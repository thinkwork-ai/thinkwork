import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	scheduledJobs,
	snakeToCamel,
} from "../../utils.js";

export const scheduledJob = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [row] = await db.select().from(scheduledJobs).where(eq(scheduledJobs.id, args.id));
	return row ? snakeToCamel(row) : null;
};
