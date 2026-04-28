import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	inboxItems, inboxItemComments,
	inboxItemToCamel, assertInboxItemTransition,
	recordActivity,
} from "../../utils.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import {
	bridgeInboxDecisionToWorkspaceReview,
	isWorkspaceReviewInboxItem,
} from "./workspace-review-bridge.js";

export const requestRevision = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [current] = await db.select().from(inboxItems).where(eq(inboxItems.id, args.id));
	if (!current) throw new Error("Inbox item not found");
	assertInboxItemTransition(current.status, "revision_requested");
	const reviewNotes = args.input.reviewNotes;
	const callerUserId = await resolveCallerUserId(ctx);
	const [row] = await db.update(inboxItems).set({
		status: "revision_requested",
		review_notes: reviewNotes,
		updated_at: new Date(),
	}).where(eq(inboxItems.id, args.id)).returning();
	// Auto-add the revision notes as a comment
	await db.insert(inboxItemComments).values({
		inbox_item_id: args.id,
		tenant_id: row.tenant_id,
		content: `Revision requested: ${reviewNotes}`,
		author_type: "system",
	});
	await recordActivity(
		row.tenant_id, "user", row.decided_by ?? row.id,
		"inbox_item.revision_requested", "inbox_item", row.id,
		{ reviewNotes },
	);

	if (isWorkspaceReviewInboxItem(current)) {
		// Resume the run with the operator's notes carried as the response.
		// The agent wakes up, reads the notes, and addresses the revision.
		await bridgeInboxDecisionToWorkspaceReview({
			inboxItem: current,
			decision: "resumed",
			actorId: callerUserId ?? null,
			values: { notes: reviewNotes, responseMarkdown: reviewNotes },
		});
	}

	return inboxItemToCamel(row);
};
