/**
 * PRD-20B: Performance metrics for a single agent.
 */

import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and, gte, sql,
	costEvents, threadTurns,
	startOfMonth,
} from "../../utils.js";

export const singleAgentPerformance = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const from = startOfMonth();

	const [metrics] = await db
		.select({
			invocationCount: sql<number>`COUNT(DISTINCT ${costEvents.request_id})::int`,
			avgDurationMs: sql<number>`COALESCE(AVG(${costEvents.duration_ms}), 0)::float`,
			p95DurationMs: sql<number>`COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ${costEvents.duration_ms}), 0)::float`,
			totalInputTokens: sql<number>`COALESCE(SUM(${costEvents.input_tokens}), 0)::int`,
			totalOutputTokens: sql<number>`COALESCE(SUM(${costEvents.output_tokens}), 0)::int`,
			totalCostUsd: sql<number>`COALESCE(SUM(amount_usd), 0)::float`,
		})
		.from(costEvents)
		.where(
			and(
				eq(costEvents.agent_id, args.agentId),
				eq(costEvents.tenant_id, args.tenantId),
				gte(costEvents.created_at, from),
			),
		);

	// Error count from thread_turns
	const [errors] = await db
		.select({
			errorCount: sql<number>`COUNT(*)::int`,
		})
		.from(threadTurns)
		.where(
			and(
				eq(threadTurns.agent_id, args.agentId),
				eq(threadTurns.tenant_id, args.tenantId),
				eq(threadTurns.status, "failed"),
				gte(threadTurns.created_at, from),
			),
		);

	const agent = await ctx.loaders.agent.load(args.agentId);

	return {
		agentId: args.agentId,
		agentName: agent?.name || "Unknown",
		errorCount: errors?.errorCount || 0,
		...metrics,
	};
};
