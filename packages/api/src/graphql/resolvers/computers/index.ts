import { computers } from "./computers.query.js";
import { computer } from "./computer.query.js";
import { assignedComputers } from "./assignedComputers.query.js";
import { computerAssignments } from "./computerAssignments.query.js";
import { computerEvents } from "./computerEvents.query.js";
import { computerTasks } from "./computerTasks.query.js";
import { myComputer } from "./myComputer.query.js";
import { createComputer } from "./createComputer.mutation.js";
import { enqueueComputerTask } from "./enqueueComputerTask.mutation.js";
import { setUserComputerAssignments } from "./setUserComputerAssignments.mutation.js";
import { updateComputer } from "./updateComputer.mutation.js";

export const computerQueries = {
  assignedComputers,
  computers,
  computer,
  computerAssignments,
  computerEvents,
  computerTasks,
  myComputer,
};

export const computerMutations = {
  createComputer,
  enqueueComputerTask,
  setUserComputerAssignments,
  updateComputer,
};

export {
  computerAssignmentTypeResolvers,
  computerTypeResolvers,
} from "./types.js";
