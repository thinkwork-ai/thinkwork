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
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Database } from "@thinkwork/database-pg";
import {
  memoryClaimEvidence,
  memoryClaims,
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
import { resolveTargetBankId } from "./repository.js";
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
  EvidenceTargetScope,
  MemoryProcessorConfig,
  MemorySourceConfig,
} from "./types.js";
import {
  buildClaimProjection,
  listActiveClaimsForSubject,
  upsertClaimsForEvidence,
} from "./claims.js";
import {
  assertBoundaryWithin,
  MemoryAuthorizationError,
  requireActiveGrant,
  revalidateGrant,
} from "./policy.js";
import { hindsightDocumentIdFor } from "./adapters/twenty.js";
import {
  getMemorySourceAdapter,
  type MemorySourceAdapter,
} from "./adapters/registry.js";
import {
  boundedInt,
  effectiveLimit,
  isNoProgress,
  pageFingerprint,
  type PageProgressState,
} from "./acquire-helpers.js";
import {
  backscanTokenFrom,
  cursorFromCheckpoint,
} from "./adapters/twenty-adapter.js";
import {
  defaultIdentityRules,
  matchCanonicalEntity,
  normalizeNaturalKeys,
  type MatchNaturalKey,
} from "../entity-identity/matcher.js";
import {
  computeIdentitySignature,
  type IdentityRule,
} from "../entity-identity/normalizers.js";
import {
  attachIdentityEvidence,
  createCanonicalEntity,
  openOrCoalesceResolutionCase,
  type ResolutionCaseKeyInput,
} from "../entity-identity/resolution.js";

// Re-exports for existing importers/tests (helpers moved in the U5 seam
// extraction; twenty cursor helpers now live with the twenty adapter).
export {
  boundedInt,
  effectiveLimit,
  isNoProgress,
  pageFingerprint,
  type PageProgressState,
  backscanTokenFrom,
  cursorFromCheckpoint,
};

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

/**
 * Scope narrowing for the evidence-writing stages (THINK-193 U6): personal
 * processors (target_scope 'user') run acquire/project/retain into the
 * owner's User Bank for personal-capable families; shared processors keep
 * space/tenant. Anything else is a mis-seeded row → visible failure.
 */
function requireWritableProcessor(
  ctx: StageContext,
): (MemoryProcessorConfig & { target_scope: EvidenceTargetScope }) | null {
  const scope = ctx.processor.target_scope;
  if (scope !== "user" && scope !== "space" && scope !== "tenant") return null;
  return ctx.processor as MemoryProcessorConfig & {
    target_scope: EvidenceTargetScope;
  };
}

/**
 * Per-source personal-scope gate (U6, defense-in-depth under the worker's
 * SHARED_ONLY_SOURCE_FAMILIES policy): a user-scoped processor may only run
 * families whose adapter declares supportsPersonalScope.
 */
function personalScopeRejection(
  processor: Pick<MemoryProcessorConfig, "id" | "target_scope">,
  source: MemorySourceConfig,
  adapter: MemorySourceAdapter,
): string | null {
  if (processor.target_scope !== "user") return null;
  if (adapter.supportsPersonalScope) return null;
  return `source family "${source.source_family}" writes shared banks only — personal processor ${processor.id} may not run it`;
}

export function failed(stage: string, error: string): MemoryStageWorkerResult {
  return { status: "failed", stage, error };
}

// ---------------------------------------------------------------------------
// Per-family adapter resolution (THINK-193 U5 dispatch seam)
// ---------------------------------------------------------------------------

/** Adapter for a source config, or a visible stage failure when the family
 * has no registered adapter (fail closed — never guess a family's shape). */
