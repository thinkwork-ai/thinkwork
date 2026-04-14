/**
 * webhook-deliveries-cleanup Lambda
 *
 * Runs on a daily EventBridge schedule. Deletes `webhook_deliveries` rows
 * older than 90 days to keep the table bounded and to enforce the PII
 * retention policy documented on the schema.
 *
 * Logs the delete count as a single line so the retention rate can be
 * charted in CloudWatch Logs Insights.
 */

import { lt, sql } from "drizzle-orm";
import { getDb, schema } from "@thinkwork/database-pg";

const { webhookDeliveries } = schema;

const RETENTION_DAYS = 90;

export async function handler(): Promise<{ deleted: number }> {
	const db = getDb();
	const start = Date.now();

	const deletedRows = await db
		.delete(webhookDeliveries)
		.where(
			lt(
				webhookDeliveries.received_at,
				sql`now() - (${RETENTION_DAYS} || ' days')::interval`,
			),
		)
		.returning({ id: webhookDeliveries.id });

	const deleted = deletedRows.length;
	const duration = Date.now() - start;
	console.log(
		`[webhook-deliveries-cleanup] deleted=${deleted} retention_days=${RETENTION_DAYS} duration_ms=${duration}`,
	);

	return { deleted };
}
