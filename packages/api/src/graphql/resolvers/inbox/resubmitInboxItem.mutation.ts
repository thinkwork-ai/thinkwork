import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	inboxItems,
	inboxItemToCamel, assertInboxItemTransition,
	recordActivity,
} from "../../utils.js";

export const resubmitInboxItem = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [current] = await db.select().from(inboxItems).where(eq(inboxItems.id, args.id));
	if (!current) throw new Error("Inbox item not found");
	assertInboxItemTransition(current.status, "pending");
	const updates: Record<string, unknown> = {
		status: "pending",
		revision: (current.revision ?? 1) + 1,
		review_notes: null,
		decided_by: null,
		decided_at: null,
		updated_at: new Date(),
	};
	if (args.input?.title) updates.title = args.input.title;
	if (args.input?.description) updates.description = args.input.description;
	if (args.input?.config) updates.config = JSON.parse(args.input.config);
	const [row] = await db.update(inboxItems).set(updates).where(eq(inboxItems.id, args.id)).returning();
	await recordActivity(
		row.tenant_id, current.requester_type ?? "system", current.requester_id ?? row.id,
		"inbox_item.resubmitted", "inbox_item", row.id,
		{ revision: row.revision },
	);
	return inboxItemToCamel(row);
};
