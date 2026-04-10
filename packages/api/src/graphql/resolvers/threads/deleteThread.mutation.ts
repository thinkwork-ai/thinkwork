import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	threads,
} from "../../utils.js";

export const deleteThread = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [row] = await db.delete(threads).where(eq(threads.id, args.id)).returning();
	return !!row;
};
