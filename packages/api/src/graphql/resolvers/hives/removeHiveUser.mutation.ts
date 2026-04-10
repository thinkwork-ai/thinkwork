import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and,
	teamUsers,
} from "../../utils.js";

export const removeHiveUser = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [row] = await db
		.delete(teamUsers)
		.where(
			and(
				eq(teamUsers.team_id, args.teamId),
				eq(teamUsers.user_id, args.userId),
			),
		)
		.returning();
	return !!row;
};
