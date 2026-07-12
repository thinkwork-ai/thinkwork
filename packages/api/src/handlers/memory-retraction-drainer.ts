/**
 * memory-retraction-drainer — scheduled retry drainer for the retraction
 * saga ledger (THINK-193 U2, Codex P1 #3).
 *
 * memory_retraction_attempts rows that failed retryably (provider 5xx) or
 * whose worker died mid-saga previously had NO production caller for
 * listDueRetractionAttempts — nothing ever retried them. This Lambda runs on
 * an EventBridge Scheduler rate(5 minutes) schedule and each tick:
 *
 *   1. sweeps exhausted non-terminal rows (attempt_count >= max_attempts
 *      with an absent/stale lock) to 'dead_lettered' so nothing retries
 *      forever,
 *   2. claims a bounded batch of due/stale attempts and processes each via
 *      processRetractionAttempt under a per-invocation fenced worker id
 *      (locked_by + lock_generation CAS — a stale drainer can never clobber
 *      a newer claimant), and
 *   3. emits one structured-log metrics line (retries, retractions,
 *      dead-letters) for alarming.
 *
 * Lambda async retries are disabled in Terraform (the schedule's next tick
 * IS the retry); per-attempt failures are recorded on the ledger row by the
 * saga and never abort the batch.
 */

import { randomUUID } from "node:crypto";
import { getDb } from "@thinkwork/database-pg";
import type { MemoryAdapter } from "../lib/memory/adapter.js";
import {
  createDrizzleSourceEraseStore,
  deadLetterExhaustedAttempts,
  listDueRetractionAttempts,
  processRetractionAttempt,
  runSourceErase,
  type RetractionAttemptRow,
  type SourceEraseResult,
} from "../lib/memory-sources/retraction.js";
import type { DbHandle } from "../lib/memory-sources/types.js";

export const DEFAULT_DRAIN_LIMIT = 25;
export const MAX_DRAIN_LIMIT = 100;
export const MAX_ERASE_AGGREGATES_PER_TICK = 5;

export type MemoryRetractionDrainerEvent = {
  /** Batch bound per invocation (clamped to [1, MAX_DRAIN_LIMIT]). */
  limit?: number;
};

export type MemoryRetractionDrainerSummary = {
  scanned: number;
  processed: number;
  retracted: number;
  /** Failed retryably — scheduled for a later tick via next_retry_at. */
  retrying: number;
  deadLettered: number;
  /** Attempts whose processing threw (row state owned by the saga). */
  errors: number;
  /** Exhausted non-terminal rows swept to dead_lettered this tick. */
  exhaustedDeadLettered: number;
  /** Rows that came back non-terminal and not failed (lost claim/fence). */
  conflicts: number;
  /** Source-erase aggregates whose cleanup phase finished this tick. */
  eraseAggregatesCompleted: number;
  /** Aggregates whose cleanup run ended pending/failed (or threw). */
  eraseAggregatesIncomplete: number;
};

export interface MemoryRetractionDrainerOptions {
  db?: DbHandle;
  adapter?: Pick<MemoryAdapter, "deleteDocument" | "consolidateBankById">;
  /** Test seam; defaults to {@link listDueRetractionAttempts}. */
  list?: (
    db: DbHandle,
    options: { limit: number },
  ) => Promise<RetractionAttemptRow[]>;
  /** Test seam; defaults to {@link processRetractionAttempt}. */
  process?: (
    attemptId: string,
    opts: { lockedBy: string },
  ) => Promise<RetractionAttemptRow>;
  /** Test seam; defaults to {@link deadLetterExhaustedAttempts}. */
  deadLetterExhausted?: (db: DbHandle) => Promise<RetractionAttemptRow[]>;
  /** Test seam; defaults to the drizzle erase store's cleanup listing. */
  listEraseCleanup?: (
    db: DbHandle,
    limit: number,
  ) => Promise<Array<{ tenantId: string; sourceConfigId: string }>>;
  /** Test seam; defaults to {@link runSourceErase}. */
  runErase?: (ref: {
    tenantId: string;
    sourceConfigId: string;
  }) => Promise<SourceEraseResult>;
  /** Fenced worker identity; defaults to a per-invocation unique id. */
  lockedBy?: string;
}

function clampLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return DEFAULT_DRAIN_LIMIT;
  }
  return Math.max(1, Math.min(MAX_DRAIN_LIMIT, Math.floor(limit)));
}

