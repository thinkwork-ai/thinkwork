import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	routines, scheduledJobs,
	snakeToCamel,
} from "../../utils.js";

export const setRoutineTrigger = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const i = args.input;
	const [routine] = await db
		.select({ tenant_id: routines.tenant_id, name: routines.name })
		.from(routines)
		.where(eq(routines.id, args.routineId));
	if (!routine) throw new Error("Routine not found");
	const [row] = await db
		.insert(scheduledJobs)
		.values({
			routine_id: args.routineId,
			tenant_id: routine.tenant_id,
			trigger_type: "routine_schedule",
			name: `Schedule: ${routine.name}`,
			schedule_type: "cron",
			schedule_expression: i.config ? JSON.parse(i.config).schedule || "" : "",
			config: i.config ? JSON.parse(i.config) : undefined,
			enabled: i.enabled ?? true,
			created_by_type: "user",
		})
		.returning();
	return snakeToCamel(row);
};
