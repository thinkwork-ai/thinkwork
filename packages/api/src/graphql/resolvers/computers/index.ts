import { computers } from "./computers.query.js";
import { computer } from "./computer.query.js";
import { myComputer } from "./myComputer.query.js";
import { createComputer } from "./createComputer.mutation.js";
import { updateComputer } from "./updateComputer.mutation.js";

export const computerQueries = {
  computers,
  computer,
  myComputer,
};

export const computerMutations = {
  createComputer,
  updateComputer,
};

export { computerTypeResolvers } from "./types.js";
