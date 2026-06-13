/**
 * eval-runner Lambda
 *
 * U3 turns this handler into a dispatcher. It owns run/test-case selection and
 * SQS fan-out only; eval-worker owns per-case AgentCore invocation, judging,
 * result writes, and last-writer run finalization.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  evalDatasets,
  evalRuns,
  evalTestCases,
  tenants,
} from "@thinkwork/database-pg/schema";
import { CURRENT_EVAL_SCORING_VERSION } from "@thinkwork/evals-core";
import {
  SendMessageBatchCommand,
  SQSClient,
  type SQSClientConfig,
} from "@aws-sdk/client-sqs";
import { notifyEvalRunUpdate } from "../lib/eval-notify.js";
import { resolveTenantPlatformAgent } from "../lib/agents/tenant-platform-agent.js";
import {
  captureRunSnapshot,
  createEvalDatasetStorageFromConfig,
  type RunSnapshot,
} from "../lib/evals/run-launch.js";
import type { DatasetStorage } from "../lib/evals/dataset-store.js";

const REGION = process.env.AWS_REGION || "us-east-1";
// Read per-invocation, not at module load (vitest env capture timing —
// Lambda sets it before init anyway).
function fanoutQueueUrl(): string {
  return process.env.EVAL_FANOUT_QUEUE_URL || "";
}

const sqs = new SQSClient({ region: REGION } satisfies SQSClientConfig);
let sqsClientForTests: SQSClient | undefined;

interface EvalRunnerEvent {
  runId: string;
  input?: {
    testCaseIds?: unknown;
  } | null;
}

export interface EvalWorkerMessage {
  runId: string;
  testCaseId: string;
  index: number;
  /**
   * Dataset-pinned launches (Trust Core U6): the run-scoped S3 key the
   * worker fetches the case content from, plus its expected sha. The
   * message stays small — content lives in the snapshot copy, never
   * inline (256KB SQS cap; U7 flagged-thread payloads exceed it).
   */
  snapshotKey?: string;
  contentSha?: string;
  /**
   * Flagged-thread cases (U8): launch-computed sha256 per payload
   * object copied into the run snapshot prefix. The worker verifies
   * its run-prefix payload fetch against these before replaying the
   * recorded history.
   */
  payloadShas?: Partial<Record<"history" | "workspace" | "traces", string>>;
}

const DIRECT_AGENTCORE_MESSAGE_SHARDS = Math.max(
  1,
  Number(process.env.EVAL_DIRECT_AGENTCORE_MESSAGE_SHARDS ?? 20),
);

export function selectedTestCaseIdsFromEvent(event: EvalRunnerEvent): string[] {
  const ids = event.input?.testCaseIds;
  if (!Array.isArray(ids)) return [];
  return ids.filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
}

export function buildEvalWorkerMessages(
  runId: string,
  testCases: Array<{
    id: string;
    snapshotKey?: string;
    contentSha?: string;
    payloadShas?: EvalWorkerMessage["payloadShas"];
  }>,
): EvalWorkerMessage[] {
  return testCases.map((tc, index) => ({
    runId,
    testCaseId: tc.id,
    index,
    ...(tc.snapshotKey
      ? { snapshotKey: tc.snapshotKey, contentSha: tc.contentSha }
      : {}),
    ...(tc.snapshotKey && tc.payloadShas
      ? { payloadShas: tc.payloadShas }
      : {}),
  }));
}

export function chunkEvalWorkerMessages(
  messages: EvalWorkerMessage[],
): EvalWorkerMessage[][] {
  const batches: EvalWorkerMessage[][] = [];
  for (let offset = 0; offset < messages.length; offset += 10) {
    batches.push(messages.slice(offset, offset + 10));
  }
  return batches;
}

export function evalWorkerMessageGroupIdForMessage(
  run: Pick<typeof evalRuns.$inferSelect, "computer_id" | "agent_id" | "id">,
  message: Pick<EvalWorkerMessage, "index">,
  shardCount = DIRECT_AGENTCORE_MESSAGE_SHARDS,
): string {
  if (run.computer_id) return `eval-computer:${run.computer_id}`;

  const safeShardCount = Math.max(1, Math.floor(shardCount));
  const shard = message.index % safeShardCount;
  return `eval-agentcore:${run.agent_id ?? run.id}:${shard}`;
}

