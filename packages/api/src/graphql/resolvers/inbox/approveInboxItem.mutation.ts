import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	agents, inboxItems, agentWakeupRequests,
	inboxItemToCamel, assertInboxItemTransition,
	recordActivity,
} from "../../utils.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import { requireTenantMember } from "../core/authz.js";
import {
	bridgeInboxDecisionToWorkspaceReview,
	isWorkspaceReviewInboxItem,
} from "./workspace-review-bridge.js";
import {
	bridgeInboxDecisionToRoutineApproval,
	isRoutineApprovalInboxItem,
} from "./routine-approval-bridge.js";

export const approveInboxItem = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [current] = await db.select().from(inboxItems).where(eq(inboxItems.id, args.id));
	if (!current) throw new Error("Inbox item not found");
	await requireTenantMember(ctx, current.tenant_id);
	assertInboxItemTransition(current.status, "approved");
	const reviewNotes = args.input?.reviewNotes ?? null;
	const callerUserId = await resolveCallerUserId(ctx);
	const [row] = await db.update(inboxItems).set({
		status: "approved",
		review_notes: reviewNotes,
		decided_by: callerUserId ?? null,
		decided_at: new Date(),
		updated_at: new Date(),
	}).where(eq(inboxItems.id, args.id)).returning();
	await recordActivity(
		row.tenant_id, "user", row.decided_by ?? row.id,
		"inbox_item.approved", "inbox_item", row.id,
		{ reviewNotes },
	);

	const isWorkspaceReview = isWorkspaceReviewInboxItem(current);
	if (isWorkspaceReview) {
		await bridgeInboxDecisionToWorkspaceReview({
			inboxItem: current,
			decision: "accepted",
			actorId: callerUserId ?? null,
			values: { notes: reviewNotes },
		});
	}
	if (isRoutineApprovalInboxItem(current)) {
		// Parse optional structured decision payload (AWSJSON wire shape).
		let parsedValues: Record<string, unknown> | undefined;
		const rawValues = args.input?.decisionValues;
		if (typeof rawValues === "string" && rawValues.length > 0) {
			try {
				parsedValues = JSON.parse(rawValues);
			} catch (err) {
				throw new Error(
					`decisionValues is not valid JSON: ${(err as Error).message}`,
				);
			}
		}
		await bridgeInboxDecisionToRoutineApproval({
			inboxItem: current,
			decision: "approved",
			actorId: callerUserId ?? null,
			decisionPayload: { reviewNotes, values: parsedValues },
		});
	}

	// Trigger: wake requesting agent on inbox item decision
	// Skip for workspace_review type — decideWorkspaceReview handles wakeup.
	if (!isWorkspaceReview && current.requester_type === "agent" && current.requester_id) {
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
					payload: { inboxItemId: row.id, status: "approved" },
					requested_by_actor_type: "system",
				});
			}
		} catch (triggerErr) {
			console.error("[approveInboxItem] Failed to insert wakeup:", triggerErr);
		}
	}
	return inboxItemToCamel(row);
};
