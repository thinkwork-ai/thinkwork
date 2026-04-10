/**
 * Cron: Recover Stale Checkouts
 *
 * Finds threads where checkout_run_id is set but the referenced trigger
 * run has finished (status != 'running'). Releases the lock by clearing
 * checkout_run_id so the thread can be picked up again.
 *
 * Schedule: every 5 minutes
 */

import { sql } from "drizzle-orm";
import { threads } from "@thinkwork/database-pg/schema";
import { getDb } from "@thinkwork/database-pg";

export async function handler() {
	const db = getDb();
	const now = new Date();

	// Single UPDATE … FROM join: release threads whose checkout run is no
	// longer running (finished, failed, cancelled, etc.) or whose run no
	// longer exists at all.
	const result = await db
		.update(threads)
		.set({
			checkout_run_id: null,
			updated_at: now,
		})
		.where(
			sql`${threads.checkout_run_id} IS NOT NULL
				AND (
					NOT EXISTS (
						SELECT 1 FROM thread_turns
						WHERE thread_turns.id = ${threads.checkout_run_id}::uuid
					)
					OR EXISTS (
						SELECT 1 FROM thread_turns
						WHERE thread_turns.id = ${threads.checkout_run_id}::uuid
						  AND thread_turns.status != 'running'
					)
				)`,
		)
		.returning({ id: threads.id });

	console.log(`Recovered ${result.length} stale thread checkouts`, {
		threadIds: result.map((r) => r.id),
	});

	return { recovered: result.length };
}
