/**
 * Retraction saga over the memory_retraction_attempts ledger (THINK-193 U2).
 *
 * A retraction is a multi-system operation — Postgres claim/evidence ledger,
 * the Hindsight document store, and bank reconsolidation — with no shared
 * transaction. Each saga step is idempotent and commits its own status to the
 * attempt row IN ORDER, so a crash resumes at the recorded status instead of
 * replaying destructive work blindly:
 *
 *   queued/failed → running            (claimed via CAS, retain-attempts style)
 *   running       → supports_updated   (claim-evidence edges retracted, orphaned
 *                                       claims deactivated, derivation retracted;
 *                                       scope 'source' also flips the evidence
 *                                       item lifecycle to 'deleted')
 *   supports_updated → provider_deleted (adapter.deleteDocument — pinned
 *                                       Hindsight 0.8.4 document-delete contract;
 *                                       "deleted" and "not_found" both advance)
 *   provider_deleted → reconsolidated  (bank consolidation, best-effort seam)
 *   reconsolidated → retracted         (terminal, completed_at set)
 *
 * On a step error the attempt is marked failed with quadratic backoff
 * (attempt_count^2 minutes) or dead_lettered when non-retryable/exhausted.
 *
 * The saga runs against a {@link RetractionStore} seam: production uses the
 * drizzle-backed store built from the caller's db handle; unit tests inject
 * an in-memory store and reuse the exported pure transition helpers.
 */

import {
  and,
  asc,
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
} from "@thinkwork/database-pg/schema";

import type { MemoryAdapter } from "../memory/adapter.js";
import { HindsightRetainError } from "../memory/adapters/hindsight-adapter.js";
import { deactivateOrphanedClaims } from "./claims.js";
import type { DbHandle } from "./types.js";

export type RetractionAttemptRow = typeof memoryRetractionAttempts.$inferSelect;
export type RetractionDerivation = typeof memoryDerivations.$inferSelect;

export type RetractionProgressStatus =
  | "supports_updated"
  | "provider_deleted"
  | "reconsolidated";

export type RetractionFailure = {
  errorClass: string;
  errorMessage: string;
  retryable: boolean;
};

/**
 * Persistence seam for the saga. Every method is a single self-committing
 * operation (never a cross-step transaction) so the saga's crash-resume
 * property holds regardless of where a worker dies.
 */
export interface RetractionStore {
  loadAttempt(attemptId: string): Promise<RetractionAttemptRow | null>;
  /** CAS claim: null when the row is not due, locked fresh, or exhausted. */
  claimAttempt(
    attemptId: string,
    opts: { lockedBy: string; now: Date },
  ): Promise<RetractionAttemptRow | null>;
  recordProgress(
    attemptId: string,
    status: RetractionProgressStatus,
    now: Date,
  ): Promise<RetractionAttemptRow>;
  markRetracted(attemptId: string, now: Date): Promise<RetractionAttemptRow>;
  markFailed(
    attempt: Pick<
      RetractionAttemptRow,
      "id" | "attempt_count" | "max_attempts"
    >,
    failure: RetractionFailure,
    now: Date,
  ): Promise<RetractionAttemptRow>;
  loadDerivation(
    tenantId: string,
    derivationId: string,
  ): Promise<RetractionDerivation | null>;
  /**
   * Step 2, in one DB transaction: retract active claim-evidence edges for
   * the evidence item, deactivate claims left without active support, flip
   * the derivation lifecycle to 'retracted', and (scope 'source') flip the
   * evidence item lifecycle to 'deleted'. Idempotent — replays match zero
   * active rows.
   */
  retractSupports(args: {
    tenantId: string;
    sourceConfigId: string;
    evidenceItemId: string;
    derivationId: string;
    deleteEvidence: boolean;
    now: Date;
  }): Promise<void>;
}

