/**
 * PRD-09 Batch 4: Deferred wakeup promotion.
 *
 * When a thread has an active checkout (another turn is running),
 * new wakeups for the same thread should be deferred instead of queued.
 * When a turn completes, the oldest deferred wakeup is promoted to queued.
 */

import { eq, and, asc, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { agentWakeupRequests } from "@thinkwork/database-pg/schema";

const db = getDb();

/**
 * Check if a thread currently has an active turn (checkout).
 * If so, returns true — the caller should defer the wakeup instead of queueing it.
 */
export async function shouldDeferWakeup(threadId: string): Promise<boolean> {
  if (!threadId) return false;

  try {
    const { threads } = await import("@thinkwork/database-pg/schema");
    const [thread] = await db
      .select({ checkout_run_id: threads.checkout_run_id })
      .from(threads)
      .where(eq(threads.id, threadId));

    return !!thread?.checkout_run_id;
  } catch {
    return false;
  }
}

/**
 * Promote the oldest deferred wakeup for a given thread to "queued" status.
 * Called after a turn completes so the next pending work can proceed.
 *
 * Returns the promoted wakeup ID, or null if none found.
 */
export async function promoteNextDeferredWakeup(
  tenantId: string,
  threadId: string,
): Promise<string | null> {
  if (!threadId) return null;

  try {
    // Find the oldest deferred wakeup for this thread
    // Note: payload->>'ticketId' is the JSON key stored in the DB — stays unchanged
    const result = await db.execute(sql`
			UPDATE agent_wakeup_requests
			SET status = 'queued', claimed_at = NULL
			WHERE id = (
				SELECT id FROM agent_wakeup_requests
				WHERE tenant_id = ${tenantId}::uuid
				  AND status = 'deferred'
				  AND payload->>'threadId' = ${threadId}
				ORDER BY created_at ASC
				LIMIT 1
				FOR UPDATE SKIP LOCKED
			)
			RETURNING id
		`);

    const rows = (result.rows || []) as Array<Record<string, unknown>>;
    if (rows.length > 0) {
      const promotedId = rows[0].id as string;
      console.log(
        `[wakeup-defer] Promoted deferred wakeup ${promotedId} for thread ${threadId}`,
      );
      return promotedId;
    }

    return null;
  } catch (err) {
    console.error(`[wakeup-defer] Failed to promote deferred wakeup:`, err);
    return null;
  }
}

/**
 * THINK-324 C5 — starvation backstop. Deferred wakeups are normally promoted
 * by the finalize path of the turn that held the thread checkout; a runtime
 * that dies without finalizing would strand them forever. Each poll cycle
 * re-queues deferred wakeups whose thread checkout is free or held by a dead
 * turn (not running / finalized / silent past the stale window — streaming
 * turns bump last_activity_at every ≤60s). Promoted wakeups still pass
 * through the dispatch-time checkout claim, so over-promotion is safe: a
 * busy thread just re-defers them.
 *
 * Returns the number of promoted wakeups.
 */
export async function promoteStaleDeferredWakeups(
  limit: number = 20,
): Promise<number> {
  try {
    const result = await db.execute(sql`
			UPDATE agent_wakeup_requests SET status = 'queued', claimed_at = NULL
			WHERE id IN (
				SELECT w.id FROM agent_wakeup_requests w
				JOIN threads t ON t.id = (w.payload->>'threadId')::uuid
				WHERE w.status = 'deferred'
				  AND (
				    t.checkout_run_id IS NULL
				    OR NOT EXISTS (
				      SELECT 1 FROM thread_turns tt
				      WHERE tt.id = t.checkout_run_id
				        AND tt.status = 'running'
				        AND tt.finalized_at IS NULL
				        AND tt.last_activity_at > NOW() - INTERVAL '10 minutes'
				    )
				  )
				ORDER BY w.created_at ASC
				LIMIT ${limit}
				FOR UPDATE SKIP LOCKED
			)
			RETURNING id
		`);
    const promoted = (result.rows || []).length;
    if (promoted > 0) {
      console.log(
        `[wakeup-defer] Promoted ${promoted} stale-deferred wakeup(s) (dead or released checkout)`,
      );
    }
    return promoted;
  } catch (err) {
    console.error(`[wakeup-defer] Stale-deferred sweep failed:`, err);
    return 0;
  }
}
