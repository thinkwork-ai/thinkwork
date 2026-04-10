import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	threadComments,
} from "../../utils.js";

export const deleteThreadComment = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [row] = await db.delete(threadComments).where(eq(threadComments.id, args.id)).returning();
	return !!row;
};
