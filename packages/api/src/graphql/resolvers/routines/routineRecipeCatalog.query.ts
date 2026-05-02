import type { GraphQLContext } from "../../context.js";
import { requireAdminOrApiKeyCaller } from "../core/authz.js";
import {
  getRecipeConfigFields,
  getRecipeDefaultArgs,
  listRecipes,
} from "../../../lib/routines/recipe-catalog.js";

export async function routineRecipeCatalog(
  _parent: unknown,
  args: { tenantId: string },
  ctx: GraphQLContext,
): Promise<unknown[]> {
  await requireAdminOrApiKeyCaller(ctx, args.tenantId, "create_routine");

  return listRecipes().map((recipe) => {
    const defaultArgs = getRecipeDefaultArgs(recipe.id);
    return {
      id: recipe.id,
      displayName: recipe.displayName,
      description: recipe.description,
      category: recipe.category,
      hitlCapable: recipe.hitlCapable,
      defaultArgs,
      configFields: getRecipeConfigFields(recipe.id, defaultArgs),
    };
  });
}
