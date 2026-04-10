import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	inboxItems, inboxItemComments,
	inboxItemToCamel, assertInboxItemTransition,
	recordActivity,
} from "../../utils.js";

export const decideInboxItem = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const i = args.input;
	const [current] = await db.select().from(inboxItems).where(eq(inboxItems.id, args.id));
	if (!current) throw new Error("Inbox item not found");
	const targetStatus = i.status.toLowerCase();
	assertInboxItemTransition(current.status, targetStatus);
	const updates: Record<string, unknown> = {
		status: targetStatus,
		decided_at: new Date(),
		updated_at: new Date(),
	};
	const [row] = await db.update(inboxItems).set(updates).where(eq(inboxItems.id, args.id)).returning();
	if (i.comment) {
		await db.insert(inboxItemComments).values({
			inbox_item_id: args.id,
			tenant_id: row.tenant_id,
			content: i.comment,
		});
	}
	await recordActivity(
		row.tenant_id, "user", row.decided_by ?? row.id,
		`inbox_item.${targetStatus}`, "inbox_item", row.id,
	);
	return inboxItemToCamel(row);
};