export function excludesComputerSurfaceByDefault(
  run: Pick<typeof evalRuns.$inferSelect, "computer_id" | "execution_target">,
  selectedTestCaseIds: string[],
): boolean {
  return (
    run.execution_target !== "desktop-pi" &&
    !run.computer_id &&
    selectedTestCaseIds.length === 0
  );
}

/** Test seam: dispatcher tests inject a fake SQS client. */
export function _setSqsClientForTests(client: SQSClient | undefined): void {
  sqsClientForTests = client;
}

let datasetStorageForTests: DatasetStorage | undefined;

/** Test seam: dataset dispatch tests inject an in-memory storage fake. */
export function _setDatasetStorageForTests(
  storage: DatasetStorage | undefined,
): void {
  datasetStorageForTests = storage;
}

async function sendFanoutBatch(
  queueUrl: string,
  batch: EvalWorkerMessage[],
  client: SQSClient,
  run: Pick<typeof evalRuns.$inferSelect, "computer_id" | "agent_id" | "id">,
): Promise<void> {
  const resp = await client.send(
    new SendMessageBatchCommand({
      QueueUrl: queueUrl,
      Entries: batch.map((message) => ({
        Id: String(message.index),
        MessageBody: JSON.stringify(message),
        MessageGroupId: evalWorkerMessageGroupIdForMessage(run, message),
      })),
    }),
  );
  if (resp.Failed && resp.Failed.length > 0) {
    throw new Error(
      `SQS SendMessageBatch failed for ${resp.Failed.length} eval cases: ${resp.Failed.map((f) => f.Id ?? f.Message).join(", ")}`,
    );
  }
}

/**
 * Dataset-pinned dispatch (Trust Core U6). The startEvalRun mutation
 * already resolved the dataset (drift-healing the index) and stamped
 * run.dataset_id; this path captures the launch-time snapshot — copying
 * every enabled case's sha-verified content into the run snapshot
 * prefix — pins dataset_version + pinned_case_ids + total_tests on the
 * run row, and fans out messages that carry the run-scoped S3 key +
 * expected sha. A copy failure throws; the handler's catch marks the
 * run failed with the error message.
 */
