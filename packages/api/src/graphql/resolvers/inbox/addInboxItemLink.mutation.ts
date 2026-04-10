import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	inboxItems, inboxItemLinks,
	snakeToCamel,
} from "../../utils.js";

export const addInboxItemLink = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const i = args.input;
	const [item] = await db
		.select({ tenant_id: inboxItems.tenant_id })
		.from(inboxItems)
		.where(eq(inboxItems.id, i.inboxItemId));
	if (!item) throw new Error("Inbox item not found");
	const [row] = await db
		.insert(inboxItemLinks)
		.values({
			inbox_item_id: i.inboxItemId,
			tenant_id: item.tenant_id,
			linked_type: i.linkedType,
			linked_id: i.linkedId,
		})
		.returning();
	return snakeToCamel(row);
};
