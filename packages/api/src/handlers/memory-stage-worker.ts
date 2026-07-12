/**
 * memory-stage-worker — async executor for `memory_stage` workflow steps
 * (external memory compounding, THINK-193 U1).
 *
 * Event-invoked by workflow-step-dispatch's await_memory_stage phase AFTER the
 * task token is stored. Runs exactly one pipeline stage (U1 implements
 * acquire / project / retain / compound over the Twenty source family), then
 * resumes the parked Step Functions execution: the token is CAS-consumed and
 * SendTaskSuccess carries a MemoryStageWorkerResult JSON that the
 * record_memory_stage phase turns into step evidence. Stage failures resume
 * with status "failed" — the run fails visibly; the machine never parks
 * forever behind a crashed worker (a genuinely dead worker is bounded by the
 * ASL TimeoutSeconds).
 *
 * Scope guard (R11/AE7): every stage loads the processor config and calls
 * assertSharedScope — user_* targets and cross-tenant payloads are rejected
 * before any source read or bank write.
 *
 * Idempotency: acquire advances the source checkpoint only in the same
 * transaction that records the evidence page (replay dedupes by source
 * item/version); retain re-issues the same stable Hindsight document_id with
 * update_mode=replace; duplicate Event deliveries lose the token CAS and
 * exit as already_resolved.
 */

import { SendTaskSuccessCommand, SFNClient } from "@aws-sdk/client-sfn";
import { consumeTaskToken, getDb } from "@thinkwork/database-pg";
import { workflowTaskTokens } from "@thinkwork/database-pg/schema";
import { and, eq } from "drizzle-orm";
import type { Database } from "@thinkwork/database-pg";
import { getMemoryServices } from "../lib/memory/index.js";
import { runBrainDreamState } from "../lib/brain/dream/runner.js";
import {
  assertSharedScope,
  ensureCheckpoint,
  getProcessorConfig,
  getSourceConfig,
  MemoryScopeError,
  resolveTargetBankId,
} from "../lib/memory-sources/repository.js";
import {
  listEvidenceForProjection,
  recordAcquiredPage,
  recordDerivation,
  recordRunItem,
} from "../lib/memory-sources/evidence.js";
import type {
  EvidenceRow,
  MemoryProcessorConfig,
  MemorySourceConfig,
} from "../lib/memory-sources/types.js";
import {
  acquireCompaniesPage,
  buildCompanyDossier,
  checkTwentyReadiness,
  hindsightDocumentIdFor,
  projectionKeyForCompany,
  type TwentyCompaniesCursor,
} from "../lib/memory-sources/adapters/twenty.js";

// ---------------------------------------------------------------------------
// Protocol mirrors — the dispatch side owns these shapes
// (packages/lambda/workflow-step-dispatch.ts MemoryStageWorkerInvokePayload /
// MemoryStageWorkerResult). packages/lambda cannot be imported from
// packages/api, so keep the mirrors byte-compatible.
// ---------------------------------------------------------------------------

export interface MemoryStageWorkerEvent {
  workflowRunId: string;
  tenantId: string;
  stepId: string;
  iteration: number;
  stage: string;
  processorConfigId: string;
  sourceConfigId: string | null;
  options: Record<string, unknown> | null;
}

export interface MemoryStageWorkerResult {
  status: "succeeded" | "failed";
  stage: string;
  counts?: Record<string, number>;
  error?: string;
  output?: Record<string, unknown>;
}

const _DEFAULT_SFN_CLIENT = new SFNClient({});
const CONSUMED_ERROR_NAMES = new Set(["TaskDoesNotExist", "TaskTimedOut"]);

const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_MAX_RECORDS = 200;

interface StageContext {
  db: Database;
  event: MemoryStageWorkerEvent;
  processor: MemoryProcessorConfig & { target_scope: "space" | "tenant" };
  sources: MemorySourceConfig[];
}

// ---------------------------------------------------------------------------
// Stage implementations
// ---------------------------------------------------------------------------

