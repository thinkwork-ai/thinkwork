import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	threads, threadAttachments,
	snakeToCamel, threadToCamel,
} from "../../utils.js";

export const thread = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [row] = await db.select().from(threads).where(eq(threads.id, args.id));
	if (!row) return null;
	// Fetch children
	const childRows = await db
		.select()
		.from(threads)
		.where(eq(threads.parent_id, args.id));
	// Fetch attachments (preserved: reserved for upcoming photos/files feature)
	const attachmentRows = await db
		.select()
		.from(threadAttachments)
		.where(eq(threadAttachments.thread_id, args.id));
	return {
		...threadToCamel(row),
		children: childRows.map(threadToCamel),
		attachments: attachmentRows.map(snakeToCamel),
		childCount: childRows.length,
	};
};
