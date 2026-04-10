import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	inboxItems,
	inboxItemToCamel, assertInboxItemTransition,
	recordActivity,
} from "../../utils.js";

export const cancelInboxItem = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [current] = await db.select().from(inboxItems).where(eq(inboxItems.id, args.id));
	if (!current) throw new Error("Inbox item not found");
	assertInboxItemTransition(current.status, "cancelled");
	const [row] = await db
		.update(inboxItems)
		.set({ status: "cancelled", updated_at: new Date() })
		.where(eq(inboxItems.id, args.id))
		.returning();
	await recordActivity(
		row.tenant_id, "user", row.id,
		"inbox_item.cancelled", "inbox_item", row.id,
	);
	return inboxItemToCamel(row);
};
