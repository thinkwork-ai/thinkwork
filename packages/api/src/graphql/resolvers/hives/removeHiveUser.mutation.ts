import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and,
	hiveUsers,
} from "../../utils.js";

export const removeHiveUser = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [row] = await db
		.delete(hiveUsers)
		.where(
			and(
				eq(hiveUsers.hive_id, args.hiveId),
				eq(hiveUsers.user_id, args.userId),
			),
		)
		.returning();
	return !!row;
};
