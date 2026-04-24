/**
 * PRD-22: Process template materializer.
 *
 * Converts a parsed ProcessTemplate into physical threads with dependency
 * edges. Called once on first wakeup when a process skill is detected.
 */

import { eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { ensureThreadForWork, type ThreadChannel } from "@thinkwork/database-pg";
import {
	threads,
	threadDependencies,
	agentWakeupRequests,
} from "@thinkwork/database-pg/schema";
import type { ProcessTemplate } from "./process-parser.js";

const db = getDb();

// ── Types ────────────────────────────────────────────────────────────────────

export interface MaterializeInput {
	template: ProcessTemplate;
	parentThreadId: string;
	agentId: string;
	tenantId: string;
}

export interface MaterializeResult {
	stepThreads: Record<string, string>; // step-id → thread UUID
}

// ── Materializer ─────────────────────────────────────────────────────────────

export async function materializeProcess(
	input: MaterializeInput,
): Promise<MaterializeResult> {
	const { template, parentThreadId, agentId, tenantId } = input;

	// 1. Load parent thread for channel + identifier
	const [parent] = await db
		.select({
			channel: threads.channel,
			agent_id: threads.agent_id,
			identifier: threads.identifier,
		})
		.from(threads)
		.where(eq(threads.id, parentThreadId));

	if (!parent) {
		throw new Error(`[process-materializer] Parent thread ${parentThreadId} not found`);
	}

	const channel = (parent.channel || "manual") as ThreadChannel;
	const stepThreads: Record<string, string> = {};

	// 2. Create a thread for each step
	for (const step of template.steps) {
		const resolvedAssignee = resolveAssignee(step.assignee, agentId);

		const { threadId: stepThreadId } = await ensureThreadForWork({
			tenantId,
			agentId: parent.agent_id || undefined,
			channel,
			title: step.title,
		});

		// Update with process-specific fields
		const stepStatus = step.gate === "human" ? "in_review" : "todo";
		await db
			.update(threads)
			.set({
				parent_id: parentThreadId,
				description: step.instructions,
				status: stepStatus,
				assignee_type: resolvedAssignee ? "agent" : undefined,
				assignee_id: resolvedAssignee || undefined,
				created_by_type: "system",
				metadata: {
					processStep: step.id,
					processTemplateSlug: template.title,
				},
				updated_at: new Date(),
			})
			.where(eq(threads.id, stepThreadId));

		stepThreads[step.id] = stepThreadId;
	}

	// 3. Create inter-step dependencies
	for (const step of template.steps) {
		for (const depId of step.dependsOn) {
			const blockerThreadId = stepThreads[depId];
			const blockedThreadId = stepThreads[step.id];
			if (blockerThreadId && blockedThreadId) {
				await db.insert(threadDependencies).values({
					tenant_id: tenantId,
					thread_id: blockedThreadId,
					blocked_by_thread_id: blockerThreadId,
				});
			}
		}
	}

	// 4. Block parent on all leaf steps (steps that no other step depends on)
	const dependedOn = new Set<string>();
	for (const step of template.steps) {
		for (const dep of step.dependsOn) {
			dependedOn.add(dep);
		}
	}
	const leafSteps = template.steps.filter((s) => !dependedOn.has(s.id));
	for (const leaf of leafSteps) {
		await db.insert(threadDependencies).values({
			tenant_id: tenantId,
			thread_id: parentThreadId,
			blocked_by_thread_id: stepThreads[leaf.id],
		});
	}

	// 5. Update parent thread metadata with process state
	const [existingParent] = await db
		.select({ metadata: threads.metadata })
		.from(threads)
		.where(eq(threads.id, parentThreadId));

	const existingMetadata = (existingParent?.metadata as Record<string, unknown>) || {};
	await db
		.update(threads)
		.set({
			status: "blocked",
			metadata: {
				...existingMetadata,
				process: {
					templateSlug: template.title,
					templateVersion: "1.0.0",
					steps: stepThreads,
					status: "active",
					materializedAt: new Date().toISOString(),
				},
			},
			updated_at: new Date(),
		})
		.where(eq(threads.id, parentThreadId));

	// 6. Fire wakeups for steps with no dependencies (ready to start)
	for (const step of template.steps) {
		if (step.dependsOn.length > 0) continue;

		const assignee = resolveAssignee(step.assignee, agentId);
		if (!assignee) continue;

		await db.insert(agentWakeupRequests).values({
			tenant_id: tenantId,
			agent_id: assignee,
			source: "thread_assignment",
			reason: `Process step: ${step.title}`,
			trigger_detail: `thread:${stepThreads[step.id]}`,
			payload: { threadId: stepThreads[step.id], processStep: step.id },
			requested_by_actor_type: "system",
		});
	}

	// 7. Schedule gate poll wakeups for human gates with poll intervals
	for (const step of template.steps) {
		if (step.gate !== "human" || !step.gatePollInterval) continue;

		const assignee = resolveAssignee(step.assignee, agentId);
		if (!assignee) continue;

		// Create a deferred wakeup for gate polling.
		// The wakeup processor will pick these up on schedule.
		await db.insert(agentWakeupRequests).values({
			tenant_id: tenantId,
			agent_id: assignee,
			source: "automation",
			reason: `Gate poll: ${step.title}`,
			trigger_detail: `thread:${stepThreads[step.id]}`,
			payload: {
				threadId: stepThreads[step.id],
				processStep: step.id,
				pollType: "gate_check",
				gatePollInterval: step.gatePollInterval,
			},
			requested_by_actor_type: "system",
			status: "deferred",
		});
	}

	console.log(
		`[process-materializer] Materialized "${template.title}" into ${template.steps.length} sub-threads for parent ${parentThreadId}`,
	);

	return { stepThreads };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function resolveAssignee(
	assigneeTemplate: string,
	currentAgentId: string,
): string | null {
	if (assigneeTemplate === "{{current_agent}}") return currentAgentId;
	if (assigneeTemplate) return assigneeTemplate; // agent slug/ID
	return null;
}
