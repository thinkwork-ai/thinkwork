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

export {
  workflowEngineBindingTypeResolvers,
  workflowEvidenceTypeResolvers,
  workflowRunEventTypeResolvers,
  workflowRunTypeResolvers,
  workflowTriggerTypeResolvers,
  workflowTypeResolvers,
  workflowVersionTypeResolvers,
} from "./types.js";
