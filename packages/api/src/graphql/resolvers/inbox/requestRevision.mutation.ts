import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	inboxItems, inboxItemComments,
	inboxItemToCamel, assertInboxItemTransition,
	recordActivity,
} from "../../utils.js";

export const requestRevision = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [current] = await db.select().from(inboxItems).where(eq(inboxItems.id, args.id));
	if (!current) throw new Error("Inbox item not found");
	assertInboxItemTransition(current.status, "revision_requested");
	const reviewNotes = args.input.reviewNotes;
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
	return inboxItemToCamel(row);
};