function adapterForSource(
  stage: string,
  source: MemorySourceConfig,
):
  | { ok: true; adapter: MemorySourceAdapter }
  | { ok: false; result: MemoryStageWorkerResult } {
  const adapter = getMemorySourceAdapter(source.source_family);
  if (!adapter) {
    return {
      ok: false,
      result: failed(
        stage,
        `source family "${source.source_family}" has no registered memory-source adapter (implemented: twenty, firecrawl)`,
      ),
    };
  }
  return { ok: true, adapter };
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
  // U6: shared families (twenty, firecrawl) write shared banks; the email
  // family additionally runs on personal processors into the owner's User
  // Bank. Anything else is a mis-seeded row → visible failure.
  const processor = requireWritableProcessor(ctx);
  if (!processor) {
    return failed(
      event.stage,
      `processor ${ctx.processor.id} targets '${ctx.processor.target_scope}' — acquisition may only target 'user', 'space', or 'tenant' banks`,
    );
  }

  // Mixed-family processors work: each source dispatches to its own
  // family adapter within one acquire stage.
  for (const source of ctx.sources) {
    const resolved = adapterForSource(event.stage, source);
    if (!resolved.ok) return resolved.result;
    const adapter = resolved.adapter;
    const scopeRejection = personalScopeRejection(processor, source, adapter);
    if (scopeRejection) return failed(event.stage, scopeRejection);
    if (adapter.requiresOwnerUser && !processor.created_by_user_id) {
      return failed(
        event.stage,
        `processor has no owning user to mint a ${source.source_family} token with — set created_by_user_id`,
      );
    }

    // U2 R9-R11: an explicit, current authorization grant is the maximum
    // readable envelope; the saved source boundary must sit inside it.
    // Revocation/expiry blocks acquisition immediately and visibly.
    let grantId: string;
    let grantVersion: number;
    let grantBoundary: Record<string, unknown>;
    try {
      const grant = await requireActiveGrant(db, {
        tenantId: processor.tenant_id,
        processorConfigId: processor.id,
        sourceFamily: source.source_family,
        sourceBindingKey: source.source_binding_key,
      });
      grantBoundary = (grant.boundary ?? {}) as Record<string, unknown>;
      assertBoundaryWithin(
        grantBoundary,
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

    const readiness = await adapter.checkReadiness(db, {
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
        `${source.source_family === "twenty" ? "Twenty" : source.source_family} source not ready: ${readiness.reason}`,
      );
    }

    // Codex F2/U3: run options and the approved-plan override may only
    // NARROW the saved source boundary and the processor budget — the
    // adapter computes effective limits as the minimum of present values.
    const boundary = (source.boundary ?? {}) as Record<string, unknown>;
    const budget = (processor.budget ?? {}) as Record<string, unknown>;
    const options = event.options ?? {};
    const override = overrideFrom(options);
    // Erase write-fence captured with the source row at stage start
    // (round-3 P1-2): every page commit CASes on it in-transaction.
    const eraseFence = {
      expectedEraseGeneration: source.erase_generation ?? 0,
    };

    let outcome;
    try {
      outcome = await adapter.runAcquire({
        db,
        client: readiness.client,
        s3: ctx.s3,
        processor,
        source,
        workflowRunId: event.workflowRunId,
        boundary,
        budget,
        options,
        override,
        grantBoundary,
        // Codex U2 #2: the adapter must call this before EVERY provider
        // page read — a revoke/expiry/re-issue after page 1 prevents page
        // 2, and the unread page's checkpoint never advances.
        revalidateGrant: () =>
          revalidateGrant(db, {
            tenantId: processor.tenant_id,
            grantId,
            expectedGrantVersion: grantVersion,
          }),
        eraseFence,
        counts,
      });
    } catch (err) {
      if (err instanceof MemoryAuthorizationError) {
        return failed(event.stage, err.message);
      }
      throw err;
    }
    if (!outcome.ok) {
      return failed(event.stage, outcome.error);
    }
    perSource[source.id] = outcome.summary;
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
  optionKey: "projectBatch" | "retainBatch" | "resolveBatch",
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
 * Resolve an evidence item's FULL normalized snapshot. The S3 ref wins when
 * present (U6: email rows keep only a content-free skeleton inline — marked
 * `contentFree: true` — that must never be projected as content); the inline
 * column remains the pre-S3 back-compat path. Null when neither a full
 * snapshot exists nor the S3 object survived its lifecycle expiry — a
 * content-free skeleton is never returned as a snapshot substitute.
 */
export async function loadSnapshot(
  ctx: Pick<StageContext, "s3">,
  item: EvidenceRow,
): Promise<Record<string, unknown> | null> {
  const inline = item.normalized_snapshot as Record<string, unknown> | null;
  if (item.snapshot_ref) {
    const fetched = await getEvidenceSnapshot(ctx.s3, {
      ref: item.snapshot_ref,
    });
    if (fetched) return fetched;
    return inline && inline.contentFree !== true ? inline : null;
  }
  return inline && inline.contentFree !== true ? inline : null;
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
  const writable = requireWritableProcessor(ctx);
  if (items.length > 0 && !writable) {
    return failed(
      event.stage,
      `processor ${ctx.processor.id} targets '${ctx.processor.target_scope}' — claim projection may only target 'user', 'space', or 'tenant' scopes`,
    );
  }
  const sourceById = new Map(ctx.sources.map((source) => [source.id, source]));
  const fenceFor = (sourceConfigId: string) => {
    const source = sourceById.get(sourceConfigId);
    return source
      ? {
          tenantId: ctx.processor.tenant_id,
          sourceConfigId: source.id,
          expectedEraseGeneration: source.erase_generation ?? 0,
        }
      : undefined;
  };

  // F6: migrate any inline snapshots in this batch to S3 before projecting.
  // Fences are per-source: mixed-family batches offload per source group.
  for (const source of ctx.sources) {
    const sourceItems = items.filter(
      (item) => item.source_config_id === source.id,
    );
    if (sourceItems.length === 0) continue;
    await offloadSnapshots(db, ctx.s3, {
      items: sourceItems,
      ttlDays: snapshotTtlDaysFor(ctx),
      eraseFence: fenceFor(source.id),
    });
  }

  let processed = 0;
  for (const item of items) {
    if (leaseExhausted(ctx)) break;
    processed += 1;
    const source = sourceById.get(item.source_config_id);
    const resolved = source
      ? adapterForSource(event.stage, source)
      : ({ ok: false } as const);
    if (!source || !resolved.ok) {
      counts.failed += 1;
      await recordRunItem(db, {
        tenantId: item.tenant_id,
        workflowRunId: event.workflowRunId,
        sourceConfigId: item.source_config_id,
        sourceItemId: item.source_item_id,
        stage: "project",
        result: "failed",
        detail: {
          reason: source
            ? `source family "${source.source_family}" has no registered adapter`
            : "evidence item's source config is not part of this run",
        },
      });
      continue;
    }
    const adapter = resolved.adapter;
    const scopeRejection = personalScopeRejection(writable!, source, adapter);
    if (scopeRejection) return failed(event.stage, scopeRejection);
    const eraseFence = fenceFor(item.source_config_id);
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
    const dossier = adapter.buildProjection(snapshot, item.source_item_id);
    const projectionKey = adapter.projectionKeyFor(item.source_item_id);
    // U2: extract durable structured claims and attach support edges to
    // this evidence item. Idempotent per (fingerprint, evidence) pair.
    const claims = adapter.extractClaims({
      snapshot,
      sourceItemId: item.source_item_id,
      targetScope: writable!.target_scope,
      targetId: writable!.target_id,
    });
    const editionEffectiveFrom = adapter.editionEffectiveFrom(snapshot);
    const claimResult = await upsertClaimsForEvidence(db, {
      tenantId: item.tenant_id,
      targetScope: writable!.target_scope,
      targetId: writable!.target_id,
      sourceConfigId: item.source_config_id,
      evidenceItemId: item.id,
      subjectKey: adapter.subjectKeyFor(item.source_item_id),
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
  const sourceById = new Map(ctx.sources.map((source) => [source.id, source]));
  const fenceFor = (sourceConfigId: string) => {
    const source = sourceById.get(sourceConfigId);
    return source
      ? {
          tenantId: processor.tenant_id,
          sourceConfigId: source.id,
          expectedEraseGeneration: source.erase_generation ?? 0,
        }
      : undefined;
  };

  const backlog = await changedEvidence(ctx);
  const items = backlog.slice(0, evidenceBatchLimit(ctx, "retainBatch"));
  const counts = { changed: 0, noop: 0 };
  const writable = requireWritableProcessor(ctx);
  if (items.length > 0 && !writable) {
    return failed(
      event.stage,
      `processor ${processor.id} targets '${processor.target_scope}' — projection retain may only target 'user', 'space', or 'tenant' banks`,
    );
  }
  const targetBankId = resolveTargetBankId(processor);
  const documents: string[] = [];

  let processed = 0;
  for (const item of items) {
    if (leaseExhausted(ctx)) break;
    processed += 1;
    const source = sourceById.get(item.source_config_id);
    const resolved = source
      ? adapterForSource(event.stage, source)
      : ({ ok: false } as const);
    if (!source || !resolved.ok) {
      counts.noop += 1;
      await recordRunItem(db, {
        tenantId: item.tenant_id,
        workflowRunId: event.workflowRunId,
        sourceConfigId: item.source_config_id,
        sourceItemId: item.source_item_id,
        stage: "retain",
        result: "failed",
        detail: {
          reason: source
            ? `source family "${source.source_family}" has no registered adapter`
            : "evidence item's source config is not part of this run",
        },
      });
      continue;
    }
    const sourceAdapter = resolved.adapter;
    const scopeRejection = personalScopeRejection(
      writable!,
      source,
      sourceAdapter,
    );
    if (scopeRejection) return failed(event.stage, scopeRejection);
    const eraseFence = fenceFor(item.source_config_id);
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
    const dossier = sourceAdapter.buildProjection(
      snapshot,
      item.source_item_id,
    );
    const projectionKey = sourceAdapter.projectionKeyFor(item.source_item_id);
    const documentId = hindsightDocumentIdFor(
      item.source_config_id,
      projectionKey,
    );

    // U2: the durable claim ledger is authoritative — project from ACTIVE
    // claims (with embedded claim ids for provenance) when the subject has
    // any; the raw dossier remains the defensive fallback for evidence
    // acquired before claim extraction existed.
    const subjectKey = sourceAdapter.subjectKeyFor(item.source_item_id);
    const activeClaims = await listActiveClaimsForSubject(db, {
      tenantId: processor.tenant_id,
      targetScope: writable!.target_scope,
      targetId: writable!.target_id,
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
      ownerType: writable!.target_scope,
      ownerId: writable!.target_id,
      path: `memory-sources/${sourceAdapter.pathSegment}/${projectionKey.replace(":", "/")}.md`,
      documentId,
      context: "external_source_projection",
      content,
      async: false,
      metadata: {
        source: sourceAdapter.pathSegment,
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
              ownerType: writable!.target_scope,
              ownerId: writable!.target_id,
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
  // Only personal processors have Thread conversations retained independently
  // of the optional external-source acquisition stages. A zero-source shared
  // processor has no bank input to compound and should settle visibly as a
  // no-op without writing an invalid source-config foreign key.
  if (processor.mode !== "personal" && ctx.sources.length === 0) {
    return {
      status: "succeeded",
      stage: event.stage,
      counts: { noop: 1 },
      output: {
        note: "no enabled sources selected for this run — nothing to consolidate",
      },
    };
  }
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

  const sourceConfigId = ctx.sources[0]?.id;
  if (sourceConfigId) {
    await recordRunItem(db, {
      tenantId: processor.tenant_id,
      workflowRunId: event.workflowRunId,
      sourceConfigId,
      sourceItemId: bankId,
      stage: "compound",
      result: "changed",
      detail: {
        dreamRunId: bank.runId,
        status: bank.status,
        applied: bank.applied ?? null,
      },
    });
  }

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
// U3 stage stub: extract passes through (claim extraction currently happens
// inside project).
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

// ---------------------------------------------------------------------------
// Resolve stage: link the claim ledger to canonical identity.
//
// Every ACTIVE claim carries a subject_key (`twenty:company:<id>`,
// `web:page:<url>`, `email:thread:<id>`); resolve maps
// each subject to a canonical entity through the U4 matcher and stamps
// memory_claims.canonical_subject_id on every active claim of that subject.
// Without it the ledger is never reachable by canonical entity, which is the
// claim-layer half of AE1 (a Twenty company and the same company's scraped
// web page must land on ONE canonical customer — the `customer.domain` claim
// is the join).
//
// Verdict → action:
//   exact | auto_link   → stamp; shared runs also (idempotently) attach the
//                         source mapping + identity claims so the NEXT run is
//                         an exact hit.
//   new (shared only)   → createCanonicalEntity (matcher/resolution writer),
//                         then stamp.
//   suggestion|ambiguous→ open/coalesce a resolution case, run item
//                         'deferred', canonical_subject_id stays NULL.
//   private_unmapped    → AE4: a user-scoped (private) subject with no
//                         existing exact mapping to REUSE creates no tenant
//                         mapping, no canonical row, and no case. Run item
//                         'noop', canonical_subject_id stays NULL.
// ---------------------------------------------------------------------------

/** Source-mapping conventions per subject-key family. */
const SUBJECT_FAMILY_MAPPINGS: Record<
  string,
  { sourceSystem: string; entityTypeSlug: string }
> = {
  twenty: { sourceSystem: "twenty", entityTypeSlug: "customer" },
  web: { sourceSystem: "web", entityTypeSlug: "customer" },
  email: { sourceSystem: "gmail", entityTypeSlug: "email_thread" },
};

export interface SubjectIdentity {
  sourceSystem: string;
  /** Subject family's kind segment (`company` / `page` / `thread` / …). */
  namespace: string;
  externalId: string;
  entityTypeSlug: string;
}

/**
 * PURE: `<family>:<kind>:<externalId>` → a source-mapping identity. The
 * external id keeps every remaining colon (web page subjects embed a URL).
 * Unknown families return null — resolve records them as no-ops rather than
 * inventing a mapping convention.
 */
export function parseSubjectKey(subjectKey: string): SubjectIdentity | null {
  const first = subjectKey.indexOf(":");
  if (first < 0) return null;
  const second = subjectKey.indexOf(":", first + 1);
  if (second < 0) return null;
  const family = subjectKey.slice(0, first);
  const namespace = subjectKey.slice(first + 1, second);
  const externalId = subjectKey.slice(second + 1);
  const mapping = SUBJECT_FAMILY_MAPPINGS[family];
  if (!mapping || !namespace || !externalId) return null;
  return { ...mapping, namespace, externalId };
}

/** Claim predicates that carry identity (email.subject deliberately does not). */
const IDENTITY_PREDICATES: Record<string, { keyKind: string; field: string }> =
  {
    "customer.name": { keyKind: "name", field: "text" },
    "customer.domain": { keyKind: "domain", field: "url" },
    "document.title": { keyKind: "name", field: "text" },
  };

/** Display-name preference order (first present wins). */
const DISPLAY_NAME_PREDICATES = [
  "customer.name",
  "document.title",
  "customer.web_page_title",
];

/**
 * PURE: natural keys + a display name for one subject, from its OWN active
 * claims. `customer.domain` is what makes the cross-source join work: the
 * CRM company and the scraped page both assert it, so both resolve to the
 * same canonical customer.
 */
export function identityFromClaims(
  subjectKey: string,
  claims: Array<{
    ontology_predicate: string;
    value: unknown;
  }>,
): { naturalKeys: MatchNaturalKey[]; displayName: string } {
  const naturalKeys: MatchNaturalKey[] = [];
  const seen = new Set<string>();
  const byPredicate = new Map<string, Record<string, unknown>>();
  for (const claim of claims) {
    const value = (claim.value ?? {}) as Record<string, unknown>;
    if (!byPredicate.has(claim.ontology_predicate)) {
      byPredicate.set(claim.ontology_predicate, value);
    }
    const spec = IDENTITY_PREDICATES[claim.ontology_predicate];
    if (!spec) continue;
    const raw = value[spec.field];
    if (typeof raw !== "string" || !raw.trim()) continue;
    const dedupe = `${spec.keyKind}:${raw}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    naturalKeys.push({ keyKind: spec.keyKind, rawValue: raw });
  }
  let displayName = subjectKey;
  for (const predicate of DISPLAY_NAME_PREDICATES) {
    const raw = byPredicate.get(predicate)?.text;
    if (typeof raw === "string" && raw.trim()) {
      displayName = raw.trim();
      break;
    }
  }
  return { naturalKeys, displayName };
}

/**
 * Identity rules for a claim subject type: the caller's rules when
 * supplied, otherwise the matcher's default (unique + autoLink exact name).
 * `domain` is appended as a strong key for customers unless the supplied
 * rules already define it — it is the deterministic cross-source join
 * (Twenty `domainName` ≡ web page host).
 */
export function claimIdentityRules(
  entityTypeSlug: string,
  tenantRules: IdentityRule[] | undefined,
): IdentityRule[] {
  const rules =
    tenantRules && tenantRules.length > 0
      ? [...tenantRules]
      : defaultIdentityRules();
  const has = (keyKind: string): boolean =>
    rules.some((rule) => rule.keyKind === keyKind);
  if (!has("name")) rules.push(...defaultIdentityRules());
  if (entityTypeSlug === "customer" && !has("domain")) {
    rules.push({
      slug: "default-domain",
      keyKind: "domain",
      normalization: "domain",
      unique: true,
      uniquenessScope: "tenant",
      sourcePrecedence: [],
      autoLink: true,
      version: 0,
    });
  }
  return rules;
}

/** Subject work item: everything the resolve loop needs for one subject. */
interface ResolveSubject {
  subjectKey: string;
  sourceConfigId: string;
  subjectEntityType: string | null;
}

/**
 * Bounded, deterministic work list: distinct subjects of this run's sources
 * whose ACTIVE claims are not yet linked to a canonical entity. Ordered by
 * subject key so a continuation invocation resumes exactly where the previous
 * batch stopped (the work list shrinks as subjects get stamped).
 */
async function unresolvedSubjects(
  ctx: StageContext,
  target: { target_scope: EvidenceTargetScope; target_id: string },
): Promise<ResolveSubject[]> {
  const tenantId = ctx.processor.tenant_id;
  const sourceIds = ctx.sources.map((source) => source.id);
  if (sourceIds.length === 0) return [];
  const edges = await ctx.db
    .select({
      claim_id: memoryClaimEvidence.claim_id,
      source_config_id: memoryClaimEvidence.source_config_id,
    })
    .from(memoryClaimEvidence)
    .where(
      and(
        eq(memoryClaimEvidence.tenant_id, tenantId),
        eq(memoryClaimEvidence.status, "active"),
        inArray(memoryClaimEvidence.source_config_id, sourceIds),
      ),
    );
  if (edges.length === 0) return [];
  const sourceByClaimId = new Map<string, string>();
  for (const edge of edges) {
    if (!sourceByClaimId.has(edge.claim_id)) {
      sourceByClaimId.set(edge.claim_id, edge.source_config_id);
    }
  }
  const rows = await ctx.db
    .select({
      id: memoryClaims.id,
      subject_key: memoryClaims.subject_key,
      subject_entity_type: memoryClaims.subject_entity_type,
    })
    .from(memoryClaims)
    .where(
      and(
        eq(memoryClaims.tenant_id, tenantId),
        eq(memoryClaims.target_scope, target.target_scope),
        eq(memoryClaims.target_id, target.target_id),
        eq(memoryClaims.status, "active"),
        isNull(memoryClaims.canonical_subject_id),
        inArray(memoryClaims.id, [...sourceByClaimId.keys()]),
      ),
    );
  const subjects = new Map<string, ResolveSubject>();
  for (const row of rows) {
    if (subjects.has(row.subject_key)) continue;
    const sourceConfigId = sourceByClaimId.get(row.id);
    if (!sourceConfigId) continue;
    subjects.set(row.subject_key, {
      subjectKey: row.subject_key,
      sourceConfigId,
      subjectEntityType: row.subject_entity_type,
    });
  }
  return [...subjects.values()].sort((a, b) =>
    a.subjectKey.localeCompare(b.subjectKey),
  );
}

export async function runResolve(
  ctx: StageContext,
): Promise<MemoryStageWorkerResult> {
  try {
    return await runResolveInner(ctx);
  } catch (err) {
    if (err instanceof SourceEraseFencedError) {
      return failed(ctx.event.stage, err.message);
    }
    throw err;
  }
}

async function runResolveInner(
  ctx: StageContext,
): Promise<MemoryStageWorkerResult> {
  const { db, event } = ctx;
  const counts = { changed: 0, created: 0, deferred: 0, noop: 0 };
  if (ctx.sources.length === 0) {
    return {
      status: "succeeded",
      stage: event.stage,
      counts: { ...counts, noop: 1 },
      output: { note: "no enabled sources selected for this run" },
    };
  }
  // Personal (user-scoped) processors run resolve too — with PRIVATE
  // visibility, so the matcher may reuse an existing exact mapping but never
  // mints tenant identity from personal evidence (AE4).
  const writable = requireWritableProcessor(ctx);
  if (!writable) {
    return failed(
      event.stage,
      `processor ${ctx.processor.id} targets '${ctx.processor.target_scope}' — canonical resolution may only target 'user', 'space', or 'tenant' scopes`,
    );
  }
  const tenantId = writable.tenant_id;
  const visibility: "tenant" | "private" =
    writable.target_scope === "user" ? "private" : "tenant";

  const backlog = await unresolvedSubjects(ctx, writable);
  const subjects = backlog.slice(0, evidenceBatchLimit(ctx, "resolveBatch"));
  if (backlog.length === 0) {
    return {
      status: "succeeded",
      stage: event.stage,
      counts: { ...counts, noop: 1 },
      output: { note: "no unresolved claim subjects for this run's sources" },
    };
  }

  const sourceById = new Map(ctx.sources.map((source) => [source.id, source]));
  // THINK-408: the ontology subsystem (which held operator-authored
  // per-type identity rules) was removed — every subject type now resolves
  // on the built-in defaults inside `claimIdentityRules`.
  const resolved: Array<{ subjectKey: string; canonicalEntityId: string }> = [];
  const deferredCaseIds: string[] = [];

  let processed = 0;
  for (const subject of subjects) {
    if (leaseExhausted(ctx)) break;
    processed += 1;
    const source = sourceById.get(subject.sourceConfigId);
    const eraseFence = source
      ? {
          tenantId,
          sourceConfigId: source.id,
          expectedEraseGeneration: source.erase_generation ?? 0,
        }
      : undefined;
    const runItem = async (
      result: "changed" | "deferred" | "noop",
      detail: Record<string, unknown>,
    ): Promise<void> => {
      await recordRunItem(db, {
        tenantId,
        workflowRunId: event.workflowRunId,
        sourceConfigId: subject.sourceConfigId,
        sourceItemId: subject.subjectKey,
        stage: "resolve",
        result,
        detail,
      });
    };

    const identity = parseSubjectKey(subject.subjectKey);
    if (!identity) {
      counts.noop += 1;
      await runItem("noop", {
        reason: `subject key "${subject.subjectKey}" has no source-mapping convention`,
      });
      continue;
    }
    const entityTypeSlug = subject.subjectEntityType ?? identity.entityTypeSlug;
    const rules = claimIdentityRules(entityTypeSlug, undefined);
    const activeClaims = await listActiveClaimsForSubject(db, {
      tenantId,
      targetScope: writable.target_scope,
      targetId: writable.target_id,
      subjectKey: subject.subjectKey,
    });
    const { naturalKeys, displayName } = identityFromClaims(
      subject.subjectKey,
      activeClaims,
    );
    const sourceKeys = [
      {
        sourceSystem: identity.sourceSystem,
        namespace: identity.namespace,
        externalId: identity.externalId,
      },
    ];
    const request = {
      tenantId,
      entityTypeSlug,
      displayName,
      visibility,
      sourceKeys,
      naturalKeys,
    };
    const verdict = await matchCanonicalEntity(db, request, rules);

    const ruleByKeyKind = new Map(rules.map((rule) => [rule.keyKind, rule]));
    const identityKeys: ResolutionCaseKeyInput[] = normalizeNaturalKeys(
      request,
      rules,
    ).map((key) => ({
      keyKind: key.keyKind,
      normalizedValue: key.normalizedValue,
      ruleSlug: ruleByKeyKind.get(key.keyKind)?.slug,
      ruleVersion: ruleByKeyKind.get(key.keyKind)?.version,
    }));

    const stamp = async (canonicalEntityId: string): Promise<void> => {
      // Erase write-fence (round-3 P1-2): a source disabled or erased
      // mid-run must not get fresh canonical links written behind the sweep.
      if (eraseFence) await assertSourceWritable(db, eraseFence);
      await db
        .update(memoryClaims)
        .set({
          canonical_subject_id: canonicalEntityId,
          updated_at: new Date(),
        })
        .where(
          and(
            eq(memoryClaims.tenant_id, tenantId),
            eq(memoryClaims.target_scope, writable.target_scope),
            eq(memoryClaims.target_id, writable.target_id),
            eq(memoryClaims.subject_key, subject.subjectKey),
            eq(memoryClaims.status, "active"),
          ),
        );
      resolved.push({ subjectKey: subject.subjectKey, canonicalEntityId });
    };

    if (verdict.kind === "exact" || verdict.kind === "auto_link") {
      if (visibility === "tenant") {
        // Idempotent: the mapping makes the NEXT run an exact hit, and the
        // identity claims make other sources' natural keys land here too.
        await attachIdentityEvidence(db, {
          tenantId,
          canonicalEntityId: verdict.canonicalEntityId,
          createdBy: "rule",
          sourceKeys,
          identityKeys,
          visibility: "tenant",
        });
      }
      await stamp(verdict.canonicalEntityId);
      counts.changed += 1;
      await runItem("changed", {
        verdict: verdict.kind,
        canonicalEntityId: verdict.canonicalEntityId,
        ...(verdict.kind === "auto_link" ? { ruleSlug: verdict.ruleSlug } : {}),
      });
      continue;
    }

    if (verdict.kind === "private_unmapped") {
      // AE4: personal evidence with nothing to reuse. No tenant mapping, no
      // canonical row, no resolution case — the claim stays unlinked.
      counts.noop += 1;
      await runItem("noop", {
        verdict: "private_unmapped",
        reason:
          "personal (user-scoped) subject with no existing exact mapping to reuse — private evidence never creates shared identity",
      });
      continue;
    }

    if (verdict.kind === "new") {
      const created = await createCanonicalEntity(db, {
        tenantId,
        entityTypeSlug,
        displayName,
        createdBy: "rule",
        sourceKeys,
        identityKeys,
        visibility: "tenant",
      });
      await stamp(created.canonicalEntityId);
      counts.changed += 1;
      counts.created += 1;
      await runItem("changed", {
        verdict: "new",
        canonicalEntityId: created.canonicalEntityId,
        created: true,
      });
      continue;
    }

    // suggestion | ambiguous — defer to the operator queue; NEVER link.
    const signatureHash = computeIdentitySignature({
      entityTypeSlug,
      keys: identityKeys.map((key) => ({
        keyKind: key.keyKind,
        normalizedValue: key.normalizedValue,
      })),
    });
    const candidates =
      verdict.kind === "ambiguous"
        ? verdict.candidates.map((candidate) => ({
            canonicalEntityId: candidate.canonicalEntityId,
            displayName: candidate.displayName,
            matchedKeyKinds: candidate.matchedKeyKinds,
          }))
        : [
            {
              canonicalEntityId: verdict.canonicalEntityId,
              displayName: null,
              matchedKeyKinds: verdict.matchedKeyKinds,
            },
          ];
    const { caseId } = await openOrCoalesceResolutionCase(db, {
      tenantId,
      signatureHash,
      entityTypeSlug,
      displayHint: displayName,
      candidates,
      conflictingClaims: [],
      impactSummary: { subjectKey: subject.subjectKey },
      pendingKeys: identityKeys,
    });
    counts.deferred += 1;
    deferredCaseIds.push(caseId);
    await runItem("deferred", {
      verdict: verdict.kind,
      caseId,
      candidates: candidates.map((c) => c.canonicalEntityId),
    });
  }

  const remaining = backlog.length - processed;
  return {
    status: "succeeded",
    stage: event.stage,
    counts,
    output: {
      resolved: resolved.slice(0, 50),
      deferredCaseIds: deferredCaseIds.slice(0, 50),
      ...(remaining > 0 ? { continuation: true, remaining } : {}),
    },
  };
}
