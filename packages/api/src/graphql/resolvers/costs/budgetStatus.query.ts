import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and, gte, sql,
	costEvents, budgetPolicies,
	snakeToCamel, startOfMonth,
} from "../../utils.js";

export const budgetStatus = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const policies = await db.select().from(budgetPolicies)
		.where(and(eq(budgetPolicies.tenant_id, args.tenantId), eq(budgetPolicies.enabled, true)));
	const monthStart = startOfMonth();
	return Promise.all(policies.map(async (p) => {
		const condition = p.scope === "agent" && p.agent_id
			? and(eq(costEvents.agent_id, p.agent_id), gte(costEvents.created_at, monthStart))
			: and(eq(costEvents.tenant_id, args.tenantId), gte(costEvents.created_at, monthStart));
		const [spend] = await db.select({
			total: sql<number>`COALESCE(SUM(amount_usd), 0)::float`,
		}).from(costEvents).where(condition);
		const limitUsd = Number(p.limit_usd);
		const spentUsd = spend.total;
		const remainingUsd = Math.max(0, limitUsd - spentUsd);
		const percentUsed = limitUsd > 0 ? (spentUsd / limitUsd) * 100 : 0;
		const status = percentUsed >= 100 ? "exceeded" : percentUsed >= 80 ? "warning" : "normal";
		return { policy: snakeToCamel(p), spentUsd, remainingUsd, percentUsed, status };
	}));
};
