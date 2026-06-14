import {
  tenantAgentMutations,
  tenantAgentQueries,
} from "./tenant-agent/index.js";
import {
  agentProfileMutations,
  agentProfileQueries,
  agentProfileSpaceAssignmentTypeResolvers,
  agentProfileTypeResolvers,
} from "./agent-profiles/index.js";
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
  evalResultTypeResolvers,
} from "./evaluations/index.js";
import {
  evalDatasetQueries,
  evalDatasetMutations,
} from "./evaluations/datasets.js";
import {
  flagThreadMutations,
  flagThreadQueries,
} from "./evaluations/flag-thread.js";
import {
  evalReplayAllowlistQueries,
  evalReplayAllowlistMutations,
} from "./evaluations/replay-allowlist.js";
import { wikiQueries, wikiMutations } from "./wiki/index.js";
import { brainQueries } from "./brain/index.js";
import { skillRunsQueries, skillRunsMutations } from "./skill-runs/index.js";
import {
  skillCatalogMutations,
  skillCatalogQueries,
} from "./skill-catalog/index.js";
import { runtimeQueries } from "./runtime/index.js";
import { workspaceQueries, workspaceMutations } from "./workspace/index.js";
import { routineMutations, routineQueries } from "./routines/index.js";
import {
  tenantCredentialMutations,
  tenantCredentialQueries,
} from "./tenant-credentials/index.js";
import { deploymentMutations, deploymentQueries } from "./deployments/index.js";
import { pluginMutations, pluginQueries } from "./plugins/index.js";
import {
  quickActionQueries,
  quickActionMutations,
} from "./quick-actions/index.js";
import { customizeQueries, customizeMutations } from "./customize/index.js";
import { complianceQueries, complianceMutations } from "./compliance/index.js";
import { slackQueries, slackMutations } from "./slack/index.js";
import { ontologyQueries, ontologyMutations } from "./ontology/index.js";
import { observabilityQueries } from "./observability/index.js";
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
  ...agentProfileQueries,
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
  ...evalDatasetQueries,
  ...flagThreadQueries,
  ...evalReplayAllowlistQueries,
  ...wikiQueries,
  ...brainQueries,
  ...skillRunsQueries,
  ...skillCatalogQueries,
  ...runtimeQueries,
  ...workspaceQueries,
  ...routineQueries,
  ...tenantCredentialQueries,
  ...deploymentQueries,
  ...pluginQueries,
  ...quickActionQueries,
  ...customizeQueries,
  ...complianceQueries,
  ...slackQueries,
  ...ontologyQueries,
  ...observabilityQueries,
  ...spaceQueries,
  ...linkedTaskQueries,
};

export const mutationResolvers: Record<string, any> = {
  _empty: () => null,
  ...tenantAgentMutations,
  ...agentProfileMutations,
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
  ...evalDatasetMutations,
  ...evalReplayAllowlistMutations,
  ...flagThreadMutations,
  ...wikiMutations,
  ...skillRunsMutations,
  ...skillCatalogMutations,
  ...workspaceMutations,
  ...routineMutations,
  ...tenantCredentialMutations,
  ...deploymentMutations,
  ...pluginMutations,
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
  AgentProfile: agentProfileTypeResolvers,
  AgentProfileSpaceAssignment: agentProfileSpaceAssignmentTypeResolvers,
  Thread: threadTypeResolvers,
  ThreadParticipant: threadParticipantTypeResolvers,
  Message: messageTypeResolvers,
  MessageMention: messageMentionTypeResolvers,
  MemoryRecord: memoryRecordTypeResolvers,
  EvalResult: evalResultTypeResolvers,
  WikiPage: wikiPageTypeResolvers,
  RoutineExecution: routineExecutionTypeResolvers,
  Space: spaceTypeResolvers,
  SpaceMember: spaceMemberTypeResolvers,
  SpaceChecklistTemplate: spaceChecklistTemplateTypeResolvers,
  SpaceMcpServer: spaceMcpServerTypeResolvers,
  LinkedTask: linkedTaskTypeResolvers,
};
