import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	teams,
} from "../../utils.js";

export const deleteHive = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [row] = await db
		.update(teams)
		.set({ status: "archived", updated_at: new Date() })
		.where(eq(teams.id, args.id))
		.returning();
	return !!row;
};
