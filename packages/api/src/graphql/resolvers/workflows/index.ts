import { deleteWorkflow } from "./deleteWorkflow.mutation.js";
import { saveWorkflow } from "./saveWorkflow.mutation.js";
import { resolveWorkflowApproval } from "./resolveWorkflowApproval.mutation.js";
import { triggerWorkflowRun } from "./triggerWorkflowRun.mutation.js";
import { workflow } from "./workflow.query.js";
import { workflowRun } from "./workflowRun.query.js";
import { workflowRuns } from "./workflowRuns.query.js";
import { workflows } from "./workflows.query.js";

export const workflowQueries = {
  workflow,
  workflowRun,
  workflowRuns,
  workflows,
};

export const workflowMutations = {
  deleteWorkflow,
  saveWorkflow,
  resolveWorkflowApproval,
  triggerWorkflowRun,
};

export {
  workflowEngineBindingTypeResolvers,
  workflowEvidenceTypeResolvers,
  workflowRunEventTypeResolvers,
  workflowRunTypeResolvers,
  workflowTriggerTypeResolvers,
  workflowTypeResolvers,
  workflowVersionTypeResolvers,
} from "./types.js";
