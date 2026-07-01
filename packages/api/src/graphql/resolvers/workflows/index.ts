import { connectN8nWorkflow } from "./connectN8nWorkflow.mutation.js";
import { createN8nWorkflowBridge } from "./createN8nWorkflowBridge.mutation.js";
import { deleteWorkflow } from "./deleteWorkflow.mutation.js";
import { discoverN8nWorkflows } from "./discoverN8nWorkflows.query.js";
import { disconnectN8nWorkflow } from "./disconnectN8nWorkflow.mutation.js";
import { importN8nWorkflowDraft } from "./importN8nWorkflowDraft.mutation.js";
import { triggerWorkflowRun } from "./triggerWorkflowRun.mutation.js";
import { workflow } from "./workflow.query.js";
import { workflowRun } from "./workflowRun.query.js";
import { workflowRuns } from "./workflowRuns.query.js";
import { workflows } from "./workflows.query.js";

export const workflowQueries = {
  discoverN8nWorkflows,
  workflow,
  workflowRun,
  workflowRuns,
  workflows,
};

export const workflowMutations = {
  connectN8nWorkflow,
  createN8nWorkflowBridge,
  deleteWorkflow,
  disconnectN8nWorkflow,
  importN8nWorkflowDraft,
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
