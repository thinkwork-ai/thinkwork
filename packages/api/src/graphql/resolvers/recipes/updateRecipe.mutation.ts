import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	recipes,
	recipeToCamel,
} from "../../utils.js";

export const updateRecipe = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const i = args.input;
	const updates: Record<string, unknown> = { updated_at: new Date() };
	if (i.title !== undefined) updates.title = i.title;
	if (i.summary !== undefined) updates.summary = i.summary;
	if (i.params !== undefined)
		updates.params = typeof i.params === "string" ? JSON.parse(i.params) : i.params;
	if (i.templates !== undefined)
		updates.templates = i.templates
			? typeof i.templates === "string" ? JSON.parse(i.templates) : i.templates
			: null;
	const [row] = await db
		.update(recipes)
		.set(updates)
		.where(eq(recipes.id, args.id))
		.returning();
	if (!row) throw new Error("Recipe not found");
	return recipeToCamel(row);
};
