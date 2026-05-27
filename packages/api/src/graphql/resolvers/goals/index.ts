import { threadGoal } from "./threadGoal.query.js";
import { threadGoalFiles } from "./threadGoalFiles.query.js";
import { reviewGoal } from "./reviewGoal.mutation.js";

export const goalQueries = {
  threadGoal,
  threadGoalFiles,
};

export const goalMutations = {
  reviewGoal,
};
