/**
 * PRD-22: Delegate a thread to another agent.
 *
 * Reassigns the thread, records the delegation as a thread_turns
 * system_event row, and fires a wakeup for the new assignee.
 *
 * Security: guarded by requireTenantAdmin on the thread's own tenant_id
 * (row-derived, not arg-supplied). A non-admin caller, or an admin in a
 * different tenant, fails closed before any mutation side effect.
 *
 * U2 of the thread-detail cleanup plan: replaces the legacy
 * thread_comments writer with a thread_turns writer so thread_comments
 * can be dropped in U5.
 */

import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	threads, threadTurns, agentWakeupRequests, agents,
	threadToCamel,
} from "../../utils.js";
import { notifyThreadUpdate } from "../../notify.js";
import { requireTenantAdmin } from "../core/authz.js";

export const delegateThread = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const { threadId, assigneeId, reason, agentId } = args.input;

	// Load the thread first so tenant isolation derives from the row, not
	// from caller-supplied args. A thread belonging to another tenant
	// surfaces as NOT_FOUND; a non-admin caller in the correct tenant
	// surfaces as FORBIDDEN via requireTenantAdmin.
	const [threadRow] = await db
		.select({
			id: threads.id,
			tenant_id: threads.tenant_id,
			title: threads.title,
			assignee_id: threads.assignee_id,
		})
		.from(threads)
		.where(eq(threads.id, threadId));

	if (!threadRow) throw new Error("Thread not found");

	await requireTenantAdmin(ctx, threadRow.tenant_id);

	// Ensure the delegated-to assignee agent belongs to the same tenant as
	// the thread. Prevents cross-tenant handoff via arg-supplied ID.
	const [assigneeAgent] = await db
		.select({ tenant_id: agents.tenant_id })
		.from(agents)
		.where(eq(agents.id, assigneeId));

	if (!assigneeAgent || assigneeAgent.tenant_id !== threadRow.tenant_id) {
		throw new Error("Thread not found");
	}

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

	// Record the delegation as a thread_turns system_event row. Replaces
	// the legacy thread_comments writer; ExecutionTrace already renders
	// thread_turns.
	await db.insert(threadTurns).values({
		thread_id: threadId,
		tenant_id: row.tenant_id,
		agent_id: agentId,
		kind: "system_event",
		invocation_source: "system",
		status: "succeeded",
		started_at: new Date(),
		finished_at: new Date(),
		result_json: {
			event: "delegate",
			reason: reason ?? null,
			actor_agent_id: agentId,
			previous_assignee_id: threadRow.assignee_id,
			new_assignee_id: assigneeId,
		},
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
