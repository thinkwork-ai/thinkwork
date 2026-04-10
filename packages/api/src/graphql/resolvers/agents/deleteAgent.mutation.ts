import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and,
	agents, scheduledJobs,
	invokeJobScheduleManager,
} from "../../utils.js";

export async function deleteAgent(_parent: any, args: any, ctx: GraphQLContext) {
	const [row] = await db
		.update(agents)
		.set({ status: "archived", updated_at: new Date() })
		.where(eq(agents.id, args.id))
		.returning();
	// Clean up triggers for this agent
	if (row) {
		const agentJobs = await db
			.select({ id: scheduledJobs.id })
			.from(scheduledJobs)
			.where(and(
				eq(scheduledJobs.agent_id, args.id),
				eq(scheduledJobs.enabled, true),
			));
		for (const job of agentJobs) {
			invokeJobScheduleManager("DELETE", { triggerId: job.id });
		}
	}
	return !!row;
}
