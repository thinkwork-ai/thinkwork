import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	threadLabels,
} from "../../utils.js";

export const deleteThreadLabel = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [row] = await db.delete(threadLabels).where(eq(threadLabels.id, args.id)).returning();
	return !!row;
};
