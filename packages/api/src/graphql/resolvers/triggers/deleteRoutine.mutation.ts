import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	routines,
} from "../../utils.js";

export const deleteRoutine = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [row] = await db
		.update(routines)
		.set({ status: "archived", updated_at: new Date() })
		.where(eq(routines.id, args.id))
		.returning();
	return !!row;
};
