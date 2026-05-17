import { computers } from "./computers.query.js";
import { computer } from "./computer.query.js";
import { assignedComputers } from "./assignedComputers.query.js";
import { computerAccessUsers } from "./computerAccessUsers.query.js";
import { computerAssignments } from "./computerAssignments.query.js";
import { computerEvents } from "./computerEvents.query.js";
import { computerTasks } from "./computerTasks.query.js";
import { myComputer } from "./myComputer.query.js";
import { userComputerAssignments } from "./userComputerAssignments.query.js";
import { createComputer } from "./createComputer.mutation.js";
import { enqueueComputerTask } from "./enqueueComputerTask.mutation.js";
import { setComputerAssignments } from "./setComputerAssignments.mutation.js";
import { setUserComputerAssignments } from "./setUserComputerAssignments.mutation.js";
import { updateComputer } from "./updateComputer.mutation.js";

export const computerQueries = {
  assignedComputers,
  computers,
  computer,
  computerAccessUsers,
  computerAssignments,
  computerEvents,
  computerTasks,
  myComputer,
  userComputerAssignments,
};

export const computerMutations = {
  createComputer,
  enqueueComputerTask,
  setComputerAssignments,
  setUserComputerAssignments,
  updateComputer,
};

export {
  computerAssignmentTypeResolvers,
  computerTypeResolvers,
} from "./types.js";
