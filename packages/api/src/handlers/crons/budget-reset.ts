/**
 * PRD-02: Monthly budget reset cron.
 *
 * Runs daily at 00:05 UTC. On the 1st of each month, unpauses all
 * budget-paused agents so they can start fresh for the new billing period.
 */

import { eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { agents } from "@thinkwork/database-pg/schema";

const db = getDb();

export async function handler(): Promise<{ reset: boolean; count: number }> {
	const now = new Date();

	// Only reset on the 1st of the month
	if (now.getUTCDate() !== 1) {
		return { reset: false, count: 0 };
	}

	const result = await db
		.update(agents)
		.set({
			budget_paused: false,
			budget_paused_at: null,
			budget_paused_reason: null,
		})
		.where(eq(agents.budget_paused, true))
		.returning({ id: agents.id });

	console.log(`[budget-reset] Unpaused ${result.length} agents`);
	return { reset: true, count: result.length };
}
