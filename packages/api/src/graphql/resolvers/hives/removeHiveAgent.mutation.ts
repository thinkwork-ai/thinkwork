import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and,
	teamAgents,
} from "../../utils.js";

export const removeHiveAgent = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [row] = await db
		.delete(teamAgents)
		.where(
			and(
				eq(teamAgents.team_id, args.teamId),
				eq(teamAgents.agent_id, args.agentId),
			),
		)
		.returning();
	return !!row;
};