export async function runMemoryRetractionDrainer(
  event: MemoryRetractionDrainerEvent,
  options: MemoryRetractionDrainerOptions = {},
): Promise<MemoryRetractionDrainerSummary> {
  const db = options.db ?? (getDb() as DbHandle);
  const lockedBy =
    options.lockedBy ?? `memory-retraction-drainer:${randomUUID()}`;
  const list = options.list ?? listDueRetractionAttempts;
  const deadLetterExhausted =
    options.deadLetterExhausted ??
    ((handle: DbHandle) => deadLetterExhaustedAttempts(handle));
  const process =
    options.process ??
    (async (attemptId: string, opts: { lockedBy: string }) => {
      const adapter = options.adapter ?? (await resolveAdapter());
      return processRetractionAttempt({ db, adapter }, attemptId, {
        lockedBy: opts.lockedBy,
      });
    });

  // 1. Exhausted-row sweep: a worker that crashed on its FINAL attempt
  //    leaves a non-terminal row no claim predicate picks up.
  const exhausted = await deadLetterExhausted(db);
  for (const row of exhausted) {
    console.warn(
      `[memory-retraction-drainer] dead_lettered exhausted attempt=${row.id} tenant=${row.tenant_id} document=${row.provider_document_id.slice(0, 64)}`,
    );
  }

  // 2. Bounded batch of due work.
  const limit = clampLimit(event?.limit);
  const due = await list(db, { limit });

  const summary: MemoryRetractionDrainerSummary = {
    scanned: due.length,
    processed: 0,
    retracted: 0,
    retrying: 0,
    deadLettered: 0,
    errors: 0,
    exhaustedDeadLettered: exhausted.length,
    conflicts: 0,
    eraseAggregatesCompleted: 0,
    eraseAggregatesIncomplete: 0,
  };

  for (const attempt of due) {
    try {
      const result = await process(attempt.id, { lockedBy });
      summary.processed += 1;
      switch (result.status) {
        case "retracted":
          summary.retracted += 1;
          break;
        case "failed":
          summary.retrying += 1;
          console.warn(
            `[memory-retraction-drainer] retry scheduled attempt=${result.id} error=${result.error_class ?? "?"} next_retry_at=${result.next_retry_at?.toISOString() ?? "?"}`,
          );
          break;
        case "dead_lettered":
          summary.deadLettered += 1;
          console.error(
            `[memory-retraction-drainer] dead_lettered attempt=${result.id} tenant=${result.tenant_id} error=${result.error_class ?? "?"}: ${result.error_message ?? ""}`,
          );
          break;
        default:
          // Non-terminal, non-failed: a fence/claim conflict — another
          // worker owns the saga; its ledger row already reflects it.
          summary.conflicts += 1;
          break;
      }
    } catch (err) {
      summary.errors += 1;
      console.error(
        `[memory-retraction-drainer] attempt ${attempt.id} crashed: ${(err as Error)?.message ?? String(err)}`,
      );
    }
  }

  // 3. Erase-aggregate cleanup sweep: an eraseMemorySource whose child
  //    attempts have all been retracted (possibly across several ticks)
  //    still needs its cleanup phase (S3 snapshot prefix delete → evidence
  //    purge → checkpoints LAST). The erase must self-finalize from this
  //    drainer — a second operator mutation is never required.
  const listEraseCleanup =
    options.listEraseCleanup ??
    ((handle: DbHandle, limit: number) =>
      createDrizzleSourceEraseStore(handle).listEraseAggregatesNeedingCleanup(
        limit,
      ));
  const runErase =
    options.runErase ??
    (async (ref: { tenantId: string; sourceConfigId: string }) => {
      const adapter = options.adapter ?? (await resolveAdapter());
      // S2: ONLY the drainer (dedicated IAM role with the evidence-snapshots
      // version-delete grant) performs destructive cleanup.
      return runSourceErase(
        { db, adapter, destructiveCleanup: true, cleanupLockedBy: lockedBy },
        ref,
      );
    });
  try {
    const aggregates = await listEraseCleanup(
      db,
      MAX_ERASE_AGGREGATES_PER_TICK,
    );
    for (const ref of aggregates) {
      try {
        const eraseResult = await runErase(ref);
        if (eraseResult.status === "completed") {
          summary.eraseAggregatesCompleted += 1;
          console.log(
            `[memory-retraction-drainer] erase aggregate completed tenant=${ref.tenantId} source=${ref.sourceConfigId} snapshotObjects=${eraseResult.snapshotObjectsDeleted} snapshotVersions=${eraseResult.snapshotVersionsDeleted} evidenceCleared=${eraseResult.evidenceRowsCleared} evidenceDeleted=${eraseResult.evidenceRowsDeleted}`,
          );
        } else {
          summary.eraseAggregatesIncomplete += 1;
          console.warn(
            `[memory-retraction-drainer] erase aggregate ${eraseResult.status} tenant=${ref.tenantId} source=${ref.sourceConfigId} attempts=${JSON.stringify(eraseResult.attempts)}`,
          );
        }
      } catch (err) {
        summary.eraseAggregatesIncomplete += 1;
        console.error(
          `[memory-retraction-drainer] erase aggregate cleanup crashed tenant=${ref.tenantId} source=${ref.sourceConfigId}: ${(err as Error)?.message ?? String(err)}`,
        );
      }
    }
  } catch (err) {
    // Round-3 P2-4: a failed cleanup LISTING is an unhealthy tick — it must
    // show in the structured metric, not just in a log line.
    summary.errors += 1;
    console.error(
      `[memory-retraction-drainer] erase cleanup sweep failed: ${(err as Error)?.message ?? String(err)}`,
    );
  }

  // 4. Structured metrics line (CloudWatch metric-filter friendly).
  console.log(
    JSON.stringify({
      metric: "memory_retraction_drainer",
      ...summary,
    }),
  );
  return summary;
}

/** Lazy adapter resolution so unit tests never touch memory config/env. */
async function resolveAdapter(): Promise<
  Pick<MemoryAdapter, "deleteDocument" | "consolidateBankById">
> {
  const { getMemoryServices } = await import("../lib/memory/index.js");
  return getMemoryServices().adapter;
}

export async function handler(
  event: MemoryRetractionDrainerEvent,
  context?: { awsRequestId?: string },
): Promise<MemoryRetractionDrainerSummary> {
  return runMemoryRetractionDrainer(event ?? {}, {
    lockedBy: context?.awsRequestId
      ? `memory-retraction-drainer:${context.awsRequestId}`
      : undefined,
  });
}
