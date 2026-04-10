import type { GraphQLContext } from "../../context.js";
import {
	db,
	scheduledJobs,
	snakeToCamel, invokeJobScheduleManager,
} from "../../utils.js";

export const createScheduledJob = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const i = args.input;
	const [row] = await db
		.insert(scheduledJobs)
		.values({
			tenant_id: i.tenantId,
			trigger_type: i.jobType,
			agent_id: i.agentId || null,
			routine_id: i.routineId || null,
			hive_id: i.hiveId || null,
			name: i.name,
			description: i.description || null,
			prompt: i.prompt || null,
			config: i.config ? JSON.parse(i.config) : null,
			schedule_type: i.scheduleType,
			schedule_expression: i.scheduleExpression,
			timezone: i.timezone || "UTC",
			enabled: true,
			created_by_type: i.createdByType || "user",
			created_by_id: i.createdById || null,
		})
		.returning();
	// Fire-and-forget: create EventBridge schedule
	invokeJobScheduleManager("POST", {
		triggerId: row.id,
		tenantId: i.tenantId,
		triggerType: i.triggerType || i.jobType,
		agentId: i.agentId || undefined,
		routineId: i.routineId || undefined,
		name: i.name,
		scheduleType: i.scheduleType,
		scheduleExpression: i.scheduleExpression,
		timezone: i.timezone || "UTC",
		prompt: i.prompt || undefined,
		config: i.config ? JSON.parse(i.config) : undefined,
		createdByType: i.createdByType || "user",
	});
	return snakeToCamel(row);
};