async function dispatchDatasetRun(
  db: ReturnType<typeof getDb>,
  run: typeof evalRuns.$inferSelect,
  queueUrl: string,
  client: SQSClient,
): Promise<{ dispatched: number; totalTests: number }> {
  const datasetId = run.dataset_id;
  if (!datasetId) throw new Error("run has no dataset_id");
  const [dataset] = await db
    .select({ slug: evalDatasets.slug })
    .from(evalDatasets)
    .where(
      and(
        eq(evalDatasets.id, datasetId),
        eq(evalDatasets.tenant_id, run.tenant_id),
      ),
    );
  if (!dataset) {
    throw new Error(`dataset ${datasetId} not found for run ${run.id}`);
  }
  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, run.tenant_id));
  if (!tenant?.slug) {
    throw new Error(`tenant ${run.tenant_id} has no slug`);
  }

  const storage =
    datasetStorageForTests ?? createEvalDatasetStorageFromConfig();
  const snapshot: RunSnapshot = await captureRunSnapshot(
    { tenantId: run.tenant_id, tenantSlug: tenant.slug, slug: dataset.slug },
    run.id,
    storage,
  );
  const pinnedCaseIds = snapshot.cases.map((c) => c.caseId);
  const startedAt = new Date();

  if (snapshot.cases.length === 0) {
    // Zero enabled cases: nothing to score — the run completes with a
    // null pass_rate ("no score", never 0%), with the scope still pinned
    // so the run row records exactly what it ran against.
    await db
      .update(evalRuns)
      .set({
        status: "completed",
        started_at: run.started_at ?? startedAt,
        completed_at: startedAt,
        dataset_version: snapshot.datasetVersion,
        pinned_case_ids: [],
        total_tests: 0,
        passed: 0,
        failed: 0,
        errored: run.scoring_version === null ? null : 0,
        pass_rate: null,
        summary_scoring_version:
          run.scoring_version === null ? null : CURRENT_EVAL_SCORING_VERSION,
        cost_usd: "0.000000",
      })
      .where(eq(evalRuns.id, run.id));
    await notifyEvalRunUpdate({
      runId: run.id,
      tenantId: run.tenant_id,
      agentId: run.agent_id,
      status: "completed",
      totalTests: 0,
      passed: 0,
      failed: 0,
    });
    return { dispatched: 0, totalTests: 0 };
  }

  if (!run.computer_id && !run.agent_id) {
    const platformAgent = await resolveTenantPlatformAgent(run.tenant_id);
    const [updatedRun] = await db
      .update(evalRuns)
      .set({ agent_id: platformAgent.id })
      .where(eq(evalRuns.id, run.id))
      .returning();
    run = updatedRun ?? { ...run, agent_id: platformAgent.id };
  }

  // Resolve the pinned dataset_case_ids to their index row uuids —
  // eval_results FK eval_test_cases for dedupe + trend history. The
  // mutation's drift-heal read just re-synced the index, and index rows
  // are never deleted (tombstone = enabled=false), so every pinned case
  // must resolve. NO enabled filter here: enabled-ness was decided from
  // the snapshot content at capture time.
  const idRows = await db
    .select({
      id: evalTestCases.id,
      dataset_case_id: evalTestCases.dataset_case_id,
    })
    .from(evalTestCases)
    .where(
      and(
        eq(evalTestCases.tenant_id, run.tenant_id),
        eq(evalTestCases.dataset_id, datasetId),
        inArray(evalTestCases.dataset_case_id, pinnedCaseIds),
      ),
    );
  const uuidByCaseId = new Map(
    idRows
      .filter((r): r is typeof r & { dataset_case_id: string } =>
        Boolean(r.dataset_case_id),
      )
      .map((r) => [r.dataset_case_id, r.id]),
  );
  const unresolved = pinnedCaseIds.filter((id) => !uuidByCaseId.has(id));
  if (unresolved.length > 0) {
    throw new Error(
      `dataset ${dataset.slug} index rows missing for pinned case(s): ${unresolved.join(", ")}`,
    );
  }

  await db
    .update(evalRuns)
    .set({
      status: "running",
      started_at: run.started_at ?? startedAt,
      dataset_version: snapshot.datasetVersion,
      pinned_case_ids: pinnedCaseIds,
      // Belt-and-suspenders for legacy read paths (placeholder rows,
      // pre-pinning reconciler fallback): record the resolved uuids too.
      selected_test_case_ids: pinnedCaseIds.map(
        (caseId) => uuidByCaseId.get(caseId) as string,
      ),
      total_tests: snapshot.cases.length,
      passed: 0,
      failed: 0,
      errored: run.scoring_version === null ? null : 0,
      pass_rate: null,
      summary_scoring_version: null,
      cost_usd: "0.000000",
      error_message: null,
    })
    .where(eq(evalRuns.id, run.id));
  await notifyEvalRunUpdate({
    runId: run.id,
    tenantId: run.tenant_id,
    agentId: run.agent_id,
    status: "running",
    totalTests: snapshot.cases.length,
  });

  const messages = buildEvalWorkerMessages(
    run.id,
    snapshot.cases.map((c) => ({
      id: uuidByCaseId.get(c.caseId) as string,
      snapshotKey: c.snapshotKey,
      contentSha: c.contentSha,
      payloadShas: c.payloadShas,
    })),
  );
  for (const batch of chunkEvalWorkerMessages(messages)) {
    await sendFanoutBatch(queueUrl, batch, client, run);
  }

  console.log(
    `[eval-runner] runId=${run.id} dataset=${dataset.slug} v${snapshot.datasetVersion} dispatched ${snapshot.cases.length} pinned eval cases`,
  );
  return {
    dispatched: snapshot.cases.length,
    totalTests: snapshot.cases.length,
  };
}

