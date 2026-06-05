import {
  tenantAgentMutations,
  tenantAgentQueries,
} from "./tenant-agent/index.js";
import { goalMutations, goalQueries } from "./goals/index.js";
import { coreQueries } from "./core/index.js";
import { threadQueries } from "./threads/index.js";
import { inboxQueries } from "./inbox/index.js";
import { triggerQueries } from "./triggers/index.js";
import { costQueries } from "./costs/index.js";
import { knowledgeQueries } from "./knowledge/index.js";
import { artifactQueries } from "./artifacts/index.js";
import { appletQueries, appletMutations } from "./applets/index.js";
import { orchestrationQueries } from "./orchestration/index.js";
import { messageQueries } from "./messages/index.js";
import { webhookQueries } from "./webhooks/index.js";
import { memoryQueries, memoryMutations } from "./memory/index.js";
import { recipeQueries, recipeMutations } from "./recipes/index.js";
import { coreMutations } from "./core/index.js";
import { messageMutations } from "./messages/index.js";
import {
  messageMentionTypeResolvers,
  messageTypeResolvers,
} from "./messages/types.js";
import { triggerMutations } from "./triggers/index.js";
import { threadMutations } from "./threads/index.js";
import { inboxMutations } from "./inbox/index.js";
import { costMutations } from "./costs/index.js";
import { knowledgeMutations } from "./knowledge/index.js";
import {
  knowledgeGraphMutations,
  knowledgeGraphQueries,
} from "./knowledge-graph/index.js";
import { artifactMutations } from "./artifacts/index.js";
import { orchestrationMutations } from "./orchestration/index.js";
import { webhookMutations } from "./webhooks/index.js";
import {
  evaluationsQueries,
  evaluationsMutations,
} from "./evaluations/index.js";
import { wikiQueries, wikiMutations } from "./wiki/index.js";
import { skillRunsQueries, skillRunsMutations } from "./skill-runs/index.js";
import {
  skillCatalogMutations,
  skillCatalogQueries,
} from "./skill-catalog/index.js";
import { runtimeQueries } from "./runtime/index.js";
import { workspaceQueries, workspaceMutations } from "./workspace/index.js";
import { brainQueries, brainMutations } from "./brain/index.js";
import { routineMutations, routineQueries } from "./routines/index.js";
import {
  tenantCredentialMutations,
  tenantCredentialQueries,
} from "./tenant-credentials/index.js";
import {
  quickActionQueries,
  quickActionMutations,
} from "./quick-actions/index.js";
import { customizeQueries, customizeMutations } from "./customize/index.js";
import { complianceQueries, complianceMutations } from "./compliance/index.js";
import { slackQueries, slackMutations } from "./slack/index.js";
import { ontologyQueries, ontologyMutations } from "./ontology/index.js";
import {
  linkedTaskMutations,
  linkedTaskQueries,
  linkedTaskTypeResolvers,
} from "./linked-tasks/index.js";
import {
  spaceChecklistTemplateTypeResolvers,
  spaceMemberTypeResolvers,
  spaceMcpServerTypeResolvers,
  spaceMutations,
  spaceQueries,
  spaceTypeResolvers,
} from "./spaces/index.js";

export const queryResolvers: Record<string, any> = {
  _empty: () => null,
  ...tenantAgentQueries,
  ...goalQueries,
  ...coreQueries,
  ...threadQueries,
  ...inboxQueries,
  ...triggerQueries,
  ...costQueries,
  ...knowledgeQueries,
  ...knowledgeGraphQueries,
  ...artifactQueries,
  ...appletQueries,
  ...orchestrationQueries,
  ...messageQueries,
  ...webhookQueries,
  ...memoryQueries,
  ...recipeQueries,
  ...evaluationsQueries,
  ...wikiQueries,
  ...skillRunsQueries,
  ...skillCatalogQueries,
  ...runtimeQueries,
  ...workspaceQueries,
  ...brainQueries,
  ...routineQueries,
  ...tenantCredentialQueries,
  ...quickActionQueries,
  ...customizeQueries,
  ...complianceQueries,
  ...slackQueries,
  ...ontologyQueries,
  ...spaceQueries,
  ...linkedTaskQueries,
};

export const mutationResolvers: Record<string, any> = {
  _empty: () => null,
  ...tenantAgentMutations,
  ...goalMutations,
  ...coreMutations,
  ...messageMutations,
  ...triggerMutations,
  ...threadMutations,
  ...inboxMutations,
  ...costMutations,
  ...knowledgeMutations,
  ...knowledgeGraphMutations,
  ...artifactMutations,
  ...appletMutations,
  ...orchestrationMutations,
  ...webhookMutations,
  ...memoryMutations,
  ...recipeMutations,
  ...evaluationsMutations,
  ...wikiMutations,
  ...skillRunsMutations,
  ...skillCatalogMutations,
  ...workspaceMutations,
  ...brainMutations,
  ...routineMutations,
  ...tenantCredentialMutations,
  ...quickActionMutations,
  ...customizeMutations,
  ...complianceMutations,
  ...slackMutations,
  ...ontologyMutations,
  ...spaceMutations,
  ...linkedTaskMutations,
};

import { agentTypeResolvers } from "./tenant-agent/types.js";
import {
  threadParticipantTypeResolvers,
  threadTypeResolvers,
} from "./threads/types.js";
import { memoryRecordTypeResolvers } from "./memory/types.js";
import { wikiPageTypeResolvers } from "./wiki/index.js";
import { routineExecutionTypeResolvers } from "./routines/types.js";
import { tenantTypeResolvers } from "./core/types.js";

export const typeResolvers: Record<string, Record<string, any>> = {
  Tenant: tenantTypeResolvers,
  Agent: agentTypeResolvers,
  Thread: threadTypeResolvers,
  ThreadParticipant: threadParticipantTypeResolvers,
  Message: messageTypeResolvers,
  MessageMention: messageMentionTypeResolvers,
  MemoryRecord: memoryRecordTypeResolvers,
  WikiPage: wikiPageTypeResolvers,
  RoutineExecution: routineExecutionTypeResolvers,
  Space: spaceTypeResolvers,
  SpaceMember: spaceMemberTypeResolvers,
  SpaceChecklistTemplate: spaceChecklistTemplateTypeResolvers,
  SpaceMcpServer: spaceMcpServerTypeResolvers,
  LinkedTask: linkedTaskTypeResolvers,
};
