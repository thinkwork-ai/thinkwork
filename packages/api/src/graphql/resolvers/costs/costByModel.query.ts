import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and, gte, lte, sql,
	costEvents,
	startOfMonth,
} from "../../utils.js";

export const costByModel = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const from = args.from ? new Date(args.from) : startOfMonth();
	const to = args.to ? new Date(args.to) : new Date();
	const rows = await db.select({
		model: costEvents.model,
		totalUsd: sql<number>`COALESCE(SUM(amount_usd), 0)::float`,
		inputTokens: sql<number>`COALESCE(SUM(input_tokens), 0)::int`,
		outputTokens: sql<number>`COALESCE(SUM(output_tokens), 0)::int`,
	}).from(costEvents).where(and(
		eq(costEvents.tenant_id, args.tenantId),
		eq(costEvents.event_type, "llm"),
		gte(costEvents.created_at, from),
		lte(costEvents.created_at, to),
	)).groupBy(costEvents.model);
	return rows.map((r) => ({ ...r, model: r.model || "unknown" }));
};
