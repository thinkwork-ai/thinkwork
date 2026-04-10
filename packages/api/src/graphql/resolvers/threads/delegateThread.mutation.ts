/**
 * PRD-22: Delegate a thread to another agent.
 *
 * Reassigns the thread, inserts a system comment, and fires a wakeup
 * for the new assignee.
 */

import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	threads, threadComments, agentWakeupRequests,
	threadToCamel,
} from "../../utils.js";
import { notifyThreadUpdate } from "../../notify.js";

export const delegateThread = async (_parent: any, args: any, _ctx: GraphQLContext) => {
	const { threadId, assigneeId, reason, agentId } = args.input;

	// Update thread: status -> todo, reassign to new agent
	const [row] = await db
		.update(threads)
		.set({
			status: "todo",
			assignee_type: "agent",
			assignee_id: assigneeId,
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
		content: `Delegated from agent ${agentId} to agent ${assigneeId}${reason ? `: ${reason}` : ""}`,
	});

	// Fire wakeup for new assignee
	await db.insert(agentWakeupRequests).values({
		tenant_id: row.tenant_id,
		agent_id: assigneeId,
		source: "thread_assignment",
		reason: `Delegation${reason ? `: ${reason}` : ""}`,
		trigger_detail: `thread:${threadId}`,
		payload: { threadId },
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
