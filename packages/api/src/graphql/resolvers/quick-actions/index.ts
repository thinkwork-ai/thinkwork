import { userQuickActions_ as userQuickActions } from "./userQuickActions.query.js";
import { createQuickAction } from "./createQuickAction.mutation.js";
import { updateQuickAction } from "./updateQuickAction.mutation.js";
import { deleteQuickAction } from "./deleteQuickAction.mutation.js";
import { reorderQuickActions } from "./reorderQuickActions.mutation.js";

export const quickActionQueries = { userQuickActions };
export const quickActionMutations = { createQuickAction, updateQuickAction, deleteQuickAction, reorderQuickActions };
