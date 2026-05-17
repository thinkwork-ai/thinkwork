/**
 * eval-runner Lambda
 *
 * U3 turns this handler into a dispatcher. It owns run/test-case selection and
 * SQS fan-out only; eval-worker owns per-case AgentCore invocation, judging,
 * result writes, and last-writer run finalization.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { evalRuns, evalTestCases } from "@thinkwork/database-pg/schema";
import {
  SendMessageBatchCommand,
  SQSClient,
  type SQSClientConfig,
} from "@aws-sdk/client-sqs";
import { notifyEvalRunUpdate } from "../lib/eval-notify.js";
import { ensureEvalAgentForTemplate } from "../lib/evals/eval-agent-provisioning.js";

const REGION = process.env.AWS_REGION || "us-east-1";
const DEFAULT_QUEUE_URL = process.env.EVAL_FANOUT_QUEUE_URL || "";

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
  testCases: Array<{ id: string }>,
): EvalWorkerMessage[] {
  return testCases.map((tc, index) => ({
    runId,
    testCaseId: tc.id,
    index,
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
  run: Pick<typeof evalRuns.$inferSelect, "computer_id">,
  selectedTestCaseIds: string[],
): boolean {
  return !run.computer_id && selectedTestCaseIds.length === 0;
}

/** Test seam: dispatcher tests inject a fake SQS client. */
export function _setSqsClientForTests(client: SQSClient | undefined): void {
  sqsClientForTests = client;
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
    const queueUrl = DEFAULT_QUEUE_URL;
    if (!queueUrl) {
      throw new Error("EVAL_FANOUT_QUEUE_URL is not configured");
    }

    const selectedTestCaseIds = selectedTestCaseIdsFromEvent(event);
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
      await db
        .update(evalRuns)
        .set({
          status: "completed",
          started_at: run.started_at ?? startedAt,
          completed_at: startedAt,
          total_tests: 0,
          passed: 0,
          failed: 0,
          pass_rate: "0.0000",
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
        passRate: 0,
      });
      return { ok: true, runId, dispatched: 0, totalTests: 0 };
    }

    if (!run.computer_id && !run.agent_id && run.agent_template_id) {
      const target = await ensureEvalAgentForTemplate({
        tenantId: run.tenant_id,
        templateId: run.agent_template_id,
      });
      const [updatedRun] = await db
        .update(evalRuns)
        .set({ agent_id: target.agentId })
        .where(eq(evalRuns.id, runId))
        .returning();
      run = updatedRun ?? { ...run, agent_id: target.agentId };
    }

    await db
      .update(evalRuns)
      .set({
        status: "running",
        started_at: run.started_at ?? startedAt,
        total_tests: cases.length,
        passed: 0,
        failed: 0,
        pass_rate: null,
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
