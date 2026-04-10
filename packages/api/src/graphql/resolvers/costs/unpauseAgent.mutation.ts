import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	agents,
	agentToCamel,
} from "../../utils.js";

export const unpauseAgent = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [row] = await db.update(agents).set({
		budget_paused: false,
		budget_paused_at: null,
		budget_paused_reason: null,
	}).where(eq(agents.id, args.agentId)).returning();
	if (!row) throw new Error("Agent not found");
	return agentToCamel(row);
};
