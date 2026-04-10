import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	inboxItems, inboxItemComments,
	snakeToCamel,
} from "../../utils.js";

export const addInboxItemComment = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const i = args.input;
	const [item] = await db
		.select({ tenant_id: inboxItems.tenant_id })
		.from(inboxItems)
		.where(eq(inboxItems.id, i.inboxItemId));
	if (!item) throw new Error("Inbox item not found");
	const [row] = await db
		.insert(inboxItemComments)
		.values({
			inbox_item_id: i.inboxItemId,
			tenant_id: item.tenant_id,
			content: i.content,
			author_type: i.authorType,
			author_id: i.authorId,
		})
		.returning();
	return snakeToCamel(row);
};
