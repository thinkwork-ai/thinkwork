import type { GraphQLContext } from "../../context.js";
import {
	db, eq, desc,
	threadTurns,
	snakeToCamel,
} from "../../utils.js";

export const routineRuns = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const limit = Math.min(args.limit || 50, 200);
	const rows = await db
		.select()
		.from(threadTurns)
		.where(eq(threadTurns.routine_id, args.routineId))
		.orderBy(desc(threadTurns.created_at))
		.limit(limit);
	return rows.map(snakeToCamel);
};
