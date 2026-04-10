import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	threadComments,
	snakeToCamel,
} from "../../utils.js";

export const updateThreadComment = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [row] = await db
		.update(threadComments)
		.set({ content: args.content, updated_at: new Date() })
		.where(eq(threadComments.id, args.id))
		.returning();
	if (!row) throw new Error("Comment not found");
	return snakeToCamel(row);
};
