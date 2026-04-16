import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	agents, inboxItems, agentWakeupRequests,
	inboxItemToCamel, assertInboxItemTransition,
	recordActivity,
} from "../../utils.js";
import {
	createLastmileTaskForInboxApproval,
	resolveThreadCreator,
} from "../../../integrations/external-work-items/createLastmileTaskForInboxApproval.js";
import type { CreateTaskRequest } from "../../../integrations/external-work-items/providers/lastmile/restClient.js";

/** Extract a `CreateTaskRequest` payload from the inbox-item's `config`
 *  JSONB column. The agent writes this via the `propose_task_create`
 *  skill; we validate the minimum viable shape here before calling
 *  LastMile so a malformed payload surfaces as a clear error instead
 *  of a 4xx from the REST API. */
function parseCreateTaskConfig(config: unknown): CreateTaskRequest {
	if (!config || typeof config !== "object") {
		throw new Error(
			"create_task inbox item is missing a config payload (expected { title, terminalId, ... })",
		);
	}
	const c = config as Record<string, unknown>;
	if (typeof c.title !== "string" || !c.title) {
		throw new Error("create_task config.title is required");
	}
	if (typeof c.terminalId !== "string" || !c.terminalId) {
		throw new Error("create_task config.terminalId is required");
	}
	const input: CreateTaskRequest = {
		title: c.title,
		terminalId: c.terminalId,
	};
	if (typeof c.description === "string") input.description = c.description;
	if (typeof c.priority === "string") input.priority = c.priority;
	if (typeof c.assigneeId === "string") input.assigneeId = c.assigneeId;
	if (typeof c.dueDate === "string") input.dueDate = c.dueDate;
	if (typeof c.status === "string") input.status = c.status;
	return input;
}

/** For `type='create_task'` inbox items: fire the LastMile REST create
 *  BEFORE marking the item approved, so a failure keeps the item
 *  pending (user can retry) and an approval always implies a real
 *  LastMile task was minted. On success, the thread's sync_status
 *  flips to 'synced' and the created task id is merged into the
 *  inbox-item config for audit. */
async function runCreateTaskSideEffect(
	item: typeof inboxItems.$inferSelect,
): Promise<{ externalTaskId: string; updatedConfig: Record<string, unknown> }> {
	if (!item.entity_id) {
		throw new Error(
			"create_task inbox item is missing entity_id (the source thread).",
		);
	}
	const creator = await resolveThreadCreator(item.entity_id);
	if (!creator) {
		throw new Error(
			`create_task entity_id=${item.entity_id} has no resolvable thread creator`,
		);
	}
	const input = parseCreateTaskConfig(item.config);

	const result = await createLastmileTaskForInboxApproval({
		inboxItemId: item.id,
		threadId: item.entity_id,
		tenantId: creator.tenantId,
		userId: creator.userId,
		input,
	});
	if (result.status === "error") throw new Error(result.message);

	const existing = (item.config as Record<string, unknown> | null) ?? {};
	return {
		externalTaskId: result.externalTaskId,
		updatedConfig: {
			...existing,
			externalTaskId: result.externalTaskId,
			provider: existing.provider ?? "lastmile",
			syncedAt: new Date().toISOString(),
		},
	};
}

export const approveInboxItem = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [current] = await db.select().from(inboxItems).where(eq(inboxItems.id, args.id));
	if (!current) throw new Error("Inbox item not found");
	assertInboxItemTransition(current.status, "approved");
	const reviewNotes = args.input?.reviewNotes ?? null;

	// Type-specific side effect: run BEFORE the status transition so a
	// failure leaves the item pending (retryable) and a success means the
	// external task definitely exists. If we approved first and the side
	// effect failed, the mobile badge would lie.
	let createTaskResult:
		| { externalTaskId: string; updatedConfig: Record<string, unknown> }
		| null = null;
	if (current.type === "create_task") {
		createTaskResult = await runCreateTaskSideEffect(current);
	}

	const [row] = await db.update(inboxItems).set({
		status: "approved",
		review_notes: reviewNotes,
		decided_at: new Date(),
		updated_at: new Date(),
		...(createTaskResult
			? { config: createTaskResult.updatedConfig }
			: {}),
	}).where(eq(inboxItems.id, args.id)).returning();
	await recordActivity(
		row.tenant_id, "user", row.decided_by ?? row.id,
		"inbox_item.approved", "inbox_item", row.id,
		{
			reviewNotes,
			...(createTaskResult
				? { externalTaskId: createTaskResult.externalTaskId }
				: {}),
		},
	);
	// Trigger: wake requesting agent on inbox item decision
	if (current.requester_type === "agent" && current.requester_id) {
		try {
			const [reqAgent] = await db
				.select({ runtime_config: agents.runtime_config })
				.from(agents)
				.where(eq(agents.id, current.requester_id));
			const heartbeatCfg = (reqAgent?.runtime_config as Record<string, unknown>)?.heartbeat as Record<string, unknown> | undefined;
			if (heartbeatCfg?.wakeOnApproval !== false) {
				await db.insert(agentWakeupRequests).values({
					tenant_id: row.tenant_id,
					agent_id: current.requester_id,
					source: "inbox_item_decided",
					reason: `Inbox item "${row.title}" approved`,
					trigger_detail: `inbox_item:${row.id}`,
					payload: {
						inboxItemId: row.id,
						status: "approved",
						...(createTaskResult
							? { externalTaskId: createTaskResult.externalTaskId }
							: {}),
					},
					requested_by_actor_type: "system",
				});
			}
		} catch (triggerErr) {
			console.error("[approveInboxItem] Failed to insert wakeup:", triggerErr);
		}
	}
	return inboxItemToCamel(row);
};
