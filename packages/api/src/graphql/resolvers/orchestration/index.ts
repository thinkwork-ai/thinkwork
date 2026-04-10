import { concurrencySnapshot } from "./concurrencySnapshot.query.js";
import { workflowConfig } from "./workflowConfig.query.js";
import { upsertWorkflowConfig } from "./upsertWorkflowConfig.mutation.js";

export const orchestrationQueries = { concurrencySnapshot, workflowConfig };
export const orchestrationMutations = { upsertWorkflowConfig };
