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
			console.log(`[wakeup-defer] Promoted deferred wakeup ${promotedId} for thread ${threadId}`);
			return promotedId;
		}

		return null;
	} catch (err) {
		console.error(`[wakeup-defer] Failed to promote deferred wakeup:`, err);
		return null;
	}
}
