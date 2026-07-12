/**
 * Erase write-fence for memory-source stage writers (THINK-193 U2, Codex
 * round-3 P1-2 + round-6 P1-3).
 *
 * beginSourceErase bumps memory_source_configs.erase_generation in the same
 * transaction that disables the source. Stage writers capture the generation
 * with the source row at stage start; then:
 *
 *   (a) INTERNAL writes CAS on it: the write transaction calls
 *       assertSourceWritable with lock=true, which takes FOR SHARE on the
 *       source row — a concurrent erase bump serializes against the write
 *       transaction, so either the write commits before the erase starts
 *       (and the erase retracts it) or the check sees the new generation and
 *       the transaction rolls back.
 *   (b) EXTERNAL writes (Hindsight document upsert, S3 snapshot put) check
 *       the fence immediately BEFORE the call and re-check it AFTER — a
 *       generation moved during the call means the erase may already have
 *       swept (even completed), so the caller must COMPENSATE:
 *       - S3 snapshot put: directly delete the EXACT just-written object
 *         version (VersionId captured from the PutObject response) and
 *         verify zero versions remain for the key;
 *       - Hindsight upsert: directly delete the just-written document.
 *       When the direct compensation itself fails, rearmEraseCleanup
 *       durably REOPENS (or re-creates, when the prior marker already went
 *       terminal) the erase marker at the source's current generation, so
 *       the dedicated drainer re-runs the sweep and the erase is not
 *       treated as complete until zero versions are verified.
 */

import { and, eq, notInArray } from "drizzle-orm";
import {
  memoryRetractionAttempts,
  memorySourceConfigs,
} from "@thinkwork/database-pg/schema";
import type { DbHandle } from "./types.js";

export class SourceEraseFencedError extends Error {
  readonly reason: "missing" | "disabled" | "generation_advanced";

  constructor(reason: SourceEraseFencedError["reason"], message: string) {
    super(message);
    this.name = "SourceEraseFencedError";
    this.reason = reason;
  }
}

export type SourceFence = {
  enabled: boolean;
  eraseGeneration: number;
};

/** Read the source's current fence values; lock=true adds FOR SHARE (call
 * inside the write transaction so an erase bump serializes against it). */
export async function readSourceFence(
  db: DbHandle,
  args: { tenantId: string; sourceConfigId: string; lock?: boolean },
): Promise<SourceFence | null> {
  const query = db
    .select({
      enabled: memorySourceConfigs.enabled,
      erase_generation: memorySourceConfigs.erase_generation,
    })
    .from(memorySourceConfigs)
    .where(
      and(
        eq(memorySourceConfigs.id, args.sourceConfigId),
        eq(memorySourceConfigs.tenant_id, args.tenantId),
      ),
    )
    .limit(1);
  const rows = args.lock ? await query.for("share") : await query;
  const row = rows[0];
  if (!row) return null;
  return {
    enabled: row.enabled,
    eraseGeneration: row.erase_generation ?? 0,
  };
}

/**
 * Throw when the source is no longer writable under the fence captured at
 * stage start: missing row, disabled source, or advanced erase generation.
 */
export async function assertSourceWritable(
  db: DbHandle,
  args: {
    tenantId: string;
    sourceConfigId: string;
    expectedEraseGeneration: number;
    lock?: boolean;
  },
): Promise<void> {
  const fence = await readSourceFence(db, args);
  if (!fence) {
    throw new SourceEraseFencedError(
      "missing",
      `memory source config ${args.sourceConfigId} no longer exists — aborting write`,
    );
  }
  if (fence.eraseGeneration !== args.expectedEraseGeneration) {
    throw new SourceEraseFencedError(
      "generation_advanced",
      `memory source config ${args.sourceConfigId} erase generation advanced (${args.expectedEraseGeneration} → ${fence.eraseGeneration}) — an erase is in progress, aborting write`,
    );
  }
  if (!fence.enabled) {
    throw new SourceEraseFencedError(
      "disabled",
      `memory source config ${args.sourceConfigId} is disabled — aborting write`,
    );
  }
}

/**
 * Durable compensation fallback for an external write that landed after the
 * erase generation moved and whose DIRECT compensation failed (round-6 P1):
 * guarantee the dedicated drainer re-runs the destructive sweep by either
 *   (a) re-arming a surviving NON-TERMINAL marker — cleanup phase/cursor
 *       reset, due immediately — or
 *   (b) CREATING a fresh marker at the source's current generation when the
 *       prior marker already went terminal (the erase looked complete but a
 *       stale write resurrected an object).
 * Returns true when a marker is guaranteed pending; false only when the
 * source config row itself no longer exists.
 */
export async function rearmEraseCleanup(
  db: DbHandle,
  args: { tenantId: string; sourceConfigId: string; now?: Date },
): Promise<boolean> {
  const now = args.now ?? new Date();
  const rearmed = await db
    .update(memoryRetractionAttempts)
    .set({
      cleanup_phase: null,
      cleanup_cursor: null,
      next_retry_at: now,
      updated_at: now,
    })
    .where(
      and(
        eq(memoryRetractionAttempts.tenant_id, args.tenantId),
        eq(memoryRetractionAttempts.source_config_id, args.sourceConfigId),
        eq(memoryRetractionAttempts.scope, "erase"),
        notInArray(memoryRetractionAttempts.status, [
          "retracted",
          "dead_lettered",
        ]),
      ),
    )
    .returning({ id: memoryRetractionAttempts.id });
  if (rearmed.length > 0) return true;

  // Prior marker terminal (or never created): reopen the erase durably at
  // the source's CURRENT generation.
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
  const source = sources[0];
  if (!source) return false;
  await db
    .insert(memoryRetractionAttempts)
    .values({
      tenant_id: args.tenantId,
      scope: "erase",
      derivation_id: null,
      source_config_id: args.sourceConfigId,
      provider: "erase_aggregate",
      provider_document_id: `erase:${args.sourceConfigId}`,
      target_bank_id: `erase:${args.sourceConfigId}`,
      status: "queued",
      erase_generation: source.erase_generation ?? 0,
      next_retry_at: now,
      updated_at: now,
    })
    .onConflictDoNothing();
  return true;
}
