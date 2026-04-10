/**
 * Cron: Mark Offline Agents
 *
 * Finds agents where status='busy' and last_heartbeat_at is older than
 * 2 minutes ago, and sets their status to 'offline'.
 *
 * Schedule: every 1 minute (EventBridge minimum)
 */

import { eq, and, lt, sql } from "drizzle-orm";
import { agents } from "@thinkwork/database-pg/schema";
import { getDb } from "@thinkwork/database-pg";

export async function handler() {
	const db = getDb();
	const now = new Date();
	const cutoff = new Date(now.getTime() - 2 * 60 * 1000); // 2 minutes ago

	const result = await db
		.update(agents)
		.set({
			status: "offline",
			updated_at: now,
		})
		.where(
			and(
				eq(agents.status, "busy"),
				lt(agents.last_heartbeat_at, cutoff),
			),
		)
		.returning({ id: agents.id, name: agents.name });

	if (result.length > 0) {
		console.log(`Marked ${result.length} agents offline`, {
			agents: result.map((a) => ({ id: a.id, name: a.name })),
		});
	} else {
		console.log("No stale busy agents found");
	}

	return { markedOffline: result.length };
}
