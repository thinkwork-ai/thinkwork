import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	routines, threadTurns,
	snakeToCamel,
} from "../../utils.js";

export const triggerRoutineRun = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [routine] = await db
		.select({ tenant_id: routines.tenant_id })
		.from(routines)
		.where(eq(routines.id, args.routineId));
	if (!routine) throw new Error("Routine not found");
	const [row] = await db
		.insert(threadTurns)
		.values({
			routine_id: args.routineId,
			tenant_id: routine.tenant_id,
			invocation_source: "on_demand",
			status: "queued",
		})
		.returning();
	return snakeToCamel(row);
};
