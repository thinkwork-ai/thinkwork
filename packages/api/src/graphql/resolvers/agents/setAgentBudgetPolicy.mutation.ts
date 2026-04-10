import type { GraphQLContext } from "../../context.js";
import { db, eq, and, agents, budgetPolicies, snakeToCamel } from "../../utils.js";

export async function setAgentBudgetPolicy(_parent: any, args: any, ctx: GraphQLContext) {
	const i = args.input;
	const [agent] = await db.select({ tenant_id: agents.tenant_id }).from(agents).where(eq(agents.id, args.agentId));
	if (!agent) throw new Error("Agent not found");

	// Upsert into unified budget_policies table
	const [existing] = await db.select().from(budgetPolicies)
		.where(and(
			eq(budgetPolicies.tenant_id, agent.tenant_id),
			eq(budgetPolicies.agent_id, args.agentId),
			eq(budgetPolicies.scope, "agent"),
		)).limit(1);

	if (existing) {
		const [row] = await db.update(budgetPolicies).set({
			limit_usd: String(i.limitUsd),
			action_on_exceed: i.actionOnExceed ?? "pause",
			period: i.period,
			enabled: true,
			updated_at: new Date(),
		}).where(eq(budgetPolicies.id, existing.id)).returning();
		return snakeToCamel(row);
	}

	const [row] = await db.insert(budgetPolicies).values({
		tenant_id: agent.tenant_id,
		agent_id: args.agentId,
		scope: "agent",
		period: i.period,
		limit_usd: String(i.limitUsd),
		action_on_exceed: i.actionOnExceed ?? "pause",
	}).returning();
	return snakeToCamel(row);
}
