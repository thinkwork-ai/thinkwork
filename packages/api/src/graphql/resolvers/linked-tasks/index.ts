import { threadLinkedTasks } from "./threadLinkedTasks.query.js";
import { threadProgressMarkdown } from "./threadProgressMarkdown.query.js";
import { updateLinkedTask } from "./updateLinkedTask.mutation.js";

export const linkedTaskQueries = {
  threadLinkedTasks,
  threadProgressMarkdown,
};

export const linkedTaskMutations = {
  updateLinkedTask,
};

export { linkedTaskTypeResolvers } from "./types.js";
