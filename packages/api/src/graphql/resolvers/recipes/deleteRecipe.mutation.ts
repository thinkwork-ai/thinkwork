import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	recipes,
} from "../../utils.js";

export const deleteRecipe = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [row] = await db
		.delete(recipes)
		.where(eq(recipes.id, args.id))
		.returning();
	return !!row;
};