const TERMINAL_STATUSES = ["retracted", "dead_lettered"] as const;
const CLAIMABLE_QUEUED_STATUSES = ["queued", "failed"] as const;
const IN_FLIGHT_STATUSES = [
  "running",
  "supports_updated",
  "provider_deleted",
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

/** Quadratic backoff: attempt_count^2 minutes from now. */
export function retryBackoffAt(attemptCount: number, now: Date): Date {
  const minutes = Math.max(1, attemptCount) ** 2;
  return new Date(now.getTime() + minutes * 60_000);
}

/**
 * Due-or-stale claim predicate: queued/failed rows are claimable once
 * next_retry_at passes; in-flight rows only when the lock is absent or stale
 * (a fresh lock means a live worker owns the saga). Exhausted and terminal
 * rows are never claimable.
 */
export function isAttemptClaimable(
  row: Pick<
    RetractionAttemptRow,
    "status" | "next_retry_at" | "locked_at" | "attempt_count" | "max_attempts"
  >,
  now: Date,
  staleAfterMs: number = RETRACTION_LOCK_STALE_AFTER_MS,
): boolean {
  if (row.attempt_count >= row.max_attempts) return false;
  if ((CLAIMABLE_QUEUED_STATUSES as readonly string[]).includes(row.status)) {
    return row.next_retry_at === null || row.next_retry_at <= now;
  }
  if ((IN_FLIGHT_STATUSES as readonly string[]).includes(row.status)) {
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
  if (err instanceof HindsightRetainError) {
    return {
      errorClass:
        err.statusCode !== undefined
          ? `hindsight_${err.statusCode}`
          : "hindsight_transport",
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

/**
 * Source-level erase (GDPR-style): queue one 'source'-scoped attempt per
 * active/superseded derivation of the source config. Idempotent — documents
 * with an in-flight attempt count as already enqueued and are skipped.
 */
export async function enqueueSourceErase(
  db: DbHandle,
  args: { tenantId: string; sourceConfigId: string },
): Promise<{ enqueued: number }> {
  const derivations = await db
    .select()
    .from(memoryDerivations)
    .where(
      and(
        eq(memoryDerivations.tenant_id, args.tenantId),
        eq(memoryDerivations.source_config_id, args.sourceConfigId),
        inArray(memoryDerivations.lifecycle, ["active", "superseded"]),
      ),
    );

  let enqueued = 0;
  for (const derivation of derivations) {
    const inserted = await insertQueuedAttempt(db, derivation, "source");
    if (inserted) enqueued += 1;
  }
  return { enqueued };
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
          ),
          and(
            inArray(memoryRetractionAttempts.status, [...IN_FLIGHT_STATUSES]),
            or(
              isNull(memoryRetractionAttempts.locked_at),
              lte(memoryRetractionAttempts.locked_at, staleLockBefore),
            ),
          ),
        ),
        sql`${memoryRetractionAttempts.attempt_count} < ${memoryRetractionAttempts.max_attempts}`,
      ),
    )
    .orderBy(asc(memoryRetractionAttempts.next_retry_at))
    .limit(options.limit);
}

// ---------------------------------------------------------------------------
// Drizzle-backed store
// ---------------------------------------------------------------------------

export function createDrizzleRetractionStore(db: DbHandle): RetractionStore {
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
      const rows = await db
        .update(memoryRetractionAttempts)
        .set({
          // queued/failed enter the saga at 'running'; in-flight statuses
          // keep their recorded progress so the saga resumes there.
          status: sql`CASE WHEN ${memoryRetractionAttempts.status} IN ('queued', 'failed') THEN 'running' ELSE ${memoryRetractionAttempts.status} END`,
          attempt_count: sql`${memoryRetractionAttempts.attempt_count} + 1`,
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
              ),
              and(
                inArray(memoryRetractionAttempts.status, [
                  ...IN_FLIGHT_STATUSES,
                ]),
                or(
                  isNull(memoryRetractionAttempts.locked_at),
                  lte(memoryRetractionAttempts.locked_at, staleLockBefore),
                ),
              ),
            ),
            sql`${memoryRetractionAttempts.attempt_count} < ${memoryRetractionAttempts.max_attempts}`,
          ),
        )
        .returning();
      return rows[0] ?? null;
    },

    async recordProgress(attemptId, status, now) {
      const rows = await db
        .update(memoryRetractionAttempts)
        .set({
          status,
          error_class: null,
          error_message: null,
          updated_at: now,
        })
        .where(eq(memoryRetractionAttempts.id, attemptId))
        .returning();
      const row = rows[0];
      if (!row) throw new Error(`retraction attempt vanished: ${attemptId}`);
      return row;
    },

    async markRetracted(attemptId, now) {
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
        .where(eq(memoryRetractionAttempts.id, attemptId))
        .returning();
      const row = rows[0];
      if (!row) throw new Error(`retraction attempt vanished: ${attemptId}`);
      return row;
    },

    async markFailed(attempt, failure, now) {
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
        .where(eq(memoryRetractionAttempts.id, attempt.id))
        .returning();
      const row = rows[0];
      if (!row) throw new Error(`retraction attempt vanished: ${attempt.id}`);
      return row;
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

    async retractSupports(args) {
      await db.transaction(async (tx) => {
        await tx
          .update(memoryClaimEvidence)
          .set({ status: "retracted", retracted_at: args.now })
          .where(
            and(
              eq(memoryClaimEvidence.tenant_id, args.tenantId),
              eq(memoryClaimEvidence.evidence_item_id, args.evidenceItemId),
              eq(memoryClaimEvidence.status, "active"),
            ),
          );
        await deactivateOrphanedClaims(tx, {
          tenantId: args.tenantId,
          sourceConfigId: args.sourceConfigId,
          evidenceItemId: args.evidenceItemId,
        });
        await tx
          .update(memoryDerivations)
          .set({
            lifecycle: "retracted",
            retracted_at: args.now,
            updated_at: args.now,
          })
          .where(
            and(
              eq(memoryDerivations.id, args.derivationId),
              eq(memoryDerivations.tenant_id, args.tenantId),
              inArray(memoryDerivations.lifecycle, ["active", "superseded"]),
            ),
          );
        if (args.deleteEvidence) {
          await tx
            .update(memoryEvidenceItems)
            .set({ lifecycle: "deleted", updated_at: args.now })
            .where(
              and(
                eq(memoryEvidenceItems.id, args.evidenceItemId),
                eq(memoryEvidenceItems.tenant_id, args.tenantId),
              ),
            );
        }
      });
    },
  };
}

