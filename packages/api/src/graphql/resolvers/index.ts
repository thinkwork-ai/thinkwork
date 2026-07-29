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
import {
  artifactQueries,
  artifactTypeResolvers,
  artifactVersionTypeResolvers,
} from "./artifacts/index.js";
import { appletQueries, appletMutations } from "./applets/index.js";
import { orchestrationQueries } from "./orchestration/index.js";
import { messageQueries } from "./messages/index.js";
import { webhookQueries } from "./webhooks/index.js";
import { memoryQueries, memoryMutations } from "./memory/index.js";
import {
  memorySourceQueries,
  memorySourceMutations,
} from "./memory-sources/index.js";
import {
  entityIdentityQueries,
  entityIdentityMutations,
} from "./entity-identity/index.js";
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
  evalRunTypeResolvers,
  skillEvalScoreTypeResolvers,
} from "./evaluations/index.js";
import {
  evalDatasetQueries,
  evalDatasetMutations,
} from "./evaluations/datasets.js";
import {
  evalProfileQueries,
  evalProfileMutations,
} from "./evaluations/profiles.js";
import {
  flagThreadMutations,
  flagThreadQueries,
} from "./evaluations/flag-thread.js";
import {
  evalReplayAllowlistQueries,
  evalReplayAllowlistMutations,
} from "./evaluations/replay-allowlist.js";
import { searchQueries, searchMutations } from "./search/index.js";
import { skillRunsQueries, skillRunsMutations } from "./skill-runs/index.js";
import {
  skillCatalogMutations,
  skillCatalogQueries,
} from "./skill-catalog/index.js";
import {
  skillCreatorMutations,
  skillCreatorQueries,
} from "./skill-creator/index.js";
import { runtimeQueries } from "./runtime/index.js";
import {
  capabilityQueries,
  capabilityMutations,
} from "./capabilities/index.js";
import { workspaceQueries, workspaceMutations } from "./workspace/index.js";
import { routineMutations, routineQueries } from "./routines/index.js";
import {
  workflowEngineBindingTypeResolvers,
  workflowEvidenceTypeResolvers,
  workflowMutations,
  workflowQueries,
  workflowRunEventTypeResolvers,
  workflowRunTypeResolvers,
  workflowTriggerTypeResolvers,
  workflowTypeResolvers,
  workflowVersionTypeResolvers,
} from "./workflows/index.js";
import {
  tenantCredentialMutations,
  tenantCredentialQueries,
} from "./tenant-credentials/index.js";
import { deploymentMutations, deploymentQueries } from "./deployments/index.js";
import { pluginMutations, pluginQueries } from "./plugins/index.js";
import { pluginAppMutations, pluginAppQueries } from "./plugin-apps/index.js";
import { crmMutations } from "./crm/index.js";
import {
  emailChannelMutations,
  emailChannelQueries,
} from "./email-channel/index.js";
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
  workItemMutations,
  workItemQueries,
  workItemTypeResolvers,
} from "./work-items/index.js";
import {
  agentLoopIterationTypeResolvers,
  agentLoopMutations,
  agentLoopQueries,
  agentLoopRunTypeResolvers,
  agentLoopTypeResolvers,
  agentLoopVersionTypeResolvers,
} from "./agent-loops/index.js";
import {
  spaceChecklistTemplateTypeResolvers,
  spaceMemberTypeResolvers,
  spaceMutations,
  spaceQueries,
  spaceTypeResolvers,
} from "./spaces/index.js";
import {
  piExtensionMutations,
  piExtensionQueries,
} from "./pi-extensions/index.js";
import {
  documentPlateMutations,
  documentPlateQueries,
} from "./document-plates/index.js";

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
  ...knowledgeGraphQueries,
  ...artifactQueries,
  ...appletQueries,
  ...orchestrationQueries,
  ...messageQueries,
  ...webhookQueries,
  ...memoryQueries,
  ...memorySourceQueries,
  ...entityIdentityQueries,
  ...recipeQueries,
  ...evaluationsQueries,
  ...evalDatasetQueries,
  ...evalProfileQueries,
  ...flagThreadQueries,
  ...evalReplayAllowlistQueries,
  ...searchQueries,
  ...skillRunsQueries,
  ...skillCatalogQueries,
  ...skillCreatorQueries,
  ...runtimeQueries,
  ...capabilityQueries,
  ...workspaceQueries,
  ...routineQueries,
  ...workflowQueries,
  ...tenantCredentialQueries,
  ...deploymentQueries,
  ...pluginQueries,
  ...pluginAppQueries,
  ...emailChannelQueries,
  ...quickActionQueries,
  ...customizeQueries,
  ...complianceQueries,
  ...slackQueries,
  ...ontologyQueries,
  ...observabilityQueries,
  ...spaceQueries,
  ...linkedTaskQueries,
  ...workItemQueries,
  ...agentLoopQueries,
  ...piExtensionQueries,
  ...documentPlateQueries,
};

