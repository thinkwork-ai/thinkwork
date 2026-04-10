/**
 * Cron: Expire Email Reply Tokens (PRD-14)
 *
 * Deletes consumed tokens older than 7 days and unconsumed tokens past expiry.
 *
 * Schedule: every 1 hour
 */

import { and, lt, or, isNotNull } from "drizzle-orm";
import { emailReplyTokens } from "@thinkwork/database-pg/schema";
import { getDb } from "@thinkwork/database-pg";

export async function handler() {
	const db = getDb();
	const now = new Date();
	const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

	const result = await db
		.delete(emailReplyTokens)
		.where(
			or(
				// Consumed tokens older than 7 days
				and(
					isNotNull(emailReplyTokens.consumed_at),
					lt(emailReplyTokens.consumed_at, sevenDaysAgo),
				),
				// Unconsumed tokens past expiry
				lt(emailReplyTokens.expires_at, now),
			),
		)
		.returning({ id: emailReplyTokens.id });

	console.log(`[expire-email-tokens] Deleted ${result.length} expired tokens`);

	return { deleted: result.length };
}
