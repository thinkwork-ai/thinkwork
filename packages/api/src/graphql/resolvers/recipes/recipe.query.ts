import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	recipes,
	recipeToCamel,
} from "../../utils.js";

export const recipe = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [row] = await db.select().from(recipes).where(eq(recipes.id, args.id));
	return row ? recipeToCamel(row) : null;
};
