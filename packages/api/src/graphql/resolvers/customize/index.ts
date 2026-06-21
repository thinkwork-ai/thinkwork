import { customizeBindings } from "./customizeBindings.query.js";
import { disableSkill } from "./disableSkill.mutation.js";
import { disableWorkflow } from "./disableWorkflow.mutation.js";
import { enableWorkflow } from "./enableWorkflow.mutation.js";
import { workflowCatalog } from "./workflowCatalog.query.js";

export const customizeQueries = {
  customizeBindings,
  workflowTemplateCatalog: workflowCatalog,
  workflowCatalog,
};

export const customizeMutations = {
  disableSkill,
  enableWorkflowTemplate: enableWorkflow,
  disableWorkflowTemplate: disableWorkflow,
  enableWorkflow,
  disableWorkflow,
};
