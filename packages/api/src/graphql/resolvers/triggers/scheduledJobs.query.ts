import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and, desc,
	scheduledJobs,
	snakeToCamel,
} from "../../utils.js";

export const scheduledJobs_ = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const conditions = [eq(scheduledJobs.tenant_id, args.tenantId)];
	if (args.agentId) conditions.push(eq(scheduledJobs.agent_id, args.agentId));
	if (args.routineId) conditions.push(eq(scheduledJobs.routine_id, args.routineId));
	if (args.jobType) conditions.push(eq(scheduledJobs.trigger_type, args.jobType));
	if (args.enabled !== undefined) conditions.push(eq(scheduledJobs.enabled, args.enabled));
	const limit = Math.min(args.limit || 50, 200);
	const rows = await db
		.select()
		.from(scheduledJobs)
		.where(and(...conditions))
		.orderBy(desc(scheduledJobs.created_at))
		.limit(limit);
	return rows.map(snakeToCamel);
};
