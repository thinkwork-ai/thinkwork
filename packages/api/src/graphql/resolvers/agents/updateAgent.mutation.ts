import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and,
	agents, scheduledJobs,
	agentToCamel,
	invokeJobScheduleManager,
} from "../../utils.js";
import { writeUserMdForAssignment } from "../../../lib/user-md-writer.js";

export async function updateAgent(_parent: any, args: any, ctx: GraphQLContext) {
	const i = args.input;
	const updates: Record<string, unknown> = { updated_at: new Date() };
	if (i.name !== undefined) updates.name = i.name;
	if (i.role !== undefined) updates.role = i.role;
	if (i.type !== undefined) updates.type = i.type.toLowerCase();
	if (i.templateId !== undefined) updates.template_id = i.templateId;
	if (i.systemPrompt !== undefined) updates.system_prompt = i.systemPrompt;
	if (i.adapterType !== undefined) updates.adapter_type = i.adapterType;
	if (i.adapterConfig !== undefined) updates.adapter_config = JSON.parse(i.adapterConfig);
	if (i.runtimeConfig !== undefined) updates.runtime_config = JSON.parse(i.runtimeConfig);
	if (i.budgetMonthlyCents !== undefined) updates.budget_monthly_cents = i.budgetMonthlyCents;
	if (i.avatarUrl !== undefined) updates.avatar_url = i.avatarUrl;
	if (i.reportsTo !== undefined) updates.reports_to = i.reportsTo;
	if (i.humanPairId !== undefined) updates.human_pair_id = i.humanPairId;
	if (i.parentAgentId !== undefined) updates.parent_agent_id = i.parentAgentId;

	const humanPairIdChanging = i.humanPairId !== undefined;

	// Unit 6: when humanPairId is set / changed / cleared, rewrite USER.md
	// in the same transaction as the DB update so the S3 side-effect is
	// atomic with the row change. An S3 failure rolls the update back and
	// human_pair_id stays at its prior value — we never leave DB pointing
	// at human B while USER.md still renders human A.
	//
	// Other update paths (runtime_config scheduled-job sync, etc.) stay
	// out of the transaction — their side effects are recoverable via
	// retry and shouldn't block a routine rename from committing.
	let row: typeof agents.$inferSelect | null = null;
	if (humanPairIdChanging) {
		row = await db.transaction(async (tx) => {
			const [pre] = await tx
				.select({ human_pair_id: agents.human_pair_id })
				.from(agents)
				.where(eq(agents.id, args.id));
			if (!pre) throw new Error("Agent not found");
			const oldPairId = pre.human_pair_id ?? null;
			const newPairId = (i.humanPairId as string | null) ?? null;

			const [updated] = await tx
				.update(agents)
				.set(updates)
				.where(eq(agents.id, args.id))
				.returning();
			if (!updated) throw new Error("Agent not found");

			// Only rewrite USER.md when the pair actually changed. Stable
			// no-op reassignments (setting the same id) shouldn't burn an
			// S3 PUT or invalidate cache.
			if (oldPairId !== newPairId) {
				try {
					await writeUserMdForAssignment(tx, args.id, newPairId);
					console.log(
						`[updateAgent] user_md_write agentId=${args.id} success=true`,
					);
				} catch (err) {
					const errorCategory =
						(err as { code?: string } | null)?.code ||
						(err as { name?: string } | null)?.name ||
						"unknown";
					console.warn(
						`[updateAgent] user_md_write agentId=${args.id} success=false errorCategory=${errorCategory}`,
					);
					throw err; // roll back the transaction
				}
			}

			return updated;
		});
	} else {
		const [updated] = await db
			.update(agents)
			.set(updates)
			.where(eq(agents.id, args.id))
			.returning();
		if (!updated) throw new Error("Agent not found");
		row = updated;
	}
	if (!row) throw new Error("Agent not found");

	// Sync scheduled job if runtime_config changed
	if (i.runtimeConfig !== undefined) {
		const newConfig = JSON.parse(i.runtimeConfig);
		const heartbeat = newConfig?.heartbeat;
		if (heartbeat?.enabled) {
			// Find existing heartbeat job for this agent, or create new
			const [existingJob] = await db
				.select({ id: scheduledJobs.id })
				.from(scheduledJobs)
				.where(and(
					eq(scheduledJobs.agent_id, args.id),
					eq(scheduledJobs.trigger_type, "agent_heartbeat"),
				))
				.limit(1);

			if (existingJob) {
				invokeJobScheduleManager("PUT", {
					jobId: existingJob.id,
					scheduleExpression: String(heartbeat.intervalSec || 300),
					scheduleType: "rate",
					prompt: heartbeat.prompt || undefined,
					config: heartbeat,
					enabled: true,
				});
			} else {
				invokeJobScheduleManager("POST", {
					tenantId: row.tenant_id,
					jobType: "agent_heartbeat",
					agentId: args.id,
					name: `Heartbeat: ${row.name}`,
					scheduleType: "rate",
					scheduleExpression: String(heartbeat.intervalSec || 300),
					config: heartbeat,
					createdByType: "system",
				});
			}
		} else if (heartbeat && heartbeat.enabled === false) {
			// Disable existing heartbeat job
			const [existingJob] = await db
				.select({ id: scheduledJobs.id })
				.from(scheduledJobs)
				.where(and(
					eq(scheduledJobs.agent_id, args.id),
					eq(scheduledJobs.trigger_type, "agent_heartbeat"),
				))
				.limit(1);
			if (existingJob) {
				invokeJobScheduleManager("DELETE", { triggerId: existingJob.id });
			}
		}
	}

	return agentToCamel(row);
}
