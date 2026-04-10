import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	inboxItemLinks,
} from "../../utils.js";

export const removeInboxItemLink = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [row] = await db.delete(inboxItemLinks).where(eq(inboxItemLinks.id, args.id)).returning();
	return !!row;
};
