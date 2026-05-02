import { agentQueries } from "./agents/index.js";
import { coreQueries } from "./core/index.js";
import { teamQueries } from "./teams/index.js";
import { threadQueries } from "./threads/index.js";
import { inboxQueries } from "./inbox/index.js";
import { triggerQueries } from "./triggers/index.js";
import { costQueries } from "./costs/index.js";
import { knowledgeQueries } from "./knowledge/index.js";
import { artifactQueries } from "./artifacts/index.js";
import { orchestrationQueries } from "./orchestration/index.js";
import { messageQueries } from "./messages/index.js";
import { webhookQueries } from "./webhooks/index.js";
import { memoryQueries, memoryMutations } from "./memory/index.js";
import { recipeQueries, recipeMutations } from "./recipes/index.js";
import { templateQueries, templateMutations } from "./templates/index.js";
import { agentMutations } from "./agents/index.js";
import { coreMutations } from "./core/index.js";
import { messageMutations } from "./messages/index.js";
import { teamMutations } from "./teams/index.js";
import { triggerMutations } from "./triggers/index.js";
import { threadMutations } from "./threads/index.js";
import { inboxMutations } from "./inbox/index.js";
import { costMutations } from "./costs/index.js";
import { knowledgeMutations } from "./knowledge/index.js";
import { artifactMutations } from "./artifacts/index.js";
import { orchestrationMutations } from "./orchestration/index.js";
import { webhookMutations } from "./webhooks/index.js";
import {
  evaluationsQueries,
  evaluationsMutations,
} from "./evaluations/index.js";
import { wikiQueries, wikiMutations } from "./wiki/index.js";
import { skillRunsQueries, skillRunsMutations } from "./skill-runs/index.js";
import { runtimeQueries } from "./runtime/index.js";
import { workspaceQueries, workspaceMutations } from "./workspace/index.js";
import { activationQueries, activationMutations } from "./activation/index.js";
import { brainQueries, brainMutations } from "./brain/index.js";
import { routineMutations, routineQueries } from "./routines/index.js";
import {
  systemWorkflowMutations,
  systemWorkflowQueries,
} from "./system-workflows/index.js";

export const queryResolvers: Record<string, any> = {
  _empty: () => null,
  ...agentQueries,
  ...coreQueries,
  ...teamQueries,
  ...threadQueries,
  ...inboxQueries,
  ...triggerQueries,
  ...costQueries,
  ...knowledgeQueries,
  ...artifactQueries,
  ...orchestrationQueries,
  ...messageQueries,
  ...webhookQueries,
  ...memoryQueries,
  ...recipeQueries,
  ...templateQueries,
  ...evaluationsQueries,
  ...wikiQueries,
  ...skillRunsQueries,
  ...runtimeQueries,
  ...workspaceQueries,
  ...activationQueries,
  ...brainQueries,
  ...routineQueries,
  ...systemWorkflowQueries,
};

export const mutationResolvers: Record<string, any> = {
  _empty: () => null,
  ...agentMutations,
  ...coreMutations,
  ...messageMutations,
  ...teamMutations,
  ...triggerMutations,
  ...threadMutations,
  ...inboxMutations,
  ...costMutations,
  ...knowledgeMutations,
  ...artifactMutations,
  ...orchestrationMutations,
  ...webhookMutations,
  ...memoryMutations,
  ...recipeMutations,
  ...templateMutations,
  ...evaluationsMutations,
  ...wikiMutations,
  ...skillRunsMutations,
  ...workspaceMutations,
  ...activationMutations,
  ...brainMutations,
  ...routineMutations,
  ...systemWorkflowMutations,
};

import { agentTypeResolvers } from "./agents/types.js";
import { threadTypeResolvers } from "./threads/types.js";
import { memoryRecordTypeResolvers } from "./memory/types.js";
import { wikiPageTypeResolvers } from "./wiki/index.js";
import { routineExecutionTypeResolvers } from "./routines/types.js";
import {
  systemWorkflowRunTypeResolvers,
  systemWorkflowTypeResolvers,
} from "./system-workflows/queries.js";

export const typeResolvers: Record<string, Record<string, any>> = {
  Agent: agentTypeResolvers,
  Thread: threadTypeResolvers,
  MemoryRecord: memoryRecordTypeResolvers,
  WikiPage: wikiPageTypeResolvers,
  RoutineExecution: routineExecutionTypeResolvers,
  SystemWorkflow: systemWorkflowTypeResolvers,
  SystemWorkflowRun: systemWorkflowRunTypeResolvers,
};
