/**
 * Retraction saga over the memory_retraction_attempts ledger (THINK-193 U2).
 *
 * A retraction is a multi-system operation — Postgres claim/evidence ledger,
 * the Hindsight document store, and bank reconsolidation — with no shared
 * transaction. Each saga step is idempotent and commits its own status to the
 * attempt row IN ORDER, so a crash resumes at the recorded status instead of
 * replaying destructive work blindly.
 *
 * Ordering invariant (Codex P1): the PROVIDER delete happens FIRST. Internal
 * state (support edges, claims, derivation lifecycle) is only finalized —
 * atomically, in one transaction — AFTER the provider document is gone, so a
 * provider 5xx can never leave memory recallable in Hindsight while the
 * ledger claims it was retracted. On provider failure the derivation and its
 * claims stay ACTIVE and queryable, and the attempt stays due for retry.
 *
 *   queued/failed → running            (claimed via fenced CAS)
 *   running       → provider_deleted   (adapter.deleteDocument — pinned
 *                                       Hindsight 0.8.4 document-delete
 *                                       contract; "deleted" and "not_found"
 *                                       both advance)
 *   provider_deleted → supports_updated (ONE transaction: claim-evidence
 *                                       edges retracted, orphaned claims
 *                                       deactivated, derivation retracted;
 *                                       scope 'source' also flips the
 *                                       evidence item lifecycle to 'deleted')
 *   supports_updated → reconsolidated  (bank consolidation; when no
 *                                       consolidator exists on a delete-
 *                                       capable adapter the step is recorded
 *                                       as SKIPPED with a durable reason —
 *                                       never silently as success)
 *   reconsolidated → retracted         (terminal, completed_at set)
 *
 * Fencing (Codex P2): claimAttempt sets locked_by and increments
 * lock_generation; every subsequent transition is a CAS on
 * (id, locked_by, lock_generation) that returns the "stale" conflict
 * indicator instead of writing when another worker has since re-claimed the
 * row. The lease (locked_at) is renewed around external calls.
 *
 * Failure budget (Codex round-3 P1-1): only CAUGHT step failures (markFailed)
 * consume the attempt budget. A worker that CRASHES after recording durable
 * in-flight progress (provider_deleted / supports_updated / reconsolidated)
 * must RESUME after its stale lease regardless of attempt_count — those
 * statuses are claimable without the budget check and are never swept to
 * dead_lettered. Only queued/failed/running rows (no recorded progress) are
 * budget-bound and sweepable when exhausted.
 *
 * On a caught step error the attempt is marked failed with quadratic backoff
 * (attempt_count^2 minutes) or dead_lettered when non-retryable/exhausted.
 * The scheduled memory-retraction-drainer Lambda re-claims due rows.
 *
 * The saga runs against a {@link RetractionStore} seam: production uses the
 * drizzle-backed store built from the caller's db handle; unit tests inject
 * an in-memory store and reuse the exported pure transition helpers.
 */

import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  lte,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import {
  memoryClaimEvidence,
  memoryDerivations,
  memoryEvidenceItems,
  memoryRetractionAttempts,
  memorySourceCheckpoints,
  memorySourceConfigs,
} from "@thinkwork/database-pg/schema";

import { getConfig } from "@thinkwork/runtime-config";
import type { RetractionCapableAdapter } from "./engine-capabilities.js";
import { deactivateOrphanedClaims } from "./claims.js";
import { SNAPSHOT_PREFIX } from "./snapshots.js";
import type { DbHandle } from "./types.js";

export type RetractionAttemptRow = typeof memoryRetractionAttempts.$inferSelect;
export type RetractionDerivation = typeof memoryDerivations.$inferSelect;

export type RetractionProgressStatus =
  | "provider_deleted"
  | "supports_updated"
  | "reconsolidated";

export type RetractionFailure = {
  errorClass: string;
  errorMessage: string;
  retryable: boolean;
};

/** Fencing token minted by claimAttempt; every transition CASes on it. */
export type RetractionFence = {
  lockedBy: string;
  lockGeneration: number;
};

/** Conflict indicator: the fence no longer matches (row was re-claimed). */
export type FenceConflict = "stale";

/**
 * Persistence seam for the saga. Every method is a single self-committing
 * operation (finalizeInternalState is one transaction) so the saga's
 * crash-resume property holds regardless of where a worker dies. All
 * post-claim transitions are fenced: they no-op and return "stale" when the
 * caller's (locked_by, lock_generation) no longer owns the row.
 */
export interface RetractionStore {
  loadAttempt(attemptId: string): Promise<RetractionAttemptRow | null>;
  /** Fenced CAS claim: null when the row is not due, locked fresh, or (for
   * budget-bound statuses) exhausted. Increments lock_generation and
   * attempt_count. Progressed in-flight statuses ignore the budget. */
  claimAttempt(
    attemptId: string,
    opts: { lockedBy: string; now: Date },
  ): Promise<RetractionAttemptRow | null>;
  /** Refresh locked_at under the fence; false when the lease was lost. */
  renewLease(
    attemptId: string,
    fence: RetractionFence,
    now: Date,
  ): Promise<boolean>;
  recordProgress(
    attemptId: string,
    status: RetractionProgressStatus,
    now: Date,
    fence: RetractionFence,
    opts?: { reconsolidationNote?: string | null },
  ): Promise<RetractionAttemptRow | FenceConflict>;
  markRetracted(
    attemptId: string,
    now: Date,
    fence: RetractionFence,
  ): Promise<RetractionAttemptRow | FenceConflict>;
  markFailed(
    attempt: Pick<
      RetractionAttemptRow,
      "id" | "attempt_count" | "max_attempts"
    >,
    failure: RetractionFailure,
    now: Date,
    fence: RetractionFence,
  ): Promise<RetractionAttemptRow | FenceConflict>;
  loadDerivation(
    tenantId: string,
    derivationId: string,
  ): Promise<RetractionDerivation | null>;
  /**
   * Post-provider-delete internal finalize, in ONE DB transaction guarded by
   * the fenced CAS provider_deleted → supports_updated on the attempt row.
   *
   * Operates on the DOCUMENT SET, not just the attempt's own derivation:
   * every active/superseded derivation of this tenant + SOURCE CONFIG that
   * projects into the deleted provider document (all editions of a stable
   * external document share provider_document_id — and the partial unique
   * memory_retraction_attempts_document_uidx allows only ONE non-terminal
   * attempt per document, so this single attempt is the only chance to
   * finalize them). For EACH such lineage: retract active claim-evidence
   * edges for its evidence item, deactivate claims left without active
   * support, flip the derivation lifecycle to 'retracted', and (scope
   * 'source') flip the evidence item lifecycle to 'deleted'. Idempotent —
   * replays match zero active rows. Returns "stale" (transaction rolled
   * back) when the fence lost.
   */
  finalizeInternalState(args: {
    attemptId: string;
    tenantId: string;
    sourceConfigId: string;
    providerDocumentId: string;
    deleteEvidence: boolean;
    now: Date;
    fence: RetractionFence;
  }): Promise<RetractionAttemptRow | FenceConflict>;
}

const TERMINAL_STATUSES = ["retracted", "dead_lettered"] as const;
const CLAIMABLE_QUEUED_STATUSES = ["queued", "failed"] as const;
/**
 * Budget-bound statuses (round-3 P1-1): a row in one of these has recorded
 * NO durable saga progress since its last claim, so exhaustion means the
 * work itself keeps failing — dead-letter it. Progressed statuses below are
 * exempt: a crash after recording progress must resume, not dead-letter.
 */
const BUDGETED_STATUSES = ["queued", "failed", "running"] as const;
/** Recorded in-flight progress: resumable after a stale lease regardless of
 * the attempt budget. */
const PROGRESSED_STATUSES = [
  "provider_deleted",
  "supports_updated",
  "reconsolidated",
] as const;

/** Matches retain-attempts: a lock older than this is presumed dead. */
export const RETRACTION_LOCK_STALE_AFTER_MS = 6 * 60 * 1000;
const MAX_ERROR_MESSAGE_CHARS = 500;

/** Non-retryable saga-internal failure (bad row data, missing lineage). */
class RetractionStepError extends Error {
  readonly errorClass: string;
  readonly retryable: boolean;

  constructor(input: {
    errorClass: string;
    message: string;
    retryable?: boolean;
  }) {
    super(input.message);
    this.name = "RetractionStepError";
    this.errorClass = input.errorClass;
    this.retryable = input.retryable ?? false;
  }
}

// ---------------------------------------------------------------------------
// Pure transition helpers (shared by the drizzle store and unit-test stores)
// ---------------------------------------------------------------------------

/** Owner + generation fence: both must match for a transition to apply. */
export function fenceMatches(
  row: Pick<RetractionAttemptRow, "locked_by" | "lock_generation">,
  fence: RetractionFence,
): boolean {
  return (
    row.locked_by === fence.lockedBy &&
    row.lock_generation === fence.lockGeneration
  );
}

/** Quadratic backoff: attempt_count^2 minutes from now. */
export function retryBackoffAt(attemptCount: number, now: Date): Date {
  const minutes = Math.max(1, attemptCount) ** 2;
  return new Date(now.getTime() + minutes * 60_000);
}

/**
 * Due-or-stale claim predicate: queued/failed rows are claimable once
 * next_retry_at passes; in-flight rows only when the lock is absent or stale
 * (a fresh lock means a live worker owns the saga). The attempt budget
 * applies ONLY to queued/failed/running — rows with recorded in-flight
 * progress (provider_deleted / supports_updated / reconsolidated) stay
 * resumable regardless of attempt_count (round-3 P1-1). Terminal rows are
 * never claimable.
 */
