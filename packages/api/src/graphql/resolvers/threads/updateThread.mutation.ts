import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	threads, agentWakeupRequests, inboxItems,
	threadToCamel, assertTransition,
	checkAndFireUnblockWakeups,
} from "../../utils.js";
import { notifyThreadUpdate } from "../../notify.js";

export const updateThread = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const i = args.input;
	const updates: Record<string, unknown> = { updated_at: new Date() };
	if (i.title !== undefined) updates.title = i.title;
	if (i.description !== undefined) updates.description = i.description;
	if (i.status !== undefined) {
		const newStatus = i.status.toLowerCase();
		// Fetch current status for transition validation
		const [current] = await db
			.select({ status: threads.status })
			.from(threads)
			.where(eq(threads.id, args.id));
		if (!current) throw new Error("Thread not found");
		assertTransition(current.status, newStatus);
		updates.status = newStatus;
		// Lifecycle timestamps
		if (newStatus === "in_progress" && current.status !== "in_progress") {
			updates.started_at = new Date();
		}
		if (newStatus === "done") {
			updates.completed_at = new Date();
			updates.closed_at = new Date();
			updates.checkout_run_id = null; // auto-release lock
			// PRD-40: Cascade done to all child threads
			db.update(threads)
				.set({ status: "done", completed_at: new Date(), closed_at: new Date(), checkout_run_id: null, updated_at: new Date() })
				.where(eq(threads.parent_id, args.id))
				.catch(() => {});
		}
		if (newStatus === "cancelled") {
			updates.cancelled_at = new Date();
			updates.checkout_run_id = null;
		}
		if (newStatus === "blocked") {
			updates.checkout_run_id = null;
		}
	}
	if (i.priority !== undefined) updates.priority = i.priority.toLowerCase();
	if (i.channel !== undefined) updates.channel = i.channel.toLowerCase();
	if (i.type !== undefined) updates.type = i.type.toLowerCase();
	if (i.assigneeType !== undefined) updates.assignee_type = i.assigneeType;
	if (i.assigneeId !== undefined) updates.assignee_id = i.assigneeId;
	if (i.billingCode !== undefined) updates.billing_code = i.billingCode;
	if (i.labels !== undefined) updates.labels = JSON.parse(i.labels);
	if (i.metadata !== undefined) updates.metadata = JSON.parse(i.metadata);
	if (i.dueAt !== undefined) updates.due_at = i.dueAt ? new Date(i.dueAt) : null;
	if (i.archivedAt !== undefined) updates.archived_at = i.archivedAt ? new Date(i.archivedAt) : null;
	if (i.lastReadAt !== undefined) updates.last_read_at = i.lastReadAt ? new Date(i.lastReadAt) : null;

	const [row] = await db.update(threads).set(updates).where(eq(threads.id, args.id)).returning();
	if (!row) throw new Error("Thread not found");

	// On assignment to agent, insert wakeup request
	if (i.assigneeType === "agent" && i.assigneeId) {
		await db.insert(agentWakeupRequests).values({
			tenant_id: row.tenant_id,
			agent_id: i.assigneeId,
			source: "thread_assignment",
			reason: `Thread ${row.identifier ?? `#${row.number}`} assigned`,
			trigger_detail: `thread:${row.id}`,
			requested_by_actor_type: "system",
		});
	}

	// PRD-09: Auto-unblock dependents when thread reaches done/cancelled
	if (i.status !== undefined) {
		const newStatus = i.status.toLowerCase();
		if (newStatus === "done" || newStatus === "cancelled") {
			await checkAndFireUnblockWakeups(args.id, row.tenant_id);
		}
		// PRD-40: Inbox notification on task completion
		if (newStatus === "done" && row.channel === "task" && row.parent_id) {
			const [parent] = await db.select({
				assignee_type: threads.assignee_type,
				assignee_id: threads.assignee_id,
				created_by_id: threads.created_by_id,
			}).from(threads).where(eq(threads.id, row.parent_id));
			const ownerId = (parent?.assignee_type === "user" && parent?.assignee_id)
				? parent.assignee_id : parent?.created_by_id;
			if (ownerId) {
				db.insert(inboxItems).values({
					tenant_id: row.tenant_id,
					recipient_id: ownerId,
					requester_type: "system",
					type: "task_completed",
					title: `Task completed: ${row.title}`,
					description: `${row.identifier} has been marked done`,
					entity_type: "thread",
					entity_id: row.id,
				}).catch(() => {}); // fire-and-forget
			}
		}
	}

	// Fire real-time notification (non-blocking) — skip for read-state-only updates
	const isReadStateOnly = Object.keys(updates).every((k) => k === "updated_at" || k === "last_read_at");
	if (!isReadStateOnly) {
		notifyThreadUpdate({
			threadId: row.id,
			tenantId: row.tenant_id,
			status: row.status,
			title: row.title,
		}).catch(() => {}); // fire-and-forget
	}

	return threadToCamel(row);
};
