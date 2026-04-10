import type { GraphQLContext } from "../../context.js";
import { db, eq, and, budgetPolicies } from "../../utils.js";

export async function deleteAgentBudgetPolicy(_parent: any, args: any, ctx: GraphQLContext) {
	const [row] = await db.delete(budgetPolicies).where(and(eq(budgetPolicies.agent_id, args.agentId), eq(budgetPolicies.scope, "agent"))).returning();
	return !!row;
}
