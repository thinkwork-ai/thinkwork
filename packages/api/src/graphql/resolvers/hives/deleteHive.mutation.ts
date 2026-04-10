import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	hives,
} from "../../utils.js";

export const deleteHive = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [row] = await db
		.update(hives)
		.set({ status: "archived", updated_at: new Date() })
		.where(eq(hives.id, args.id))
		.returning();
	return !!row;
};
