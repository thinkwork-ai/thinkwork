import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	messages,
} from "../../utils.js";

export const deleteMessage = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [row] = await db.delete(messages).where(eq(messages.id, args.id)).returning();
	return !!row;
};
