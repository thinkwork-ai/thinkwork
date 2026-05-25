import { threadLinkedTasks } from "./threadLinkedTasks.query.js";
import { updateLinkedTask } from "./updateLinkedTask.mutation.js";

export const linkedTaskQueries = {
  threadLinkedTasks,
};

export const linkedTaskMutations = {
  updateLinkedTask,
};

export { linkedTaskTypeResolvers } from "./types.js";
