/**
 * auth-ticket-sweeper — hourly retention sweep for auth_subscription_tickets.
 *
 * `auth-subscription-ticket.ts` mints a single-use, 60-second AppSync
 * subscription ticket on every connect AND on every subscription
 * registration — roughly 30 rows/minute per active stage. Nothing ever
 * deleted them: on the McPherson stage the table had grown to 551k rows
 * / 306 MB (~24 MB/day) with `idx_scan = 0`, i.e. pure write-amplified
 * dead weight (autovacuum churn, bloated indexes, longer base backups).
 *
 * A ticket is dead 60 seconds after it is minted, so anything past
 * `expires_at` is unreadable by the authorizer. We still keep a one-hour
 * grace window past expiry so a just-failed subscription handshake can be
 * traced in the table while an operator is looking at it.
 *
 * Batching: Postgres has no `DELETE ... LIMIT`, so each batch resolves a
 * bounded set of `ctid`s in a subselect and deletes exactly those. This
 * keeps each statement's lock footprint and WAL burst small enough that
 * the sweep never blocks ticket minting, which is on the interactive
 * subscribe path. The loop runs until a batch comes back short (backlog
 * drained) or the time budget expires — the first invocations on a stage
 * with a large backlog chew it down over several hourly ticks instead of
 * attempting one 551k-row transaction.
 *
 * Triggered by EventBridge (aws_scheduler_schedule `auth-ticket-sweeper`)
 * once per hour. Has no HTTP surface.
 *
 * Constants:
 *   - GRACE_MS:        1 hour past expires_at
 *   - BATCH_SIZE:      25,000 rows per DELETE
 *   - TIME_BUDGET_MS:  45s (Lambda timeout for this handler is 120s)
 */

import { sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";

/** Keep rows for this long past expires_at so recent failures stay debuggable. */
const GRACE_MS = 60 * 60 * 1000;

/** Rows deleted per statement. Bounded to keep lock/WAL footprint small. */
const BATCH_SIZE = 25_000;

/** Stop starting new batches after this much wall time; the next tick resumes. */
const TIME_BUDGET_MS = 45_000;

export interface SweepResult {
  sweptAt: string;
  cutoff: string;
  deleted: number;
  batches: number;
  /**
   * true when the final batch came back short of BATCH_SIZE — the backlog
   * is drained. false means the time budget cut the loop off and rows
   * older than the cutoff remain for the next scheduled tick.
   */
  exhausted: boolean;
}

export async function handler(): Promise<SweepResult> {
  const db = getDb();
  const startedAt = Date.now();
  const now = new Date();
  const cutoff = new Date(now.getTime() - GRACE_MS);

  let deleted = 0;
  let batches = 0;
  let exhausted = false;

  for (;;) {
    const result = await db.execute(sql`
      DELETE FROM auth_subscription_tickets
      WHERE ctid IN (
        SELECT ctid
        FROM auth_subscription_tickets
        WHERE expires_at < ${cutoff}
        LIMIT ${BATCH_SIZE}
      )
    `);

    const rowCount =
      (result as unknown as { rowCount?: number | null }).rowCount ?? 0;
    deleted += rowCount;
    batches += 1;

    if (rowCount < BATCH_SIZE) {
      exhausted = true;
      break;
    }
    if (Date.now() - startedAt >= TIME_BUDGET_MS) break;
  }

  const result: SweepResult = {
    sweptAt: now.toISOString(),
    cutoff: cutoff.toISOString(),
    deleted,
    batches,
    exhausted,
  };

  console.log(
    `[auth-ticket-sweeper] deleted=${result.deleted} batches=${result.batches} ` +
      `exhausted=${result.exhausted} cutoff=${result.cutoff} ` +
      `elapsed_ms=${Date.now() - startedAt}`,
  );

  return result;
}
