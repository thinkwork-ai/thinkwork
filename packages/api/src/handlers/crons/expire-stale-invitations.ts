/**
 * Cron: Expire Stale Invitations
 *
 * Finds invites where expires_at < now and they haven't been revoked,
 * and deletes them to clean up expired invite tokens.
 *
 * Schedule: every 1 hour
 */

import { and, lt, isNull } from "drizzle-orm";
import { invites } from "@thinkwork/database-pg/schema";
import { getDb } from "@thinkwork/database-pg";

export async function handler() {
	const db = getDb();
	const now = new Date();

	const result = await db
		.delete(invites)
		.where(
			and(
				lt(invites.expires_at, now),
				isNull(invites.revoked_at),
			),
		)
		.returning({ id: invites.id, tenant_id: invites.tenant_id });

	console.log(`Deleted ${result.length} expired invitations`, {
		inviteIds: result.map((r) => r.id),
	});

	return { deleted: result.length };
}