async function runAcquire(ctx: StageContext): Promise<MemoryStageWorkerResult> {
  const { db, event, processor } = ctx;
  const counts = { changed: 0, seen: 0, pages: 0 };
  const perSource: Record<string, unknown> = {};

  for (const source of ctx.sources) {
    if (source.source_family !== "twenty") {
      return failed(
        event.stage,
        `source family "${source.source_family}" is not implemented in U1 (only twenty)`,
      );
    }
    if (!processor.created_by_user_id) {
      return failed(
        event.stage,
        "processor has no owning user to mint a Twenty token with — set created_by_user_id",
      );
    }

    const readiness = await checkTwentyReadiness(db, {
      tenantId: processor.tenant_id,
      userId: processor.created_by_user_id,
    });
    if (!readiness.ready) {
      // blocked_not_ready semantics: visible failure, checkpoint untouched.
      return failed(
        event.stage,
        `Twenty source not ready: ${readiness.reason}`,
      );
    }

    const boundary = (source.boundary ?? {}) as Record<string, unknown>;
    const options = event.options ?? {};
    const pageSize = boundedInt(
      options.pageSize ?? boundary.pageSize,
      DEFAULT_PAGE_SIZE,
      1,
      200,
    );
    const maxRecords = boundedInt(
      options.maxRecords ?? boundary.maxRecords,
      DEFAULT_MAX_RECORDS,
      1,
      2000,
    );

    let checkpoint = await ensureCheckpoint(db, {
      tenantId: processor.tenant_id,
      sourceConfigId: source.id,
      partitionKey: "companies",
    });
    let cursor = cursorFromCheckpoint(checkpoint.cursor);
    let fetched = 0;

    while (fetched < maxRecords) {
      const page = await acquireCompaniesPage(readiness.client, {
        cursor,
        pageSize: Math.min(pageSize, maxRecords - fetched),
        targetScope: processor.target_scope,
        targetId: processor.target_id,
      });
      counts.pages += 1;
      fetched += page.rawCount;

      if (page.items.length === 0) break;

      // High-water cursor: last kept item's (updatedAt, id). Persisted even on
      // the final page so the next run resumes incrementally.
      const last = page.items[page.items.length - 1]!;
      const highWater: TwentyCompaniesCursor = {
        lastUpdatedAt: last.sourceVersion,
        lastId: last.sourceItemId,
      };

      const recorded = await recordAcquiredPage(db, {
        tenantId: processor.tenant_id,
        sourceConfigId: source.id,
        workflowRunId: event.workflowRunId,
        partitionKey: "companies",
        expectedCheckpointVersion: checkpoint.version,
        nextCursor: highWater as unknown as Record<string, unknown>,
        items: page.items,
      });
      counts.changed += recorded.changed.length;
      counts.seen += recorded.seen;
      checkpoint = recorded.checkpoint;
      cursor = page.nextCursor ?? highWater;

      if (page.nextCursor === null) break;
    }

    perSource[source.id] = {
      family: source.source_family,
      fetched,
      checkpointVersion: checkpoint.version,
    };
  }

  return {
    status: "succeeded",
    stage: event.stage,
    counts,
    output: { sources: perSource },
  };
}

async function changedEvidence(ctx: StageContext): Promise<EvidenceRow[]> {
  const rows: EvidenceRow[] = [];
  for (const source of ctx.sources) {
    rows.push(
      ...(await listEvidenceForProjection(ctx.db, {
        sourceConfigId: source.id,
        workflowRunId: ctx.event.workflowRunId,
      })),
    );
  }
  return rows;
}

async function runProject(ctx: StageContext): Promise<MemoryStageWorkerResult> {
  const { db, event } = ctx;
  const items = await changedEvidence(ctx);
  const counts = { changed: 0, noop: 0, failed: 0 };

  for (const item of items) {
    const snapshot = item.normalized_snapshot as Record<string, unknown> | null;
    if (!snapshot) {
      counts.failed += 1;
      await recordRunItem(db, {
        tenantId: item.tenant_id,
        workflowRunId: event.workflowRunId,
        sourceConfigId: item.source_config_id,
        sourceItemId: item.source_item_id,
        stage: "project",
        result: "failed",
        detail: { reason: "evidence item has no normalized snapshot" },
      });
      continue;
    }
    const dossier = buildCompanyDossier(snapshot);
    const projectionKey = projectionKeyForCompany(item.source_item_id);
    counts.changed += 1;
    await recordRunItem(db, {
      tenantId: item.tenant_id,
      workflowRunId: event.workflowRunId,
      sourceConfigId: item.source_config_id,
      sourceItemId: item.source_item_id,
      stage: "project",
      result: "changed",
      detail: {
        projectionKey,
        title: dossier.title,
        bytes: dossier.markdown.length,
      },
    });
  }

  if (items.length === 0) counts.noop = 1;
  return { status: "succeeded", stage: event.stage, counts };
}

