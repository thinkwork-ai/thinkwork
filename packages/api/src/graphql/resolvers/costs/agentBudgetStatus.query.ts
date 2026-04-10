import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and, gte, sql,
	costEvents, budgetPolicies,
	snakeToCamel, startOfMonth,
} from "../../utils.js";

export const agentBudgetStatus = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [p] = await db.select().from(budgetPolicies)
		.where(and(eq(budgetPolicies.agent_id, args.agentId), eq(budgetPolicies.scope, "agent"), eq(budgetPolicies.enabled, true)))
		.limit(1);
	if (!p) return null;
	const monthStart = startOfMonth();
	const [spend] = await db.select({
		total: sql<number>`COALESCE(SUM(amount_usd), 0)::float`,
	}).from(costEvents).where(and(eq(costEvents.agent_id, args.agentId), gte(costEvents.created_at, monthStart)));
	const limitUsd = Number(p.limit_usd);
	const spentUsd = spend.total;
	const remainingUsd = Math.max(0, limitUsd - spentUsd);
	const percentUsed = limitUsd > 0 ? (spentUsd / limitUsd) * 100 : 0;
	const status = percentUsed >= 100 ? "exceeded" : percentUsed >= 80 ? "warning" : "normal";
	return { policy: snakeToCamel(p), spentUsd, remainingUsd, percentUsed, status };
};