// ---------------------------------------------------------------------------
// The saga
// ---------------------------------------------------------------------------

export type ProcessRetractionDeps = {
  db: DbHandle;
  adapter: Pick<MemoryAdapter, "deleteDocument" | "consolidateBankById">;
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

  // Step 1 — CAS claim. A lost claim (fresh lock elsewhere, terminal row,
  // exhausted attempts) returns the current row unchanged.
  const claimed = await store.claimAttempt(attemptId, {
    lockedBy: opts.lockedBy ?? "memory-retraction",
    now: opts.now ?? new Date(),
  });
  if (!claimed) {
    const current = await store.loadAttempt(attemptId);
    if (!current) {
      throw new Error(`retraction attempt not found: ${attemptId}`);
    }
    return current;
  }

  let row = claimed;
  try {
    // Step 2 — supports_updated: sever the claim-support graph and retract
    // the derivation lineage before anything destructive hits the provider.
    if (row.status === "running") {
      if (!row.derivation_id) {
        throw new RetractionStepError({
          errorClass: "derivation_missing",
          message: "retraction attempt has no derivation_id",
        });
      }
      const derivation = await store.loadDerivation(
        row.tenant_id,
        row.derivation_id,
      );
      if (!derivation) {
        throw new RetractionStepError({
          errorClass: "derivation_missing",
          message: `derivation not found: ${row.derivation_id}`,
        });
      }
      await store.retractSupports({
        tenantId: row.tenant_id,
        sourceConfigId: row.source_config_id,
        evidenceItemId: derivation.evidence_item_id,
        derivationId: derivation.id,
        deleteEvidence: row.scope === "source",
        now: new Date(),
      });
      row = await store.recordProgress(row.id, "supports_updated", new Date());
    }

    // Step 3 — provider_deleted: pinned Hindsight 0.8.4 document delete.
    // "not_found" is idempotent success (a prior attempt's delete landed).
    if (row.status === "supports_updated") {
      if (typeof deps.adapter.deleteDocument !== "function") {
        return await store.markFailed(
          row,
          {
            errorClass: "unsupported_engine",
            errorMessage:
              "active memory adapter does not implement deleteDocument; retraction unsupported",
            retryable: false,
          },
          new Date(),
        );
      }
      const owner = parseBankOwner(row.target_bank_id);
      await deps.adapter.deleteDocument({
        tenantId: row.tenant_id,
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
        documentId: row.provider_document_id,
      });
      row = await store.recordProgress(row.id, "provider_deleted", new Date());
    }

    // Step 4 — reconsolidated: let the engine reconcile the bank now that
    // the document's units are gone. No consolidator available is a logged
    // skip, not a failure.
    if (row.status === "provider_deleted") {
      if (deps.consolidate) {
        await deps.consolidate(row.tenant_id, row.target_bank_id);
      } else if (typeof deps.adapter.consolidateBankById === "function") {
        await deps.adapter.consolidateBankById(row.target_bank_id);
      } else {
        console.log(
          `[memory-retraction] no consolidator available; skipping reconsolidation attempt=${row.id} bank=${row.target_bank_id.slice(0, 18)}`,
        );
      }
      row = await store.recordProgress(row.id, "reconsolidated", new Date());
    }

    // Step 5 — terminal.
    return await store.markRetracted(row.id, new Date());
  } catch (err) {
    return store.markFailed(row, classifyRetractionError(err), new Date());
  }
}
