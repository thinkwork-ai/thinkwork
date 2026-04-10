/**
 * E2E test: verify Thread.costSummary resolver queries don't throw
 * "operator does not exist: uuid = text" against the real dev database.
 *
 * Runs against the ericodom-stage Aurora cluster via RDS Data API.
 * Requires AWS credentials with rds-data:ExecuteStatement permission.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { eq, and, sql, asc } from "drizzle-orm";
import { createDb } from "@thinkwork/database-pg";
import {
	threads,
	costEvents,
	threadTurns,
	messages,
} from "@thinkwork/database-pg/schema";

const CLUSTER_ARN = "arn:aws:rds:us-east-1:487219502366:cluster:thinkwork-ericodom-db";
const SECRET_ARN = "arn:aws:secretsmanager:us-east-1:487219502366:secret:thinkwork-ericodom-graphql-db-credentials-EMNbVe";
const DATABASE = "thinkwork";

let db: ReturnType<typeof createDb>;
let sampleThreadId: string;

beforeAll(async () => {
	process.env.AWS_REGION = "us-east-1";
	db = createDb(process.env.DATABASE_URL || `postgresql://thinkwork_admin:password@localhost:5432/${DATABASE}`);

	// Grab a real thread ID to use in sub-field queries
	const rows = await db.select({ id: threads.id }).from(threads).limit(1);
	if (rows.length === 0) {
		throw new Error("No threads in dev database — cannot run e2e test");
	}
	sampleThreadId = rows[0].id;
	console.log(`Using sample thread: ${sampleThreadId}`);
});

describe("Thread sub-field resolvers (e2e, real DB)", () => {
	it("costSummary: direct cost_events query (eq on uuid column)", async () => {
		// This is the query that was failing with "uuid = text"
		const directCosts = await db
			.select({ total: sql<string>`COALESCE(SUM(amount_usd), 0)` })
			.from(costEvents)
			.where(eq(costEvents.thread_id, sampleThreadId));

		expect(directCosts).toHaveLength(1);
		expect(Number(directCosts[0].total)).toBeGreaterThanOrEqual(0);
	});

	it("costSummary: turn-linked cost_events query (join + eq on uuid)", async () => {
		const turnCosts = await db
			.select({ total: sql<string>`COALESCE(SUM(${costEvents.amount_usd}), 0)` })
			.from(costEvents)
			.innerJoin(threadTurns, sql`${threadTurns.wakeup_request_id}::text = ${costEvents.request_id}`)
			.where(and(
				eq(threadTurns.thread_id, sampleThreadId),
				sql`${costEvents.thread_id} IS NULL`,
			));

		expect(turnCosts).toHaveLength(1);
		expect(Number(turnCosts[0].total)).toBeGreaterThanOrEqual(0);
	});

	it("messages: sub-field query uses eq on uuid column", async () => {
		const rows = await db
			.select()
			.from(messages)
			.where(eq(messages.thread_id, sampleThreadId))
			.orderBy(asc(messages.created_at))
			.limit(5);

		// May be empty for this thread, but should not throw
		expect(Array.isArray(rows)).toBe(true);
	});
});
