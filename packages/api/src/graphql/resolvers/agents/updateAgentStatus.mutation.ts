import type { GraphQLContext } from "../../context.js";
import { db, eq, agents, agentToCamel } from "../../utils.js";

export async function updateAgentStatus(_parent: any, args: any, ctx: GraphQLContext) {
	const [row] = await db
		.update(agents)
		.set({
			status: args.status.toLowerCase(),
			last_heartbeat_at: new Date(),
			updated_at: new Date(),
		})
		.where(eq(agents.id, args.id))
		.returning();
	if (!row) throw new Error("Agent not found");
	return agentToCamel(row);
}
