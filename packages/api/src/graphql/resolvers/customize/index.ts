import { customizeBindings } from "./customizeBindings.query.js";
import { disableSkill } from "./disableSkill.mutation.js";
import { disableWorkflow } from "./disableWorkflow.mutation.js";
import { enableSkill } from "./enableSkill.mutation.js";
import { enableWorkflow } from "./enableWorkflow.mutation.js";
import { skillCatalog } from "./skillCatalog.query.js";
import { workflowCatalog } from "./workflowCatalog.query.js";

export const customizeQueries = {
  customizeBindings,
  skillCatalog,
  workflowCatalog,
};

export const customizeMutations = {
  enableSkill,
  disableSkill,
  enableWorkflow,
  disableWorkflow,
};
