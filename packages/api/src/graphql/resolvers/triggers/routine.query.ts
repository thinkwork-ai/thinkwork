import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	routines, scheduledJobs,
	snakeToCamel,
} from "../../utils.js";

export const routine = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [row] = await db.select().from(routines).where(eq(routines.id, args.id));
	if (!row) return null;
	// Fetch triggers from unified triggers table
	const trigs = await db
		.select()
		.from(scheduledJobs)
		.where(eq(scheduledJobs.routine_id, args.id));
	return { ...snakeToCamel(row), triggers: trigs.map(snakeToCamel) };
};
