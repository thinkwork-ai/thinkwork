import type { GraphQLContext } from "../../context.js";
import {
	db, eq, sql,
	agents, tenants, threads, inboxItems,
	threadToCamel,
} from "../../utils.js";
import { notifyThreadUpdate } from "../../notify.js";

export const createThread = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const i = args.input;

	// PRD-09 §9.4.4: Agent-created thread validation
	if (i.createdByType === "agent" && i.createdById) {
		// Enforce same-tenant: verify the agent belongs to this tenant
		const [creatorAgent] = await db
			.select({ tenant_id: agents.tenant_id })
			.from(agents)
			.where(eq(agents.id, i.createdById));
		if (!creatorAgent || creatorAgent.tenant_id !== i.tenantId) {
			throw new Error("Agent can only create threads in its own tenant");
		}
	}

	// Global counter + channel prefix
	const channel = (i.channel?.toLowerCase() ?? "manual") as string;
	const CHANNEL_PREFIX: Record<string, string> = {
		schedule: "AUTO", email: "EMAIL", chat: "CHAT",
		manual: "TICK", webhook: "HOOK", api: "API",
		task: "TASK",
	};
	const prefix = CHANNEL_PREFIX[channel] || "TICK";

	const [tenant] = await db
		.update(tenants)
		.set({
			issue_counter: sql`${tenants.issue_counter} + 1`,
		})
		.where(eq(tenants.id, i.tenantId))
		.returning({
			next_number: sql<number>`${tenants.issue_counter}`,
		});
	if (!tenant) throw new Error("Tenant not found");
	const nextNumber = tenant.next_number;
	const identifier = `${prefix}-${nextNumber}`;

	const initialStatus = (channel === "chat" || channel === "schedule") ? "in_progress"
		: channel === "task" ? "todo"
		: "backlog";

	// Task-channel rows created by a user (not the webhook ingest path,
	// which writes via ensureExternalTaskThread and sets its own metadata)
	// start in sync_status='pending'. The syncExternalTaskOnCreate call
	// below will flip this to 'synced', 'local', or 'error'. Non-task
	// channels stay NULL since they don't sync externally.
	const isUserCreatedTask = channel === "task" && i.createdByType !== "agent";
	const initialSyncStatus = isUserCreatedTask ? "pending" : null;

	const [row] = await db
		.insert(threads)
		.values({
			tenant_id: i.tenantId,
			agent_id: i.agentId,
			number: nextNumber,
			identifier,
			title: i.title,
			description: i.description,
			status: initialStatus,
			priority: i.priority?.toLowerCase() ?? "medium",
			type: i.type?.toLowerCase() ?? "task",
			channel,
			parent_id: i.parentId,
			assignee_type: i.assigneeType,
			assignee_id: i.assigneeId,
			billing_code: i.billingCode,
			created_by_type: i.createdByType,
			created_by_id: i.createdById,
			labels: i.labels ? JSON.parse(i.labels) : undefined,
			metadata: i.metadata ? JSON.parse(i.metadata) : undefined,
			due_at: i.dueAt ? new Date(i.dueAt) : undefined,
			sync_status: initialSyncStatus,
		})
		.returning();
	notifyThreadUpdate({
		threadId: row.id,
		tenantId: row.tenant_id,
		status: row.status,
		title: row.title,
	}).catch(() => {});

	// PRD-40: Auto-promote parent to task channel when a task child is created under a non-task parent
	if (row.channel === "task" && row.parent_id) {
		const [parent] = await db.select({
			channel: threads.channel, number: threads.number,
			assignee_type: threads.assignee_type, assignee_id: threads.assignee_id,
			created_by_type: threads.created_by_type, created_by_id: threads.created_by_id,
		}).from(threads).where(eq(threads.id, row.parent_id));
		if (parent && parent.channel !== "task") {
			const updates: Record<string, unknown> = {
				channel: "task",
				identifier: `TASK-${parent.number}`,
				status: "todo",
				priority: "high",
				updated_at: new Date(),
			};
			// Set assignee to the thread creator if not already assigned
			if (!parent.assignee_id && parent.created_by_id) {
				updates.assignee_type = parent.created_by_type === "agent" ? "agent" : "user";
				updates.assignee_id = parent.created_by_id;
			}
			db.update(threads).set(updates).where(eq(threads.id, row.parent_id)).catch(() => {});
		}
	}

	// PRD-40: Inbox notification on task assignment
	if (row.channel === "task" && row.assignee_type === "user" && row.assignee_id) {
		db.insert(inboxItems).values({
			tenant_id: row.tenant_id,
			recipient_id: row.assignee_id,
			requester_type: row.created_by_type ?? "system",
			requester_id: row.created_by_id ?? undefined,
			type: "task_assigned",
			title: `Task assigned: ${row.title}`,
			description: `You have been assigned ${row.identifier}`,
			entity_type: "thread",
			entity_id: row.id,
		}).catch(() => {}); // fire-and-forget
	}

	// User-created task threads now flow through a form-intake step
	// before we fire `POST /tasks` on LastMile. The agent presents the
	// `lastmile-tasks` Question Card, the user fills it in, and the
	// agent calls the `createLastmileTask` mutation which in turn
	// invokes `syncExternalTaskOnCreate`. We used to call that sync
	// inline here — that skipped the intake step and produced a
	// near-empty LastMile task (no description / priority / dueDate).
	//
	// To preserve the mobile "draft badge, no red error" UX we stamp
	// `sync_status='local'` with a friendly hint. Agent-created tasks
	// still bypass this path entirely because they carry their own
	// sync semantics.
	if (isUserCreatedTask && row.created_by_id) {
		await db
			.update(threads)
			.set({
				sync_status: "local",
				sync_error:
					"Fill out the task intake form in the thread to sync to LastMile.",
				updated_at: new Date(),
			})
			.where(eq(threads.id, row.id));
		const [reconciled] = await db
			.select()
			.from(threads)
			.where(eq(threads.id, row.id));
		if (reconciled) {
			return { ...threadToCamel(reconciled), commentCount: 0, childCount: 0 };
		}
	}

	return { ...threadToCamel(row), commentCount: 0, childCount: 0 };
};
