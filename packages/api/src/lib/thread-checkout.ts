/**
 * THINK-324 C5 — pre-dispatch thread checkout.
 *
 * `threads.checkout_run_id` is the single-writer lease for a thread's agent
 * turns. The orchestration mutations (checkoutThread/releaseThread) have used
 * it since PRD-09, and the wakeup defer/promote machinery keys off it — but
 * neither chat dispatch path ever CLAIMED it, so two quick sends raced two
 * concurrent runtime turns whose durable-session writes collided (the loser
 * logged SessionConflictError yet still delivered, silently dropping its
 * exchange from the durable session).
 *
 * Claim rules:
 *  - free thread (checkout_run_id IS NULL) → claim
 *  - already held by this run id → claim (idempotent re-entry)
 *  - held by a DEAD turn → steal. Liveness = the holding thread_turns row is
 *    still `running`, unfinalized, and has bumped `last_activity_at` within
 *    STALE_CHECKOUT_MINUTES. Streaming turns bump every ≤60s (THINK-324 C1),
 *    so a holder silent for 10 minutes is gone — stealing here is what keeps
 *    a crashed runtime from wedging the thread while the stall monitor is
 *    disabled.
 *  - held by a LIVE turn → busy; the caller defers instead of dispatching.
 */

import { sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";

const db = getDb();

export const STALE_CHECKOUT_MINUTES = 10;

export async function claimThreadCheckout(input: {
  tenantId: string;
  threadId: string;
  runId: string;
}): Promise<boolean> {
  // threads.checkout_run_id is a TEXT column (schema/threads.ts), so the run
  // id must be compared as text — a ::uuid cast on either side raises 42883
  // "operator does not exist: text = uuid" and the claim fails open. The
  // liveness join casts the column to uuid only behind a CASE format guard:
  // the orchestration mutations accept client-supplied run ids, so a non-uuid
  // value must read as "no live holder" (steal) rather than abort the claim.
  const result = await db.execute(sql`
		UPDATE threads
		SET checkout_run_id = ${input.runId}, updated_at = NOW()
		WHERE id = ${input.threadId}::uuid
		  AND tenant_id = ${input.tenantId}::uuid
		  AND (
		    checkout_run_id IS NULL
		    OR checkout_run_id = ${input.runId}
		    OR NOT EXISTS (
		      SELECT 1 FROM thread_turns tt
		      WHERE tt.id = CASE
		          WHEN threads.checkout_run_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
		            THEN threads.checkout_run_id::uuid
		        END
		        AND tt.status = 'running'
		        AND tt.finalized_at IS NULL
		        AND tt.last_activity_at > NOW() - (${STALE_CHECKOUT_MINUTES} * INTERVAL '1 minute')
		    )
		  )
		RETURNING id
	`);
  return (result.rows || []).length > 0;
}

/**
 * Release the checkout iff this run still holds it (a later steal must not be
 * clobbered by the dead holder's tardy release). Best-effort: a release
 * failure self-heals through the stale-steal window above, so callers never
 * fail a turn over it.
 */
export async function releaseThreadCheckout(input: {
  threadId: string;
  runId: string;
}): Promise<void> {
  try {
    await db.execute(sql`
			UPDATE threads
			SET checkout_run_id = NULL, updated_at = NOW()
			WHERE id = ${input.threadId}::uuid
			  AND checkout_run_id = ${input.runId}
		`);
  } catch (err) {
    console.warn(
      `[thread-checkout] release failed (best-effort, stale-steal self-heals): thread=${input.threadId} run=${input.runId}`,
      err instanceof Error ? err.message : err,
    );
  }
}
