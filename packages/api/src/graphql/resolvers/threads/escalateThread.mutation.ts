/**
 * PRD-22: Escalate a thread to the agent's supervisor.
 *
 * Looks up the agent's reports_to supervisor, reassigns the thread,
 * records the escalation as a thread_turns system_event row, and fires a
 * wakeup for the supervisor.
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

export const escalateThread = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const { threadId, reason, agentId } = args.input;

	// Load the thread first so tenant isolation derives from the row, not
	// from caller-supplied args. A thread belonging to another tenant
	// surfaces as NOT_FOUND; a non-admin caller in the correct tenant
	// surfaces as FORBIDDEN via requireTenantAdmin. Also select the
	// current assignee_id so we can record the pre-escalation assignee in
	// the audit payload below (reading it from the post-UPDATE row would
	// always be the supervisor, which loses that history).
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

	// Look up the escalating agent. Verify existence + tenant BEFORE the
	// reports_to null check so a cross-tenant agentId surfaces as a
	// generic "Thread not found" rather than the more-informative "has no
	// supervisor" message — the latter would leak agent-existence across
	// tenant boundaries.
	const [agent] = await db
		.select({
			reports_to: agents.reports_to,
			name: agents.name,
			tenant_id: agents.tenant_id,
		})
		.from(agents)
		.where(eq(agents.id, agentId));

	if (!agent || agent.tenant_id !== threadRow.tenant_id) {
		throw new Error("Thread not found");
	}

	if (!agent.reports_to) {
		throw new Error(`Agent ${agentId} has no supervisor (reports_to is not set)`);
	}

	const supervisorId = agent.reports_to;

	// Verify the supervisor itself belongs to the thread's tenant.
	// agents.reports_to is a plain FK with no tenant-scoped constraint, so
	// a misconfigured reports_to could point across tenants. Without this
	// check we would reassign the thread to a foreign-tenant agent and
	// enqueue a wakeup targeting their AgentCore runtime.
	const [supervisor] = await db
		.select({ tenant_id: agents.tenant_id })
		.from(agents)
		.where(eq(agents.id, supervisorId));

	if (!supervisor || supervisor.tenant_id !== threadRow.tenant_id) {
		throw new Error("Thread not found");
	}

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

	// Record the escalation as a thread_turns system_event row. Replaces
	// the legacy thread_comments writer; the timeline already renders
	// thread_turns, so ExecutionTrace picks this up without extra UI work.
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
			event: "escalate",
			reason,
			actor_agent_id: agentId,
			actor_agent_name: agent.name,
			// Read from the pre-UPDATE threadRow, not `row` — the post-UPDATE
			// assignee is supervisorId by construction, so reading from `row`
			// would always yield null here.
			previous_assignee_id:
				threadRow.assignee_id === supervisorId ? null : threadRow.assignee_id,
			new_assignee_id: supervisorId,
		},
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
