import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and,
	budgetPolicies,
	snakeToCamel,
} from "../../utils.js";

export const upsertBudgetPolicy = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const i = args.input;
	const scope = i.scope;
	const agentId = scope === "agent" ? i.agentId : null;
	if (scope === "agent" && !agentId) throw new Error("agentId required for agent-scope policy");

	// Check for existing policy to update
	const existingConditions = [
		eq(budgetPolicies.tenant_id, args.tenantId),
		eq(budgetPolicies.scope, scope),
	];
	if (agentId) {
		existingConditions.push(eq(budgetPolicies.agent_id, agentId));
	}
	const [existing] = await db.select().from(budgetPolicies)
		.where(and(...existingConditions)).limit(1);

	if (existing) {
		const [row] = await db.update(budgetPolicies).set({
			limit_usd: String(i.limitUsd),
			action_on_exceed: i.actionOnExceed || "pause",
			period: i.period || "monthly",
			enabled: true,
			updated_at: new Date(),
		}).where(eq(budgetPolicies.id, existing.id)).returning();
		return snakeToCamel(row);
	}

	const [row] = await db.insert(budgetPolicies).values({
		tenant_id: args.tenantId,
		agent_id: agentId,
		scope,
		period: i.period || "monthly",
		limit_usd: String(i.limitUsd),
		action_on_exceed: i.actionOnExceed || "pause",
	}).returning();
	return snakeToCamel(row);
};
