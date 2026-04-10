import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and, desc, lt,
	messages,
	messageToCamel,
} from "../../utils.js";

export const messages_ = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const conditions = [eq(messages.thread_id, args.threadId)];
	const limit = Math.min(args.limit || 50, 200);
	if (args.cursor) {
		conditions.push(lt(messages.created_at, new Date(args.cursor)));
	}
	const rows = await db
		.select()
		.from(messages)
		.where(and(...conditions))
		.orderBy(desc(messages.created_at))
		.limit(limit + 1);

	const hasMore = rows.length > limit;
	const items = hasMore ? rows.slice(0, limit) : rows;
	const endCursor = hasMore && items.length > 0
		? items[items.length - 1].created_at.toISOString()
		: null;

	return {
		edges: items.map((m) => ({
			node: messageToCamel(m),
			cursor: m.created_at.toISOString(),
		})),
		pageInfo: { hasNextPage: hasMore, endCursor },
	};
};