export const mutationResolvers: Record<string, any> = {
  _empty: () => null,
  ...tenantAgentMutations,
  ...agentProfileMutations,
  ...capabilityMutations,
  ...goalMutations,
  ...coreMutations,
  ...messageMutations,
  ...triggerMutations,
  ...threadMutations,
  ...inboxMutations,
  ...costMutations,
  ...knowledgeGraphMutations,
  ...artifactMutations,
  ...appletMutations,
  ...orchestrationMutations,
  ...webhookMutations,
  ...memoryMutations,
  ...memorySourceMutations,
  ...entityIdentityMutations,
  ...recipeMutations,
  ...evaluationsMutations,
  ...evalDatasetMutations,
  ...evalProfileMutations,
  ...evalReplayAllowlistMutations,
  ...flagThreadMutations,
  ...searchMutations,
  ...skillRunsMutations,
  ...skillCatalogMutations,
  ...skillCreatorMutations,
  ...workspaceMutations,
  ...routineMutations,
  ...workflowMutations,
  ...tenantCredentialMutations,
  ...deploymentMutations,
  ...pluginMutations,
  ...pluginAppMutations,
  ...crmMutations,
  ...emailChannelMutations,
  ...quickActionMutations,
  ...customizeMutations,
  ...complianceMutations,
  ...slackMutations,
  ...ontologyMutations,
  ...spaceMutations,
  ...linkedTaskMutations,
  ...workItemMutations,
  ...agentLoopMutations,
  ...piExtensionMutations,
  ...documentPlateMutations,
};

import { agentTypeResolvers } from "./tenant-agent/types.js";
import {
  threadParticipantTypeResolvers,
  threadTypeResolvers,
} from "./threads/types.js";
import { routineExecutionTypeResolvers } from "./routines/types.js";
import { tenantTypeResolvers } from "./core/types.js";

export const typeResolvers: Record<string, Record<string, any>> = {
  Tenant: tenantTypeResolvers,
  Artifact: artifactTypeResolvers,
  ArtifactVersion: artifactVersionTypeResolvers,
  Agent: agentTypeResolvers,
  AgentProfile: agentProfileTypeResolvers,
  AgentProfileSpaceAssignment: agentProfileSpaceAssignmentTypeResolvers,
  Thread: threadTypeResolvers,
  ThreadParticipant: threadParticipantTypeResolvers,
  Message: messageTypeResolvers,
  MessageMention: messageMentionTypeResolvers,
  EvalResult: evalResultTypeResolvers,
  EvalRun: evalRunTypeResolvers,
  SkillEvalScore: skillEvalScoreTypeResolvers,
  RoutineExecution: routineExecutionTypeResolvers,
  Workflow: workflowTypeResolvers,
  WorkflowVersion: workflowVersionTypeResolvers,
  WorkflowTrigger: workflowTriggerTypeResolvers,
  WorkflowEngineBinding: workflowEngineBindingTypeResolvers,
  WorkflowRun: workflowRunTypeResolvers,
  WorkflowRunEvent: workflowRunEventTypeResolvers,
  WorkflowEvidence: workflowEvidenceTypeResolvers,
  Space: spaceTypeResolvers,
  SpaceMember: spaceMemberTypeResolvers,
  SpaceChecklistTemplate: spaceChecklistTemplateTypeResolvers,
  LinkedTask: linkedTaskTypeResolvers,
  WorkItem: workItemTypeResolvers,
  AgentLoop: agentLoopTypeResolvers,
  AgentLoopVersion: agentLoopVersionTypeResolvers,
  AgentLoopRun: agentLoopRunTypeResolvers,
  AgentLoopIteration: agentLoopIterationTypeResolvers,
};
