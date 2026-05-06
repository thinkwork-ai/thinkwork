import { computers } from "./computers.query.js";
import { computer } from "./computer.query.js";
import { computerTasks } from "./computerTasks.query.js";
import { myComputer } from "./myComputer.query.js";
import { createComputer } from "./createComputer.mutation.js";
import { enqueueComputerTask } from "./enqueueComputerTask.mutation.js";
import { updateComputer } from "./updateComputer.mutation.js";

export const computerQueries = {
  computers,
  computer,
  computerTasks,
  myComputer,
};

export const computerMutations = {
  createComputer,
  enqueueComputerTask,
  updateComputer,
};

export { computerTypeResolvers } from "./types.js";
