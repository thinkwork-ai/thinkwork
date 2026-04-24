import type { GraphQLContext } from "../../context.js";
import {
	db, eq, inArray,
	inboxItems, inboxItemComments, inboxItemLinks,
	threads,
	snakeToCamel, inboxItemToCamel,
} from "../../utils.js";

export const inboxItem = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [row] = await db.select().from(inboxItems).where(eq(inboxItems.id, args.id));
	if (!row) return null;
	const commentRows = await db.select().from(inboxItemComments)
		.where(eq(inboxItemComments.inbox_item_id, args.id))
		.orderBy(inboxItemComments.created_at);
	const linkRows = await db.select().from(inboxItemLinks)
		.where(eq(inboxItemLinks.inbox_item_id, args.id));
	// Resolve linked threads
	const threadLinkIds = linkRows
		.filter((l) => (l.linked_type === "thread" || l.linked_type === "ticket") && l.linked_id)
		.map((l) => l.linked_id!);
	let linkedThreadRows: Record<string, unknown>[] = [];
	if (threadLinkIds.length > 0) {
		linkedThreadRows = (await db.select({
			id: threads.id,
			number: threads.number,
			identifier: threads.identifier,
			title: threads.title,
			status: threads.status,
		}).from(threads).where(inArray(threads.id, threadLinkIds))) as Record<string, unknown>[];
	}
	return {
		...inboxItemToCamel(row),
		comments: commentRows.map(snakeToCamel),
		links: linkRows.map(snakeToCamel),
		linkedThreads: linkedThreadRows,
	};
};
