import {
  systemWorkflow,
  systemWorkflowEvidence_,
  systemWorkflowRun,
  systemWorkflowRuns,
  systemWorkflowStepEvents_,
  systemWorkflows,
} from "./queries.js";

export const systemWorkflowQueries = {
  systemWorkflows,
  systemWorkflow,
  systemWorkflowRuns,
  systemWorkflowRun,
  systemWorkflowStepEvents: systemWorkflowStepEvents_,
  systemWorkflowEvidence: systemWorkflowEvidence_,
};

export const systemWorkflowMutations = {};
