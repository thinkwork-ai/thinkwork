/**
 * Unified Job Trigger Lambda
 *
 * Invoked by AWS EventBridge Scheduler when any scheduled job fires.
 *
 * For agent jobs: creates a thread + inserts wakeup request (wakeup-processor handles dispatch)
 * For routine jobs: creates thread_turns record + invokes routine runner
 * For one-time jobs: auto-deletes EventBridge schedule after firing
 *
 * Event payload (set by job-schedule-manager when creating the rule):
 *   { triggerId, triggerType, tenantId, agentId?, routineId?, prompt?, scheduleName?, oneTime? }
 */

import { getDb, ensureThreadForWork } from "@thinkwork/database-pg";
import {
	agentWakeupRequests,
	agents,
	scheduledJobs,
	threadTurns,
} from "@thinkwork/database-pg/schema";
import { eq } from "drizzle-orm";

interface JobTriggerEvent {
	triggerId: string;
	triggerType: string; // agent_heartbeat | agent_reminder | agent_scheduled | routine_schedule | routine_one_time
	tenantId: string;
	agentId?: string;
	routineId?: string;
	prompt?: string;
	scheduleName?: string;
	oneTime?: boolean;
}

const SCHEDULE_GROUP = "thinkwork-jobs";

export async function handler(event: JobTriggerEvent): Promise<void> {
	const { triggerId, triggerType, tenantId, agentId, routineId, prompt, scheduleName, oneTime } = event;

	if (!triggerId || !tenantId || !triggerType) {
		console.error("[job-trigger] Missing required fields in event", event);
		return;
	}

	console.log(`[job-trigger] Firing triggerId=${triggerId} type=${triggerType} oneTime=${!!oneTime}`);

	try {
		const db = getDb();

		// Guard: check if the job is still enabled before executing
		const [job] = await db
			.select({ enabled: scheduledJobs.enabled, name: scheduledJobs.name, config: scheduledJobs.config })
			.from(scheduledJobs)
			.where(eq(scheduledJobs.id, triggerId));
		if (job && !job.enabled) {
			console.log(`[job-trigger] Job ${triggerId} is disabled, skipping execution`);
			return;
		}

		const isAgentJob = triggerType.startsWith("agent_");

		if (isAgentJob && agentId) {
			// Agent jobs: create a thread for tracking, then insert wakeup request
			const jobTitle = job?.name || `Scheduled job ${triggerId.slice(0, 8)}`;
			const result = await ensureThreadForWork({
				tenantId,
				agentId,
				title: jobTitle,
				channel: "schedule",
			});
			const threadId = result.threadId;
			console.log(`[job-trigger] Created thread ${result.identifier} for agent ${agentId}`);

			const source = triggerType === "agent_heartbeat"
				? "timer"
				: triggerType === "agent_reminder"
					? "on_demand"
					: "trigger";

			const reason = triggerType === "agent_heartbeat"
				? "heartbeat_timer"
				: prompt
					? "Scheduled wakeup with prompt"
					: `trigger:${triggerType}`;

			await db.insert(agentWakeupRequests).values({
				tenant_id: tenantId,
				agent_id: agentId,
				source,
				reason,
				trigger_detail: scheduleName ? `schedule:${scheduleName}` : `job:${triggerId}`,
				payload: prompt
					? { message: prompt, triggerId, ...(threadId && { threadId }) }
					: { triggerId, ...(threadId && { threadId }) },
				requested_by_actor_type: "system",
			});

			// Update agent last_heartbeat_at
			await db
				.update(agents)
				.set({ last_heartbeat_at: new Date() })
				.where(eq(agents.id, agentId));

			console.log(`[job-trigger] Wakeup request created for agent ${agentId}`);

		} else if (routineId) {
			// Routine jobs: create a thread_turns record + invoke routine runner
			const [run] = await db.insert(threadTurns).values({
				tenant_id: tenantId,
				trigger_id: triggerId,
				routine_id: routineId,
				invocation_source: "schedule",
				trigger_detail: scheduleName ? `schedule:${scheduleName}` : `job:${triggerId}`,
				status: "queued",
			}).returning();

			console.log(`[job-trigger] Created thread_turn ${run.id} for routine ${routineId}`);

			// Invoke routine runner if configured
			const routineRunnerUrl = process.env.ROUTINE_RUNNER_URL;
			const routineAuthSecret = process.env.ROUTINE_AUTH_SECRET;
			if (routineRunnerUrl && routineAuthSecret) {
				try {
					const response = await fetch(`${routineRunnerUrl}/routine/trigger`, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${routineAuthSecret}`,
						},
						body: JSON.stringify({
							routineId,
							runId: run.id,
							tenantId,
							triggerId,
						}),
					});
					if (!response.ok) {
						const errText = await response.text();
						console.error(`[job-trigger] Routine runner error: ${response.status} ${errText}`);
					}
				} catch (runnerErr) {
					console.error(`[job-trigger] Failed to invoke routine runner:`, runnerErr);
				}
			}
		}

		// Update last_run_at on the scheduled job
		await db
			.update(scheduledJobs)
			.set({ last_run_at: new Date() })
			.where(eq(scheduledJobs.id, triggerId));

		// If this was a one-time schedule, delete the EventBridge schedule after firing
		if (oneTime && scheduleName) {
			try {
				const { SchedulerClient, DeleteScheduleCommand } = await import("@aws-sdk/client-scheduler");
				const scheduler = new SchedulerClient({});
				await scheduler.send(new DeleteScheduleCommand({
					Name: scheduleName,
					GroupName: SCHEDULE_GROUP,
				}));
				console.log(`[job-trigger] Deleted one-time schedule: ${scheduleName}`);

				// Mark the job as disabled since it's been consumed
				await db
					.update(scheduledJobs)
					.set({ enabled: false, updated_at: new Date() })
					.where(eq(scheduledJobs.id, triggerId));
			} catch (deleteErr) {
				// Non-fatal — schedule may have ActionAfterCompletion: DELETE
				console.warn(`[job-trigger] Failed to delete one-time schedule:`, deleteErr);
			}
		}
	} catch (err) {
		console.error("[job-trigger] Failed to process job trigger:", err);
	}
}
