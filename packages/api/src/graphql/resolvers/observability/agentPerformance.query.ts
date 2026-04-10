/**
 * PRD-20: Agent performance metrics from cost_events.
 */

import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and, gte, lte, sql,
	costEvents, agents, threadTurns,
	startOfMonth,
} from "../../utils.js";

export const agentPerformance = async (_parent: any, args: any, _ctx: GraphQLContext) => {
	const from = args.from ? new Date(args.from) : startOfMonth();
	const to = args.to ? new Date(args.to) : new Date();

	const rows = await db
		.select({
			agentId: costEvents.agent_id,
			agentName: sql<string>`MAX(${agents.name})`,
			invocationCount: sql<number>`COUNT(DISTINCT ${costEvents.request_id})::int`,
			avgDurationMs: sql<number>`COALESCE(AVG(${costEvents.duration_ms}), 0)::float`,
			p95DurationMs: sql<number>`COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ${costEvents.duration_ms}), 0)::float`,
			totalInputTokens: sql<number>`COALESCE(SUM(${costEvents.input_tokens}), 0)::int`,
			totalOutputTokens: sql<number>`COALESCE(SUM(${costEvents.output_tokens}), 0)::int`,
			totalCostUsd: sql<number>`COALESCE(SUM(amount_usd), 0)::float`,
		})
		.from(costEvents)
		.leftJoin(agents, eq(costEvents.agent_id, agents.id))
		.where(
			and(
				eq(costEvents.tenant_id, args.tenantId),
				gte(costEvents.created_at, from),
				lte(costEvents.created_at, to),
			),
		)
		.groupBy(costEvents.agent_id)
		.orderBy(sql`COALESCE(SUM(amount_usd), 0) DESC`);

	// Derive error counts from thread_turns (separate query to avoid cross-join)
	const errorRows = await db
		.select({
			agentId: threadTurns.agent_id,
			errorCount: sql<number>`COUNT(*)::int`,
		})
		.from(threadTurns)
		.where(
			and(
				eq(threadTurns.tenant_id, args.tenantId),
				eq(threadTurns.status, "failed"),
				gte(threadTurns.created_at, from),
				lte(threadTurns.created_at, to),
			),
		)
		.groupBy(threadTurns.agent_id);

	const errorMap = new Map(errorRows.map((r) => [r.agentId, r.errorCount]));

	return rows.map((r) => ({
		...r,
		errorCount: errorMap.get(r.agentId) || 0,
	}));
};
