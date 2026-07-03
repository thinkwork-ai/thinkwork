/**
 * Dream-run audit ledger (THINK-133 U4, KTD-2).
 *
 * State machine:
 *   run:    planned → applying → applied | failed   (skipped = dedupe no-op)
 *   action: staged → applied | skipped
 *
 * The plan→apply split is the crash-safety boundary. Staging is re-runnable
 * (ON CONFLICT on (run_id, ordinal) ignores already-staged rows); apply is
 * guarded per action row, so a crashed or retried run resumes by re-loading
 * only `staged` actions and never double-applies.
 *
 * Idempotency keys follow the compile-continuation rule: the next bucket is
 * parsed forward from the prior run's dedupe key, never recomputed from
 * wall-clock alone (docs/solutions/logic-errors/compile-continuation-dedupe-
 * bucket-2026-04-20.md). Wall-clock only seeds the very first run for a bank.
 */

import { sql } from "drizzle-orm";
import type { Database } from "@thinkwork/database-pg";

export const DREAM_DEDUPE_BUCKET_SECONDS = 3600;

export type DreamActionType = "quarantine" | "forget" | "consolidate";

export interface DreamActionSpec {
  ordinal: number;
  actionType: DreamActionType;
  /** Memory-unit ids / document ids the action mutates. */
  target: {
    memoryUnitIds?: string[];
    documentIds?: string[];
  } | null;
  reason: string;
}

export interface DreamRunRow {
  id: string;
  tenant_id: string;
  bank_id: string;
  dedupe_key: string;
  status: string;
}

export interface StagedActionRow {
  id: string;
  ordinal: number;
  action_type: DreamActionType;
  target: { memoryUnitIds?: string[]; documentIds?: string[] } | null;
  reason: string | null;
}

export function buildDreamDedupeKey(
  tenantId: string,
  bankId: string,
  bucket: number,
): string {
  return `${tenantId}:${bankId}:${bucket}`;
}

export function parseDreamDedupeBucket(dedupeKey: string): number | null {
  const parts = dedupeKey.split(":");
  if (parts.length !== 3) return null;
  const bucket = Number(parts[2]);
  return Number.isInteger(bucket) ? bucket : null;
}

/**
 * Next bucket for a bank: strictly after the prior run's bucket (parsed from
 * its key, per the compile-continuation rule) and never behind the current
 * wall bucket — so back-to-back manual runs get distinct keys while a stale
 * prior key cannot pin new runs into the past.
 */
export function nextDreamBucket(
  priorDedupeKey: string | null,
  now: Date,
): number {
  const wallBucket = Math.floor(
    now.getTime() / 1000 / DREAM_DEDUPE_BUCKET_SECONDS,
  );
  if (!priorDedupeKey) return wallBucket;
  const priorBucket = parseDreamDedupeBucket(priorDedupeKey);
  if (priorBucket === null) return wallBucket;
  return Math.max(priorBucket + 1, wallBucket);
}

/** Latest run for a bank, any status — used only to parse the bucket forward. */
export async function loadLatestRun(
  db: Database,
  tenantId: string,
  bankId: string,
): Promise<DreamRunRow | null> {
  const result = await db.execute(sql`
    SELECT id, tenant_id, bank_id, dedupe_key, status
    FROM brain_dream_runs
    WHERE tenant_id = ${tenantId} AND bank_id = ${bankId}
    ORDER BY created_at DESC
    LIMIT 1
  `);
  return ((result.rows ?? [])[0] as unknown as DreamRunRow | undefined) ?? null;
}

/**
 * A run that staged but never finished applying — resumed instead of
 * creating a new run, so its unapplied staged actions run exactly once.
 */
export async function findResumableRun(
  db: Database,
  tenantId: string,
  bankId: string,
): Promise<DreamRunRow | null> {
  const result = await db.execute(sql`
    SELECT id, tenant_id, bank_id, dedupe_key, status
    FROM brain_dream_runs
    WHERE tenant_id = ${tenantId}
      AND bank_id = ${bankId}
      AND status IN ('planned', 'applying')
    ORDER BY created_at DESC
    LIMIT 1
  `);
  return ((result.rows ?? [])[0] as unknown as DreamRunRow | undefined) ?? null;
}

/**
 * Insert a new run guarded by the dedupe-key unique index. Returns null when
 * another run already claimed this bucket (idempotent skip).
 */
