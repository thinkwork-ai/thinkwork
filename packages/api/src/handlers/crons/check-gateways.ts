/**
 * Cron: Check Gateways
 *
 * Finds agents where type='gateway' and status != 'offline' and
 * last_heartbeat_at is older than 2 minutes ago, and marks them offline.
 *
 * Schedule: every 1 minute
 */

import { eq, and, lt, ne } from "drizzle-orm";
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
				eq(agents.type, "gateway"),
				ne(agents.status, "offline"),
				lt(agents.last_heartbeat_at, cutoff),
			),
		)
		.returning({ id: agents.id, name: agents.name });

	if (result.length > 0) {
		console.log(`Marked ${result.length} gateways offline`, {
			gateways: result.map((g) => ({ id: g.id, name: g.name })),
		});
	} else {
		console.log("All gateways healthy");
	}

	return { markedOffline: result.length };
}
