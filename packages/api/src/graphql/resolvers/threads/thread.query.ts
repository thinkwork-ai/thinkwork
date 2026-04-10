import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	threads, threadComments, threadAttachments,
	snakeToCamel, threadToCamel,
} from "../../utils.js";

export const thread = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [row] = await db.select().from(threads).where(eq(threads.id, args.id));
	if (!row) return null;
	// Fetch comments
	const commentRows = await db
		.select()
		.from(threadComments)
		.where(eq(threadComments.thread_id, args.id))
		.orderBy(threadComments.created_at);
	// Fetch children
	const childRows = await db
		.select()
		.from(threads)
		.where(eq(threads.parent_id, args.id));
	// Fetch attachments
	const attachmentRows = await db
		.select()
		.from(threadAttachments)
		.where(eq(threadAttachments.thread_id, args.id));
	return {
		...threadToCamel(row),
		comments: commentRows.map(snakeToCamel),
		children: childRows.map(threadToCamel),
		attachments: attachmentRows.map(snakeToCamel),
		commentCount: commentRows.length,
		childCount: childRows.length,
	};
};