export async function createDreamRun(args: {
  db: Database;
  tenantId: string;
  bankId: string;
  now?: Date;
}): Promise<DreamRunRow | null> {
  const now = args.now ?? new Date();
  const latest = await loadLatestRun(args.db, args.tenantId, args.bankId);
  const bucket = nextDreamBucket(latest?.dedupe_key ?? null, now);
  const dedupeKey = buildDreamDedupeKey(args.tenantId, args.bankId, bucket);
  const result = await args.db.execute(sql`
    INSERT INTO brain_dream_runs (tenant_id, bank_id, dedupe_key, status, started_at)
    VALUES (${args.tenantId}, ${args.bankId}, ${dedupeKey}, 'planned', ${now})
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING id, tenant_id, bank_id, dedupe_key, status
  `);
  const row = (result.rows ?? [])[0] as unknown as DreamRunRow | undefined;
  if (!row) {
    console.log(
      `[brain-dream] dedupe collision bank=${args.bankId} bucket=${bucket} — skipping (inserted=false)`,
    );
    return null;
  }
  return row;
}

/** Stage the plan. Re-runnable: already-staged ordinals are left untouched. */
export async function stageDreamActions(
  db: Database,
  runId: string,
  actions: DreamActionSpec[],
): Promise<void> {
  for (const action of actions) {
    await db.execute(sql`
      INSERT INTO brain_dream_actions (run_id, ordinal, action_type, status, target, reason)
      VALUES (
        ${runId},
        ${action.ordinal},
        ${action.actionType},
        'staged',
        ${action.target ? JSON.stringify(action.target) : null}::jsonb,
        ${action.reason}
      )
      ON CONFLICT (run_id, ordinal) DO NOTHING
    `);
  }
  await db.execute(sql`
    UPDATE brain_dream_runs
    SET planned_counts = (
      SELECT COALESCE(jsonb_object_agg(action_type, n), '{}'::jsonb)
      FROM (
        SELECT action_type, count(*)::int AS n
        FROM brain_dream_actions
        WHERE run_id = ${runId}
        GROUP BY action_type
      ) counts
    ),
    updated_at = now()
    WHERE id = ${runId}
  `);
}

/** Only `staged` rows — applied/skipped rows are never re-run. */
export async function loadStagedActions(
  db: Database,
  runId: string,
): Promise<StagedActionRow[]> {
  const result = await db.execute(sql`
    SELECT id, ordinal, action_type, target, reason
    FROM brain_dream_actions
    WHERE run_id = ${runId} AND status = 'staged'
    ORDER BY ordinal ASC
  `);
  return (result.rows ?? []) as unknown as StagedActionRow[];
}

export async function markRunApplying(
  db: Database,
  runId: string,
): Promise<void> {
  await db.execute(sql`
    UPDATE brain_dream_runs
    SET status = 'applying', updated_at = now()
    WHERE id = ${runId}
  `);
}

export async function markActionApplied(
  db: Database,
  actionId: string,
): Promise<void> {
  await db.execute(sql`
    UPDATE brain_dream_actions
    SET status = 'applied', applied_at = now()
    WHERE id = ${actionId} AND status = 'staged'
  `);
}

export async function markActionSkipped(
  db: Database,
  actionId: string,
  errorMessage?: string,
): Promise<void> {
  await db.execute(sql`
    UPDATE brain_dream_actions
    SET status = 'skipped', error_message = ${errorMessage ?? null}
    WHERE id = ${actionId} AND status = 'staged'
  `);
}

export async function completeDreamRun(
  db: Database,
  runId: string,
): Promise<void> {
  await db.execute(sql`
    UPDATE brain_dream_runs
    SET status = 'applied',
        finished_at = now(),
        applied_counts = (
          SELECT COALESCE(jsonb_object_agg(action_type, n), '{}'::jsonb)
          FROM (
            SELECT action_type, count(*)::int AS n
            FROM brain_dream_actions
            WHERE run_id = ${runId} AND status = 'applied'
            GROUP BY action_type
          ) counts
        ),
        updated_at = now()
    WHERE id = ${runId}
  `);
}

export async function failDreamRun(
  db: Database,
  runId: string,
  errorMessage: string,
): Promise<void> {
  await db.execute(sql`
    UPDATE brain_dream_runs
    SET status = 'failed',
        error_message = ${errorMessage.slice(0, 500)},
        finished_at = now(),
        updated_at = now()
    WHERE id = ${runId}
  `);
}
