/**
 * PRD-20: Daily performance time series.
 */

import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and, gte, sql,
	costEvents, threadTurns,
} from "../../utils.js";

export const performanceTimeSeries = async (_parent: any, args: any, _ctx: GraphQLContext) => {
	const days = args.days || 30;
	const cutoff = new Date();
	cutoff.setDate(cutoff.getDate() - days);

	const conditions = [
		eq(costEvents.tenant_id, args.tenantId),
		gte(costEvents.created_at, cutoff),
	];

	if (args.agentId) {
		conditions.push(eq(costEvents.agent_id, args.agentId));
	}

	const rows = await db
		.select({
			day: sql<string>`TO_CHAR(${costEvents.created_at}, 'YYYY-MM-DD')`,
			invocationCount: sql<number>`COUNT(DISTINCT ${costEvents.request_id})::int`,
			avgDurationMs: sql<number>`COALESCE(AVG(${costEvents.duration_ms}), 0)::float`,
			errorCount: sql<number>`0`, // Will be enriched from spans later
			totalCostUsd: sql<number>`COALESCE(SUM(amount_usd), 0)::float`,
		})
		.from(costEvents)
		.where(and(...conditions))
		.groupBy(sql`TO_CHAR(${costEvents.created_at}, 'YYYY-MM-DD')`)
		.orderBy(sql`TO_CHAR(${costEvents.created_at}, 'YYYY-MM-DD') ASC`);

	// Derive error counts from thread_turns per day
	const errorConditions = [
		eq(threadTurns.tenant_id, args.tenantId),
		eq(threadTurns.status, "failed"),
		gte(threadTurns.created_at, cutoff),
	];
	if (args.agentId) {
		errorConditions.push(eq(threadTurns.agent_id, args.agentId));
	}

	const errorRows = await db
		.select({
			day: sql<string>`TO_CHAR(${threadTurns.created_at}, 'YYYY-MM-DD')`,
			errorCount: sql<number>`COUNT(*)::int`,
		})
		.from(threadTurns)
		.where(and(...errorConditions))
		.groupBy(sql`TO_CHAR(${threadTurns.created_at}, 'YYYY-MM-DD')`);

	const errorMap = new Map(errorRows.map((r) => [r.day, r.errorCount]));

	return rows.map((r) => ({
		...r,
		errorCount: errorMap.get(r.day) || 0,
	}));
};
