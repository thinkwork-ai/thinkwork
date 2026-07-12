/**
 * memory_stage pipeline stage implementations (THINK-193 U1).
 *
 * Extracted from the memory-stage-worker handler so the harness (token
 * claim/resume/redrive) and the stage logic evolve independently. Each stage
 * takes a validated StageContext and returns a MemoryStageWorkerResult; the
 * harness owns payload validation, the durable execution claim, and task-token
 * resume.
 */

import type { Database } from "@thinkwork/database-pg";
import type { MemoryStageWorkerResult } from "@thinkwork/agent-loops-core";
import { getMemoryServices } from "../memory/index.js";
import { runBrainDreamState } from "../brain/dream/runner.js";
import {
  ensureCheckpoint,
  getCheckpoint,
  resolveTargetBankId,
} from "./repository.js";
import { CheckpointConflictError } from "./repository.js";
import {
  listEvidenceForProjection,
  recordAcquiredPage,
  recordDerivation,
  recordRunItem,
} from "./evidence.js";
import type {
  EvidenceRow,
  MemoryProcessorConfig,
  MemorySourceConfig,
} from "./types.js";
import {
  acquireCompaniesPage,
  buildCompanyDossier,
  checkTwentyReadiness,
  hindsightDocumentIdFor,
  projectionKeyForCompany,
  type TwentyCompaniesCursor,
} from "./adapters/twenty.js";

export interface MemoryStageWorkerEventShape {
  workflowRunId: string;
  tenantId: string;
  stepId: string;
  iteration: number;
  stage: string;
  processorConfigId: string;
  sourceConfigId: string | null;
  options: Record<string, unknown> | null;
}

export interface StageContext {
  db: Database;
  event: MemoryStageWorkerEventShape;
  processor: MemoryProcessorConfig & { target_scope: "space" | "tenant" };
  sources: MemorySourceConfig[];
}

export function failed(stage: string, error: string): MemoryStageWorkerResult {
  return { status: "failed", stage, error };
}

export function boundedInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export function cursorFromCheckpoint(
  cursor: Record<string, unknown> | null | undefined,
): TwentyCompaniesCursor | null {
  const lastUpdatedAt = cursor?.lastUpdatedAt;
  const lastId = cursor?.lastId;
  if (typeof lastUpdatedAt !== "string" || typeof lastId !== "string") {
    return null;
  }
  return { lastUpdatedAt, lastId };
}

// ---------------------------------------------------------------------------
// Stage implementations
// ---------------------------------------------------------------------------

export async function runAcquire(
  ctx: StageContext,
): Promise<MemoryStageWorkerResult> {
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
    let pageToken: string | null = null;
    let fetched = 0;
    let casRetries = 0;

    while (fetched < maxRecords) {
      const page = await acquireCompaniesPage(readiness.client, {
        cursor,
        pageSize: Math.min(pageSize, maxRecords - fetched),
        targetScope: processor.target_scope,
        targetId: processor.target_id,
        startingAfter: pageToken,
      });
      counts.pages += 1;
      fetched += page.rawCount;
      pageToken = page.pageToken ?? null;

      if (page.items.length === 0) {
        // A full raw page whose kept set is empty means every record is
        // covered by the cursor (an equal-updatedAt cohort). With a provider
        // page token we advance through it; without one we must fail
        // VISIBLY — silently breaking would permanently skip the cohort.
        const fullPage = page.rawCount >= Math.min(pageSize, maxRecords);
        if (fullPage && pageToken) continue;
        if (fullPage && !pageToken) {
          return failed(
            event.stage,
            "acquisition cannot advance past an equal-updatedAt cohort: the Twenty server exposed no page cursor — raise pageSize above the cohort size or upgrade Twenty",
          );
        }
        break;
      }

      // High-water cursor: last kept item's (updatedAt, id) — but only from
      // items with a real timestamp version. A hash-fallback sourceVersion
      // must never become lastUpdatedAt (it would be compared against ISO
      // timestamps); such items are re-seen next run and deduped instead.
      const lastTimestamped = [...page.items]
        .reverse()
        .find((item) => item.sourceTimestamp != null);
      const highWater: TwentyCompaniesCursor = lastTimestamped
        ? {
            lastUpdatedAt: lastTimestamped.sourceVersion,
            lastId: lastTimestamped.sourceItemId,
          }
        : (cursor ?? { lastUpdatedAt: null, lastId: null });

      try {
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
        casRetries = 0;
      } catch (err) {
        if (err instanceof CheckpointConflictError && casRetries < 3) {
          // A concurrent worker (duplicate Event delivery or a parallel run
          // on the same source) advanced the checkpoint first. Their commit
          // is durable and evidence upserts dedupe, so re-read the surviving
          // cursor and continue instead of failing a run whose work is done.
          casRetries += 1;
          checkpoint =
            (await getCheckpoint(db, {
              sourceConfigId: source.id,
              partitionKey: "companies",
            })) ??
            (await ensureCheckpoint(db, {
              tenantId: processor.tenant_id,
              sourceConfigId: source.id,
              partitionKey: "companies",
            }));
          cursor = cursorFromCheckpoint(checkpoint.cursor);
          pageToken = null;
          continue;
        }
        throw err;
      }
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
      })),
    );
  }
  return rows;
}

export async function runProject(
  ctx: StageContext,
): Promise<MemoryStageWorkerResult> {
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

export async function runRetain(
  ctx: StageContext,
): Promise<MemoryStageWorkerResult> {
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
    if (!snapshot) {
      counts.noop += 1;
      await recordRunItem(db, {
        tenantId: item.tenant_id,
        workflowRunId: event.workflowRunId,
        sourceConfigId: item.source_config_id,
        sourceItemId: item.source_item_id,
        stage: "retain",
        result: "failed",
        detail: { reason: "evidence item has no normalized snapshot" },
      });
      continue;
    }
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

export async function runCompound(
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
