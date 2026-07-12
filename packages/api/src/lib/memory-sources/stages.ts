/**
 * memory_stage pipeline stage implementations (THINK-193 U1).
 *
 * Extracted from the memory-stage-worker handler so the harness (token
 * claim/resume/redrive) and the stage logic evolve independently. Each stage
 * takes a validated StageContext and returns a MemoryStageWorkerResult; the
 * harness owns payload validation, the durable execution claim, and task-token
 * resume.
 */

import type { S3Client } from "@aws-sdk/client-s3";
import { and, desc, eq } from "drizzle-orm";
import type { Database } from "@thinkwork/database-pg";
import {
  memoryEvidenceItems,
  memoryRunItems,
} from "@thinkwork/database-pg/schema";
import {
  sanitizeApprovalPlanOverride,
  type ApprovalPlanOverride,
  type MemoryStageWorkerResult,
} from "@thinkwork/agent-loops-core";
import { getMemoryServices } from "../memory/index.js";
import { runBrainDreamState } from "../brain/dream/runner.js";
import {
  advanceCheckpoint,
  ensureCheckpoint,
  getCheckpoint,
  resolveTargetBankId,
} from "./repository.js";
import { CheckpointConflictError } from "./repository.js";
import {
  listEvidenceForProjection,
  recordAcquiredPage,
  recordDerivation,
  recordDerivationWithRunItem,
  recordRunItem,
} from "./evidence.js";
import {
  assertSourceWritable,
  rearmEraseCleanup,
  SourceEraseFencedError,
} from "./erase-fence.js";
import {
  clampSnapshotTtlDays,
  deleteEvidenceSnapshotVersion,
  getEvidenceSnapshot,
  putEvidenceSnapshot,
  resolveSnapshotBucket,
  snapshotKeyFor,
  verifyNoSnapshotVersions,
} from "./snapshots.js";
import type {
  EvidenceRow,
  MemoryProcessorConfig,
  MemorySourceConfig,
} from "./types.js";
import {
  buildClaimProjection,
  extractCompanyClaims,
  listActiveClaimsForSubject,
  upsertClaimsForEvidence,
} from "./claims.js";
import {
  assertBoundaryWithin,
  MemoryAuthorizationError,
  requireActiveGrant,
  revalidateGrant,
} from "./policy.js";
import { getCompileJob, type WikiCompileJobRow } from "../wiki/repository.js";
import { invokeWikiCompile } from "../wiki/enqueue.js";
import {
  acquireCompaniesPage,
  buildCompanyDossier,
  checkTwentyReadiness,
  hindsightDocumentIdFor,
  projectionKeyForCompany,
  reconcileCompaniesPage,
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

/**
 * Optional invocation lease injected by the handler harness (Codex F7).
 * Stages consult remainingMs() between items and stop starting new work
 * when the Lambda deadline approaches; the harness owns re-invocation.
 */
export interface StageLease {
  renew(): Promise<boolean>;
  deadlineMs?: number;
  remainingMs?: () => number;
}

export interface StageContext {
  db: Database;
  event: MemoryStageWorkerEventShape;
  /** U3: personal processors (target_scope 'user') run the pipeline too;
   * stages that write shared projections re-assert shared scope below. */
  processor: MemoryProcessorConfig;
  sources: MemorySourceConfig[];
  /** Injected by the harness; absent in tests/back-compat callers. */
  lease?: StageLease;
  /** Injected S3 client for snapshot IO; defaults to the lazy module client. */
  s3?: S3Client;
  /** Test/ops seams for the graph/wiki stages (THINK-193 U4 stitch).
   * Defaults are the real Lambda invoke + wiki compile-job repository. */
  graphWiki?: GraphWikiStageDeps;
}

/** Injectable dependencies for runGraph / runWiki (defaults in this module). */
export interface GraphWikiStageDeps {
  /** RequestResponse-invoke the targeted observations ingest Lambda. */
  invokeObservationsIngest?: (
    payload: GraphIngestInvokePayload,
  ) => Promise<GraphIngestInvokeResult>;
  /** Load a wiki compile job row by id (defaults to the wiki repository). */
  getCompileJob?: (jobId: string) => Promise<WikiCompileJobRow | null>;
  /** Best-effort Event-invoke of the wiki-compile Lambda for a job id. */
  invokeCompile?: (jobId: string) => Promise<void>;
  /** Poll sleep; injectable so tests settle without wall-clock waits. */
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  /** Per-invocation settle budget for runWiki (continuation beyond it). */
  settleBudgetMs?: number;
}

/** Payload sent to thinkwork-<stage>-api-knowledge-graph-observations-ingest. */
export interface GraphIngestInvokePayload {
  tenantId: string;
  bankIds: string[];
  trigger: "manual" | "scheduled";
}

/**
 * Structural mirror of KnowledgeGraphObservationsIngestResult (the handler's
 * response shape). Declared here so lib code does not import from handlers/.
 */
export interface GraphIngestInvokeResult {
  ok: boolean;
  status: "succeeded" | "failed" | "stale_noop" | "skipped" | "sweep";
  runId?: string;
  tenantId?: string;
  metrics?: Record<string, unknown>;
  error?: string;
}

/**
 * Approved-plan override carried in options.override (THINK-193 U3). The
 * worker already applied sourceConfigIds narrowing by intersection; stages
 * consume the numeric caps through the existing narrow-only effectiveLimit.
 * Malformed values are ignored — narrowing is opt-in, widening impossible.
 */
export function overrideFrom(
  options: Record<string, unknown> | null | undefined,
): ApprovalPlanOverride | null {
  const raw = options?.override;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  try {
    return sanitizeApprovalPlanOverride(raw);
  } catch {
    return null;
  }
}

/**
 * Defensive shared-scope narrowing for stages whose write path is scoped to
 * space/tenant banks in U3 (Twenty evidence, shared claims). The worker's
 * family policy already prevents shared-only sources on personal
 * processors; this converts an impossible state into a visible failure
 * instead of a mis-typed bank id.
 */
function requireSharedProcessor(
  ctx: StageContext,
): (MemoryProcessorConfig & { target_scope: "space" | "tenant" }) | null {
  const scope = ctx.processor.target_scope;
  if (scope !== "space" && scope !== "tenant") return null;
  return ctx.processor as MemoryProcessorConfig & {
    target_scope: "space" | "tenant";
  };
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

const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_MAX_RECORDS = 200;

/**
 * Narrow-only effective limit (Codex F2): the minimum over every PRESENT
 * numeric value (saved source boundary, processor budget, requested run
 * options), falling back to `fallback` when none is present, clamped to
 * [min, max]. Run options can therefore only NARROW the persisted
 * boundary/budget — never widen them.
 */
export function effectiveLimit(
  values: Array<unknown>,
  fallback: number,
  min: number,
  max: number,
): number {
  const present = values
    .map((value) => (typeof value === "number" ? value : Number(value)))
    .filter((n, i) => values[i] != null && Number.isFinite(n));
  const chosen = present.length > 0 ? Math.min(...present) : fallback;
  return Math.max(min, Math.min(max, Math.floor(chosen)));
}

// ---------------------------------------------------------------------------
// Paging no-progress guard (Codex F5)
// ---------------------------------------------------------------------------

export interface PageProgressState {
  token: string | null;
  fingerprint: string;
}

/** Deterministic fingerprint of a page's returned record ids. */
export function pageFingerprint(ids: string[]): string {
  return ids.join("|");
}

/**
 * True when the provider made no progress between two consecutive pages:
 * it returned the same continuation token again, or the identical
 * non-empty id set. Callers must stop with a VISIBLE failure — silently
 * looping would spin the budget without ever completing.
 */
export function isNoProgress(
  prev: PageProgressState | null,
  next: PageProgressState,
): boolean {
  if (!prev) return false;
  if (next.token !== null && next.token === prev.token) return true;
  if (next.fingerprint !== "" && next.fingerprint === prev.fingerprint) {
    return true;
  }
  return false;
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

/** Opaque backscan sweep position stored inside the checkpoint cursor. */
export function backscanTokenFrom(
  cursor: Record<string, unknown> | null | undefined,
): string | null {
  const token = cursor?.backscanToken;
  return typeof token === "string" && token ? token : null;
}

// ---------------------------------------------------------------------------
// Stage implementations
// ---------------------------------------------------------------------------

export async function runAcquire(
  ctx: StageContext,
): Promise<MemoryStageWorkerResult> {
  try {
    return await runAcquireInner(ctx);
  } catch (err) {
    // Erase write-fence (round-3 P1-2): the source was disabled or its
    // erase generation advanced mid-run — the offending page transaction
    // rolled back; fail the stage visibly.
    if (err instanceof SourceEraseFencedError) {
      return failed(ctx.event.stage, err.message);
    }
    throw err;
  }
}

async function runAcquireInner(
  ctx: StageContext,
): Promise<MemoryStageWorkerResult> {
  const { db, event } = ctx;
  const counts = { changed: 0, seen: 0, pages: 0 };
  const perSource: Record<string, unknown> = {};

  // Zero configured/selected sources is a VISIBLE no-op, not a failure —
  // the normal state for a personal processor before U6 adds personal
  // source families, and for an override that deselected every source.
  if (ctx.sources.length === 0) {
    return {
      status: "succeeded",
      stage: event.stage,
      counts: { ...counts, noop: 1 },
      output: { note: "no enabled sources selected for this run" },
    };
  }
  // U3: every implemented source family (Twenty) writes shared evidence.
  const processor = requireSharedProcessor(ctx);
  if (!processor) {
    return failed(
      event.stage,
      `processor ${ctx.processor.id} targets '${ctx.processor.target_scope}' — the configured source families write shared banks only`,
    );
  }

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

    // U2 R9-R11: an explicit, current authorization grant is the maximum
    // readable envelope; the saved source boundary must sit inside it.
    // Revocation/expiry blocks acquisition immediately and visibly.
    let grantId: string;
    let grantVersion: number;
    try {
      const grant = await requireActiveGrant(db, {
        tenantId: processor.tenant_id,
        processorConfigId: processor.id,
        sourceFamily: source.source_family,
        sourceBindingKey: source.source_binding_key,
      });
      assertBoundaryWithin(
        (grant.boundary ?? {}) as Record<string, unknown>,
        (source.boundary ?? {}) as Record<string, unknown>,
        { sourceFamily: source.source_family },
      );
      grantId = grant.id;
      grantVersion = grant.grant_version;
    } catch (err) {
      if (err instanceof MemoryAuthorizationError) {
        return failed(event.stage, err.message);
      }
      throw err;
    }

    const readiness = await checkTwentyReadiness(db, {
      tenantId: processor.tenant_id,
      userId: processor.created_by_user_id,
      // Codex F3: resolve exactly the persisted tenant-owned binding —
      // readiness fails closed when it is missing/disabled/unapproved.
      bindingKey: source.source_binding_key,
    });
    if (!readiness.ready) {
      // blocked_not_ready semantics: visible failure, checkpoint untouched.
      return failed(
        event.stage,
        `Twenty source not ready: ${readiness.reason}`,
      );
    }

    // Codex F2: run options may only NARROW the saved source boundary and
    // the processor budget — the effective limit is the minimum of all
    // present values.
    const boundary = (source.boundary ?? {}) as Record<string, unknown>;
    const budget = (processor.budget ?? {}) as Record<string, unknown>;
    const options = event.options ?? {};
    // Approved-plan override (U3): joins the narrow-only minimum below —
    // a reviewer can only shrink the run, never exceed saved boundaries.
    const override = overrideFrom(options);
    // Erase write-fence captured with the source row at stage start
    // (round-3 P1-2): every page commit CASes on it in-transaction.
    const eraseFence = {
      expectedEraseGeneration: source.erase_generation ?? 0,
    };
    // Binary object capability (policy agent contract): the saved source
    // boundary's already-validated `objects` selection — omitted means the
    // adapter's companies-only (depth-0) default.
    const approvedObjects = boundary.objects as readonly string[] | undefined;
    const pageSize = effectiveLimit(
      [boundary.pageSize, budget.pageSize, options.pageSize],
      DEFAULT_PAGE_SIZE,
      1,
      200,
    );
    const maxRecords = effectiveLimit(
      [
        boundary.maxRecords,
        budget.maxRecords,
        options.maxRecords,
        override?.maxRecords,
      ],
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
    let progress: PageProgressState | null = null;

    while (fetched < maxRecords) {
      // Codex U2 #2: the grant is re-checked before EVERY provider page
      // read — a revoke/expiry/re-issue after page 1 prevents page 2, and
      // the unread page's checkpoint never advances.
      try {
        await revalidateGrant(db, {
          tenantId: processor.tenant_id,
          grantId,
          expectedGrantVersion: grantVersion,
        });
      } catch (err) {
        if (err instanceof MemoryAuthorizationError) {
          return failed(event.stage, err.message);
        }
        throw err;
      }
      const page = await acquireCompaniesPage(readiness.client, {
        cursor,
        pageSize: Math.min(pageSize, maxRecords - fetched),
        targetScope: processor.target_scope,
        targetId: processor.target_id,
        startingAfter: pageToken,
        objects: approvedObjects,
      });
      counts.pages += 1;
      fetched += page.rawCount;
      pageToken = page.pageToken ?? null;

      // No-progress guard (Codex F5): a repeated provider token or an
      // identical consecutive id set means paging is stuck — stop VISIBLY
      // instead of spinning the budget or advancing a bogus cursor.
      const observedProgress: PageProgressState = {
        token: pageToken,
        fingerprint: pageFingerprint(
          page.items.map((item) => item.sourceItemId),
        ),
      };
      if (isNoProgress(progress, observedProgress)) {
        return failed(
          event.stage,
          `acquisition made no progress on source ${source.id}: Twenty returned a repeated page token or an identical record set twice in a row — aborting the incremental pass`,
        );
      }
      progress = observedProgress;

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

      // High-water cursor: last kept item's (updatedAt, id) — from the
      // ORDERING timestamp only (Codex F4: sourceVersion now embeds a
      // content-hash edition suffix and must never become lastUpdatedAt).
      // Items without a timestamp are re-seen next run and deduped instead.
      const lastTimestamped = [...page.items]
        .reverse()
        .find((item) => item.sourceTimestamp != null);
      const observed: { lastUpdatedAt: string; lastId: string } | null =
        lastTimestamped
          ? {
              lastUpdatedAt: lastTimestamped.sourceTimestamp!.toISOString(),
              lastId: lastTimestamped.sourceItemId,
            }
          : null;
      // Monotonic guard (Codex F5): never regress the high-water mark.
      // A filtered response containing older records means provider
      // ordering/filtering is best-effort — log and rely on the backscan.
      // Compare parsed instants (not strings): mixed timestamp precision
      // ("…00Z" vs "…00.000Z") breaks lexical ordering.
      let highWater: TwentyCompaniesCursor;
      if (
        observed &&
        (!cursor?.lastUpdatedAt ||
          Date.parse(observed.lastUpdatedAt) >=
            Date.parse(cursor.lastUpdatedAt))
      ) {
        highWater = observed;
      } else {
        if (observed) {
          console.warn(
            `[memory-sources:twenty] filtered page for source ${source.id} contained records older than cursor ${cursor?.lastUpdatedAt} — keeping the cursor and relying on backscan reconciliation`,
          );
        }
        highWater = cursor ?? { lastUpdatedAt: null, lastId: null };
      }

      try {
        const recorded = await recordAcquiredPage(db, {
          tenantId: processor.tenant_id,
          sourceConfigId: source.id,
          workflowRunId: event.workflowRunId,
          partitionKey: "companies",
          expectedCheckpointVersion: checkpoint.version,
          nextCursor: {
            ...highWater,
            // Preserve the round-robin backscan position across incremental
            // checkpoint advances.
            backscanToken: backscanTokenFrom(checkpoint.cursor),
          } as unknown as Record<string, unknown>,
          items: page.items,
          eraseFence,
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
          progress = null;
          continue;
        }
        throw err;
      }
      cursor = page.nextCursor ?? highWater;

      if (page.nextCursor === null) break;
    }

    // Bounded relation reconciliation / backscan (Codex F4/F5): the
    // incremental gte-filtered pass never re-sees a company whose people/
    // opportunities/notes changed without touching the parent updatedAt.
    // Sweep unfiltered pages with the REMAINING record budget, recording
    // evidence WITHOUT advancing the incremental checkpoint (content-
    // sensitive editions make unchanged records cheap dedupe no-ops). The
    // sweep position round-robins across runs via cursor.backscanToken.
    let backscanToken = backscanTokenFrom(checkpoint.cursor);
    let backscanPages = 0;
    let backscanProgress: PageProgressState | null = null;
    while (fetched < maxRecords) {
      try {
        await revalidateGrant(db, {
          tenantId: processor.tenant_id,
          grantId,
          expectedGrantVersion: grantVersion,
        });
      } catch (err) {
        if (err instanceof MemoryAuthorizationError) {
          return failed(event.stage, err.message);
        }
        throw err;
      }
      const page = await reconcileCompaniesPage(readiness.client, {
        startingAfter: backscanToken,
        pageSize: Math.min(pageSize, maxRecords - fetched),
        targetScope: processor.target_scope,
        targetId: processor.target_id,
        objects: approvedObjects,
      });
      counts.pages += 1;
      fetched += page.rawCount;
      backscanPages += 1;

      const observedProgress: PageProgressState = {
        token: page.pageToken ?? null,
        fingerprint: pageFingerprint(
          page.items.map((item) => item.sourceItemId),
        ),
      };
      if (isNoProgress(backscanProgress, observedProgress)) {
        return failed(
          event.stage,
          `backscan made no progress on source ${source.id}: Twenty returned a repeated page token or an identical record set twice in a row — aborting the reconciliation sweep`,
        );
      }
      backscanProgress = observedProgress;

      if (page.items.length > 0) {
        const recorded = await recordAcquiredPage(db, {
          tenantId: processor.tenant_id,
          sourceConfigId: source.id,
          workflowRunId: event.workflowRunId,
          partitionKey: "companies",
          expectedCheckpointVersion: checkpoint.version,
          nextCursor: checkpoint.cursor ?? {},
          items: page.items,
          skipCheckpointAdvance: true,
          eraseFence,
        });
        counts.changed += recorded.changed.length;
        counts.seen += recorded.seen;
      }

      backscanToken = page.pageToken ?? null;
      // Token exhausted: the sweep finished (or the provider exposes no
      // paging) — a null token restarts the round-robin next run.
      if (!backscanToken) break;
    }

    if (backscanPages > 0) {
      // Persist the sweep position with the same version CAS the
      // incremental pass uses. A lost CAS is benign: evidence is already
      // recorded and the sweep resumes from the surviving cursor next run.
      const advanced = await advanceCheckpoint(db, {
        sourceConfigId: source.id,
        partitionKey: "companies",
        expectedVersion: checkpoint.version,
        cursor: {
          ...((checkpoint.cursor ?? {}) as Record<string, unknown>),
          backscanToken,
        },
      });
      if (advanced) {
        checkpoint = advanced;
      } else {
        console.warn(
          `[memory-sources:twenty] backscan checkpoint CAS lost for source ${source.id} — sweep position not persisted this run`,
        );
      }
    }

    perSource[source.id] = {
      family: source.source_family,
      fetched,
      checkpointVersion: checkpoint.version,
      backscanPages,
      backscanToken,
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

// ---------------------------------------------------------------------------
// Bounded batches + lease (Codex F7) and snapshot boundary (Codex F6)
// ---------------------------------------------------------------------------

export const DEFAULT_EVIDENCE_BATCH = 25;
export const MAX_EVIDENCE_BATCH = 100;
/** Stop starting new items when less than this remains on the lease. */
const LEASE_STOP_THRESHOLD_MS = 60_000;

/**
 * Deterministic per-invocation bound over the projection/retain work list.
 * Options and boundary can narrow it; 100 is the hard ceiling. Because the
 * work list is staleness-based (active evidence without an active
 * derivation) and stably ordered by evidence id, a continuation invocation
 * naturally resumes exactly where the previous batch stopped.
 */
function evidenceBatchLimit(
  ctx: StageContext,
  optionKey: "projectBatch" | "retainBatch",
): number {
  const boundary = (ctx.sources[0]?.boundary ?? {}) as Record<string, unknown>;
  const options = ctx.event.options ?? {};
  return boundedInt(
    options[optionKey] ?? boundary[optionKey],
    DEFAULT_EVIDENCE_BATCH,
    1,
    MAX_EVIDENCE_BATCH,
  );
}

/** True when the harness lease reports too little time to start an item. */
function leaseExhausted(ctx: StageContext): boolean {
  const remainingMs = ctx.lease?.remainingMs;
  if (!remainingMs) return false;
  return remainingMs() < LEASE_STOP_THRESHOLD_MS;
}

/** Snapshot TTL: processor budget beats source boundary; clamped 7-90d. */
function snapshotTtlDaysFor(ctx: StageContext): number {
  const budget = (ctx.processor.budget ?? {}) as Record<string, unknown>;
  const boundary = (ctx.sources[0]?.boundary ?? {}) as Record<string, unknown>;
  return clampSnapshotTtlDays(
    budget.snapshotTtlDays ?? boundary.snapshotTtlDays,
  );
}

/**
 * Resolve an evidence item's normalized snapshot: inline column when
 * present (pre-S3 back-compat rows), else fetch from the S3 ref. Null when
 * neither exists or the S3 object lifecycle-expired.
 */
export async function loadSnapshot(
  ctx: Pick<StageContext, "s3">,
  item: EvidenceRow,
): Promise<Record<string, unknown> | null> {
  const inline = item.normalized_snapshot as Record<string, unknown> | null;
  if (inline) return inline;
  if (item.snapshot_ref) {
    return await getEvidenceSnapshot(ctx.s3, { ref: item.snapshot_ref });
  }
  return null;
}

/**
 * F6 snapshot boundary: move inline normalized snapshots (which carry raw
 * source content — emails, note bodies) out of Postgres into the encrypted
 * brain-artifacts bucket, leaving only the s3:// ref + app-side expiry on
 * the row. Runs bounded to the caller's batch at the start of runProject,
 * so rows written by the acquire path before its own S3-first pre-upload
 * lands still get offloaded promptly. Returns the number of rows moved.
 */
export async function offloadSnapshots(
  db: Database,
  s3: S3Client | undefined,
  args: {
    items: EvidenceRow[];
    ttlDays?: number;
    /** Erase write-fence (round-3 P1-2 / round-6 P1): checked immediately
     * before AND after every S3 put, with exact-version compensation. */
    eraseFence?: {
      tenantId: string;
      sourceConfigId: string;
      expectedEraseGeneration: number;
    };
  },
): Promise<number> {
  const pending = args.items.filter(
    (item) => item.normalized_snapshot && !item.snapshot_ref,
  );
  if (pending.length === 0) return 0;
  const bucket = resolveSnapshotBucket();
  let offloaded = 0;
  for (const item of pending) {
    const key = snapshotKeyFor({
      tenantId: item.tenant_id,
      sourceConfigId: item.source_config_id,
      sourceItemId: item.source_item_id,
      sourceVersion: item.source_version,
    });
    // (b) external-write fence: pre-check…
    if (args.eraseFence) {
      await assertSourceWritable(db, {
        tenantId: args.eraseFence.tenantId,
        sourceConfigId: args.eraseFence.sourceConfigId,
        expectedEraseGeneration: args.eraseFence.expectedEraseGeneration,
      });
    }
    const { ref, expiresAt, versionId } = await putEvidenceSnapshot(s3, {
      bucket,
      key,
      snapshot: item.normalized_snapshot as Record<string, unknown>,
      ttlDays: args.ttlDays,
    });
    // …and post-check with EXACT-VERSION compensation (round-6 P1): a
    // generation moved during the put means the erase sweep may already
    // have passed (or completed) — remove precisely the version just
    // written and prove the key is gone; if that fails, durably reopen the
    // erase marker so the dedicated drainer re-sweeps.
    if (args.eraseFence) {
      try {
        await assertSourceWritable(db, {
          tenantId: args.eraseFence.tenantId,
          sourceConfigId: args.eraseFence.sourceConfigId,
          expectedEraseGeneration: args.eraseFence.expectedEraseGeneration,
        });
      } catch (err) {
        if (err instanceof SourceEraseFencedError) {
          try {
            await deleteEvidenceSnapshotVersion(s3, {
              bucket,
              key,
              versionId,
            });
            const clean = await verifyNoSnapshotVersions(s3, { bucket, key });
            if (!clean) {
              throw new Error(
                `snapshot versions remain for ${key} after compensation`,
              );
            }
          } catch (compensationErr) {
            console.error(
              `[memory-sources] snapshot write compensation failed for ${key} — reopening erase marker: ${(compensationErr as Error)?.message}`,
            );
            await rearmEraseCleanup(db, {
              tenantId: args.eraseFence.tenantId,
              sourceConfigId: args.eraseFence.sourceConfigId,
            });
          }
        }
        throw err;
      }
    }
    await db
      .update(memoryEvidenceItems)
      .set({
        snapshot_ref: ref,
        snapshot_expires_at: expiresAt,
        normalized_snapshot: null,
        updated_at: new Date(),
      })
      .where(eq(memoryEvidenceItems.id, item.id));
    // Keep the in-memory copy so this run's stages read it without a
    // round-trip; only the Postgres column is cleared.
    item.snapshot_ref = ref;
    item.snapshot_expires_at = expiresAt;
    offloaded += 1;
  }
  return offloaded;
}

export async function runProject(
  ctx: StageContext,
): Promise<MemoryStageWorkerResult> {
  try {
    return await runProjectInner(ctx);
  } catch (err) {
    if (err instanceof SourceEraseFencedError) {
      return failed(ctx.event.stage, err.message);
    }
    throw err;
  }
}

async function runProjectInner(
  ctx: StageContext,
): Promise<MemoryStageWorkerResult> {
  const { db, event } = ctx;
  const backlog = await changedEvidence(ctx);
  const items = backlog.slice(0, evidenceBatchLimit(ctx, "projectBatch"));
  const counts = { changed: 0, noop: 0, failed: 0 };
  const shared = requireSharedProcessor(ctx);
  if (items.length > 0 && !shared) {
    // Unreachable via the worker (shared-only families cannot bind personal
    // processors), but never silently mint claims under a user scope.
    return failed(
      event.stage,
      `processor ${ctx.processor.id} targets '${ctx.processor.target_scope}' — Twenty claim projection writes shared scopes only`,
    );
  }
  const fenceSource = ctx.sources[0];
  const eraseFence = fenceSource
    ? {
        tenantId: ctx.processor.tenant_id,
        sourceConfigId: fenceSource.id,
        expectedEraseGeneration: fenceSource.erase_generation ?? 0,
      }
    : undefined;

  // F6: migrate any inline snapshots in this batch to S3 before projecting.
  await offloadSnapshots(db, ctx.s3, {
    items,
    ttlDays: snapshotTtlDaysFor(ctx),
    eraseFence,
  });

  let processed = 0;
  for (const item of items) {
    if (leaseExhausted(ctx)) break;
    processed += 1;
    const snapshot = await loadSnapshot(ctx, item);
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
    // U2: extract durable ontology-shaped claims and attach support edges to
    // this evidence item. Idempotent per (fingerprint, evidence) pair.
    const claims = extractCompanyClaims({
      snapshot,
      sourceItemId: item.source_item_id,
      targetScope: shared!.target_scope,
      targetId: shared!.target_id,
    });
    const editionEffectiveFrom =
      typeof snapshot.updatedAt === "string" &&
      !Number.isNaN(new Date(snapshot.updatedAt).getTime())
        ? new Date(snapshot.updatedAt)
        : null;
    const claimResult = await upsertClaimsForEvidence(db, {
      tenantId: item.tenant_id,
      targetScope: shared!.target_scope,
      targetId: shared!.target_id,
      sourceConfigId: item.source_config_id,
      evidenceItemId: item.id,
      subjectKey: `twenty:company:${item.source_item_id}`,
      effectiveFrom: editionEffectiveFrom,
      claims,
      // In-transaction erase fence CAS (round-3 P1-2).
      eraseFence: eraseFence
        ? { expectedEraseGeneration: eraseFence.expectedEraseGeneration }
        : undefined,
    });
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
        claims: claims.length,
        claimsCreated: claimResult.created,
        claimsSupported: claimResult.supported,
        claimsSwept: claimResult.unsupportedRetracted,
      },
    });
  }

  const remaining = backlog.length - processed;
  if (backlog.length === 0) counts.noop = 1;
  return {
    status: "succeeded",
    stage: event.stage,
    counts,
    // Continuation marker (F7): the harness re-invokes; the staleness-based
    // work list resumes exactly where this bounded batch stopped.
    ...(remaining > 0 ? { output: { continuation: true, remaining } } : {}),
  };
}

export async function runRetain(
  ctx: StageContext,
): Promise<MemoryStageWorkerResult> {
  try {
    return await runRetainInner(ctx);
  } catch (err) {
    if (err instanceof SourceEraseFencedError) {
      return failed(ctx.event.stage, err.message);
    }
    throw err;
  }
}

async function runRetainInner(
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
  const fenceSource = ctx.sources[0];
  const eraseFence = fenceSource
    ? {
        tenantId: processor.tenant_id,
        sourceConfigId: fenceSource.id,
        expectedEraseGeneration: fenceSource.erase_generation ?? 0,
      }
    : undefined;

  const backlog = await changedEvidence(ctx);
  const items = backlog.slice(0, evidenceBatchLimit(ctx, "retainBatch"));
  const counts = { changed: 0, noop: 0 };
  const shared = requireSharedProcessor(ctx);
  if (items.length > 0 && !shared) {
    return failed(
      event.stage,
      `processor ${processor.id} targets '${processor.target_scope}' — Twenty projection retain writes shared banks only`,
    );
  }
  const targetBankId = resolveTargetBankId(processor);
  const documents: string[] = [];

  let processed = 0;
  for (const item of items) {
    if (leaseExhausted(ctx)) break;
    processed += 1;
    const snapshot = await loadSnapshot(ctx, item);
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

    // U2: the durable claim ledger is authoritative — project from ACTIVE
    // claims (with embedded claim ids for provenance) when the subject has
    // any; the raw dossier remains the defensive fallback for evidence
    // acquired before claim extraction existed.
    const subjectKey = `twenty:company:${item.source_item_id}`;
    const activeClaims = await listActiveClaimsForSubject(db, {
      tenantId: processor.tenant_id,
      targetScope: shared!.target_scope,
      targetId: shared!.target_id,
      subjectKey,
    });
    const content =
      activeClaims.length > 0
        ? buildClaimProjection(
            activeClaims.map((claim) => ({
              id: claim.id,
              ontologyPredicate: claim.ontology_predicate,
              value: claim.value as Record<string, unknown>,
              effectiveFrom: claim.effective_from,
            })),
            { title: dossier.title, subjectKey },
          ).markdown
        : dossier.markdown;

    // (b) external-write fence: pre-check immediately before the upsert…
    if (eraseFence) {
      await assertSourceWritable(db, eraseFence);
    }
    // Synchronous replace: the workflow's compound stage must observe a bank
    // that already contains this projection.
    await adapter.upsertMarkdownMemoryDocument({
      tenantId: processor.tenant_id,
      ownerType: shared!.target_scope,
      ownerId: shared!.target_id,
      path: `memory-sources/twenty/${projectionKey.replace(":", "/")}.md`,
      documentId,
      context: "external_source_projection",
      content,
      async: false,
      metadata: {
        source: "twenty",
        sourceConfigId: item.source_config_id,
        projectionKey,
        contentHash: item.content_hash,
        sourceVersion: item.source_version,
      },
    });
    // …and post-check with compensation (round-6 P1): the generation moved
    // during the upsert, so the erase sweep may already have deleted this
    // document set — delete the just-written document directly; if that
    // fails, durably record the derivation (so a fresh erase child targets
    // the document) AND reopen the erase marker.
    if (eraseFence) {
      try {
        await assertSourceWritable(db, eraseFence);
      } catch (err) {
        if (err instanceof SourceEraseFencedError) {
          try {
            if (typeof adapter.deleteDocument !== "function") {
              throw new Error("adapter has no deleteDocument");
            }
            await adapter.deleteDocument({
              tenantId: processor.tenant_id,
              ownerType: shared!.target_scope,
              ownerId: shared!.target_id,
              documentId,
            });
          } catch (compensationErr) {
            console.error(
              `[memory-sources] Hindsight write compensation failed for ${documentId} — recording derivation + reopening erase marker: ${(compensationErr as Error)?.message}`,
            );
            await recordDerivation(db, {
              tenantId: processor.tenant_id,
              sourceConfigId: item.source_config_id,
              evidenceItemId: item.id,
              projectionKey,
              targetBankId,
              hindsightDocumentId: documentId,
              currentVersion: item.source_version,
            });
            await rearmEraseCleanup(db, {
              tenantId: eraseFence.tenantId,
              sourceConfigId: eraseFence.sourceConfigId,
            });
          }
        }
        throw err;
      }
    }

    // F8: derivation + run item commit in ONE transaction after the
    // (idempotent) Hindsight write. Separate commits let a crash strand the
    // evidence: the derivation alone marks it "done" for the staleness
    // work list, so a retry would skip it forever.
    await recordDerivationWithRunItem(db, {
      // In-transaction erase fence CAS (round-3 P1-2).
      eraseFence: eraseFence
        ? { expectedEraseGeneration: eraseFence.expectedEraseGeneration }
        : undefined,
      derivation: {
        tenantId: processor.tenant_id,
        sourceConfigId: item.source_config_id,
        evidenceItemId: item.id,
        projectionKey,
        targetBankId,
        hindsightDocumentId: documentId,
        currentVersion: item.source_version,
      },
      runItem: {
        tenantId: processor.tenant_id,
        workflowRunId: event.workflowRunId,
        sourceConfigId: item.source_config_id,
        sourceItemId: item.source_item_id,
        stage: "retain",
        result: "changed",
        detail: { documentId, targetBankId, bytes: content.length },
      },
    });
    counts.changed += 1;
    documents.push(documentId);
  }

  const remaining = backlog.length - processed;
  if (backlog.length === 0) counts.noop = 1;
  return {
    status: "succeeded",
    stage: event.stage,
    counts,
    output: {
      targetBankId,
      documents: documents.slice(0, 50),
      // Continuation marker (F7): the harness re-invokes; the staleness-
      // based work list resumes where this bounded batch stopped.
      ...(remaining > 0 ? { continuation: true, remaining } : {}),
    },
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

// ---------------------------------------------------------------------------
// U3 stage stubs: extract/resolve pass through (claim extraction currently
// happens inside project; deterministic identity resolution lands in U4);
// graph/wiki are SHARED-ONLY stubs that hard-reject user_* targets now and
// gain their real implementations in U4.
// ---------------------------------------------------------------------------

export async function runExtract(
  ctx: StageContext,
): Promise<MemoryStageWorkerResult> {
  return {
    status: "succeeded",
    stage: ctx.event.stage,
    counts: { noop: 1 },
    output: {
      note: "extract is a pass-through in U3 — claim extraction runs inside the project stage",
    },
  };
}

export async function runResolve(
  ctx: StageContext,
): Promise<MemoryStageWorkerResult> {
  return {
    status: "succeeded",
    stage: ctx.event.stage,
    counts: { noop: 1 },
    output: {
      note: "resolve is a pass-through in U3 — canonical identity resolution lands in U4",
    },
  };
}

// ---------------------------------------------------------------------------
// Graph + Wiki stages (THINK-193 U4 run-orchestration stitch).
//
// runGraph RequestResponse-invokes the targeted observations ingest Lambda
// for the processor's shared bank; runWiki settles the compile job that the
// ingest transactionally enqueued. Both are SHARED-ONLY: `user_*` banks are
// hard-rejected (AE7) on top of the worker's own scope gate and the personal
// blueprint structurally omitting these steps.
//
// In-process vs. Lambda-invoke (documented choice): the ingest performs
// Bedrock classifier + extraction calls whose model ids
// (OBSERVATION_CLASSIFIER_MODEL_ID / KG_EXTRACTION_MODEL_ID) and memory/
// timeout sizing (1024MB / 480s, bundled Bedrock SDK) live on the ingest
// Lambda's own env — the memory-stage-worker (256MB) carries none of that.
// The worker therefore invokes the ingest function RequestResponse (its
// 900s timeout comfortably brackets the ingest's 480s) and consumes the
// structured response. The shared api role already grants
// lambda:InvokeFunction on the ingest function (iam-grouped.tf).
// ---------------------------------------------------------------------------

/** Shared-only guard for graph/wiki: `user_*` banks are hard-rejected. */
function requireSharedGraphWikiProcessor(
  ctx: StageContext,
  what: string,
):
  | {
      ok: true;
      processor: MemoryProcessorConfig & { target_scope: "space" | "tenant" };
    }
  | { ok: false; result: MemoryStageWorkerResult } {
  const shared = requireSharedProcessor(ctx);
  if (!shared || ctx.processor.mode !== "shared") {
    return {
      ok: false,
      result: failed(
        ctx.event.stage,
        `stage '${ctx.event.stage}' rejects bank '${resolveTargetBankId(ctx.processor)}' — ${what} publishes shared knowledge and never reads or writes user_* banks (AE7)`,
      ),
    };
  }
  return { ok: true, processor: shared };
}

/** Default RequestResponse invoke of the observations-ingest Lambda. */
async function defaultInvokeObservationsIngest(
  payload: GraphIngestInvokePayload,
): Promise<GraphIngestInvokeResult> {
  const fnName =
    process.env.KG_OBSERVATIONS_INGEST_FN ??
    (process.env.STAGE
      ? `thinkwork-${process.env.STAGE}-api-knowledge-graph-observations-ingest`
      : null);
  if (!fnName) {
    throw new Error(
      "observations-ingest function name unresolved (no STAGE or KG_OBSERVATIONS_INGEST_FN)",
    );
  }
  const { LambdaClient, InvokeCommand } = await import(
    "@aws-sdk/client-lambda"
  );
  const response = await new LambdaClient({}).send(
    new InvokeCommand({
      FunctionName: fnName,
      InvocationType: "RequestResponse",
      Payload: new TextEncoder().encode(JSON.stringify(payload)),
    }),
  );
  const body = response.Payload
    ? new TextDecoder().decode(response.Payload)
    : "";
  if (response.FunctionError) {
    throw new Error(
      `observations-ingest invoke errored (${response.FunctionError}): ${body.slice(0, 300)}`,
    );
  }
  return JSON.parse(body) as GraphIngestInvokeResult;
}

/** Enqueue outcomes that carry a settleable compile job for runWiki. */
const SETTLEABLE_ENQUEUE_STATUSES = new Set([
  "enqueued",
  "enqueued_invoke_failed",
  "deduped",
]);
/** Explicit kill-switch skips: compile intentionally off, not a dead handoff. */
const SKIP_ENQUEUE_STATUSES = new Set([
  "skipped_source_not_graph",
  "skipped_flag_off",
]);

/**
 * Minimum lease headroom before starting the synchronous ingest invoke: the
 * ingest Lambda can legitimately run its full 480s timeout, and an invoke
 * cut off by the WORKER's own deadline would strand the claim mid-flight.
 * Only enforced when the harness wired remainingMs.
 */
const GRAPH_INGEST_MIN_LEASE_MS = 540_000;

export async function runGraph(
  ctx: StageContext,
): Promise<MemoryStageWorkerResult> {
  const guard = requireSharedGraphWikiProcessor(ctx, "targeted graph ingest");
  if (!guard.ok) return guard.result;
  const { db, event } = ctx;
  const processor = guard.processor;
  const targetBankId = resolveTargetBankId(processor);

  const remainingMs = ctx.lease?.remainingMs?.();
  if (remainingMs !== undefined && remainingMs < GRAPH_INGEST_MIN_LEASE_MS) {
    // Not enough runway for a full ingest invoke — hand back a continuation
    // so the harness re-invokes this worker fresh instead of failing
    // spuriously mid-flight.
    return {
      status: "succeeded",
      stage: event.stage,
      counts: { noop: 1 },
      output: {
        continuation: true,
        note: "insufficient lease headroom to start the targeted graph ingest — continuing on a fresh invocation",
      },
    };
  }

  const invoke =
    ctx.graphWiki?.invokeObservationsIngest ?? defaultInvokeObservationsIngest;
  let ingest: GraphIngestInvokeResult;
  try {
    ingest = await invoke({
      tenantId: processor.tenant_id,
      bankIds: [targetBankId],
      trigger: "manual",
    });
  } catch (err) {
    return failed(
      event.stage,
      `targeted graph ingest invoke failed for bank ${targetBankId}: ${(err as Error)?.message ?? String(err)}`,
    );
  }

  if (ingest.status === "skipped") {
    // Another observations ingest run is already active for this tenant —
    // fail visibly/resumably rather than silently skipping the graph pass.
    return failed(
      event.stage,
      `targeted graph ingest was skipped: another observations ingest run is active for this tenant (runId=${ingest.runId ?? "unknown"}) — re-run the stage after it settles`,
    );
  }
  if (ingest.status === "stale_noop") {
    // Zero candidates: nothing to publish, no compile job expected. Record
    // the visible no-op so runWiki can settle as a no-op too.
    const detail = {
      ingestRunId: ingest.runId ?? null,
      ingestStatus: "stale_noop",
      wikiCompileEnqueue: null,
    };
    await recordRunItem(db, {
      tenantId: processor.tenant_id,
      workflowRunId: event.workflowRunId,
      sourceConfigId: ctx.sources[0]?.id ?? processor.id,
      sourceItemId: targetBankId,
      stage: "graph",
      result: "noop",
      detail,
    });
    return {
      status: "succeeded",
      stage: event.stage,
      counts: { noop: 1 },
      output: {
        targetBankId,
        ...detail,
        note: "no new observation candidates in the target bank",
      },
    };
  }
  if (!ingest.ok || ingest.status !== "succeeded") {
    return failed(
      event.stage,
      `targeted graph ingest ${ingest.runId ?? ""} failed for bank ${targetBankId}: ${ingest.error ?? `status ${ingest.status}`}`,
    );
  }

  const metrics = ingest.metrics ?? {};
  const enqueue = metrics.wikiCompileEnqueue as
    | Record<string, unknown>
    | undefined;
  const enqueueStatus =
    typeof enqueue?.status === "string" ? enqueue.status : null;
  const settleable =
    enqueueStatus !== null && SETTLEABLE_ENQUEUE_STATUSES.has(enqueueStatus);
  const skipped =
    enqueueStatus !== null && SKIP_ENQUEUE_STATUSES.has(enqueueStatus);
  if (!settleable && !skipped) {
    // A succeeded ingest with no usable compile handoff is exactly the dead
    // trigger U4 closed — fail the stage visibly so the run cannot report
    // success while the Wiki silently never compiles. Re-running the stage
    // re-ingests (idempotent: cursors advanced, deferrals coalesce) and
    // re-attempts the enqueue.
    return failed(
      event.stage,
      `targeted graph ingest ${ingest.runId ?? ""} succeeded but reported no usable wiki-compile enqueue outcome (${enqueueStatus ?? "missing"}) — failing so the graph→wiki handoff cannot die silently`,
    );
  }

  const deferrals = Array.isArray(metrics.identityDeferrals)
    ? (metrics.identityDeferrals as Array<Record<string, unknown>>)
    : [];
  const counts = {
    candidates: boundedInt(
      metrics.candidateCount,
      0,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    gated: Array.isArray(metrics.promotedIds) ? metrics.promotedIds.length : 0,
    merged: boundedInt(metrics.entityCount, 0, 0, Number.MAX_SAFE_INTEGER),
    deferred: boundedInt(
      metrics.identityDeferredCount,
      0,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
  };
  const detail = {
    ingestRunId: ingest.runId ?? null,
    ingestStatus: "succeeded",
    counts,
    deferredCaseIds: deferrals
      .map((d) => d.caseId)
      .filter((id): id is string => typeof id === "string")
      .slice(0, 50),
    wikiCompileEnqueue: enqueue ?? null,
  };
  await recordRunItem(db, {
    tenantId: processor.tenant_id,
    workflowRunId: event.workflowRunId,
    sourceConfigId: ctx.sources[0]?.id ?? processor.id,
    sourceItemId: targetBankId,
    stage: "graph",
    result: counts.merged > 0 || counts.gated > 0 ? "changed" : "noop",
    detail,
  });

  return {
    status: "succeeded",
    stage: event.stage,
    counts,
    output: { targetBankId, ...detail },
  };
}

const DEFAULT_WIKI_POLL_INTERVAL_MS = 5_000;
/** Per-invocation settle budget; a still-running compile continues on a
 * fresh invocation instead of failing spuriously. */
const DEFAULT_WIKI_SETTLE_BUDGET_MS = 300_000;

/**
 * The durable graph→wiki job reference: the graph stage's run-item detail
 * for THIS workflow run (recorded only on graph success, so it cannot go
 * stale on a graph retry).
 */
async function findGraphStageDetail(
  ctx: StageContext,
): Promise<Record<string, unknown> | null> {
  const [row] = await ctx.db
    .select({ detail: memoryRunItems.detail })
    .from(memoryRunItems)
    .where(
      and(
        eq(memoryRunItems.workflow_run_id, ctx.event.workflowRunId),
        eq(memoryRunItems.stage, "graph"),
      ),
    )
    .orderBy(desc(memoryRunItems.created_at))
    .limit(1);
  return (row?.detail as Record<string, unknown> | undefined) ?? null;
}

export async function runWiki(
  ctx: StageContext,
): Promise<MemoryStageWorkerResult> {
  const guard = requireSharedGraphWikiProcessor(ctx, "canonical Wiki compile");
  if (!guard.ok) return guard.result;
  const { db, event } = ctx;
  const processor = guard.processor;
  const targetBankId = resolveTargetBankId(processor);

  // Job reference: explicit option (ops/tests) beats the graph stage's
  // durable run-item record for this run.
  let jobId =
    typeof ctx.event.options?.wikiCompileJobId === "string"
      ? (ctx.event.options.wikiCompileJobId as string)
      : null;
  if (!jobId) {
    const graphDetail = await findGraphStageDetail(ctx);
    if (!graphDetail) {
      return failed(
        event.stage,
        "no graph-stage record found for this run — the wiki stage settles the compile job the graph stage enqueued, so run graph first",
      );
    }
    const enqueue = graphDetail.wikiCompileEnqueue as
      | Record<string, unknown>
      | null
      | undefined;
    const recordedJobId =
      typeof enqueue?.jobId === "string" ? enqueue.jobId : null;
    if (!recordedJobId) {
      // Graph recorded a no-op (stale ingest) or an explicit kill-switch
      // skip — there is no compile to settle. Visible no-op, not a failure.
      const status =
        typeof enqueue?.status === "string" ? enqueue.status : null;
      await recordRunItem(db, {
        tenantId: processor.tenant_id,
        workflowRunId: event.workflowRunId,
        sourceConfigId: ctx.sources[0]?.id ?? processor.id,
        sourceItemId: targetBankId,
        stage: "wiki",
        result: "noop",
        detail: { reason: status ?? "graph stage recorded no compile job" },
      });
      return {
        status: "succeeded",
        stage: event.stage,
        counts: { noop: 1 },
        output: {
          targetBankId,
          note: `no wiki compile job to settle (${status ?? "graph stage was a no-op"})`,
        },
      };
    }
    jobId = recordedJobId;
  }

  const deps = ctx.graphWiki ?? {};
  const getJob =
    deps.getCompileJob ?? ((id: string) => getCompileJob(id, db as never));
  const kick = deps.invokeCompile ?? invokeWikiCompile;
  const sleep =
    deps.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_WIKI_POLL_INTERVAL_MS;
  const settleBudgetMs = deps.settleBudgetMs ?? DEFAULT_WIKI_SETTLE_BUDGET_MS;
  const startedAt = Date.now();
  let kicked = false;

  for (;;) {
    const job = await getJob(jobId);
    if (!job) {
      return failed(event.stage, `wiki compile job ${jobId} not found`);
    }
    if (job.tenant_id !== processor.tenant_id) {
      return failed(
        event.stage,
        `wiki compile job ${jobId} belongs to another tenant — refusing cross-tenant settlement`,
      );
    }
    if (job.status === "succeeded") {
      // Idempotent settle: recordRunItem no-ops on a duplicate settle of the
      // same job within this run.
      await recordRunItem(db, {
        tenantId: processor.tenant_id,
        workflowRunId: event.workflowRunId,
        sourceConfigId: ctx.sources[0]?.id ?? processor.id,
        sourceItemId: jobId,
        stage: "wiki",
        result: "changed",
        detail: { jobId, jobStatus: job.status, attempt: job.attempt },
      });
      return {
        status: "succeeded",
        stage: event.stage,
        counts: { compiled: 1 },
        output: { targetBankId, jobId, jobStatus: job.status },
      };
    }
    if (job.status === "failed" || job.status === "skipped") {
      // Visible, resumable failure: the run stays failed instead of falsely
      // successful. A re-run of this stage re-checks the same job id and can
      // settle it idempotently if an operator rerun later completed it.
      return failed(
        event.stage,
        `wiki compile job ${jobId} finished '${job.status}'${job.error ? `: ${job.error}` : ""} — the graph ingest succeeded but the canonical Wiki did not compile`,
      );
    }

    // pending | running
    if (job.status === "pending" && !kicked) {
      // Cover deduped / enqueued_invoke_failed handoffs: the job row exists
      // but nothing may have invoked the compile Lambda. claimCompileJobById
      // CAS inside wiki-compile makes a duplicate kick harmless.
      kicked = true;
      try {
        await kick(jobId);
      } catch (err) {
        console.warn(
          `[memory-sources:wiki] compile kick for job ${jobId} failed: ${(err as Error)?.message}`,
        );
      }
    }

    if (ctx.lease) {
      const renewed = await ctx.lease.renew().catch(() => false);
      if (!renewed) {
        // Lease taken over — the new claimant owns settlement; hand back a
        // continuation result (the harness detects the superseded lease).
        return {
          status: "succeeded",
          stage: event.stage,
          counts: { noop: 1 },
          output: { continuation: true, jobId, jobStatus: job.status },
        };
      }
    }

    const elapsedMs = Date.now() - startedAt;
    const exhausted =
      elapsedMs + pollIntervalMs > settleBudgetMs || leaseExhausted(ctx);
    if (exhausted) {
      if (job.status === "running") {
        // The compile is progressing — continue on a fresh invocation
        // rather than failing spuriously.
        return {
          status: "succeeded",
          stage: event.stage,
          counts: { noop: 1 },
          output: {
            continuation: true,
            jobId,
            jobStatus: job.status,
            waitedMs: elapsedMs,
          },
        };
      }
      // Still pending after the budget (kick failed or the worker crashed
      // pre-claim): fail visibly/resumably — the job row survives for the
      // drainer, and a re-run of this stage re-checks and settles it.
      return failed(
        event.stage,
        `wiki compile job ${jobId} is still '${job.status}' after ${Math.round(elapsedMs / 1000)}s — re-run the stage to settle it once a compile worker picks it up`,
      );
    }
    await sleep(pollIntervalMs);
  }
}