export function isAttemptClaimable(
  row: Pick<
    RetractionAttemptRow,
    "status" | "next_retry_at" | "locked_at" | "attempt_count" | "max_attempts"
  >,
  now: Date,
  staleAfterMs: number = RETRACTION_LOCK_STALE_AFTER_MS,
): boolean {
  const budgeted = (BUDGETED_STATUSES as readonly string[]).includes(
    row.status,
  );
  if (budgeted && row.attempt_count >= row.max_attempts) return false;
  if ((CLAIMABLE_QUEUED_STATUSES as readonly string[]).includes(row.status)) {
    return row.next_retry_at === null || row.next_retry_at <= now;
  }
  if (
    row.status === "running" ||
    (PROGRESSED_STATUSES as readonly string[]).includes(row.status)
  ) {
    return (
      row.locked_at === null ||
      row.locked_at.getTime() <= now.getTime() - staleAfterMs
    );
  }
  return false;
}

/** Failed-step transition: retryable-and-not-exhausted backs off, else DLQ. */
export function resolveFailureTransition(
  attempt: Pick<RetractionAttemptRow, "attempt_count" | "max_attempts">,
  failure: RetractionFailure,
  now: Date,
): {
  status: "failed" | "dead_lettered";
  nextRetryAt: Date | null;
  completedAt: Date | null;
} {
  const exhausted = attempt.attempt_count >= attempt.max_attempts;
  if (!failure.retryable || exhausted) {
    return { status: "dead_lettered", nextRetryAt: null, completedAt: now };
  }
  return {
    status: "failed",
    nextRetryAt: retryBackoffAt(attempt.attempt_count, now),
    completedAt: null,
  };
}