async function runRetain(ctx: StageContext): Promise<MemoryStageWorkerResult> {
  const { db, event, processor } = ctx;
  const { adapter, config } = getMemoryServices();
  if (config.engine !== "hindsight" || !adapter.upsertMarkdownMemoryDocument) {
    return failed(
      event.stage,
      `memory engine "${config.engine}" has no document upsert — Hindsight required`,
    );
  }

  const items = await changedEvidence(ctx);
  const counts = { changed: 0, noop: 0 };
  const targetBankId = resolveTargetBankId(processor);
  const documents: string[] = [];

  for (const item of items) {
    const snapshot = item.normalized_snapshot as Record<string, unknown> | null;
    if (!snapshot) continue;
    const dossier = buildCompanyDossier(snapshot);
    const projectionKey = projectionKeyForCompany(item.source_item_id);
    const documentId = hindsightDocumentIdFor(
      item.source_config_id,
      projectionKey,
    );

    // Synchronous replace: the workflow's compound stage must observe a bank
    // that already contains this projection.
    await adapter.upsertMarkdownMemoryDocument({
      tenantId: processor.tenant_id,
      ownerType: processor.target_scope,
      ownerId: processor.target_id,
      path: `memory-sources/twenty/${projectionKey.replace(":", "/")}.md`,
      documentId,
      context: "external_source_projection",
      content: dossier.markdown,
      async: false,
      metadata: {
        source: "twenty",
        sourceConfigId: item.source_config_id,
        projectionKey,
        contentHash: item.content_hash,
        sourceVersion: item.source_version,
      },
    });

    await recordDerivation(db, {
      tenantId: processor.tenant_id,
      sourceConfigId: item.source_config_id,
      evidenceItemId: item.id,
      projectionKey,
      targetBankId,
      hindsightDocumentId: documentId,
      currentVersion: item.source_version,
    });
    await recordRunItem(db, {
      tenantId: processor.tenant_id,
      workflowRunId: event.workflowRunId,
      sourceConfigId: item.source_config_id,
      sourceItemId: item.source_item_id,
      stage: "retain",
      result: "changed",
      detail: { documentId, targetBankId, bytes: dossier.markdown.length },
    });
    counts.changed += 1;
    documents.push(documentId);
  }

  if (items.length === 0) counts.noop = 1;
  return {
    status: "succeeded",
    stage: event.stage,
    counts,
    output: { targetBankId, documents: documents.slice(0, 50) },
  };
}

