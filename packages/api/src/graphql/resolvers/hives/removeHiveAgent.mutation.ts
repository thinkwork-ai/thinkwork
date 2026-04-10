import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and,
	hiveAgents,
} from "../../utils.js";

export const removeHiveAgent = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [row] = await db
		.delete(hiveAgents)
		.where(
			and(
				eq(hiveAgents.hive_id, args.hiveId),
				eq(hiveAgents.agent_id, args.agentId),
			),
		)
		.returning();
	return !!row;
};