export async function handler(event: EvalRunnerEvent): Promise<{
  ok: boolean;
  runId: string;
  error?: string;
  dispatched?: number;
  totalTests?: number;
}> {
  const { runId } = event;
  if (!runId) return { ok: false, runId: "", error: "missing runId" };

  const db = getDb();
  let [run] = await db.select().from(evalRuns).where(eq(evalRuns.id, runId));
  if (!run) return { ok: false, runId, error: "run not found" };

  console.log(
    `[eval-runner] dispatching runId=${runId} tenant=${run.tenant_id} agent=${run.agent_id}`,
  );

  try {
    const queueUrl = fanoutQueueUrl();
    if (!queueUrl) {
      throw new Error("EVAL_FANOUT_QUEUE_URL is not configured");
    }

    // Dataset-pinned launch (Trust Core U6): copy-at-launch + pinned
    // fan-out. Legacy category/test-case launches continue below.
    if (run.dataset_id) {
      const client = sqsClientForTests ?? sqs;
      const { dispatched, totalTests } = await dispatchDatasetRun(
        db,
        run,
        queueUrl,
        client,
      );
      return { ok: true, runId, dispatched, totalTests };
    }

    const eventSelectedTestCaseIds = selectedTestCaseIdsFromEvent(event);
    const selectedTestCaseIds =
      eventSelectedTestCaseIds.length > 0
        ? eventSelectedTestCaseIds
        : run.selected_test_case_ids;
    const caseConditions = [
      eq(evalTestCases.tenant_id, run.tenant_id),
      eq(evalTestCases.enabled, true),
    ];
    if (selectedTestCaseIds.length > 0) {
      caseConditions.push(inArray(evalTestCases.id, selectedTestCaseIds));
    } else if (run.categories.length > 0) {
      caseConditions.push(inArray(evalTestCases.category, run.categories));
    }
    if (excludesComputerSurfaceByDefault(run, selectedTestCaseIds)) {
      caseConditions.push(
        sql`not (${evalTestCases.tags} @> ARRAY['surface:computer']::text[])`,
      );
    }

    const cases = await db
      .select({ id: evalTestCases.id })
      .from(evalTestCases)
      .where(and(...caseConditions));

    const startedAt = new Date();
    if (cases.length === 0) {
      // Zero matching cases means there is nothing to score: the run
      // completes with a null pass_rate ("no score"), never 0%.
      await db
        .update(evalRuns)
        .set({
          status: "completed",
          started_at: run.started_at ?? startedAt,
          completed_at: startedAt,
          total_tests: 0,
          passed: 0,
          failed: 0,
          errored: run.scoring_version === null ? null : 0,
          pass_rate: null,
          summary_scoring_version:
            run.scoring_version === null ? null : CURRENT_EVAL_SCORING_VERSION,
          cost_usd: "0.000000",
        })
        .where(eq(evalRuns.id, runId));
      await notifyEvalRunUpdate({
        runId,
        tenantId: run.tenant_id,
        agentId: run.agent_id,
        status: "completed",
        totalTests: 0,
        passed: 0,
        failed: 0,
      });
      return { ok: true, runId, dispatched: 0, totalTests: 0 };
    }

    if (!run.computer_id && !run.agent_id) {
      const platformAgent = await resolveTenantPlatformAgent(run.tenant_id);
      const [updatedRun] = await db
        .update(evalRuns)
        .set({ agent_id: platformAgent.id })
        .where(eq(evalRuns.id, runId))
        .returning();
      run = updatedRun ?? { ...run, agent_id: platformAgent.id };
    }

    await db
      .update(evalRuns)
      .set({
        status: "running",
        started_at: run.started_at ?? startedAt,
        total_tests: cases.length,
        passed: 0,
        failed: 0,
        errored: run.scoring_version === null ? null : 0,
        pass_rate: null,
        summary_scoring_version: null,
        cost_usd: "0.000000",
        error_message: null,
      })
      .where(eq(evalRuns.id, runId));
    await notifyEvalRunUpdate({
      runId,
      tenantId: run.tenant_id,
      agentId: run.agent_id,
      status: "running",
      totalTests: cases.length,
    });

    const messages = buildEvalWorkerMessages(runId, cases);
    const client = sqsClientForTests ?? sqs;
    for (const batch of chunkEvalWorkerMessages(messages)) {
      await sendFanoutBatch(queueUrl, batch, client, run);
    }

    console.log(
      `[eval-runner] runId=${runId} dispatched ${cases.length} eval cases`,
    );
    return {
      ok: true,
      runId,
      dispatched: cases.length,
      totalTests: cases.length,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const completedAt = new Date();
    await db
      .update(evalRuns)
      .set({
        status: "failed",
        completed_at: completedAt,
        error_message: message,
      })
      .where(eq(evalRuns.id, runId));
    await notifyEvalRunUpdate({
      runId,
      tenantId: run.tenant_id,
      agentId: run.agent_id,
      status: "failed",
      errorMessage: message,
    });
    console.error(`[eval-runner] runId=${runId} dispatch failed:`, message);
    return { ok: false, runId, error: message };
  }
}
