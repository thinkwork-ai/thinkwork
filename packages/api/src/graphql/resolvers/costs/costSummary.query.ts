import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and, gte, lte, sql,
	costEvents,
	startOfMonth,
} from "../../utils.js";

export const costSummary = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const from = args.from ? new Date(args.from) : startOfMonth();
	const to = args.to ? new Date(args.to) : new Date();
	const [total] = await db.select({
		totalUsd: sql<number>`COALESCE(SUM(amount_usd), 0)::float`,
		llmUsd: sql<number>`COALESCE(SUM(CASE WHEN event_type = 'llm' THEN amount_usd ELSE 0 END), 0)::float`,
		computeUsd: sql<number>`COALESCE(SUM(CASE WHEN event_type = 'agentcore_compute' THEN amount_usd ELSE 0 END), 0)::float`,
		toolsUsd: sql<number>`COALESCE(SUM(CASE WHEN event_type NOT IN ('llm', 'agentcore_compute', 'eval') THEN amount_usd ELSE 0 END), 0)::float`,
		evalUsd: sql<number>`COALESCE(SUM(CASE WHEN event_type = 'eval' THEN amount_usd ELSE 0 END), 0)::float`,
		totalInputTokens: sql<number>`COALESCE(SUM(input_tokens), 0)::int`,
		totalOutputTokens: sql<number>`COALESCE(SUM(output_tokens), 0)::int`,
		eventCount: sql<number>`COUNT(*)::int`,
	}).from(costEvents).where(and(
		eq(costEvents.tenant_id, args.tenantId),
		gte(costEvents.created_at, from),
		lte(costEvents.created_at, to),
	));
	return { ...total, periodStart: from.toISOString(), periodEnd: to.toISOString() };
};
