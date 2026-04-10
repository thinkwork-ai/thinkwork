import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and, gte, lte, sql,
	costEvents,
	startOfMonth,
} from "../../utils.js";

export const costByAgent = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const from = args.from ? new Date(args.from) : startOfMonth();
	const to = args.to ? new Date(args.to) : new Date();
	const rows = await db.select({
		agentId: costEvents.agent_id,
		totalUsd: sql<number>`COALESCE(SUM(amount_usd), 0)::float`,
		eventCount: sql<number>`COUNT(*)::int`,
	}).from(costEvents).where(and(
		eq(costEvents.tenant_id, args.tenantId),
		gte(costEvents.created_at, from),
		lte(costEvents.created_at, to),
	)).groupBy(costEvents.agent_id);
	// Resolve agent names via DataLoader (filter out null agent rows — those are unattributed tool costs)
	const validRows = rows.filter((r) => r.agentId != null);
	const resolvedAgents = await Promise.all(
		validRows.map((r) => ctx.loaders.agent.load(r.agentId!)),
	);
	return validRows.map((r, i) => ({
		agentId: r.agentId,
		agentName: resolvedAgents[i]?.name || "Unknown",
		totalUsd: r.totalUsd,
		eventCount: r.eventCount,
	}));
};
