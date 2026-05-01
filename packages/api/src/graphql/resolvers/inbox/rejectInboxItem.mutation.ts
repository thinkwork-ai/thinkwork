import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	agents, inboxItems, agentWakeupRequests,
	inboxItemToCamel, assertInboxItemTransition,
	recordActivity,
} from "../../utils.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import {
	bridgeInboxDecisionToWorkspaceReview,
	isWorkspaceReviewInboxItem,
} from "./workspace-review-bridge.js";
import {
	bridgeInboxDecisionToRoutineApproval,
	isRoutineApprovalInboxItem,
} from "./routine-approval-bridge.js";

export const rejectInboxItem = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [current] = await db.select().from(inboxItems).where(eq(inboxItems.id, args.id));
	if (!current) throw new Error("Inbox item not found");
	assertInboxItemTransition(current.status, "rejected");
	const reviewNotes = args.input?.reviewNotes ?? null;
	const callerUserId = await resolveCallerUserId(ctx);
	const [row] = await db.update(inboxItems).set({
		status: "rejected",
		review_notes: reviewNotes,
		decided_by: callerUserId ?? null,
		decided_at: new Date(),
		updated_at: new Date(),
	}).where(eq(inboxItems.id, args.id)).returning();
	await recordActivity(
		row.tenant_id, "user", row.decided_by ?? row.id,
		"inbox_item.rejected", "inbox_item", row.id,
		{ reviewNotes },
	);

	const isWorkspaceReview = isWorkspaceReviewInboxItem(current);
	if (isWorkspaceReview) {
		await bridgeInboxDecisionToWorkspaceReview({
			inboxItem: current,
			decision: "cancelled",
			actorId: callerUserId ?? null,
			values: { notes: reviewNotes },
		});
	}
	if (isRoutineApprovalInboxItem(current)) {
		await bridgeInboxDecisionToRoutineApproval({
			inboxItem: current,
			decision: "rejected",
			actorId: callerUserId ?? null,
			decisionPayload: { reviewNotes },
		});
	}

	// Trigger: wake requesting agent on inbox item rejection
	// Skip for workspace_review type — decideWorkspaceReview handles run state.
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
					reason: `Inbox item "${row.title}" rejected`,
					trigger_detail: `inbox_item:${row.id}`,
					payload: { inboxItemId: row.id, status: "rejected" },
					requested_by_actor_type: "system",
				});
			}
		} catch (triggerErr) {
			console.error("[rejectInboxItem] Failed to insert wakeup:", triggerErr);
		}
	}
	return inboxItemToCamel(row);
};