async function runCompound(
  ctx: StageContext,
): Promise<MemoryStageWorkerResult> {
  const { db, event, processor } = ctx;
  const { adapter, config } = getMemoryServices();
  if (config.engine !== "hindsight" || !adapter.consolidateBankById) {
    return failed(
      event.stage,
      `memory engine "${config.engine}" has no targeted consolidation — Hindsight required`,
    );
  }

  const bankId = resolveTargetBankId(processor);
  const result = await runBrainDreamState({
    db,
    consolidator: {
      consolidateBankById: (id: string) => adapter.consolidateBankById!(id),
    },
    input: { tenantId: processor.tenant_id, bankId, dryRun: false },
  });

  const bank = result.banks[0];
  const applied =
    bank?.status === "applied" ||
    bank?.status === "resumed_applied" ||
    bank?.status === "skipped_dedupe";
  if (!bank || !applied) {
    return failed(
      event.stage,
      `targeted consolidation of ${bankId} did not settle: ${bank?.status ?? "no bank result"}${bank?.error ? ` (${bank.error})` : ""}`,
    );
  }

  await recordRunItem(db, {
    tenantId: processor.tenant_id,
    workflowRunId: event.workflowRunId,
    sourceConfigId: ctx.sources[0]?.id ?? processor.id,
    sourceItemId: bankId,
    stage: "compound",
    result: "changed",
    detail: {
      dreamRunId: bank.runId,
      status: bank.status,
      applied: bank.applied ?? null,
    },
  });

  return {
    status: "succeeded",
    stage: event.stage,
    counts: { compounded: 1 },
    output: {
      bankId,
      dreamRunId: bank.runId,
      dreamStatus: bank.status,
    },
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function failed(stage: string, error: string): MemoryStageWorkerResult {
  return { status: "failed", stage, error };
}

function boundedInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function cursorFromCheckpoint(
  cursor: Record<string, unknown> | null | undefined,
): TwentyCompaniesCursor | null {
  const lastUpdatedAt = cursor?.lastUpdatedAt;
  const lastId = cursor?.lastId;
  if (typeof lastUpdatedAt !== "string" || typeof lastId !== "string") {
    return null;
  }
  return { lastUpdatedAt, lastId };
}

async function executeStage(
  db: Database,
  event: MemoryStageWorkerEvent,
): Promise<MemoryStageWorkerResult> {
  const processor = await getProcessorConfig(db, {
    tenantId: event.tenantId,
    processorConfigId: event.processorConfigId,
  });
  if (!processor) {
    return failed(
      event.stage,
      `processor config ${event.processorConfigId} not found for tenant`,
    );
  }
  if (processor.tenant_id !== event.tenantId) {
    return failed(event.stage, "processor belongs to another tenant");
  }
  if (!processor.enabled || processor.status !== "active") {
    return failed(event.stage, "processor is disabled");
  }
  try {
    assertSharedScope(processor);
  } catch (err) {
    if (err instanceof MemoryScopeError) {
      return failed(event.stage, err.message);
    }
    throw err;
  }

  let sources: MemorySourceConfig[];
  if (event.sourceConfigId) {
    const found = await getSourceConfig(db, {
      tenantId: event.tenantId,
      sourceConfigId: event.sourceConfigId,
    });
    if (!found || found.processor.id !== processor.id) {
      return failed(
        event.stage,
        `source config ${event.sourceConfigId} not found on this processor`,
      );
    }
    if (!found.source.enabled) {
      return failed(event.stage, "source config is disabled");
    }
    sources = [found.source];
  } else {
    return failed(
      event.stage,
      "U1 requires an explicit sourceConfigId on the memory_stage step",
    );
  }

  const ctx: StageContext = {
    db,
    event,
    processor: processor as StageContext["processor"],
    sources,
  };

  switch (event.stage) {
    case "acquire":
      return runAcquire(ctx);
    case "project":
      return runProject(ctx);
    case "retain":
      return runRetain(ctx);
    case "compound":
      return runCompound(ctx);
    default:
      return failed(
        event.stage,
        `stage "${event.stage}" is not implemented in U1 (acquire|project|retain|compound)`,
      );
  }
}

async function resumeToken(
  db: Database,
  sfn: SFNClient,
  event: MemoryStageWorkerEvent,
  result: MemoryStageWorkerResult,
): Promise<"resumed" | "already_resolved" | "no_token"> {
  const [pending] = await db
    .select({
      step_id: workflowTaskTokens.step_id,
      iteration: workflowTaskTokens.iteration,
    })
    .from(workflowTaskTokens)
    .where(
      and(
        eq(workflowTaskTokens.workflow_run_id, event.workflowRunId),
        eq(workflowTaskTokens.step_id, event.stepId),
        eq(workflowTaskTokens.iteration, event.iteration),
        eq(workflowTaskTokens.purpose, "memory_stage"),
        eq(workflowTaskTokens.status, "pending"),
      ),
    )
    .limit(1);
  if (!pending) return "no_token";

  const consumed = await consumeTaskToken(db, {
    workflowRunId: event.workflowRunId,
    stepId: event.stepId,
    iteration: event.iteration,
    purpose: "memory_stage",
  });
  if (!consumed) return "already_resolved";

  try {
    await sfn.send(
      new SendTaskSuccessCommand({
        taskToken: consumed.token,
        output: JSON.stringify(result),
      }),
    );
  } catch (err) {
    const name = (err as { name?: string })?.name ?? "";
    if (CONSUMED_ERROR_NAMES.has(name)) return "already_resolved";
    throw err;
  }
  return "resumed";
}

export interface MemoryStageWorkerOptions {
  db?: Database;
  sfnClient?: SFNClient;
}

export async function runMemoryStageWorker(
  event: MemoryStageWorkerEvent,
  options: MemoryStageWorkerOptions = {},
): Promise<{ result: MemoryStageWorkerResult; resume: string }> {
  const db = options.db ?? getDb();
  const sfn = options.sfnClient ?? _DEFAULT_SFN_CLIENT;

  for (const field of [
    "workflowRunId",
    "tenantId",
    "stepId",
    "stage",
    "processorConfigId",
  ] as const) {
    if (!event?.[field]) {
      throw new Error(`memory-stage-worker event is missing ${field}`);
    }
  }

  let result: MemoryStageWorkerResult;
  try {
    result = await executeStage(db, event);
  } catch (err) {
    // Never leave the machine parked: unexpected errors resume as a visible
    // stage failure. Checkpoints are transactional, so a crashed acquire left
    // no partial advance behind.
    const message = (err as Error)?.message ?? String(err);
    console.error(
      `[memory-stage-worker] stage=${event.stage} run=${event.workflowRunId} crashed: ${message}`,
    );
    result = failed(event.stage, message.slice(0, 500));
  }

  const resume = await resumeToken(db, sfn, event, result);
  console.log(
    `[memory-stage-worker] stage=${event.stage} run=${event.workflowRunId} status=${result.status} resume=${resume} counts=${JSON.stringify(result.counts ?? {})}`,
  );
  return { result, resume };
}

export async function handler(
  event: MemoryStageWorkerEvent,
): Promise<{ result: MemoryStageWorkerResult; resume: string }> {
  return runMemoryStageWorker(event);
}
