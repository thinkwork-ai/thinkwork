import { recipes_ as recipes } from "./recipes.query.js";
import { recipe } from "./recipe.query.js";
import { createRecipe } from "./createRecipe.mutation.js";
import { updateRecipe } from "./updateRecipe.mutation.js";
import { deleteRecipe } from "./deleteRecipe.mutation.js";

export const recipeQueries = { recipes, recipe };
export const recipeMutations = { createRecipe, updateRecipe, deleteRecipe };
