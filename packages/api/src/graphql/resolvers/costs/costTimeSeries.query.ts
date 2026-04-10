import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and, gte, sql,
	costEvents,
} from "../../utils.js";

export const costTimeSeries = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const days = args.days || 30;
	const since = new Date();
	since.setDate(since.getDate() - days);
	const dayBucket = sql`(date_trunc('day', ${costEvents.created_at}))::date`;
	const rows = await db.select({
		day: sql<string>`${dayBucket}::text`,
		totalUsd: sql<number>`COALESCE(SUM(amount_usd), 0)::float`,
		llmUsd: sql<number>`COALESCE(SUM(CASE WHEN event_type = 'llm' THEN amount_usd ELSE 0 END), 0)::float`,
		computeUsd: sql<number>`COALESCE(SUM(CASE WHEN event_type = 'agentcore_compute' THEN amount_usd ELSE 0 END), 0)::float`,
		toolsUsd: sql<number>`COALESCE(SUM(CASE WHEN event_type NOT IN ('llm', 'agentcore_compute', 'eval') THEN amount_usd ELSE 0 END), 0)::float`,
		eventCount: sql<number>`COUNT(*)::int`,
	}).from(costEvents).where(and(
		eq(costEvents.tenant_id, args.tenantId),
		gte(costEvents.created_at, since),
	)).groupBy(dayBucket).orderBy(dayBucket);
	return rows;
};