function classifyRetractionError(err: unknown): RetractionFailure {
  if (err instanceof RetractionStepError) {
    return {
      errorClass: err.errorClass,
      errorMessage: truncateError(err.message),
      retryable: err.retryable,
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return {
    errorClass: "unknown",
    errorMessage: truncateError(message),
    retryable: true,
  };
}

function truncateError(message: string): string {
  return message.slice(0, MAX_ERROR_MESSAGE_CHARS);
}

/** `tenant_<uuid>` / `space_<uuid>` / `user_<uuid>` → deleteDocument owner. */
function parseBankOwner(bankId: string): {
  ownerType: "user" | "space" | "tenant";
  ownerId: string;
} {
  const match = bankId.match(
    /^(user|space|tenant)_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
  );
  if (!match) {
    throw new RetractionStepError({
      errorClass: "invalid_bank_id",
      message: `unparseable target_bank_id: ${bankId.slice(0, 80)}`,
    });
  }
  return {
    ownerType: match[1] as "user" | "space" | "tenant",
    ownerId: match[2]!,
  };
}

// ---------------------------------------------------------------------------
// Enqueue — one attempt per provider document, idempotent via partial unique
// ---------------------------------------------------------------------------

async function insertQueuedAttempt(
  db: DbHandle,
  derivation: Pick<
    RetractionDerivation,
    | "id"
    | "tenant_id"
    | "source_config_id"
    | "target_bank_id"
    | "hindsight_document_id"
  >,
  scope: "derivation" | "source",
  eraseGeneration = 0,
): Promise<RetractionAttemptRow | null> {
  const now = new Date();
  // Bare ON CONFLICT DO NOTHING intentionally: the conflict target is the
  // partial unique memory_retraction_attempts_document_uidx (non-terminal
  // rows per tenant/provider/document), which a targeted clause can't name
  // portably from drizzle.
  const rows = await db
    .insert(memoryRetractionAttempts)
    .values({
      tenant_id: derivation.tenant_id,
      scope,
      derivation_id: derivation.id,
      source_config_id: derivation.source_config_id,
      provider: "hindsight",
      provider_document_id: derivation.hindsight_document_id,
      target_bank_id: derivation.target_bank_id,
      status: "queued",
      erase_generation: eraseGeneration,
      next_retry_at: now,
      updated_at: now,
    })
    .onConflictDoNothing()
    .returning();
  return rows[0] ?? null;
}

/**
 * Queue retraction of one derivation's projected document. Returns the new
 * attempt, the existing non-terminal attempt when one is already in flight
 * (idempotent per document), or null when the derivation is missing or
 * already retracted.
 */
export async function enqueueDerivationRetraction(
  db: DbHandle,
  args: { tenantId: string; derivationId: string },
): Promise<RetractionAttemptRow | null> {
  const derivations = await db
    .select()
    .from(memoryDerivations)
    .where(
      and(
        eq(memoryDerivations.id, args.derivationId),
        eq(memoryDerivations.tenant_id, args.tenantId),
      ),
    )
    .limit(1);
  const derivation = derivations[0];
  if (
    !derivation ||
    (derivation.lifecycle !== "active" && derivation.lifecycle !== "superseded")
  ) {
    return null;
  }

  const inserted = await insertQueuedAttempt(db, derivation, "derivation");
  if (inserted) return inserted;

  const existing = await db
    .select()
    .from(memoryRetractionAttempts)
    .where(
      and(
        eq(memoryRetractionAttempts.tenant_id, args.tenantId),
        eq(memoryRetractionAttempts.provider, "hindsight"),
        eq(
          memoryRetractionAttempts.provider_document_id,
          derivation.hindsight_document_id,
        ),
        notInArray(memoryRetractionAttempts.status, [...TERMINAL_STATUSES]),
      ),
    )
    .limit(1);
  return existing[0] ?? null;
}

// ---------------------------------------------------------------------------
// Source erase initiation + enqueue
// ---------------------------------------------------------------------------

/** Synthetic provider/document identity of the durable erase marker row. */
export const ERASE_MARKER_PROVIDER = "erase_aggregate";
export function eraseMarkerDocumentId(sourceConfigId: string): string {
  return `erase:${sourceConfigId}`;
}

function eraseMarkerValues(args: {
  tenantId: string;
  sourceConfigId: string;
  eraseGeneration: number;
  now: Date;
}) {
  return {
    tenant_id: args.tenantId,
    scope: "erase" as const,
    derivation_id: null,
    source_config_id: args.sourceConfigId,
    provider: ERASE_MARKER_PROVIDER,
    provider_document_id: eraseMarkerDocumentId(args.sourceConfigId),
    target_bank_id: eraseMarkerDocumentId(args.sourceConfigId),
    status: "queued" as const,
    erase_generation: args.eraseGeneration,
    next_retry_at: null,
    updated_at: args.now,
  };
}

/**
 * Atomic erase initiation (Codex round-5 P1 + round-7 idempotency): in ONE
 * transaction, tenant-pin + FOR UPDATE-lock the source row, disable it, and
 * ensure a durable 'erase' marker. IDEMPOTENT per active erase: when a
 * NON-TERMINAL marker already exists, its generation is returned unchanged —
 * a retry/double-click never mints a new generation that would orphan
 * in-flight children of the current one. Only after the prior erase is
 * terminal does a new initiation bump the generation and create a fresh
 * marker. Either everything lands (the drainer can self-finalize from the
 * marker no matter what fails afterwards) or nothing does.
 */
export async function beginSourceErase(
  db: DbHandle,
  args: { tenantId: string; sourceConfigId: string },
): Promise<{ eraseGeneration: number }> {
  return db.transaction(async (tx) => {
    const now = new Date();
    // Serialize concurrent initiations on the source row.
    const sources = await tx
      .select({ id: memorySourceConfigs.id })
      .from(memorySourceConfigs)
      .where(
        and(
          eq(memorySourceConfigs.id, args.sourceConfigId),
          eq(memorySourceConfigs.tenant_id, args.tenantId),
        ),
      )
      .limit(1)
      .for("update");
    if (!sources[0]) {
      throw new Error("Memory source config not found");
    }

    const existingMarkers = await tx
      .select()
      .from(memoryRetractionAttempts)
      .where(
        and(
          eq(memoryRetractionAttempts.tenant_id, args.tenantId),
          eq(memoryRetractionAttempts.source_config_id, args.sourceConfigId),
          eq(memoryRetractionAttempts.scope, "erase"),
          notInArray(memoryRetractionAttempts.status, [...TERMINAL_STATUSES]),
        ),
      )
      .limit(1);
    const existing = existingMarkers[0];
    if (existing) {
      // Active erase already in flight: just (re-)disable the source; the
      // existing generation stays authoritative.
      await tx
        .update(memorySourceConfigs)
        .set({ enabled: false, updated_at: now })
        .where(
          and(
            eq(memorySourceConfigs.id, args.sourceConfigId),
            eq(memorySourceConfigs.tenant_id, args.tenantId),
          ),
        );
      return { eraseGeneration: existing.erase_generation };
    }

    const updated = await tx
      .update(memorySourceConfigs)
      .set({
        enabled: false,
        erase_generation: sql`${memorySourceConfigs.erase_generation} + 1`,
        updated_at: now,
      })
      .where(
        and(
          eq(memorySourceConfigs.id, args.sourceConfigId),
          eq(memorySourceConfigs.tenant_id, args.tenantId),
        ),
      )
      .returning({ erase_generation: memorySourceConfigs.erase_generation });
    const eraseGeneration = updated[0]!.erase_generation;

    await tx.insert(memoryRetractionAttempts).values(
      eraseMarkerValues({
        tenantId: args.tenantId,
        sourceConfigId: args.sourceConfigId,
        eraseGeneration,
        now,
      }),
    );
    return { eraseGeneration };
  });
}

/** Bound on child attempts enqueued per call (round-5 bounded batching). */
export const DEFAULT_ERASE_ENQUEUE_LIMIT = 200;

/**
 * Source-level erase enqueue (idempotent, callable every aggregate pass):
 *   1. ensure the durable 'erase' marker exists and carries the CURRENT
 *      erase generation (covers drainer-only recovery paths where
 *      beginSourceErase ran long ago);
 *   2. PROMOTE colliding non-terminal derivation-scoped attempts for this
 *      source into the erase (scope 'source' + current generation) so they
 *      finalize with erase semantics and are accounted to this generation
 *      (round-4 P1-B);
 *   3. queue one 'source'-scoped attempt per active/superseded derivation,
 *      bounded per call — the aggregate stays 'pending' while derivations
 *      remain, so subsequent passes enqueue the rest.
 */
export async function enqueueSourceErase(
  db: DbHandle,
  args: { tenantId: string; sourceConfigId: string },
  opts: { childLimit?: number } = {},
): Promise<{ enqueued: number; eraseGeneration: number }> {
  const now = new Date();
  // The NON-TERMINAL marker's generation is authoritative for the active
  // erase (round-7 idempotency): beginSourceErase only mints a new
  // generation when no non-terminal marker exists.
  const markers = await db
    .select()
    .from(memoryRetractionAttempts)
    .where(
      and(
        eq(memoryRetractionAttempts.tenant_id, args.tenantId),
        eq(memoryRetractionAttempts.source_config_id, args.sourceConfigId),
        eq(memoryRetractionAttempts.scope, "erase"),
        notInArray(memoryRetractionAttempts.status, [...TERMINAL_STATUSES]),
      ),
    )
    .limit(1);
  let eraseGeneration: number;
  if (markers[0]) {
    eraseGeneration = markers[0].erase_generation;
  } else {
    const sources = await db
      .select({ erase_generation: memorySourceConfigs.erase_generation })
      .from(memorySourceConfigs)
      .where(
        and(
          eq(memorySourceConfigs.id, args.sourceConfigId),
          eq(memorySourceConfigs.tenant_id, args.tenantId),
        ),
      )
      .limit(1);
    eraseGeneration = sources[0]?.erase_generation ?? 0;
    await db
      .insert(memoryRetractionAttempts)
      .values(
        eraseMarkerValues({
          tenantId: args.tenantId,
          sourceConfigId: args.sourceConfigId,
          eraseGeneration,
          now,
        }),
      )
      .onConflictDoNothing();
  }

  // Collision promotion (round-4 P1-B): an in-flight derivation-scoped
  // attempt holds the per-document uniqueness slot, so the erase could
  // never enqueue its own child. Promote it into the erase instead: it
  // finalizes with deleteEvidence semantics and counts in this generation.
  await db
    .update(memoryRetractionAttempts)
    .set({
      scope: "source",
      erase_generation: eraseGeneration,
      updated_at: now,
    })
    .where(
      and(
        eq(memoryRetractionAttempts.tenant_id, args.tenantId),
        eq(memoryRetractionAttempts.source_config_id, args.sourceConfigId),
        eq(memoryRetractionAttempts.scope, "derivation"),
        notInArray(memoryRetractionAttempts.status, [...TERMINAL_STATUSES]),
      ),
    );
  // Defense-in-depth (round-7): carry any surviving non-terminal 'source'
  // child from another generation into the active one so per-generation
  // accounting always sees in-flight work.
  await db
    .update(memoryRetractionAttempts)
    .set({ erase_generation: eraseGeneration, updated_at: now })
    .where(
      and(
        eq(memoryRetractionAttempts.tenant_id, args.tenantId),
        eq(memoryRetractionAttempts.source_config_id, args.sourceConfigId),
        eq(memoryRetractionAttempts.scope, "source"),
        notInArray(memoryRetractionAttempts.status, [...TERMINAL_STATUSES]),
        sql`${memoryRetractionAttempts.erase_generation} <> ${eraseGeneration}`,
      ),
    );

  const childLimit = opts.childLimit ?? DEFAULT_ERASE_ENQUEUE_LIMIT;
  const derivations = await db
    .select()
    .from(memoryDerivations)
    .where(
      and(
        eq(memoryDerivations.tenant_id, args.tenantId),
        eq(memoryDerivations.source_config_id, args.sourceConfigId),
        inArray(memoryDerivations.lifecycle, ["active", "superseded"]),
      ),
    )
    .orderBy(asc(memoryDerivations.id))
    .limit(childLimit);

  let enqueued = 0;
  for (const derivation of derivations) {
    const inserted = await insertQueuedAttempt(
      db,
      derivation,
      "source",
      eraseGeneration,
    );
    if (inserted) enqueued += 1;
  }
  return { enqueued, eraseGeneration };
}

// ---------------------------------------------------------------------------
// Due-work listing (drainer surface, retain-attempts semantics)
// ---------------------------------------------------------------------------

export async function listDueRetractionAttempts(
  db: DbHandle,
  options: { limit: number; now?: Date; staleAfterMs?: number },
): Promise<RetractionAttemptRow[]> {
  const now = options.now ?? new Date();
  const staleLockBefore = new Date(
    now.getTime() - (options.staleAfterMs ?? RETRACTION_LOCK_STALE_AFTER_MS),
  );
  const lockFree = or(
    isNull(memoryRetractionAttempts.locked_at),
    lte(memoryRetractionAttempts.locked_at, staleLockBefore),
  );
  const underBudget = sql`${memoryRetractionAttempts.attempt_count} < ${memoryRetractionAttempts.max_attempts}`;
  return db
    .select()
    .from(memoryRetractionAttempts)
    .where(
      and(
        or(
          and(
            inArray(memoryRetractionAttempts.status, [
              ...CLAIMABLE_QUEUED_STATUSES,
            ]),
            or(
              isNull(memoryRetractionAttempts.next_retry_at),
              lte(memoryRetractionAttempts.next_retry_at, now),
            ),
            underBudget,
          ),
          and(
            eq(memoryRetractionAttempts.status, "running"),
            lockFree,
            underBudget,
          ),
          // Recorded in-flight progress resumes regardless of the attempt
          // budget (round-3 P1-1): only caught failures consume it.
          and(
            inArray(memoryRetractionAttempts.status, [...PROGRESSED_STATUSES]),
            lockFree,
          ),
        ),
        // Erase aggregate markers are never processed by the per-document
        // saga; the drainer's cleanup sweep owns them.
        sql`${memoryRetractionAttempts.scope} <> 'erase'`,
      ),
    )
    .orderBy(asc(memoryRetractionAttempts.next_retry_at))
    .limit(options.limit);
}

/**
 * Terminal sweep for the drainer: a worker that crashed on its FINAL claim
 * WITHOUT recording durable progress leaves a queued/failed/running row with
 * attempt_count >= max_attempts that no claim predicate will ever pick up.
 * Move such rows (with an absent/stale lock) to 'dead_lettered' so they
 * surface as failures instead of lingering forever. Rows with recorded
 * in-flight progress (provider_deleted / supports_updated / reconsolidated)
 * are NEVER swept — they resume (round-3 P1-1). 'erase' markers in
 * queued/failed/running are swept like children (a crashed final cleanup
 * claim must surface too).
 */
export async function deadLetterExhaustedAttempts(
  db: DbHandle,
  options: { now?: Date; staleAfterMs?: number } = {},
): Promise<RetractionAttemptRow[]> {
  const now = options.now ?? new Date();
  const staleLockBefore = new Date(
    now.getTime() - (options.staleAfterMs ?? RETRACTION_LOCK_STALE_AFTER_MS),
  );
  return db
    .update(memoryRetractionAttempts)
    .set({
      status: "dead_lettered",
      next_retry_at: null,
      locked_at: null,
      locked_by: null,
      error_class: "attempts_exhausted",
      error_message:
        "attempt_count reached max_attempts without a terminal transition",
      completed_at: now,
      updated_at: now,
    })
    .where(
      and(
        inArray(memoryRetractionAttempts.status, [...BUDGETED_STATUSES]),
        sql`${memoryRetractionAttempts.attempt_count} >= ${memoryRetractionAttempts.max_attempts}`,
        or(
          isNull(memoryRetractionAttempts.locked_at),
          lte(memoryRetractionAttempts.locked_at, staleLockBefore),
        ),
        // Erase markers with durable cleanup progress mirror the progressed
        // child statuses: they RESUME, never sweep (round-7).
        sql`NOT (${memoryRetractionAttempts.scope} = 'erase' AND (${memoryRetractionAttempts.cleanup_phase} IS NOT NULL OR ${memoryRetractionAttempts.cleanup_cursor} IS NOT NULL))`,
      ),
    )
    .returning();
}

/**
 * Operator DLQ retry (round-5 P2): reset a dead_lettered (or remediated
 * failed) attempt to a due queued state with a FRESH attempt budget. The
 * lock_generation bump fences out any stale worker still holding the old
 * claim. Works for saga children AND erase markers. Returns null when the
 * attempt is missing, belongs to another tenant, or is not retryable.
 * NOTE: re-queuing a dead_lettered row whose document has since gained a
 * NEW non-terminal attempt violates the per-document partial unique and
 * surfaces as a constraint error — operator-visible by design.
 */
export async function requeueRetractionAttempt(
  db: DbHandle,
  args: { tenantId: string; attemptId: string; now?: Date },
): Promise<RetractionAttemptRow | null> {
  const now = args.now ?? new Date();
  const rows = await db
    .update(memoryRetractionAttempts)
    .set({
      status: "queued",
      attempt_count: 0,
      next_retry_at: now,
      locked_at: null,
      locked_by: null,
      lock_generation: sql`${memoryRetractionAttempts.lock_generation} + 1`,
      error_class: null,
      error_message: null,
      completed_at: null,
      updated_at: now,
    })
    .where(
      and(
        eq(memoryRetractionAttempts.id, args.attemptId),
        eq(memoryRetractionAttempts.tenant_id, args.tenantId),
        inArray(memoryRetractionAttempts.status, ["dead_lettered", "failed"]),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Drizzle-backed store
// ---------------------------------------------------------------------------

export function createDrizzleRetractionStore(db: DbHandle): RetractionStore {
  const fenceWhere = (attemptId: string, fence: RetractionFence) =>
    and(
      eq(memoryRetractionAttempts.id, attemptId),
      eq(memoryRetractionAttempts.locked_by, fence.lockedBy),
      eq(memoryRetractionAttempts.lock_generation, fence.lockGeneration),
    );

  return {
    async loadAttempt(attemptId) {
      const rows = await db
        .select()
        .from(memoryRetractionAttempts)
        .where(eq(memoryRetractionAttempts.id, attemptId))
        .limit(1);
      return rows[0] ?? null;
    },

    async claimAttempt(attemptId, opts) {
      const now = opts.now;
      const staleLockBefore = new Date(
        now.getTime() - RETRACTION_LOCK_STALE_AFTER_MS,
      );
      const lockFree = or(
        isNull(memoryRetractionAttempts.locked_at),
        lte(memoryRetractionAttempts.locked_at, staleLockBefore),
      );
      const underBudget = sql`${memoryRetractionAttempts.attempt_count} < ${memoryRetractionAttempts.max_attempts}`;
      const rows = await db
        .update(memoryRetractionAttempts)
        .set({
          // queued/failed enter the saga at 'running'; in-flight statuses
          // keep their recorded progress so the saga resumes there.
          status: sql`CASE WHEN ${memoryRetractionAttempts.status} IN ('queued', 'failed') THEN 'running' ELSE ${memoryRetractionAttempts.status} END`,
          attempt_count: sql`${memoryRetractionAttempts.attempt_count} + 1`,
          lock_generation: sql`${memoryRetractionAttempts.lock_generation} + 1`,
          locked_at: now,
          locked_by: opts.lockedBy,
          updated_at: now,
        })
        .where(
          and(
            eq(memoryRetractionAttempts.id, attemptId),
            or(
              and(
                inArray(memoryRetractionAttempts.status, [
                  ...CLAIMABLE_QUEUED_STATUSES,
                ]),
                or(
                  isNull(memoryRetractionAttempts.next_retry_at),
                  lte(memoryRetractionAttempts.next_retry_at, now),
                ),
                underBudget,
              ),
              and(
                eq(memoryRetractionAttempts.status, "running"),
                lockFree,
                underBudget,
              ),
              // Progressed statuses resume without the budget check
              // (round-3 P1-1).
              and(
                inArray(memoryRetractionAttempts.status, [
                  ...PROGRESSED_STATUSES,
                ]),
                lockFree,
              ),
            ),
          ),
        )
        .returning();
      return rows[0] ?? null;
    },

    async renewLease(attemptId, fence, now) {
      const rows = await db
        .update(memoryRetractionAttempts)
        .set({ locked_at: now, updated_at: now })
        .where(fenceWhere(attemptId, fence))
        .returning({ id: memoryRetractionAttempts.id });
      return rows.length > 0;
    },

    async recordProgress(attemptId, status, now, fence, opts) {
      const rows = await db
        .update(memoryRetractionAttempts)
        .set({
          status,
          ...(opts?.reconsolidationNote !== undefined
            ? { reconsolidation_note: opts.reconsolidationNote }
            : {}),
          error_class: null,
          error_message: null,
          updated_at: now,
        })
        .where(fenceWhere(attemptId, fence))
        .returning();
      return rows[0] ?? "stale";
    },

    async markRetracted(attemptId, now, fence) {
      const rows = await db
        .update(memoryRetractionAttempts)
        .set({
          status: "retracted",
          next_retry_at: null,
          locked_at: null,
          locked_by: null,
          error_class: null,
          error_message: null,
          completed_at: now,
          updated_at: now,
        })
        .where(fenceWhere(attemptId, fence))
        .returning();
      return rows[0] ?? "stale";
    },

    async markFailed(attempt, failure, now, fence) {
      const transition = resolveFailureTransition(attempt, failure, now);
      const rows = await db
        .update(memoryRetractionAttempts)
        .set({
          status: transition.status,
          next_retry_at: transition.nextRetryAt,
          locked_at: null,
          locked_by: null,
          error_class: failure.errorClass,
          error_message: failure.errorMessage,
          completed_at: transition.completedAt,
          updated_at: now,
        })
        .where(fenceWhere(attempt.id, fence))
        .returning();
      return rows[0] ?? "stale";
    },

    async loadDerivation(tenantId, derivationId) {
      const rows = await db
        .select()
        .from(memoryDerivations)
        .where(
          and(
            eq(memoryDerivations.id, derivationId),
            eq(memoryDerivations.tenant_id, tenantId),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async finalizeInternalState(args) {
      return db.transaction(async (tx) => {
        // Fenced CAS provider_deleted → supports_updated FIRST: when the
        // fence (or expected status) lost, the whole transaction rolls
        // back with zero internal mutations.
        const casRows = await tx
          .update(memoryRetractionAttempts)
          .set({
            status: "supports_updated",
            error_class: null,
            error_message: null,
            updated_at: args.now,
          })
          .where(
            and(
              eq(memoryRetractionAttempts.id, args.attemptId),
              eq(memoryRetractionAttempts.locked_by, args.fence.lockedBy),
              eq(
                memoryRetractionAttempts.lock_generation,
                args.fence.lockGeneration,
              ),
              eq(memoryRetractionAttempts.status, "provider_deleted"),
            ),
          )
          .returning();
        const updated = casRows[0];
        if (!updated) return "stale" as const;

        // Every lineage projecting into the deleted document — all editions
        // of a stable external document share provider_document_id, and the
        // partial unique per-document index means no other attempt will
        // ever finalize them. Pinned to the attempt's OWN source config: a
        // malformed or colliding provider_document_id must never retract
        // another source config's derivations/evidence.
        const lineages = await tx
          .select({
            id: memoryDerivations.id,
            source_config_id: memoryDerivations.source_config_id,
            evidence_item_id: memoryDerivations.evidence_item_id,
          })
          .from(memoryDerivations)
          .where(
            and(
              eq(memoryDerivations.tenant_id, args.tenantId),
              eq(memoryDerivations.source_config_id, args.sourceConfigId),
              eq(
                memoryDerivations.hindsight_document_id,
                args.providerDocumentId,
              ),
              inArray(memoryDerivations.lifecycle, ["active", "superseded"]),
            ),
          );

        for (const lineage of lineages) {
          await tx
            .update(memoryClaimEvidence)
            .set({ status: "retracted", retracted_at: args.now })
            .where(
              and(
                eq(memoryClaimEvidence.tenant_id, args.tenantId),
                eq(
                  memoryClaimEvidence.evidence_item_id,
                  lineage.evidence_item_id,
                ),
                eq(memoryClaimEvidence.status, "active"),
              ),
            );
          await deactivateOrphanedClaims(tx, {
            tenantId: args.tenantId,
            sourceConfigId: lineage.source_config_id,
            evidenceItemId: lineage.evidence_item_id,
          });
        }
        if (lineages.length > 0) {
          await tx
            .update(memoryDerivations)
            .set({
              lifecycle: "retracted",
              retracted_at: args.now,
              updated_at: args.now,
            })
            .where(
              and(
                eq(memoryDerivations.tenant_id, args.tenantId),
                inArray(
                  memoryDerivations.id,
                  lineages.map((l) => l.id),
                ),
                inArray(memoryDerivations.lifecycle, ["active", "superseded"]),
              ),
            );
          if (args.deleteEvidence) {
            // Lifecycle only — snapshot_ref/normalized_snapshot clearing is
            // owned by the erase aggregate's cleanup phase (the intact ref
            // is the SQL-visible marker that S3 snapshot objects still
            // exist).
            await tx
              .update(memoryEvidenceItems)
              .set({
                lifecycle: "deleted",
                updated_at: args.now,
              })
              .where(
                and(
                  eq(memoryEvidenceItems.tenant_id, args.tenantId),
                  inArray(
                    memoryEvidenceItems.id,
                    lineages.map((l) => l.evidence_item_id),
                  ),
                ),
              );
          }
        }
        return updated;
      });
    },
  };
}

// ---------------------------------------------------------------------------
// The saga
// ---------------------------------------------------------------------------

export type ProcessRetractionDeps = {
  db: DbHandle;
  adapter: RetractionCapableAdapter;
  /** Overrides adapter.consolidateBankById when provided. */
  consolidate?: (tenantId: string, bankId: string) => Promise<void>;
  /** Test seam; defaults to the drizzle store over deps.db. */
  store?: RetractionStore;
};

export async function processRetractionAttempt(
  deps: ProcessRetractionDeps,
  attemptId: string,
  opts: { lockedBy?: string; now?: Date } = {},
): Promise<RetractionAttemptRow> {
  const store = deps.store ?? createDrizzleRetractionStore(deps.db);
  const lockedBy = opts.lockedBy ?? "memory-retraction";

  // Step 1 — fenced CAS claim. A lost claim (fresh lock elsewhere, terminal
  // row, exhausted budget-bound row) returns the current row unchanged.
  const claimed = await store.claimAttempt(attemptId, {
    lockedBy,
    now: opts.now ?? new Date(),
  });
  if (!claimed) {
    const current = await store.loadAttempt(attemptId);
    if (!current) {
      throw new Error(`retraction attempt not found: ${attemptId}`);
    }
    return current;
  }

  const fence: RetractionFence = {
    lockedBy,
    lockGeneration: claimed.lock_generation,
  };
  const onStale = async (): Promise<RetractionAttemptRow> => {
    console.warn(
      `[memory-retraction] fence lost attempt=${attemptId} worker=${lockedBy} gen=${fence.lockGeneration} — another claimant owns the saga`,
    );
    return (await store.loadAttempt(attemptId)) ?? claimed;
  };

  let row = claimed;
  try {
    // Lineage validation before anything destructive: a corrupt attempt row
    // must not delete provider documents it cannot finalize afterwards.
    let derivation: RetractionDerivation | null = null;
    if (row.status === "running" || row.status === "provider_deleted") {
      if (!row.derivation_id) {
        throw new RetractionStepError({
          errorClass: "derivation_missing",
          message: "retraction attempt has no derivation_id",
        });
      }
      derivation = await store.loadDerivation(row.tenant_id, row.derivation_id);
      if (!derivation) {
        throw new RetractionStepError({
          errorClass: "derivation_missing",
          message: `derivation not found: ${row.derivation_id}`,
        });
      }
    }

    // Step 2 — provider_deleted: pinned Hindsight 0.8.4 document delete,
    // FIRST (Codex P1). "not_found" is idempotent success (a prior
    // attempt's delete landed). On failure the internal state has not been
    // touched: the derivation and its claims stay ACTIVE and queryable
    // until a later retry succeeds.
    if (row.status === "running") {
      if (typeof deps.adapter.deleteDocument !== "function") {
        const failed = await store.markFailed(
          row,
          {
            errorClass: "unsupported_engine",
            errorMessage:
              "active memory adapter does not implement deleteDocument; retraction unsupported",
            retryable: false,
          },
          new Date(),
          fence,
        );
        return failed === "stale" ? onStale() : failed;
      }
      const owner = parseBankOwner(row.target_bank_id);
      // Renew the lease around the external call so a slow provider delete
      // does not look like a dead worker to the claim predicate.
      if (!(await store.renewLease(row.id, fence, new Date()))) {
        return onStale();
      }
      await deps.adapter.deleteDocument({
        tenantId: row.tenant_id,
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
        documentId: row.provider_document_id,
      });
      const next = await store.recordProgress(
        row.id,
        "provider_deleted",
        new Date(),
        fence,
      );
      if (next === "stale") return onStale();
      row = next;
    }

    // Step 3 — supports_updated: with the provider document gone, finalize
    // ALL internal state atomically in one transaction — for EVERY lineage
    // sharing the deleted provider document (support edges, orphaned
    // claims, derivation lifecycles, scope-'source' evidence). The partial
    // unique per-document index means this attempt is the only one that
    // will ever finalize those sibling derivations.
    if (row.status === "provider_deleted") {
      const next = await store.finalizeInternalState({
        attemptId: row.id,
        tenantId: row.tenant_id,
        sourceConfigId: row.source_config_id,
        providerDocumentId: row.provider_document_id,
        deleteEvidence: row.scope === "source",
        now: new Date(),
        fence,
      });
      if (next === "stale") return onStale();
      row = next;
    }

    // Step 4 — reconsolidated: let the engine reconcile the bank now that
    // the document's units are gone. A delete-capable adapter WITHOUT a
    // consolidator is recorded as skipped-with-reason — durable on the
    // row, never silently counted as success.
    if (row.status === "supports_updated") {
      let reconsolidationNote: string | null = null;
      if (deps.consolidate) {
        if (!(await store.renewLease(row.id, fence, new Date()))) {
          return onStale();
        }
        await deps.consolidate(row.tenant_id, row.target_bank_id);
      } else if (typeof deps.adapter.consolidateBankById === "function") {
        if (!(await store.renewLease(row.id, fence, new Date()))) {
          return onStale();
        }
        await deps.adapter.consolidateBankById(row.target_bank_id);
      } else {
        reconsolidationNote =
          "skipped: no consolidator available on delete-capable adapter";
        console.warn(
          `[memory-retraction] reconsolidation skipped (no consolidator) attempt=${row.id} bank=${row.target_bank_id.slice(0, 18)}`,
        );
      }
      const next = await store.recordProgress(
        row.id,
        "reconsolidated",
        new Date(),
        fence,
        { reconsolidationNote },
      );
      if (next === "stale") return onStale();
      row = next;
    }

    // Step 5 — terminal.
    const done = await store.markRetracted(row.id, new Date(), fence);
    return done === "stale" ? onStale() : done;
  } catch (err) {
    const failed = await store.markFailed(
      row,
      classifyRetractionError(err),
      new Date(),
      fence,
    );
    return failed === "stale" ? onStale() : failed;
  }
}

// ---------------------------------------------------------------------------
// Source erase — durable AGGREGATE over the per-document saga (Codex P1 #4)
// ---------------------------------------------------------------------------

export type SourceEraseStatus = "completed" | "pending" | "failed";

export type SourceEraseResult = {
  status: SourceEraseStatus;
  attempts: {
    total: number;
    retracted: number;
    pending: number;
    deadLettered: number;
    processedThisCall: number;
  };
  snapshotObjectsDeleted: number;
  snapshotVersionsDeleted: number;
  evidenceRowsCleared: number;
  evidenceRowsDeleted: number;
  checkpointsDeleted: boolean;
};

/** Durable cleanup phases recorded on the erase marker (bounded cleanup). */
export type EraseCleanupPhase = "snapshots_deleted" | "evidence_purged";

/** Result of one bounded S3 snapshot-prefix deletion pass (S1: versioned
 * bucket — every VERSION and delete marker under the prefix is removed). */
export type SnapshotDeleteResult = {
  /** Distinct object keys touched this pass. */
  objects: number;
  /** Object versions + delete markers removed this pass. */
  versions: number;
  /** True when the page budget ran out with listings remaining. */
  truncated: boolean;
};

/**
 * Persistence seam for the erase aggregate (drizzle in production, in-memory
 * in tests).
 */
export interface SourceEraseStore {
  listPendingSourceAttemptIds(
    tenantId: string,
    sourceConfigId: string,
    limit: number,
  ): Promise<string[]>;
  /** Child accounting scoped to ONE erase generation (round-4 P1-C): a
   * dead-lettered child from a previous, remediated erase must never fail
   * a later one. */
  countSourceAttemptsByStatus(
    tenantId: string,
    sourceConfigId: string,
    eraseGeneration: number,
  ): Promise<Record<string, number>>;
  /** Derivations still active/superseded (i.e. not yet retracted). */
  countRemainingDerivations(
    tenantId: string,
    sourceConfigId: string,
  ): Promise<number>;
  /**
   * Set-based, single-statement evidence scrub (round-4 P1-B + round-5
   * bounded cleanup): mark EVERY remaining evidence row of the source
   * lifecycle='deleted' and clear snapshot_ref + normalized_snapshot —
   * including rows whose retraction ran under derivation-scope semantics
   * (deleteEvidence=false) before the erase promoted them. Returns the
   * number of rows touched.
   */
  clearEvidencePayloads(
    tenantId: string,
    sourceConfigId: string,
    now: Date,
  ): Promise<number>;
  /**
   * Bounded hard-DELETE of ALL the source's evidence rows (U8 erase
   * epoch): per batch, remaining active claim edges are retracted and
   * orphaned claims deactivated, then the claim-evidence edges,
   * derivations, and evidence rows themselves are deleted outright — at
   * most `limit` rows per call, resuming from `cursor` (last processed
   * evidence id). nextCursor is null when done.
   *
   * Rationale: leaving lifecycle='deleted' tombstones occupied the
   * (source_config_id, source_item_id, source_version) unique slot, so
   * re-onboarding the source with identical provider content was a silent
   * acquire no-op. The erase AGGREGATE marker and memory_run_items remain
   * the audit trail; retraction attempt rows survive (derivation_id is ON
   * DELETE SET NULL) with provider_document_id intact.
   */
  purgeSourceEvidence(
    tenantId: string,
    sourceConfigId: string,
    opts: { cursor: string | null; limit: number; now: Date },
  ): Promise<{ deleted: number; nextCursor: string | null }>;
  deleteCheckpoints(tenantId: string, sourceConfigId: string): Promise<void>;
  /** Latest erase marker row for the source (any status), or null. */
  loadEraseMarker(
    tenantId: string,
    sourceConfigId: string,
  ): Promise<RetractionAttemptRow | null>;
  /**
   * Fenced CAS claim of the erase marker for a cleanup pass (round-3 P1-3):
   * null when no non-terminal marker is due, the lock is fresh (another
   * cleanup runs — overlap prevention), or the cleanup budget is exhausted.
   * Increments attempt_count and lock_generation, sets status 'running'.
   */
  claimEraseMarker(
    tenantId: string,
    sourceConfigId: string,
    opts: { lockedBy: string; now: Date },
  ): Promise<RetractionAttemptRow | null>;
  /**
   * Fenced durable cleanup progress on the marker. release=true also puts
   * the marker back to 'queued' due-now (bounded pass yielded with work
   * remaining); release=false keeps the claim for the same tick.
   */
  recordEraseCleanupProgress(
    markerId: string,
    fence: RetractionFence,
    patch: { cleanupPhase?: EraseCleanupPhase; cleanupCursor?: string | null },
    opts: { release: boolean; now: Date },
  ): Promise<boolean>;
  /** Fenced cleanup failure: quadratic backoff or dead_lettered when the
   * cleanup budget is exhausted. Returns the updated row or "stale". */
  markEraseCleanupFailed(
    marker: Pick<RetractionAttemptRow, "id" | "attempt_count" | "max_attempts">,
    errorMessage: string,
    now: Date,
    fence: RetractionFence,
  ): Promise<RetractionAttemptRow | FenceConflict>;
  /** Fenced terminal transition of the erase marker after full cleanup. */
  markEraseCompleted(
    markerId: string,
    now: Date,
    fence: RetractionFence,
  ): Promise<boolean>;
  /** Terminal failure of the erase marker (dead-lettered children). Not
   * fenced: idempotent, both racers write the same outcome. */
  markEraseFailed(
    tenantId: string,
    sourceConfigId: string,
    reason: string,
    now: Date,
  ): Promise<void>;
  /**
   * Erase aggregates the drainer should drive forward: sources with a DUE,
   * unclaimed, non-terminal 'erase' marker whose 'source' children have all
   * reached a terminal status. runSourceErase then either runs a bounded
   * cleanup pass (all children retracted) or marks the aggregate failed
   * (dead-lettered children). Self-finalizing — a second operator mutation
   * is never required.
   */
  listEraseAggregatesNeedingCleanup(
    limit: number,
  ): Promise<Array<{ tenantId: string; sourceConfigId: string }>>;
}

export function createDrizzleSourceEraseStore(db: DbHandle): SourceEraseStore {
  const markerScope = (tenantId: string, sourceConfigId: string) =>
    and(
      eq(memoryRetractionAttempts.tenant_id, tenantId),
      eq(memoryRetractionAttempts.source_config_id, sourceConfigId),
      eq(memoryRetractionAttempts.scope, "erase"),
    );
  const fenceWhere = (markerId: string, fence: RetractionFence) =>
    and(
      eq(memoryRetractionAttempts.id, markerId),
      eq(memoryRetractionAttempts.locked_by, fence.lockedBy),
      eq(memoryRetractionAttempts.lock_generation, fence.lockGeneration),
    );

  return {
    async listPendingSourceAttemptIds(tenantId, sourceConfigId, limit) {
      const rows = await db
        .select({ id: memoryRetractionAttempts.id })
        .from(memoryRetractionAttempts)
        .where(
          and(
            eq(memoryRetractionAttempts.tenant_id, tenantId),
            eq(memoryRetractionAttempts.source_config_id, sourceConfigId),
            eq(memoryRetractionAttempts.scope, "source"),
            notInArray(memoryRetractionAttempts.status, [...TERMINAL_STATUSES]),
          ),
        )
        .orderBy(asc(memoryRetractionAttempts.created_at))
        .limit(limit);
      return rows.map((r) => r.id);
    },

    async countSourceAttemptsByStatus(tenantId, sourceConfigId, generation) {
      const rows = await db
        .select({
          status: memoryRetractionAttempts.status,
          count: sql<number>`count(*)::int`,
        })
        .from(memoryRetractionAttempts)
        .where(
          and(
            eq(memoryRetractionAttempts.tenant_id, tenantId),
            eq(memoryRetractionAttempts.source_config_id, sourceConfigId),
            eq(memoryRetractionAttempts.scope, "source"),
            eq(memoryRetractionAttempts.erase_generation, generation),
          ),
        )
        .groupBy(memoryRetractionAttempts.status);
      return Object.fromEntries(rows.map((r) => [r.status, r.count]));
    },

    async countRemainingDerivations(tenantId, sourceConfigId) {
      const rows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(memoryDerivations)
        .where(
          and(
            eq(memoryDerivations.tenant_id, tenantId),
            eq(memoryDerivations.source_config_id, sourceConfigId),
            inArray(memoryDerivations.lifecycle, ["active", "superseded"]),
          ),
        );
      return rows[0]?.count ?? 0;
    },

    async clearEvidencePayloads(tenantId, sourceConfigId, now) {
      const rows = await db
        .update(memoryEvidenceItems)
        .set({
          lifecycle: "deleted",
          snapshot_ref: null,
          normalized_snapshot: null,
          updated_at: now,
        })
        .where(
          and(
            eq(memoryEvidenceItems.tenant_id, tenantId),
            eq(memoryEvidenceItems.source_config_id, sourceConfigId),
            or(
              sql`${memoryEvidenceItems.lifecycle} <> 'deleted'`,
              sql`${memoryEvidenceItems.snapshot_ref} IS NOT NULL`,
              sql`${memoryEvidenceItems.normalized_snapshot} IS NOT NULL`,
            ),
          ),
        )
        .returning({ id: memoryEvidenceItems.id });
      return rows.length;
    },

    async purgeSourceEvidence(tenantId, sourceConfigId, opts) {
      return db.transaction(async (tx) => {
        const batch = await tx
          .select({ id: memoryEvidenceItems.id })
          .from(memoryEvidenceItems)
          .where(
            and(
              eq(memoryEvidenceItems.tenant_id, tenantId),
              eq(memoryEvidenceItems.source_config_id, sourceConfigId),
              ...(opts.cursor
                ? [sql`${memoryEvidenceItems.id} > ${opts.cursor}`]
                : []),
            ),
          )
          .orderBy(asc(memoryEvidenceItems.id))
          .limit(opts.limit);
        for (const row of batch) {
          await tx
            .update(memoryClaimEvidence)
            .set({ status: "retracted", retracted_at: opts.now })
            .where(
              and(
                eq(memoryClaimEvidence.tenant_id, tenantId),
                eq(memoryClaimEvidence.evidence_item_id, row.id),
                eq(memoryClaimEvidence.status, "active"),
              ),
            );
          await deactivateOrphanedClaims(tx, {
            tenantId,
            sourceConfigId,
            evidenceItemId: row.id,
          });
        }
        if (batch.length > 0) {
          const ids = batch.map((r) => r.id);
          // U8 erase epoch: hard-DELETE outright. The FK cascades
          // (memory_claim_evidence / memory_derivations → evidence ON
          // DELETE CASCADE) would remove the dependents anyway; explicit
          // set-based deletes in the same transaction keep the intent
          // auditable and the order deterministic. Derivation rows go too
          // (evidence_item_id is NOT NULL) — the retraction attempt ledger
          // (derivation_id ON DELETE SET NULL, provider_document_id kept)
          // and memory_run_items remain the durable audit trail.
          await tx
            .delete(memoryClaimEvidence)
            .where(
              and(
                eq(memoryClaimEvidence.tenant_id, tenantId),
                inArray(memoryClaimEvidence.evidence_item_id, ids),
              ),
            );
          await tx
            .delete(memoryDerivations)
            .where(
              and(
                eq(memoryDerivations.tenant_id, tenantId),
                inArray(memoryDerivations.evidence_item_id, ids),
              ),
            );
          await tx
            .delete(memoryEvidenceItems)
            .where(
              and(
                eq(memoryEvidenceItems.tenant_id, tenantId),
                inArray(memoryEvidenceItems.id, ids),
              ),
            );
        }
        return {
          deleted: batch.length,
          nextCursor:
            batch.length === opts.limit
              ? String(batch[batch.length - 1]!.id)
              : null,
        };
      });
    },

    async deleteCheckpoints(tenantId, sourceConfigId) {
      await db
        .delete(memorySourceCheckpoints)
        .where(
          and(
            eq(memorySourceCheckpoints.tenant_id, tenantId),
            eq(memorySourceCheckpoints.source_config_id, sourceConfigId),
          ),
        );
    },

    async loadEraseMarker(tenantId, sourceConfigId) {
      const rows = await db
        .select()
        .from(memoryRetractionAttempts)
        .where(markerScope(tenantId, sourceConfigId))
        .orderBy(desc(memoryRetractionAttempts.created_at))
        .limit(1);
      return rows[0] ?? null;
    },

    async claimEraseMarker(tenantId, sourceConfigId, opts) {
      const now = opts.now;
      const staleLockBefore = new Date(
        now.getTime() - RETRACTION_LOCK_STALE_AFTER_MS,
      );
      const rows = await db
        .update(memoryRetractionAttempts)
        .set({
          status: "running",
          attempt_count: sql`${memoryRetractionAttempts.attempt_count} + 1`,
          lock_generation: sql`${memoryRetractionAttempts.lock_generation} + 1`,
          locked_at: now,
          locked_by: opts.lockedBy,
          updated_at: now,
        })
        .where(
          and(
            markerScope(tenantId, sourceConfigId),
            or(
              and(
                inArray(memoryRetractionAttempts.status, [
                  ...CLAIMABLE_QUEUED_STATUSES,
                ]),
                or(
                  isNull(memoryRetractionAttempts.next_retry_at),
                  lte(memoryRetractionAttempts.next_retry_at, now),
                ),
              ),
              and(
                eq(memoryRetractionAttempts.status, "running"),
                or(
                  isNull(memoryRetractionAttempts.locked_at),
                  lte(memoryRetractionAttempts.locked_at, staleLockBefore),
                ),
              ),
            ),
            // The cleanup budget counts CAUGHT FAILURES only (round-7): a
            // marker with durable phase/cursor progress remains claimable
            // regardless of attempt_count — a healthy large source must
            // never dead-letter for needing many bounded passes.
            or(
              sql`${memoryRetractionAttempts.attempt_count} < ${memoryRetractionAttempts.max_attempts}`,
              sql`${memoryRetractionAttempts.cleanup_phase} IS NOT NULL`,
              sql`${memoryRetractionAttempts.cleanup_cursor} IS NOT NULL`,
            ),
          ),
        )
        .returning();
      return rows[0] ?? null;
    },

    async recordEraseCleanupProgress(markerId, fence, patch, opts) {
      const rows = await db
        .update(memoryRetractionAttempts)
        .set({
          ...(patch.cleanupPhase !== undefined
            ? { cleanup_phase: patch.cleanupPhase }
            : {}),
          ...(patch.cleanupCursor !== undefined
            ? { cleanup_cursor: patch.cleanupCursor }
            : {}),
          // Durable progress proves the cleanup is healthy: give the budget
          // back so only caught failures consume it (round-7).
          attempt_count: 0,
          ...(opts.release
            ? {
                status: "queued",
                next_retry_at: opts.now,
                locked_at: null,
                locked_by: null,
              }
            : {}),
          updated_at: opts.now,
        })
        .where(fenceWhere(markerId, fence))
        .returning({ id: memoryRetractionAttempts.id });
      return rows.length > 0;
    },

    async markEraseCleanupFailed(marker, errorMessage, now, fence) {
      const transition = resolveFailureTransition(
        marker,
        { errorClass: "cleanup_failed", errorMessage, retryable: true },
        now,
      );
      const rows = await db
        .update(memoryRetractionAttempts)
        .set({
          status: transition.status,
          next_retry_at: transition.nextRetryAt,
          locked_at: null,
          locked_by: null,
          error_class: "cleanup_failed",
          error_message: truncateError(errorMessage),
          completed_at: transition.completedAt,
          updated_at: now,
        })
        .where(fenceWhere(marker.id, fence))
        .returning();
      return rows[0] ?? "stale";
    },

    async markEraseCompleted(markerId, now, fence) {
      const rows = await db
        .update(memoryRetractionAttempts)
        .set({
          status: "retracted",
          next_retry_at: null,
          locked_at: null,
          locked_by: null,
          error_class: null,
          error_message: null,
          completed_at: now,
          updated_at: now,
        })
        .where(fenceWhere(markerId, fence))
        .returning({ id: memoryRetractionAttempts.id });
      return rows.length > 0;
    },

    async markEraseFailed(tenantId, sourceConfigId, reason, now) {
      await db
        .update(memoryRetractionAttempts)
        .set({
          status: "dead_lettered",
          next_retry_at: null,
          locked_at: null,
          locked_by: null,
          error_class: "children_dead_lettered",
          error_message: truncateError(reason),
          completed_at: now,
          updated_at: now,
        })
        .where(
          and(
            markerScope(tenantId, sourceConfigId),
            notInArray(memoryRetractionAttempts.status, [...TERMINAL_STATUSES]),
          ),
        );
    },

    async listEraseAggregatesNeedingCleanup(limit) {
      // Durable-marker driven: any DUE, unclaimed, non-terminal 'erase'
      // marker whose 'source' children have all reached a terminal status.
      // The marker is persisted atomically at erase initiation
      // (beginSourceErase), so a crash/S3 failure at any point — including
      // a zero-derivation source — leaves a row the drainer can pick up.
      const now = new Date();
      const staleLockBefore = new Date(
        now.getTime() - RETRACTION_LOCK_STALE_AFTER_MS,
      );
      // One non-terminal marker per source (partial unique), so a plain
      // select is already distinct. Ordered by due time then age so a
      // persistently failing cohort cannot starve newer erases (round-7).
      const rows = await db
        .select({
          tenant_id: memoryRetractionAttempts.tenant_id,
          source_config_id: memoryRetractionAttempts.source_config_id,
        })
        .from(memoryRetractionAttempts)
        .where(
          and(
            eq(memoryRetractionAttempts.scope, "erase"),
            notInArray(memoryRetractionAttempts.status, [...TERMINAL_STATUSES]),
            or(
              isNull(memoryRetractionAttempts.next_retry_at),
              lte(memoryRetractionAttempts.next_retry_at, now),
            ),
            or(
              isNull(memoryRetractionAttempts.locked_at),
              lte(memoryRetractionAttempts.locked_at, staleLockBefore),
            ),
            // Children of THIS generation only (round-7): historical or
            // cross-generation work must neither block current cleanup nor
            // release it early.
            sql`NOT EXISTS (
              SELECT 1 FROM memory_retraction_attempts child
              WHERE child.tenant_id = ${memoryRetractionAttempts.tenant_id}
                AND child.source_config_id = ${memoryRetractionAttempts.source_config_id}
                AND child.scope = 'source'
                AND child.erase_generation = ${memoryRetractionAttempts.erase_generation}
                AND child.status NOT IN ('retracted', 'dead_lettered')
            )`,
          ),
        )
        .orderBy(
          asc(memoryRetractionAttempts.next_retry_at),
          asc(memoryRetractionAttempts.created_at),
        )
        .limit(limit);
      return rows.map((r) => ({
        tenantId: r.tenant_id,
        sourceConfigId: r.source_config_id,
      }));
    },
  };
}

/**
 * Default S3 snapshot deleter for the erase cleanup (S1: the brain-artifacts
 * bucket is VERSIONED — ListObjectsV2 + plain DeleteObjects would leave every
 * noncurrent version retrievable). Enumerates with ListObjectVersions and
 * deletes EVERY object version AND delete marker under the source's
 * evidence-snapshot prefix, bounded to `maxPages` listing pages per pass
 * (bounded cleanup; `truncated: true` means call again). Runs ONLY under the
 * drainer's dedicated IAM role (S2) — the GraphQL path never calls it.
 * Lazy-imports the S3 client so unit tests (which inject deleteSnapshots)
 * never construct AWS clients.
 */
async function deleteEvidenceSnapshotObjects(
  args: { tenantId: string; sourceConfigId: string },
  opts: { maxPages?: number } = {},
): Promise<SnapshotDeleteResult> {
  const [
    { S3Client, ListObjectVersionsCommand, DeleteObjectsCommand },
    runtimeConfig,
  ] = await Promise.all([
    import("@aws-sdk/client-s3"),
    import("@thinkwork/runtime-config"),
  ]);
  const bucket =
    getConfig("BRAIN_ARTIFACTS_BUCKET") ??
    runtimeConfig.getConfig("BRAIN_ARTIFACTS_BUCKET");
  if (!bucket) {
    throw new Error(
      "BRAIN_ARTIFACTS_BUCKET is not configured — source erase requires the brain-artifacts bucket to delete evidence snapshots",
    );
  }
  const prefix = `${SNAPSHOT_PREFIX}/${args.tenantId}/${args.sourceConfigId}/`;
  const s3 = new S3Client({});
  const maxPages = opts.maxPages ?? 20;
  const keys = new Set<string>();
  let versions = 0;
  let pages = 0;
  let keyMarker: string | undefined;
  let versionIdMarker: string | undefined;
  let truncated = false;
  do {
    const page = await s3.send(
      new ListObjectVersionsCommand({
        Bucket: bucket,
        Prefix: prefix,
        KeyMarker: keyMarker,
        VersionIdMarker: versionIdMarker,
      }),
    );
    pages += 1;
    const targets = [
      ...(page.Versions ?? []),
      ...(page.DeleteMarkers ?? []),
    ].filter(
      (v): v is { Key: string; VersionId: string } =>
        Boolean(v.Key) && Boolean(v.VersionId),
    );
    if (targets.length > 0) {
      const result = await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: targets.map((t) => ({
              Key: t.Key,
              VersionId: t.VersionId,
            })),
            Quiet: true,
          },
        }),
      );
      const errors = result.Errors ?? [];
      if (errors.length > 0) {
        throw new Error(
          `evidence snapshot version delete failed for ${errors.length} object(s): ${errors[0]?.Code ?? "?"} ${errors[0]?.Message ?? ""}`,
        );
      }
      for (const t of targets) keys.add(t.Key);
      versions += targets.length;
    }
    if (page.IsTruncated) {
      keyMarker = page.NextKeyMarker;
      versionIdMarker = page.NextVersionIdMarker;
      if (pages >= maxPages) {
        truncated = true;
        break;
      }
    } else {
      keyMarker = undefined;
      versionIdMarker = undefined;
    }
  } while (keyMarker !== undefined || versionIdMarker !== undefined);
  const summary = { objects: keys.size, versions, truncated };
  console.log(
    `[memory-source-erase] snapshot version delete tenant=${args.tenantId} source=${args.sourceConfigId} objects=${summary.objects} versions=${summary.versions} truncated=${summary.truncated}`,
  );
  return summary;
}

export type SourceEraseDeps = ProcessRetractionDeps & {
  /** Test seam; defaults to the drizzle store over deps.db. */
  eraseStore?: SourceEraseStore;
  /** Test seam; defaults to {@link enqueueSourceErase}. */
  enqueue?: (
    db: DbHandle,
    args: { tenantId: string; sourceConfigId: string },
  ) => Promise<{ enqueued: number; eraseGeneration: number }>;
  /** Test seam; defaults to {@link processRetractionAttempt}. */
  process?: (attemptId: string) => Promise<RetractionAttemptRow>;
  /** Test seam; defaults to the versioned S3 evidence-snapshot deleter. */
  deleteSnapshots?: (args: {
    tenantId: string;
    sourceConfigId: string;
  }) => Promise<SnapshotDeleteResult>;
  /** Bound on inline saga processing per call (remainder drains via the
   * scheduled memory-retraction-drainer). */
  maxInlineAttempts?: number;
  /** Bound on evidence rows hard-deleted per cleanup pass. */
  cleanupBatch?: number;
  /**
   * S2 (IAM blast radius): destructive S3 cleanup runs ONLY when true —
   * i.e. only from the memory-retraction-drainer, which holds the dedicated
   * role with the evidence-snapshots delete grant. The GraphQL mutation
   * path leaves this false: it enqueues the durable marker and returns
   * 'pending'; the drainer self-finalizes.
   */
  destructiveCleanup?: boolean;
  /** Cleanup claimant identity for the fenced marker claim. */
  cleanupLockedBy?: string;
  /** Clock seam (tests simulate multi-tick timelines); defaults to Date. */
  nowFn?: () => Date;
};

const DEFAULT_MAX_INLINE_ERASE_ATTEMPTS = 20;
const DEFAULT_CLEANUP_BATCH = 200;

function eraseOutcome(
  status: SourceEraseStatus,
  attempts: SourceEraseResult["attempts"],
  extra: Partial<
    Pick<
      SourceEraseResult,
      | "snapshotObjectsDeleted"
      | "snapshotVersionsDeleted"
      | "evidenceRowsCleared"
      | "evidenceRowsDeleted"
      | "checkpointsDeleted"
    >
  > = {},
): SourceEraseResult {
  return {
    status,
    attempts,
    snapshotObjectsDeleted: 0,
    snapshotVersionsDeleted: 0,
    evidenceRowsCleared: 0,
    evidenceRowsDeleted: 0,
    checkpointsDeleted: false,
    ...extra,
  };
}

/**
 * Source-level erase as a durable AGGREGATE. It only reports "completed"
 * after (a) every derivation of the source is retracted through the saga,
 * (b) every evidence snapshot object VERSION under the source's S3 prefix is
 * deleted, (c) all evidence rows are scrubbed (lifecycle 'deleted', snapshot
 * payloads cleared) and then ALL evidence rows are hard-deleted (U8 erase
 * epoch — tombstones would occupy the source_version unique slot and turn
 * re-onboarding into a silent no-op), and (d) —
 * only then — checkpoints are deleted and the durable marker retired.
 *
 * Partial progress surfaces as status "pending" — and the erase is
 * SELF-FINALIZING: the scheduled memory-retraction-drainer keeps retracting
 * the children and, once they are all terminal, runs the bounded cleanup
 * phases itself under its dedicated IAM role (destructiveCleanup=true), with
 * durable phase/cursor progress on the marker so a large source completes
 * across multiple ticks. Dead-lettered children surface as status "failed"
 * (marker dead-lettered too — never silently pending); repeated cleanup
 * failures back off quadratically and dead-letter when the marker's attempt
 * budget is exhausted (operators re-arm via retryMemoryRetractionAttempt).
 */
export async function runSourceErase(
  deps: SourceEraseDeps,
  args: { tenantId: string; sourceConfigId: string },
): Promise<SourceEraseResult> {
  const eraseStore = deps.eraseStore ?? createDrizzleSourceEraseStore(deps.db);
  const enqueue = deps.enqueue ?? enqueueSourceErase;
  const process =
    deps.process ??
    ((attemptId: string) =>
      processRetractionAttempt(
        { db: deps.db, adapter: deps.adapter, consolidate: deps.consolidate },
        attemptId,
        { lockedBy: "memory-source-erase" },
      ));
  const deleteSnapshots = deps.deleteSnapshots ?? deleteEvidenceSnapshotObjects;
  const maxInline = deps.maxInlineAttempts ?? DEFAULT_MAX_INLINE_ERASE_ATTEMPTS;
  const cleanupBatch = deps.cleanupBatch ?? DEFAULT_CLEANUP_BATCH;
  const nowFn = deps.nowFn ?? (() => new Date());

  // 1. Enqueue (idempotent): marker generation sync, collision promotion,
  //    bounded child batch.
  const { eraseGeneration } = await enqueue(deps.db, args);

  // 2. Bounded inline drain of non-terminal source-scoped attempts. A
  //    per-attempt failure is recorded on its ledger row by the saga; a
  //    thrown error must not abort the rest of the batch.
  const pendingIds = await eraseStore.listPendingSourceAttemptIds(
    args.tenantId,
    args.sourceConfigId,
    maxInline,
  );
  let processedThisCall = 0;
  for (const attemptId of pendingIds) {
    try {
      await process(attemptId);
    } catch (err) {
      console.error(
        `[memory-source-erase] attempt ${attemptId} processing crashed: ${(err as Error)?.message ?? String(err)}`,
      );
    }
    processedThisCall += 1;
  }

  // 3. Aggregate accounting AFTER processing — scoped to THIS erase
  //    generation (round-4 P1-C).
  const byStatus = await eraseStore.countSourceAttemptsByStatus(
    args.tenantId,
    args.sourceConfigId,
    eraseGeneration,
  );
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  const retracted = byStatus["retracted"] ?? 0;
  const deadLettered = byStatus["dead_lettered"] ?? 0;
  const pending = total - retracted - deadLettered;
  const remainingDerivations = await eraseStore.countRemainingDerivations(
    args.tenantId,
    args.sourceConfigId,
  );

  const attempts = {
    total,
    retracted,
    pending,
    deadLettered,
    processedThisCall,
  };

  if (deadLettered > 0) {
    // Dead-lettered children are surfaced as a FAILED aggregate (the erase
    // marker is dead-lettered too, so it never lingers silently pending)
    // and the cleanup phase never runs.
    await eraseStore.markEraseFailed(
      args.tenantId,
      args.sourceConfigId,
      `${deadLettered} retraction attempt(s) dead-lettered for source ${args.sourceConfigId}`,
      nowFn(),
    );
    return eraseOutcome("failed", attempts);
  }
  const marker = await eraseStore.loadEraseMarker(
    args.tenantId,
    args.sourceConfigId,
  );
  if (marker?.status === "dead_lettered") {
    // Cleanup budget exhausted on a previous pass — surfaced, not pending.
    return eraseOutcome("failed", attempts);
  }
  if (marker?.status === "retracted") {
    return eraseOutcome("completed", attempts, { checkpointsDeleted: true });
  }
  if (pending > 0 || remainingDerivations > 0) {
    return eraseOutcome("pending", attempts);
  }

  // 4. Cleanup — destructive S3/Postgres work. S2: only the drainer (its
  //    dedicated IAM role holds the evidence-snapshots delete grant) sets
  //    destructiveCleanup; the GraphQL path returns pending here and the
  //    drainer self-finalizes.
  if (!deps.destructiveCleanup) {
    console.log(
      `[memory-source-erase] cleanup deferred to the drainer (dedicated-role destructive S3 work) tenant=${args.tenantId} source=${args.sourceConfigId}`,
    );
    return eraseOutcome("pending", attempts);
  }

  // Fenced marker claim (round-3 P1-3): overlap prevention + cleanup budget.
  const claimed = await eraseStore.claimEraseMarker(
    args.tenantId,
    args.sourceConfigId,
    {
      lockedBy: deps.cleanupLockedBy ?? "memory-source-erase-cleanup",
      now: nowFn(),
    },
  );
  if (!claimed) {
    console.log(
      `[memory-source-erase] cleanup claim lost (another claimant or backoff) tenant=${args.tenantId} source=${args.sourceConfigId}`,
    );
    return eraseOutcome("pending", attempts);
  }
  const fence: RetractionFence = {
    lockedBy: claimed.locked_by!,
    lockGeneration: claimed.lock_generation,
  };

  // Bounded phase machine with durable progress on the marker. Order:
  // S3 snapshot versions → evidence scrub + bounded hard-delete purge →
  // checkpoints LAST → marker retired. A failure at any step records a
  // fenced cleanup failure (backoff / DLQ) and later passes resume at the
  // recorded phase; checkpoints are never deleted before S3 + evidence
  // cleanup have fully succeeded.
  let snapshotObjectsDeleted = 0;
  let snapshotVersionsDeleted = 0;
  let evidenceRowsCleared = 0;
  let evidenceRowsDeleted = 0;
  try {
    let phase = (claimed.cleanup_phase ?? null) as EraseCleanupPhase | null;
    if (phase === null) {
      const s3 = await deleteSnapshots(args);
      snapshotObjectsDeleted = s3.objects;
      snapshotVersionsDeleted = s3.versions;
      if (s3.truncated) {
        await eraseStore.recordEraseCleanupProgress(
          claimed.id,
          fence,
          {},
          { release: true, now: nowFn() },
        );
        return eraseOutcome("pending", attempts, {
          snapshotObjectsDeleted,
          snapshotVersionsDeleted,
        });
      }
      phase = "snapshots_deleted";
      await eraseStore.recordEraseCleanupProgress(
        claimed.id,
        fence,
        { cleanupPhase: phase },
        { release: false, now: nowFn() },
      );
    }

    if (phase === "snapshots_deleted") {
      evidenceRowsCleared = await eraseStore.clearEvidencePayloads(
        args.tenantId,
        args.sourceConfigId,
        nowFn(),
      );
      const purged = await eraseStore.purgeSourceEvidence(
        args.tenantId,
        args.sourceConfigId,
        {
          cursor: claimed.cleanup_cursor,
          limit: cleanupBatch,
          now: nowFn(),
        },
      );
      evidenceRowsDeleted = purged.deleted;
      if (purged.nextCursor) {
        await eraseStore.recordEraseCleanupProgress(
          claimed.id,
          fence,
          { cleanupCursor: purged.nextCursor },
          { release: true, now: nowFn() },
        );
        return eraseOutcome("pending", attempts, {
          snapshotObjectsDeleted,
          snapshotVersionsDeleted,
          evidenceRowsCleared,
          evidenceRowsDeleted,
        });
      }
      phase = "evidence_purged";
      await eraseStore.recordEraseCleanupProgress(
        claimed.id,
        fence,
        { cleanupPhase: phase, cleanupCursor: null },
        { release: false, now: nowFn() },
      );
    }

    // phase === "evidence_purged": checkpoints last, then terminal.
    await eraseStore.deleteCheckpoints(args.tenantId, args.sourceConfigId);
    const completed = await eraseStore.markEraseCompleted(
      claimed.id,
      nowFn(),
      fence,
    );
    if (!completed) {
      console.warn(
        `[memory-source-erase] marker completion fence lost tenant=${args.tenantId} source=${args.sourceConfigId}`,
      );
      return eraseOutcome("pending", attempts);
    }
    return eraseOutcome("completed", attempts, {
      snapshotObjectsDeleted,
      snapshotVersionsDeleted,
      evidenceRowsCleared,
      evidenceRowsDeleted,
      checkpointsDeleted: true,
    });
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    console.error(
      `[memory-source-erase] cleanup pass failed tenant=${args.tenantId} source=${args.sourceConfigId}: ${message}`,
    );
    const failedMarker = await eraseStore.markEraseCleanupFailed(
      claimed,
      message,
      nowFn(),
      fence,
    );
    if (failedMarker !== "stale" && failedMarker.status === "dead_lettered") {
      return eraseOutcome("failed", attempts);
    }
    return eraseOutcome("pending", attempts);
  }
}
