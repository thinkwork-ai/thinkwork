import type { GraphQLContext } from "../../context.js";
import {
	db,
	scheduledJobs,
	computers,
	snakeToCamel, invokeJobScheduleManager, eq,
} from "../../utils.js";

export const createScheduledJob = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const i = args.input;

	// Validate that any computer_id in the input belongs to the named tenant
	// before inserting the FK. Mirrors the REST handler — see U3 / U4 of
	// the scheduled-jobs-and-automations plan.
	if (i.computerId) {
		const [computerRow] = await db
			.select({ tenant_id: computers.tenant_id })
			.from(computers)
			.where(eq(computers.id, i.computerId));
		if (!computerRow) {
			throw new Error(`Computer ${i.computerId} not found`);
		}
		if (computerRow.tenant_id !== i.tenantId) {
			throw new Error("Computer does not belong to this tenant");
		}
	}

	const [row] = await db
		.insert(scheduledJobs)
		.values({
			tenant_id: i.tenantId,
			trigger_type: i.jobType,
			agent_id: i.agentId || null,
			computer_id: i.computerId || null,
			routine_id: i.routineId || null,
			team_id: i.teamId || null,
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
	const result = await invokeJobScheduleManager("POST", {
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
	if (!result.ok) {
		throw new Error(
			`Automation saved but EventBridge schedule could not be provisioned: ${result.error}. Open the automation and press Save to retry.`,
		);
	}
	// Re-read to pick up eb_schedule_name populated by the manager Lambda
	const [refreshed] = await db
		.select()
		.from(scheduledJobs)
		.where(eq(scheduledJobs.id, row.id));
	return snakeToCamel(refreshed || row);
};
