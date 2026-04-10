/**
 * PRD-22: Escalate a thread to the agent's supervisor.
 *
 * Looks up the agent's reports_to supervisor, reassigns the thread,
 * inserts a system comment, and fires a wakeup for the supervisor.
 */

import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	threads, threadComments, agentWakeupRequests, agents,
	threadToCamel,
} from "../../utils.js";
import { notifyThreadUpdate } from "../../notify.js";

export const escalateThread = async (_parent: any, args: any, _ctx: GraphQLContext) => {
	const { threadId, reason, agentId } = args.input;

	// Look up the agent's supervisor
	const [agent] = await db
		.select({ reports_to: agents.reports_to, name: agents.name })
		.from(agents)
		.where(eq(agents.id, agentId));

	if (!agent?.reports_to) {
		throw new Error(`Agent ${agentId} has no supervisor (reports_to is not set)`);
	}

	const supervisorId = agent.reports_to;

	// Update thread: status -> todo, reassign to supervisor
	const [row] = await db
		.update(threads)
		.set({
			status: "todo",
			assignee_type: "agent",
			assignee_id: supervisorId,
			checkout_run_id: null,
			updated_at: new Date(),
		})
		.where(eq(threads.id, threadId))
		.returning();

	if (!row) throw new Error("Thread not found");

	// Insert system comment
	await db.insert(threadComments).values({
		thread_id: threadId,
		tenant_id: row.tenant_id,
		author_type: "system",
		content: `Escalated to supervisor by ${agent.name || agentId}: ${reason}`,
	});

	// Fire wakeup for supervisor
	await db.insert(agentWakeupRequests).values({
		tenant_id: row.tenant_id,
		agent_id: supervisorId,
		source: "thread_assignment",
		reason: `Escalation: ${reason}`,
		trigger_detail: `thread:${threadId}`,
		payload: { threadId, escalatedFrom: agentId },
		requested_by_actor_type: "agent",
		requested_by_actor_id: agentId,
	});

	notifyThreadUpdate({
		threadId: row.id,
		tenantId: row.tenant_id,
		status: row.status,
		title: row.title,
	}).catch(() => {});

	return threadToCamel(row);
};
