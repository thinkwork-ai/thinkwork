import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	scheduledJobs, invokeJobScheduleManager,
} from "../../utils.js";

export const deleteRoutineTrigger = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [row] = await db
		.update(scheduledJobs)
		.set({ enabled: false })
		.where(eq(scheduledJobs.id, args.id))
		.returning();
	// Delete EB schedule so it stops firing
	if (row?.eb_schedule_name) {
		invokeJobScheduleManager("DELETE", { triggerId: row.id, ebScheduleName: row.eb_schedule_name });
	}
	return !!row;
};
