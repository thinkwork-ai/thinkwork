/**
 * Cron: Cleanup Pending Connections
 *
 * Deletes connections stuck in 'pending' status that were created more than
 * 10 minutes ago — these are abandoned OAuth flows where the user started
 * authorization but never completed the callback.
 *
 * Schedule: every 1 hour
 */

import { and, eq, lt } from "drizzle-orm";
import { connections } from "@thinkwork/database-pg/schema";
import { getDb } from "@thinkwork/database-pg";

export async function handler() {
	const db = getDb();
	const cutoff = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago

	const result = await db
		.delete(connections)
		.where(
			and(
				eq(connections.status, "pending"),
				lt(connections.created_at, cutoff),
			),
		)
		.returning({ id: connections.id, tenant_id: connections.tenant_id });

	console.log(`Deleted ${result.length} stale pending connections`, {
		connectionIds: result.map((r) => r.id),
	});

	return { deleted: result.length };
}
