import { threadGoal } from "./threadGoal.query.js";
import { threadGoalFiles } from "./threadGoalFiles.query.js";
import { reviewGoal } from "./reviewGoal.mutation.js";
import { refreshThreadProgress } from "./refreshThreadProgress.mutation.js";

export const goalQueries = {
  threadGoal,
  threadGoalFiles,
};

export const goalMutations = {
  refreshThreadProgress,
  reviewGoal,
};
