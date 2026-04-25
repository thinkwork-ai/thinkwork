/* eslint-disable */
import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  AWSDateTime: { input: any; output: any; }
  AWSJSON: { input: any; output: any; }
  AWSURL: { input: any; output: any; }
};

export type AcceptTemplateUpdateBulkResult = {
  __typename?: 'AcceptTemplateUpdateBulkResult';
  accepted: Scalars['Int']['output'];
  failed: Scalars['Int']['output'];
  results: Array<AcceptTemplateUpdateBulkResultEntry>;
};

export type AcceptTemplateUpdateBulkResultEntry = {
  __typename?: 'AcceptTemplateUpdateBulkResultEntry';
  agentId: Scalars['ID']['output'];
  error?: Maybe<Scalars['String']['output']>;
  success: Scalars['Boolean']['output'];
};

export type ActivityLogEntry = {
  __typename?: 'ActivityLogEntry';
  action: Scalars['String']['output'];
  actorId: Scalars['ID']['output'];
  actorType: Scalars['String']['output'];
  changes?: Maybe<Scalars['AWSJSON']['output']>;
  createdAt: Scalars['AWSDateTime']['output'];
  entityId?: Maybe<Scalars['ID']['output']>;
  entityType?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  metadata?: Maybe<Scalars['AWSJSON']['output']>;
  tenantId: Scalars['ID']['output'];
};

export type AddInboxItemCommentInput = {
  authorId?: InputMaybe<Scalars['ID']['input']>;
  authorType?: InputMaybe<Scalars['String']['input']>;
  content: Scalars['String']['input'];
  inboxItemId: Scalars['ID']['input'];
};

export type AddInboxItemLinkInput = {
  inboxItemId: Scalars['ID']['input'];
  linkedId: Scalars['ID']['input'];
  linkedType: Scalars['String']['input'];
};

export type AddTeamAgentInput = {
  agentId: Scalars['ID']['input'];
  /** Optional idempotency key. See CreateTeamInput.idempotencyKey. */
  idempotencyKey?: InputMaybe<Scalars['String']['input']>;
  role?: InputMaybe<Scalars['String']['input']>;
};

export type AddTeamUserInput = {
  /** Optional idempotency key. See CreateTeamInput.idempotencyKey. */
  idempotencyKey?: InputMaybe<Scalars['String']['input']>;
  role?: InputMaybe<Scalars['String']['input']>;
  userId: Scalars['ID']['input'];
};

export type AddTenantMemberInput = {
  /** Optional idempotency key. See UpdateTenantInput.idempotencyKey. */
  idempotencyKey?: InputMaybe<Scalars['String']['input']>;
  principalId: Scalars['ID']['input'];
  principalType: Scalars['String']['input'];
  role?: InputMaybe<Scalars['String']['input']>;
};

export type AdminRoleCheckResult = {
  __typename?: 'AdminRoleCheckResult';
  /** One of: owner, admin, member, other. */
  role: Scalars['String']['output'];
};

export type Agent = {
  __typename?: 'Agent';
  adapterConfig?: Maybe<Scalars['AWSJSON']['output']>;
  adapterType?: Maybe<Scalars['String']['output']>;
  agentTemplate?: Maybe<AgentTemplate>;
  avatarUrl?: Maybe<Scalars['String']['output']>;
  budgetPolicy?: Maybe<AgentBudgetPolicy>;
  capabilities: Array<AgentCapability>;
  createdAt: Scalars['AWSDateTime']['output'];
  humanPair?: Maybe<User>;
  humanPairId?: Maybe<Scalars['ID']['output']>;
  id: Scalars['ID']['output'];
  knowledgeBases: Array<AgentKnowledgeBase>;
  lastHeartbeatAt?: Maybe<Scalars['AWSDateTime']['output']>;
  name: Scalars['String']['output'];
  parentAgentId?: Maybe<Scalars['ID']['output']>;
  reportsTo?: Maybe<Agent>;
  reportsToId?: Maybe<Scalars['ID']['output']>;
  role?: Maybe<Scalars['String']['output']>;
  runtimeConfig?: Maybe<Scalars['AWSJSON']['output']>;
  skills: Array<AgentSkill>;
  slug?: Maybe<Scalars['String']['output']>;
  source?: Maybe<Scalars['String']['output']>;
  status: AgentStatus;
  subAgents?: Maybe<Array<Agent>>;
  systemPrompt?: Maybe<Scalars['String']['output']>;
  templateId: Scalars['ID']['output'];
  tenantId: Scalars['ID']['output'];
  type: AgentType;
  updatedAt: Scalars['AWSDateTime']['output'];
  version: Scalars['Int']['output'];
};

export type AgentApiKey = {
  __typename?: 'AgentApiKey';
  agentId: Scalars['ID']['output'];
  createdAt: Scalars['AWSDateTime']['output'];
  id: Scalars['ID']['output'];
  keyPrefix: Scalars['String']['output'];
  lastUsedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  revokedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  tenantId: Scalars['ID']['output'];
};

export type AgentBudgetPolicy = {
  __typename?: 'AgentBudgetPolicy';
  actionOnExceed: Scalars['String']['output'];
  agentId: Scalars['ID']['output'];
  createdAt: Scalars['AWSDateTime']['output'];
  enabled: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  limitUsd: Scalars['Float']['output'];
  period: Scalars['String']['output'];
  scope: Scalars['String']['output'];
  tenantId: Scalars['ID']['output'];
  updatedAt: Scalars['AWSDateTime']['output'];
};

export type AgentBudgetPolicyInput = {
  actionOnExceed?: InputMaybe<Scalars['String']['input']>;
  limitUsd: Scalars['Float']['input'];
  period: Scalars['String']['input'];
};

export type AgentCapability = {
  __typename?: 'AgentCapability';
  agentId: Scalars['ID']['output'];
  capability: Scalars['String']['output'];
  config?: Maybe<Scalars['AWSJSON']['output']>;
  createdAt: Scalars['AWSDateTime']['output'];
  enabled: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  tenantId: Scalars['ID']['output'];
};

export type AgentCapabilityInput = {
  capability: Scalars['String']['input'];
  config?: InputMaybe<Scalars['AWSJSON']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
};

export type AgentCostSummary = {
  __typename?: 'AgentCostSummary';
  agentId?: Maybe<Scalars['ID']['output']>;
  agentName: Scalars['String']['output'];
  eventCount: Scalars['Int']['output'];
  totalUsd: Scalars['Float']['output'];
};

export type AgentCount = {
  __typename?: 'AgentCount';
  agentId: Scalars['ID']['output'];
  agentName?: Maybe<Scalars['String']['output']>;
  count: Scalars['Int']['output'];
};

export type AgentEmailCapability = {
  __typename?: 'AgentEmailCapability';
  agentId: Scalars['ID']['output'];
  allowedSenders: Array<Scalars['String']['output']>;
  emailAddress?: Maybe<Scalars['String']['output']>;
  enabled: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  maxReplyTokenAgeDays: Scalars['Int']['output'];
  maxReplyTokenUses: Scalars['Int']['output'];
  rateLimitPerHour: Scalars['Int']['output'];
  replyTokensEnabled: Scalars['Boolean']['output'];
  vanityAddress?: Maybe<Scalars['String']['output']>;
};

export type AgentKnowledgeBase = {
  __typename?: 'AgentKnowledgeBase';
  agentId: Scalars['ID']['output'];
  createdAt: Scalars['AWSDateTime']['output'];
  enabled: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  knowledgeBase?: Maybe<KnowledgeBase>;
  knowledgeBaseId: Scalars['ID']['output'];
  searchConfig?: Maybe<Scalars['AWSJSON']['output']>;
};

export type AgentKnowledgeBaseInput = {
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  knowledgeBaseId: Scalars['ID']['input'];
  searchConfig?: InputMaybe<Scalars['AWSJSON']['input']>;
};

export type AgentPerformance = {
  __typename?: 'AgentPerformance';
  agentId: Scalars['ID']['output'];
  agentName: Scalars['String']['output'];
  avgDurationMs: Scalars['Float']['output'];
  errorCount: Scalars['Int']['output'];
  invocationCount: Scalars['Int']['output'];
  p95DurationMs: Scalars['Float']['output'];
  totalCostUsd: Scalars['Float']['output'];
  totalInputTokens: Scalars['Int']['output'];
  totalOutputTokens: Scalars['Int']['output'];
};

export type AgentSkill = {
  __typename?: 'AgentSkill';
  agentId: Scalars['ID']['output'];
  config?: Maybe<Scalars['AWSJSON']['output']>;
  createdAt: Scalars['AWSDateTime']['output'];
  enabled: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  modelOverride?: Maybe<Scalars['String']['output']>;
  permissions?: Maybe<Scalars['AWSJSON']['output']>;
  rateLimitRpm?: Maybe<Scalars['Int']['output']>;
  skillId: Scalars['String']['output'];
  tenantId: Scalars['ID']['output'];
};

export type AgentSkillInput = {
  config?: InputMaybe<Scalars['AWSJSON']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  modelOverride?: InputMaybe<Scalars['String']['input']>;
  permissions?: InputMaybe<Scalars['AWSJSON']['input']>;
  rateLimitRpm?: InputMaybe<Scalars['Int']['input']>;
  skillId: Scalars['String']['input'];
};

export enum AgentStatus {
  Busy = 'BUSY',
  Error = 'ERROR',
  Idle = 'IDLE',
  Offline = 'OFFLINE'
}

export type AgentStatusEvent = {
  __typename?: 'AgentStatusEvent';
  agentId: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  status: Scalars['String']['output'];
  tenantId: Scalars['ID']['output'];
  updatedAt: Scalars['AWSDateTime']['output'];
};

export type AgentTemplate = {
  __typename?: 'AgentTemplate';
  blockedTools?: Maybe<Scalars['AWSJSON']['output']>;
  /**
   * Browser Automation opt-in metadata for the AgentCore Browser + Nova Act
   * built-in tool. Shape validated at create/update time by
   * packages/api/src/lib/templates/browser-config.ts:
   *   { enabled: true }
   * Null means the template does not use Browser Automation unless an agent-level
   * capability override enables it.
   */
  browser?: Maybe<Scalars['AWSJSON']['output']>;
  category?: Maybe<Scalars['String']['output']>;
  config?: Maybe<Scalars['AWSJSON']['output']>;
  createdAt: Scalars['AWSDateTime']['output'];
  description?: Maybe<Scalars['String']['output']>;
  guardrailId?: Maybe<Scalars['ID']['output']>;
  icon?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  isPublished: Scalars['Boolean']['output'];
  knowledgeBaseIds?: Maybe<Scalars['AWSJSON']['output']>;
  model?: Maybe<Scalars['String']['output']>;
  name: Scalars['String']['output'];
  /**
   * Sandbox opt-in metadata for the AgentCore Code Interpreter sandbox
   * (plan Unit 3). Shape validated at create/update time by
   * packages/api/src/lib/templates/sandbox-config.ts:
   *   { environment: "default-public" | "internal-only" }
   * Null means the template does not use the sandbox.
   */
  sandbox?: Maybe<Scalars['AWSJSON']['output']>;
  skills?: Maybe<Scalars['AWSJSON']['output']>;
  slug: Scalars['String']['output'];
  source: Scalars['String']['output'];
  tenantId?: Maybe<Scalars['ID']['output']>;
  updatedAt: Scalars['AWSDateTime']['output'];
};

export enum AgentType {
  Agent = 'AGENT',
  Gateway = 'GATEWAY',
  Supervisor = 'SUPERVISOR'
}

export type AgentVersion = {
  __typename?: 'AgentVersion';
  agentId: Scalars['ID']['output'];
  configSnapshot?: Maybe<Scalars['AWSJSON']['output']>;
  createdAt: Scalars['AWSDateTime']['output'];
  createdBy?: Maybe<Scalars['ID']['output']>;
  guardrailSnapshot?: Maybe<Scalars['AWSJSON']['output']>;
  id: Scalars['ID']['output'];
  isActive: Scalars['Boolean']['output'];
  knowledgeBasesSnapshot?: Maybe<Scalars['AWSJSON']['output']>;
  label?: Maybe<Scalars['String']['output']>;
  skillsSnapshot?: Maybe<Scalars['AWSJSON']['output']>;
  tenantId: Scalars['ID']['output'];
  versionNumber: Scalars['Int']['output'];
  workspaceSnapshot?: Maybe<Scalars['AWSJSON']['output']>;
};

export type AgentWakeupRequest = {
  __typename?: 'AgentWakeupRequest';
  agent?: Maybe<Agent>;
  agentId: Scalars['ID']['output'];
  claimedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  coalescedCount: Scalars['Int']['output'];
  createdAt: Scalars['AWSDateTime']['output'];
  finishedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  id: Scalars['ID']['output'];
  idempotencyKey?: Maybe<Scalars['String']['output']>;
  payload?: Maybe<Scalars['AWSJSON']['output']>;
  reason?: Maybe<Scalars['String']['output']>;
  requestedAt: Scalars['AWSDateTime']['output'];
  requestedByActorId?: Maybe<Scalars['String']['output']>;
  requestedByActorType?: Maybe<Scalars['String']['output']>;
  runId?: Maybe<Scalars['ID']['output']>;
  source: Scalars['String']['output'];
  status: Scalars['String']['output'];
  tenantId: Scalars['ID']['output'];
  triggerDetail?: Maybe<Scalars['String']['output']>;
};

export type AgentWorkspace = {
  __typename?: 'AgentWorkspace';
  name: Scalars['String']['output'];
  purpose?: Maybe<Scalars['String']['output']>;
  slug: Scalars['String']['output'];
};

export type ApproveInboxItemInput = {
  reviewNotes?: InputMaybe<Scalars['String']['input']>;
};

export type Artifact = {
  __typename?: 'Artifact';
  agentId?: Maybe<Scalars['ID']['output']>;
  content?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['AWSDateTime']['output'];
  id: Scalars['ID']['output'];
  metadata?: Maybe<Scalars['AWSJSON']['output']>;
  s3Key?: Maybe<Scalars['String']['output']>;
  sourceMessageId?: Maybe<Scalars['ID']['output']>;
  status: ArtifactStatus;
  summary?: Maybe<Scalars['String']['output']>;
  tenantId: Scalars['ID']['output'];
  threadId?: Maybe<Scalars['ID']['output']>;
  title: Scalars['String']['output'];
  type: ArtifactType;
  updatedAt: Scalars['AWSDateTime']['output'];
};

export enum ArtifactStatus {
  Draft = 'DRAFT',
  Final = 'FINAL',
  Superseded = 'SUPERSEDED'
}

export enum ArtifactType {
  DataView = 'DATA_VIEW',
  Digest = 'DIGEST',
  Draft = 'DRAFT',
  Note = 'NOTE',
  Plan = 'PLAN',
  Report = 'REPORT'
}

export type BootstrapResult = {
  __typename?: 'BootstrapResult';
  isNew: Scalars['Boolean']['output'];
  tenant: Tenant;
  user: User;
};

export type BudgetPolicy = {
  __typename?: 'BudgetPolicy';
  actionOnExceed: Scalars['String']['output'];
  agentId?: Maybe<Scalars['ID']['output']>;
  createdAt: Scalars['AWSDateTime']['output'];
  enabled: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  limitUsd: Scalars['Float']['output'];
  period: Scalars['String']['output'];
  scope: Scalars['String']['output'];
  tenantId: Scalars['ID']['output'];
  updatedAt: Scalars['AWSDateTime']['output'];
};

export type BudgetStatus = {
  __typename?: 'BudgetStatus';
  percentUsed: Scalars['Float']['output'];
  policy: BudgetPolicy;
  remainingUsd: Scalars['Float']['output'];
  spentUsd: Scalars['Float']['output'];
  status: Scalars['String']['output'];
};

export type CheckoutThreadInput = {
  runId: Scalars['String']['input'];
};

export type CompositionFeedbackSummary = {
  __typename?: 'CompositionFeedbackSummary';
  negative: Scalars['Int']['output'];
  positive: Scalars['Int']['output'];
  skillId: Scalars['String']['output'];
  total: Scalars['Int']['output'];
};

export type ConcurrencySnapshot = {
  __typename?: 'ConcurrencySnapshot';
  byAgent: Array<AgentCount>;
  byStatus: Array<StatusCount>;
  totalActive: Scalars['Int']['output'];
};

export type CostEvent = {
  __typename?: 'CostEvent';
  agentId?: Maybe<Scalars['ID']['output']>;
  amountUsd: Scalars['Float']['output'];
  cachedReadTokens?: Maybe<Scalars['Int']['output']>;
  createdAt: Scalars['AWSDateTime']['output'];
  durationMs?: Maybe<Scalars['Int']['output']>;
  eventType: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  inputTokens?: Maybe<Scalars['Int']['output']>;
  model?: Maybe<Scalars['String']['output']>;
  outputTokens?: Maybe<Scalars['Int']['output']>;
  provider?: Maybe<Scalars['String']['output']>;
  requestId: Scalars['String']['output'];
  tenantId: Scalars['ID']['output'];
};

export type CostRecordedEvent = {
  __typename?: 'CostRecordedEvent';
  agentId?: Maybe<Scalars['ID']['output']>;
  agentName?: Maybe<Scalars['String']['output']>;
  amountUsd: Scalars['Float']['output'];
  eventType: Scalars['String']['output'];
  model?: Maybe<Scalars['String']['output']>;
  tenantId: Scalars['ID']['output'];
  updatedAt: Scalars['AWSDateTime']['output'];
};

export type CostSummary = {
  __typename?: 'CostSummary';
  computeUsd: Scalars['Float']['output'];
  evalUsd?: Maybe<Scalars['Float']['output']>;
  eventCount: Scalars['Int']['output'];
  llmUsd: Scalars['Float']['output'];
  periodEnd: Scalars['AWSDateTime']['output'];
  periodStart: Scalars['AWSDateTime']['output'];
  toolsUsd: Scalars['Float']['output'];
  totalInputTokens: Scalars['Int']['output'];
  totalOutputTokens: Scalars['Int']['output'];
  totalUsd: Scalars['Float']['output'];
};

export type CreateAgentApiKeyInput = {
  agentId: Scalars['ID']['input'];
  name?: InputMaybe<Scalars['String']['input']>;
};

export type CreateAgentApiKeyResult = {
  __typename?: 'CreateAgentApiKeyResult';
  apiKey: AgentApiKey;
  plainTextKey: Scalars['String']['output'];
};

export type CreateAgentFromTemplateInput = {
  /** Optional idempotency key. See CreateAgentInput.idempotencyKey. */
  idempotencyKey?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  slug: Scalars['String']['input'];
  teamId?: InputMaybe<Scalars['ID']['input']>;
  templateId: Scalars['ID']['input'];
};

export type CreateAgentInput = {
  adapterConfig?: InputMaybe<Scalars['AWSJSON']['input']>;
  adapterType?: InputMaybe<Scalars['String']['input']>;
  avatarUrl?: InputMaybe<Scalars['String']['input']>;
  humanPairId?: InputMaybe<Scalars['ID']['input']>;
  /**
   * Optional client-supplied idempotency key. When provided, a retry with
   * the same key returns the prior call's result without re-executing.
   * Null/absent = server derives a key from canonicalized inputs.
   * See packages/api/src/lib/idempotency.ts.
   */
  idempotencyKey?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  parentAgentId?: InputMaybe<Scalars['ID']['input']>;
  reportsTo?: InputMaybe<Scalars['ID']['input']>;
  role?: InputMaybe<Scalars['String']['input']>;
  runtimeConfig?: InputMaybe<Scalars['AWSJSON']['input']>;
  systemPrompt?: InputMaybe<Scalars['String']['input']>;
  templateId: Scalars['ID']['input'];
  tenantId: Scalars['ID']['input'];
  type?: InputMaybe<AgentType>;
};

export type CreateAgentTemplateInput = {
  blockedTools?: InputMaybe<Scalars['AWSJSON']['input']>;
  /**
   * Browser Automation opt-in metadata; see AgentTemplate.browser. Omit
   * (or pass null) for templates that do not opt into Browser Automation.
   */
  browser?: InputMaybe<Scalars['AWSJSON']['input']>;
  category?: InputMaybe<Scalars['String']['input']>;
  config?: InputMaybe<Scalars['AWSJSON']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  guardrailId?: InputMaybe<Scalars['ID']['input']>;
  icon?: InputMaybe<Scalars['String']['input']>;
  /**
   * Optional client-supplied idempotency key. See
   * CreateAgentInput.idempotencyKey / packages/api/src/lib/idempotency.ts.
   */
  idempotencyKey?: InputMaybe<Scalars['String']['input']>;
  isPublished?: InputMaybe<Scalars['Boolean']['input']>;
  knowledgeBaseIds?: InputMaybe<Scalars['AWSJSON']['input']>;
  model?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  /**
   * Sandbox opt-in metadata; see AgentTemplate.sandbox. Validated at
   * resolver boundary. Omit (or pass null) for templates that do not
   * opt into the sandbox.
   */
  sandbox?: InputMaybe<Scalars['AWSJSON']['input']>;
  skills?: InputMaybe<Scalars['AWSJSON']['input']>;
  slug: Scalars['String']['input'];
  tenantId: Scalars['ID']['input'];
};

export type CreateArtifactInput = {
  agentId?: InputMaybe<Scalars['ID']['input']>;
  content?: InputMaybe<Scalars['String']['input']>;
  metadata?: InputMaybe<Scalars['AWSJSON']['input']>;
  s3Key?: InputMaybe<Scalars['String']['input']>;
  sourceMessageId?: InputMaybe<Scalars['ID']['input']>;
  status?: InputMaybe<ArtifactStatus>;
  summary?: InputMaybe<Scalars['String']['input']>;
  tenantId: Scalars['ID']['input'];
  threadId?: InputMaybe<Scalars['ID']['input']>;
  title: Scalars['String']['input'];
  type: ArtifactType;
};

export type CreateEvalTestCaseInput = {
  agentTemplateId?: InputMaybe<Scalars['ID']['input']>;
  agentcoreEvaluatorIds?: InputMaybe<Array<Scalars['String']['input']>>;
  assertions?: InputMaybe<Array<EvalAssertionInput>>;
  category: Scalars['String']['input'];
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  name: Scalars['String']['input'];
  query: Scalars['String']['input'];
  systemPrompt?: InputMaybe<Scalars['String']['input']>;
  tags?: InputMaybe<Array<Scalars['String']['input']>>;
};

export type CreateInboxItemInput = {
  config?: InputMaybe<Scalars['AWSJSON']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  entityId?: InputMaybe<Scalars['ID']['input']>;
  entityType?: InputMaybe<Scalars['String']['input']>;
  expiresAt?: InputMaybe<Scalars['AWSDateTime']['input']>;
  recipientId?: InputMaybe<Scalars['ID']['input']>;
  requesterId?: InputMaybe<Scalars['ID']['input']>;
  requesterType?: InputMaybe<Scalars['String']['input']>;
  tenantId: Scalars['ID']['input'];
  title?: InputMaybe<Scalars['String']['input']>;
  type: Scalars['String']['input'];
};

export type CreateKnowledgeBaseInput = {
  chunkOverlapPercent?: InputMaybe<Scalars['Int']['input']>;
  chunkSizeTokens?: InputMaybe<Scalars['Int']['input']>;
  chunkingStrategy?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  embeddingModel?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  tenantId: Scalars['ID']['input'];
};

export type CreateQuickActionInput = {
  prompt: Scalars['String']['input'];
  scope?: InputMaybe<QuickActionScope>;
  sortOrder?: InputMaybe<Scalars['Int']['input']>;
  tenantId: Scalars['ID']['input'];
  title: Scalars['String']['input'];
  workspaceAgentId?: InputMaybe<Scalars['ID']['input']>;
};

export type CreateRecipeInput = {
  agentId?: InputMaybe<Scalars['ID']['input']>;
  genuiType: Scalars['String']['input'];
  params: Scalars['AWSJSON']['input'];
  server: Scalars['String']['input'];
  sourceMessageId?: InputMaybe<Scalars['ID']['input']>;
  summary?: InputMaybe<Scalars['String']['input']>;
  templates?: InputMaybe<Scalars['AWSJSON']['input']>;
  tenantId: Scalars['ID']['input'];
  threadId?: InputMaybe<Scalars['ID']['input']>;
  title: Scalars['String']['input'];
  tool: Scalars['String']['input'];
};

export type CreateRoutineInput = {
  agentId?: InputMaybe<Scalars['ID']['input']>;
  config?: InputMaybe<Scalars['AWSJSON']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  schedule?: InputMaybe<Scalars['String']['input']>;
  teamId?: InputMaybe<Scalars['ID']['input']>;
  tenantId: Scalars['ID']['input'];
  type?: InputMaybe<Scalars['String']['input']>;
};

export type CreateScheduledJobInput = {
  agentId?: InputMaybe<Scalars['ID']['input']>;
  config?: InputMaybe<Scalars['AWSJSON']['input']>;
  createdById?: InputMaybe<Scalars['String']['input']>;
  createdByType?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  prompt?: InputMaybe<Scalars['String']['input']>;
  routineId?: InputMaybe<Scalars['ID']['input']>;
  scheduleExpression?: InputMaybe<Scalars['String']['input']>;
  scheduleType?: InputMaybe<Scalars['String']['input']>;
  teamId?: InputMaybe<Scalars['ID']['input']>;
  tenantId: Scalars['ID']['input'];
  timezone?: InputMaybe<Scalars['String']['input']>;
  triggerType: Scalars['String']['input'];
};

export type CreateTeamInput = {
  budgetMonthlyCents?: InputMaybe<Scalars['Int']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  /**
   * Optional client-supplied idempotency key. See
   * CreateAgentInput.idempotencyKey / packages/api/src/lib/idempotency.ts.
   */
  idempotencyKey?: InputMaybe<Scalars['String']['input']>;
  metadata?: InputMaybe<Scalars['AWSJSON']['input']>;
  name: Scalars['String']['input'];
  tenantId: Scalars['ID']['input'];
  type?: InputMaybe<Scalars['String']['input']>;
};

export type CreateTenantInput = {
  name: Scalars['String']['input'];
  plan?: InputMaybe<Scalars['String']['input']>;
  slug: Scalars['String']['input'];
};

export type CreateThreadInput = {
  agentId?: InputMaybe<Scalars['ID']['input']>;
  assigneeId?: InputMaybe<Scalars['ID']['input']>;
  assigneeType?: InputMaybe<Scalars['String']['input']>;
  billingCode?: InputMaybe<Scalars['String']['input']>;
  channel?: InputMaybe<ThreadChannel>;
  createdById?: InputMaybe<Scalars['String']['input']>;
  createdByType?: InputMaybe<Scalars['String']['input']>;
  dueAt?: InputMaybe<Scalars['AWSDateTime']['input']>;
  firstMessage?: InputMaybe<Scalars['String']['input']>;
  labels?: InputMaybe<Scalars['AWSJSON']['input']>;
  metadata?: InputMaybe<Scalars['AWSJSON']['input']>;
  tenantId: Scalars['ID']['input'];
  title: Scalars['String']['input'];
};

export type CreateThreadLabelInput = {
  color?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  tenantId: Scalars['ID']['input'];
};

export type CreateWakeupRequestInput = {
  agentId: Scalars['ID']['input'];
  idempotencyKey?: InputMaybe<Scalars['String']['input']>;
  payload?: InputMaybe<Scalars['AWSJSON']['input']>;
  reason?: InputMaybe<Scalars['String']['input']>;
  requestedByActorId?: InputMaybe<Scalars['String']['input']>;
  requestedByActorType?: InputMaybe<Scalars['String']['input']>;
  source: Scalars['String']['input'];
  tenantId: Scalars['ID']['input'];
  triggerDetail?: InputMaybe<Scalars['String']['input']>;
};

export type CreateWebhookInput = {
  agentId?: InputMaybe<Scalars['ID']['input']>;
  config?: InputMaybe<Scalars['AWSJSON']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  prompt?: InputMaybe<Scalars['String']['input']>;
  rateLimit?: InputMaybe<Scalars['Int']['input']>;
  routineId?: InputMaybe<Scalars['ID']['input']>;
  targetType: Scalars['String']['input'];
  tenantId: Scalars['ID']['input'];
};

export type DailyCostPoint = {
  __typename?: 'DailyCostPoint';
  computeUsd: Scalars['Float']['output'];
  day: Scalars['String']['output'];
  eventCount: Scalars['Int']['output'];
  llmUsd: Scalars['Float']['output'];
  toolsUsd: Scalars['Float']['output'];
  totalUsd: Scalars['Float']['output'];
};

export type DelegateThreadInput = {
  agentId: Scalars['ID']['input'];
  assigneeId: Scalars['ID']['input'];
  reason?: InputMaybe<Scalars['String']['input']>;
  threadId: Scalars['ID']['input'];
};

export type DeploymentStatus = {
  __typename?: 'DeploymentStatus';
  accountId?: Maybe<Scalars['String']['output']>;
  adminUrl?: Maybe<Scalars['String']['output']>;
  agentcoreStatus?: Maybe<Scalars['String']['output']>;
  apiEndpoint?: Maybe<Scalars['String']['output']>;
  appsyncRealtimeUrl?: Maybe<Scalars['String']['output']>;
  appsyncUrl?: Maybe<Scalars['String']['output']>;
  bucketName?: Maybe<Scalars['String']['output']>;
  databaseEndpoint?: Maybe<Scalars['String']['output']>;
  docsUrl?: Maybe<Scalars['String']['output']>;
  ecrUrl?: Maybe<Scalars['String']['output']>;
  hindsightEnabled: Scalars['Boolean']['output'];
  hindsightEndpoint?: Maybe<Scalars['String']['output']>;
  managedMemoryEnabled: Scalars['Boolean']['output'];
  region: Scalars['String']['output'];
  source: Scalars['String']['output'];
  stage: Scalars['String']['output'];
};

export type EscalateThreadInput = {
  agentId: Scalars['ID']['input'];
  reason: Scalars['String']['input'];
  threadId: Scalars['ID']['input'];
};

export type EvalAssertionInput = {
  path?: InputMaybe<Scalars['String']['input']>;
  type: Scalars['String']['input'];
  value?: InputMaybe<Scalars['String']['input']>;
};

export type EvalResult = {
  __typename?: 'EvalResult';
  actualOutput?: Maybe<Scalars['String']['output']>;
  agentSessionId?: Maybe<Scalars['String']['output']>;
  assertions: Scalars['AWSJSON']['output'];
  category?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['AWSDateTime']['output'];
  durationMs?: Maybe<Scalars['Int']['output']>;
  errorMessage?: Maybe<Scalars['String']['output']>;
  evaluatorResults: Scalars['AWSJSON']['output'];
  expected?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  input?: Maybe<Scalars['String']['output']>;
  runId: Scalars['ID']['output'];
  score?: Maybe<Scalars['Float']['output']>;
  status: Scalars['String']['output'];
  testCaseId?: Maybe<Scalars['ID']['output']>;
  testCaseName?: Maybe<Scalars['String']['output']>;
};

export type EvalRun = {
  __typename?: 'EvalRun';
  agentId?: Maybe<Scalars['ID']['output']>;
  agentName?: Maybe<Scalars['String']['output']>;
  agentTemplateId?: Maybe<Scalars['ID']['output']>;
  agentTemplateName?: Maybe<Scalars['String']['output']>;
  categories: Array<Scalars['String']['output']>;
  completedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  costUsd?: Maybe<Scalars['Float']['output']>;
  createdAt: Scalars['AWSDateTime']['output'];
  errorMessage?: Maybe<Scalars['String']['output']>;
  failed: Scalars['Int']['output'];
  id: Scalars['ID']['output'];
  model?: Maybe<Scalars['String']['output']>;
  passRate?: Maybe<Scalars['Float']['output']>;
  passed: Scalars['Int']['output'];
  regression: Scalars['Boolean']['output'];
  startedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  status: Scalars['String']['output'];
  tenantId: Scalars['ID']['output'];
  totalTests: Scalars['Int']['output'];
};

export type EvalRunUpdateEvent = {
  __typename?: 'EvalRunUpdateEvent';
  agentId?: Maybe<Scalars['ID']['output']>;
  errorMessage?: Maybe<Scalars['String']['output']>;
  failed?: Maybe<Scalars['Int']['output']>;
  passRate?: Maybe<Scalars['Float']['output']>;
  passed?: Maybe<Scalars['Int']['output']>;
  runId: Scalars['ID']['output'];
  status: Scalars['String']['output'];
  tenantId: Scalars['ID']['output'];
  totalTests?: Maybe<Scalars['Int']['output']>;
  updatedAt: Scalars['AWSDateTime']['output'];
};

export type EvalRunsPage = {
  __typename?: 'EvalRunsPage';
  items: Array<EvalRun>;
  totalCount: Scalars['Int']['output'];
};

export type EvalSummary = {
  __typename?: 'EvalSummary';
  avgPassRate?: Maybe<Scalars['Float']['output']>;
  latestPassRate?: Maybe<Scalars['Float']['output']>;
  regressionCount: Scalars['Int']['output'];
  totalRuns: Scalars['Int']['output'];
};

export type EvalTestCase = {
  __typename?: 'EvalTestCase';
  agentTemplateId?: Maybe<Scalars['ID']['output']>;
  agentTemplateName?: Maybe<Scalars['String']['output']>;
  agentcoreEvaluatorIds: Array<Scalars['String']['output']>;
  assertions: Scalars['AWSJSON']['output'];
  category: Scalars['String']['output'];
  createdAt: Scalars['AWSDateTime']['output'];
  enabled: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  query: Scalars['String']['output'];
  source: Scalars['String']['output'];
  systemPrompt?: Maybe<Scalars['String']['output']>;
  tags: Array<Scalars['String']['output']>;
  tenantId: Scalars['ID']['output'];
  updatedAt: Scalars['AWSDateTime']['output'];
};

export type EvalTimeSeriesPoint = {
  __typename?: 'EvalTimeSeriesPoint';
  day: Scalars['String']['output'];
  failed: Scalars['Int']['output'];
  passRate?: Maybe<Scalars['Float']['output']>;
  passed: Scalars['Int']['output'];
  runCount: Scalars['Int']['output'];
};

export type HeartbeatActivityEvent = {
  __typename?: 'HeartbeatActivityEvent';
  createdAt: Scalars['AWSDateTime']['output'];
  heartbeatId: Scalars['ID']['output'];
  message?: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
  tenantId: Scalars['ID']['output'];
};

export type InboxItem = {
  __typename?: 'InboxItem';
  comments: Array<InboxItemComment>;
  config?: Maybe<Scalars['AWSJSON']['output']>;
  createdAt: Scalars['AWSDateTime']['output'];
  decidedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  decidedBy?: Maybe<Scalars['ID']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  entityId?: Maybe<Scalars['ID']['output']>;
  entityType?: Maybe<Scalars['String']['output']>;
  expiresAt?: Maybe<Scalars['AWSDateTime']['output']>;
  id: Scalars['ID']['output'];
  linkedThreads: Array<LinkedThread>;
  links: Array<InboxItemLink>;
  recipientId?: Maybe<Scalars['ID']['output']>;
  requesterId?: Maybe<Scalars['ID']['output']>;
  requesterType?: Maybe<Scalars['String']['output']>;
  reviewNotes?: Maybe<Scalars['String']['output']>;
  revision: Scalars['Int']['output'];
  status: InboxItemStatus;
  tenantId: Scalars['ID']['output'];
  title?: Maybe<Scalars['String']['output']>;
  type: Scalars['String']['output'];
  updatedAt: Scalars['AWSDateTime']['output'];
};

export type InboxItemComment = {
  __typename?: 'InboxItemComment';
  authorId?: Maybe<Scalars['ID']['output']>;
  authorType?: Maybe<Scalars['String']['output']>;
  content: Scalars['String']['output'];
  createdAt: Scalars['AWSDateTime']['output'];
  id: Scalars['ID']['output'];
  inboxItemId: Scalars['ID']['output'];
  tenantId: Scalars['ID']['output'];
};

export type InboxItemDecisionInput = {
  comment?: InputMaybe<Scalars['String']['input']>;
  status: InboxItemStatus;
};

export type InboxItemLink = {
  __typename?: 'InboxItemLink';
  createdAt: Scalars['AWSDateTime']['output'];
  id: Scalars['ID']['output'];
  inboxItemId: Scalars['ID']['output'];
  linkedId?: Maybe<Scalars['ID']['output']>;
  linkedType?: Maybe<Scalars['String']['output']>;
  tenantId: Scalars['ID']['output'];
};

export enum InboxItemStatus {
  Approved = 'APPROVED',
  Cancelled = 'CANCELLED',
  Expired = 'EXPIRED',
  Pending = 'PENDING',
  Rejected = 'REJECTED',
  RevisionRequested = 'REVISION_REQUESTED'
}

export type InboxItemStatusEvent = {
  __typename?: 'InboxItemStatusEvent';
  inboxItemId: Scalars['ID']['output'];
  status: Scalars['String']['output'];
  tenantId: Scalars['ID']['output'];
  title?: Maybe<Scalars['String']['output']>;
  updatedAt: Scalars['AWSDateTime']['output'];
};

export type InviteMemberInput = {
  email: Scalars['String']['input'];
  /** Optional idempotency key. See UpdateTenantInput.idempotencyKey. */
  idempotencyKey?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  role?: InputMaybe<Scalars['String']['input']>;
};

export type KnowledgeBase = {
  __typename?: 'KnowledgeBase';
  awsKbId?: Maybe<Scalars['String']['output']>;
  chunkOverlapPercent?: Maybe<Scalars['Int']['output']>;
  chunkSizeTokens?: Maybe<Scalars['Int']['output']>;
  chunkingStrategy: Scalars['String']['output'];
  createdAt: Scalars['AWSDateTime']['output'];
  description?: Maybe<Scalars['String']['output']>;
  documentCount?: Maybe<Scalars['Int']['output']>;
  embeddingModel: Scalars['String']['output'];
  errorMessage?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  lastSyncAt?: Maybe<Scalars['AWSDateTime']['output']>;
  lastSyncStatus?: Maybe<Scalars['String']['output']>;
  name: Scalars['String']['output'];
  slug: Scalars['String']['output'];
  status: Scalars['String']['output'];
  tenantId: Scalars['ID']['output'];
  updatedAt: Scalars['AWSDateTime']['output'];
};

export type LinkedThread = {
  __typename?: 'LinkedThread';
  id: Scalars['ID']['output'];
  identifier?: Maybe<Scalars['String']['output']>;
  number: Scalars['Int']['output'];
  status: Scalars['String']['output'];
  title: Scalars['String']['output'];
};

export type MemoryContent = {
  __typename?: 'MemoryContent';
  text?: Maybe<Scalars['String']['output']>;
};

export type MemoryGraph = {
  __typename?: 'MemoryGraph';
  edges: Array<MemoryGraphEdge>;
  nodes: Array<MemoryGraphNode>;
};

export type MemoryGraphEdge = {
  __typename?: 'MemoryGraphEdge';
  label?: Maybe<Scalars['String']['output']>;
  source: Scalars['String']['output'];
  target: Scalars['String']['output'];
  type: Scalars['String']['output'];
  weight: Scalars['Float']['output'];
};

export type MemoryGraphNode = {
  __typename?: 'MemoryGraphNode';
  edgeCount: Scalars['Int']['output'];
  entityType?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  label: Scalars['String']['output'];
  latestThreadId?: Maybe<Scalars['String']['output']>;
  strategy?: Maybe<Scalars['String']['output']>;
  type: Scalars['String']['output'];
};

export type MemoryRecord = {
  __typename?: 'MemoryRecord';
  accessCount?: Maybe<Scalars['Int']['output']>;
  agentSlug?: Maybe<Scalars['String']['output']>;
  confidence?: Maybe<Scalars['Float']['output']>;
  content?: Maybe<MemoryContent>;
  context?: Maybe<Scalars['String']['output']>;
  createdAt?: Maybe<Scalars['AWSDateTime']['output']>;
  eventDate?: Maybe<Scalars['AWSDateTime']['output']>;
  expiresAt?: Maybe<Scalars['AWSDateTime']['output']>;
  factType?: Maybe<Scalars['String']['output']>;
  memoryRecordId: Scalars['ID']['output'];
  mentionedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  namespace?: Maybe<Scalars['String']['output']>;
  occurredEnd?: Maybe<Scalars['AWSDateTime']['output']>;
  occurredStart?: Maybe<Scalars['AWSDateTime']['output']>;
  proofCount?: Maybe<Scalars['Int']['output']>;
  score?: Maybe<Scalars['Float']['output']>;
  strategy?: Maybe<Scalars['String']['output']>;
  strategyId?: Maybe<Scalars['String']['output']>;
  tags?: Maybe<Array<Scalars['String']['output']>>;
  threadId?: Maybe<Scalars['String']['output']>;
  updatedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  /**
   * Compiled wiki pages (Compounding Memory) that cite this memory unit as
   * a source. Populated from wiki_section_sources.source_ref. Returns pages
   * scoped to the same agent as this memory (there is no cross-agent
   * citation in v1). Returned pages have empty `sections`/`aliases` — fetch
   * `wikiPage(tenantId, ownerId, type, slug)` for full detail.
   */
  wikiPages: Array<WikiPage>;
};

export type MemorySearchResult = {
  __typename?: 'MemorySearchResult';
  records: Array<MemoryRecord>;
  totalCount: Scalars['Int']['output'];
};

export enum MemoryStrategy {
  Episodes = 'EPISODES',
  Preferences = 'PREFERENCES',
  Reflections = 'REFLECTIONS',
  Semantic = 'SEMANTIC',
  Summaries = 'SUMMARIES'
}

/**
 * Runtime memory system configuration exposed to the admin UI.
 * Lets the UI decide which views to render (e.g. Knowledge Graph toggle is
 * only meaningful when Hindsight is deployed alongside managed memory).
 */
export type MemorySystemConfig = {
  __typename?: 'MemorySystemConfig';
  /**
   * True when the optional Hindsight add-on is deployed (ECS + ALB). Gates
   * the Knowledge Graph / entity-graph views in the admin UI.
   */
  hindsightEnabled: Scalars['Boolean']['output'];
  /**
   * True when managed AgentCore Memory is provisioned and wired into the
   * agent container. This is the always-on baseline — when false, memory
   * features may be unavailable.
   */
  managedMemoryEnabled: Scalars['Boolean']['output'];
};

export type Message = {
  __typename?: 'Message';
  artifacts: Array<MessageArtifact>;
  content?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['AWSDateTime']['output'];
  durableArtifact?: Maybe<Artifact>;
  id: Scalars['ID']['output'];
  metadata?: Maybe<Scalars['AWSJSON']['output']>;
  role: MessageRole;
  senderId?: Maybe<Scalars['ID']['output']>;
  senderType?: Maybe<Scalars['String']['output']>;
  tenantId: Scalars['ID']['output'];
  threadId: Scalars['ID']['output'];
  tokenCount?: Maybe<Scalars['Int']['output']>;
  toolCalls?: Maybe<Scalars['AWSJSON']['output']>;
  toolResults?: Maybe<Scalars['AWSJSON']['output']>;
};

export type MessageArtifact = {
  __typename?: 'MessageArtifact';
  artifactType: Scalars['String']['output'];
  content?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['AWSDateTime']['output'];
  id: Scalars['ID']['output'];
  messageId: Scalars['ID']['output'];
  metadata?: Maybe<Scalars['AWSJSON']['output']>;
  mimeType?: Maybe<Scalars['String']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  s3Key?: Maybe<Scalars['String']['output']>;
  sizeBytes?: Maybe<Scalars['Int']['output']>;
  tenantId: Scalars['ID']['output'];
  threadId: Scalars['ID']['output'];
};

export type MessageConnection = {
  __typename?: 'MessageConnection';
  edges: Array<MessageEdge>;
  pageInfo: PageInfo;
};

export type MessageEdge = {
  __typename?: 'MessageEdge';
  cursor: Scalars['String']['output'];
  node: Message;
};

export enum MessageRole {
  Assistant = 'ASSISTANT',
  System = 'SYSTEM',
  Tool = 'TOOL',
  User = 'USER'
}

/**
 * Fact-type picker values exposed to the mobile quick-capture footer. Maps to
 * Hindsight's native fact_type via the resolver. FACT is the default when the
 * user doesn't override.
 */
export enum MobileCaptureFactType {
  Experience = 'EXPERIENCE',
  Fact = 'FACT',
  Observation = 'OBSERVATION',
  Preference = 'PREFERENCE'
}

export type MobileMemoryCapture = {
  __typename?: 'MobileMemoryCapture';
  agentId: Scalars['ID']['output'];
  capturedAt: Scalars['AWSDateTime']['output'];
  content: Scalars['String']['output'];
  factType: MobileCaptureFactType;
  id: Scalars['ID']['output'];
  metadata?: Maybe<Scalars['AWSJSON']['output']>;
  syncedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  tenantId: Scalars['ID']['output'];
};

export type MobileWikiSearchResult = {
  __typename?: 'MobileWikiSearchResult';
  /**
   * Retained for wire-format compatibility with older mobile clients.
   * Always [] on the FTS path; pages match their own compiled text, not
   * source memory units.
   */
  matchingMemoryIds: Array<Scalars['ID']['output']>;
  page: WikiPage;
  /**
   * Postgres `ts_rank(search_tsv, plainto_tsquery('english', query))` on
   * the page's compiled text. Higher is better. Not comparable across
   * queries.
   */
  score: Scalars['Float']['output'];
};

export type ModelCatalogEntry = {
  __typename?: 'ModelCatalogEntry';
  contextWindow?: Maybe<Scalars['Int']['output']>;
  displayName: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  inputCostPerMillion?: Maybe<Scalars['Float']['output']>;
  maxOutputTokens?: Maybe<Scalars['Int']['output']>;
  modelId: Scalars['String']['output'];
  outputCostPerMillion?: Maybe<Scalars['Float']['output']>;
  provider: Scalars['String']['output'];
  supportsTools?: Maybe<Scalars['Boolean']['output']>;
  supportsVision?: Maybe<Scalars['Boolean']['output']>;
};

export type ModelCostSummary = {
  __typename?: 'ModelCostSummary';
  inputTokens: Scalars['Int']['output'];
  model: Scalars['String']['output'];
  outputTokens: Scalars['Int']['output'];
  totalUsd: Scalars['Float']['output'];
};

export type ModelInvocation = {
  __typename?: 'ModelInvocation';
  branch?: Maybe<Scalars['String']['output']>;
  cacheReadTokenCount: Scalars['Int']['output'];
  costUsd?: Maybe<Scalars['Float']['output']>;
  hasToolResult?: Maybe<Scalars['Boolean']['output']>;
  inputPreview?: Maybe<Scalars['String']['output']>;
  inputTokenCount: Scalars['Int']['output'];
  modelId: Scalars['String']['output'];
  outputPreview?: Maybe<Scalars['String']['output']>;
  outputTokenCount: Scalars['Int']['output'];
  requestId: Scalars['String']['output'];
  timestamp: Scalars['AWSDateTime']['output'];
  toolCount?: Maybe<Scalars['Int']['output']>;
  toolUses?: Maybe<Array<Scalars['String']['output']>>;
};

export type Mutation = {
  __typename?: 'Mutation';
  _empty?: Maybe<Scalars['String']['output']>;
  /** Advance an agent's pinned hash for a guardrail-class file. idempotencyKey optional. */
  acceptTemplateUpdate: Agent;
  acceptTemplateUpdateBulk: AcceptTemplateUpdateBulkResult;
  addInboxItemComment: InboxItemComment;
  addInboxItemLink: InboxItemLink;
  addTeamAgent: TeamAgent;
  addTeamUser: TeamUser;
  addTenantMember: TenantMember;
  addThreadDependency: ThreadDependency;
  approveInboxItem: InboxItem;
  assignThreadLabel: ThreadLabelAssignment;
  /**
   * Admin-only fire-and-forget dispatch of a journal-schema bulk ingest onto
   * a dedicated worker Lambda. Returns immediately with a dispatch
   * acknowledgement — the actual ingest + terminal compile happen
   * asynchronously. Track progress via the wiki-bootstrap-import Lambda's
   * CloudWatch logs and the resulting compile job in wiki_compile_jobs.
   */
  bootstrapJournalImport: WikiJournalImportDispatch;
  bootstrapUser: BootstrapResult;
  cancelEvalRun: EvalRun;
  cancelInboxItem: InboxItem;
  cancelSkillRun: SkillRun;
  cancelThreadTurn: ThreadTurn;
  captureMobileMemory: MobileMemoryCapture;
  checkoutThread: Thread;
  claimVanityEmailAddress: AgentCapability;
  /**
   * Admin-only: enqueue an ad-hoc compile job for a specific (tenant, agent).
   * Returns the job row (newly inserted or the in-flight dedupe hit).
   *
   * When `modelId` is supplied, it is forwarded to the compile Lambda event
   * payload so a single run can override `BEDROCK_MODEL_ID` without a
   * redeploy. The override takes effect only on the direct Event-invoke
   * path; if the invoke fails and a polling worker claims the job later, the
   * compile falls back to the env-default model.
   */
  compileWikiNow: WikiCompileJob;
  createAgent: Agent;
  createAgentApiKey: CreateAgentApiKeyResult;
  createAgentFromTemplate: Agent;
  createAgentTemplate: AgentTemplate;
  createArtifact: Artifact;
  createEvalTestCase: EvalTestCase;
  createInboxItem: InboxItem;
  createKnowledgeBase: KnowledgeBase;
  createQuickAction: UserQuickAction;
  createRecipe: Recipe;
  createRoutine: Routine;
  createScheduledJob: ScheduledJob;
  createTeam: Team;
  createTenant: Tenant;
  createThread: Thread;
  createThreadLabel: ThreadLabel;
  createWakeupRequest: AgentWakeupRequest;
  createWebhook: Webhook;
  decideInboxItem: InboxItem;
  delegateThread: Thread;
  deleteAgent: Scalars['Boolean']['output'];
  deleteAgentBudgetPolicy: Scalars['Boolean']['output'];
  deleteAgentTemplate: Scalars['Boolean']['output'];
  deleteArtifact: Scalars['Boolean']['output'];
  deleteBudgetPolicy: Scalars['Boolean']['output'];
  deleteEvalRun: Scalars['Boolean']['output'];
  deleteEvalTestCase: Scalars['Boolean']['output'];
  deleteKnowledgeBase: Scalars['Boolean']['output'];
  deleteMemoryRecord: Scalars['Boolean']['output'];
  deleteMessage: Scalars['Boolean']['output'];
  deleteMobileMemoryCapture: Scalars['Boolean']['output'];
  deleteQuickAction: Scalars['Boolean']['output'];
  deleteRecipe: Scalars['Boolean']['output'];
  deleteRoutine: Scalars['Boolean']['output'];
  deleteRoutineTrigger: Scalars['Boolean']['output'];
  deleteRun: Scalars['Boolean']['output'];
  deleteTeam: Scalars['Boolean']['output'];
  deleteThread: Scalars['Boolean']['output'];
  deleteThreadLabel: Scalars['Boolean']['output'];
  deleteWebhook: Scalars['Boolean']['output'];
  escalateThread: Thread;
  inviteMember: TenantMember;
  notifyAgentStatus?: Maybe<AgentStatusEvent>;
  notifyCostRecorded?: Maybe<CostRecordedEvent>;
  notifyEvalRunUpdate?: Maybe<EvalRunUpdateEvent>;
  notifyHeartbeatActivity?: Maybe<HeartbeatActivityEvent>;
  notifyInboxItemUpdate?: Maybe<InboxItemStatusEvent>;
  notifyNewMessage?: Maybe<NewMessageEvent>;
  notifyOrgUpdate?: Maybe<OrgUpdateEvent>;
  notifyThreadTurnUpdate?: Maybe<ThreadTurnUpdateEvent>;
  notifyThreadUpdate?: Maybe<ThreadUpdateEvent>;
  refreshGenUI?: Maybe<Message>;
  regenerateWebhookToken?: Maybe<Webhook>;
  registerPushToken: Scalars['Boolean']['output'];
  rejectInboxItem: InboxItem;
  releaseThread: Thread;
  releaseVanityEmailAddress: AgentCapability;
  removeInboxItemLink: Scalars['Boolean']['output'];
  removeTeamAgent: Scalars['Boolean']['output'];
  removeTeamUser: Scalars['Boolean']['output'];
  /** Remove a tenant member. idempotencyKey optional — see UpdateTenantInput.idempotencyKey. */
  removeTenantMember: Scalars['Boolean']['output'];
  removeThreadDependency: Scalars['Boolean']['output'];
  removeThreadLabel: Scalars['Boolean']['output'];
  reorderQuickActions: Array<UserQuickAction>;
  requestRevision: InboxItem;
  /**
   * Admin-only replay: clear the compile cursor for (tenant, owner). If
   * `force` is true, also archives every active page in the scope so the
   * next compile rebuilds from scratch. Destructive when force=true.
   */
  resetWikiCursor: WikiResetCursorResult;
  resubmitInboxItem: InboxItem;
  revokeAgentApiKey: AgentApiKey;
  rollbackAgentVersion: Agent;
  seedEvalTestCases: Scalars['Int']['output'];
  sendMessage: Message;
  setAgentBudgetPolicy: AgentBudgetPolicy;
  /** Replace an agent's capabilities. idempotencyKey optional — see CreateAgentInput.idempotencyKey. */
  setAgentCapabilities: Array<AgentCapability>;
  setAgentKnowledgeBases: Array<AgentKnowledgeBase>;
  /** Replace an agent's skills. idempotencyKey optional — see CreateAgentInput.idempotencyKey. */
  setAgentSkills: Array<AgentSkill>;
  setRoutineTrigger: RoutineTrigger;
  startEvalRun: EvalRun;
  startSkillRun: SkillRun;
  submitRunFeedback: SkillRun;
  syncKnowledgeBase: KnowledgeBase;
  /** Sync template config + workspace files to a linked agent. idempotencyKey optional. */
  syncTemplateToAgent: Agent;
  /** Sync template to every linked agent in a tenant. idempotencyKey optional. */
  syncTemplateToAllAgents: SyncSummary;
  toggleAgentEmailChannel: AgentCapability;
  triggerRoutineRun: RoutineRun;
  unpauseAgent: Agent;
  unregisterPushToken: Scalars['Boolean']['output'];
  updateAgent: Agent;
  updateAgentEmailAllowlist: AgentCapability;
  updateAgentStatus: Agent;
  updateAgentTemplate: AgentTemplate;
  updateArtifact: Artifact;
  updateEvalTestCase: EvalTestCase;
  updateKnowledgeBase: KnowledgeBase;
  updateMemoryRecord: Scalars['Boolean']['output'];
  updateQuickAction: UserQuickAction;
  updateRecipe: Recipe;
  updateRoutine: Routine;
  updateTeam: Team;
  updateTenant: Tenant;
  updateTenantMember: TenantMember;
  /**
   * Platform-operator-only mutation — see UpdateTenantPolicyInput. Changes
   * are audited in tenant_policy_events and must satisfy the compound
   * sandbox_requires_standard_tier CHECK on the tenants table.
   */
  updateTenantPolicy: Tenant;
  updateTenantSettings: TenantSettings;
  updateThread: Thread;
  updateThreadLabel: ThreadLabel;
  updateUser: User;
  updateUserProfile: UserProfile;
  updateWebhook: Webhook;
  upsertBudgetPolicy: BudgetPolicy;
};


export type MutationAcceptTemplateUpdateArgs = {
  agentId: Scalars['ID']['input'];
  filename: Scalars['String']['input'];
  idempotencyKey?: InputMaybe<Scalars['String']['input']>;
};


export type MutationAcceptTemplateUpdateBulkArgs = {
  filename: Scalars['String']['input'];
  templateId: Scalars['ID']['input'];
  tenantId: Scalars['ID']['input'];
};


export type MutationAddInboxItemCommentArgs = {
  input: AddInboxItemCommentInput;
};


export type MutationAddInboxItemLinkArgs = {
  input: AddInboxItemLinkInput;
};


export type MutationAddTeamAgentArgs = {
  input: AddTeamAgentInput;
  teamId: Scalars['ID']['input'];
};


export type MutationAddTeamUserArgs = {
  input: AddTeamUserInput;
  teamId: Scalars['ID']['input'];
};


export type MutationAddTenantMemberArgs = {
  input: AddTenantMemberInput;
  tenantId: Scalars['ID']['input'];
};


export type MutationAddThreadDependencyArgs = {
  blockedByThreadId: Scalars['ID']['input'];
  threadId: Scalars['ID']['input'];
};


export type MutationApproveInboxItemArgs = {
  id: Scalars['ID']['input'];
  input?: InputMaybe<ApproveInboxItemInput>;
};


export type MutationAssignThreadLabelArgs = {
  labelId: Scalars['ID']['input'];
  threadId: Scalars['ID']['input'];
};


export type MutationBootstrapJournalImportArgs = {
  accountId: Scalars['ID']['input'];
  agentId: Scalars['ID']['input'];
  limit?: InputMaybe<Scalars['Int']['input']>;
  tenantId: Scalars['ID']['input'];
};


export type MutationCancelEvalRunArgs = {
  id: Scalars['ID']['input'];
};


export type MutationCancelInboxItemArgs = {
  id: Scalars['ID']['input'];
};


export type MutationCancelSkillRunArgs = {
  runId: Scalars['ID']['input'];
};


export type MutationCancelThreadTurnArgs = {
  id: Scalars['ID']['input'];
};


export type MutationCaptureMobileMemoryArgs = {
  agentId: Scalars['ID']['input'];
  clientCaptureId?: InputMaybe<Scalars['ID']['input']>;
  content: Scalars['String']['input'];
  factType?: InputMaybe<MobileCaptureFactType>;
  metadata?: InputMaybe<Scalars['AWSJSON']['input']>;
};


export type MutationCheckoutThreadArgs = {
  id: Scalars['ID']['input'];
  input: CheckoutThreadInput;
};


export type MutationClaimVanityEmailAddressArgs = {
  agentId: Scalars['ID']['input'];
  localPart: Scalars['String']['input'];
};


export type MutationCompileWikiNowArgs = {
  modelId?: InputMaybe<Scalars['String']['input']>;
  ownerId: Scalars['ID']['input'];
  tenantId: Scalars['ID']['input'];
};


export type MutationCreateAgentArgs = {
  input: CreateAgentInput;
};


export type MutationCreateAgentApiKeyArgs = {
  input: CreateAgentApiKeyInput;
};


export type MutationCreateAgentFromTemplateArgs = {
  input: CreateAgentFromTemplateInput;
};


export type MutationCreateAgentTemplateArgs = {
  input: CreateAgentTemplateInput;
};


export type MutationCreateArtifactArgs = {
  input: CreateArtifactInput;
};


export type MutationCreateEvalTestCaseArgs = {
  input: CreateEvalTestCaseInput;
  tenantId: Scalars['ID']['input'];
};


export type MutationCreateInboxItemArgs = {
  input: CreateInboxItemInput;
};


export type MutationCreateKnowledgeBaseArgs = {
  input: CreateKnowledgeBaseInput;
};


export type MutationCreateQuickActionArgs = {
  input: CreateQuickActionInput;
};


export type MutationCreateRecipeArgs = {
  input: CreateRecipeInput;
};


export type MutationCreateRoutineArgs = {
  input: CreateRoutineInput;
};


export type MutationCreateScheduledJobArgs = {
  input: CreateScheduledJobInput;
};


export type MutationCreateTeamArgs = {
  input: CreateTeamInput;
};


export type MutationCreateTenantArgs = {
  input: CreateTenantInput;
};


export type MutationCreateThreadArgs = {
  input: CreateThreadInput;
};


export type MutationCreateThreadLabelArgs = {
  input: CreateThreadLabelInput;
};


export type MutationCreateWakeupRequestArgs = {
  input: CreateWakeupRequestInput;
};


export type MutationCreateWebhookArgs = {
  input: CreateWebhookInput;
};


export type MutationDecideInboxItemArgs = {
  id: Scalars['ID']['input'];
  input: InboxItemDecisionInput;
};


export type MutationDelegateThreadArgs = {
  input: DelegateThreadInput;
};


export type MutationDeleteAgentArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteAgentBudgetPolicyArgs = {
  agentId: Scalars['ID']['input'];
};


export type MutationDeleteAgentTemplateArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteArtifactArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteBudgetPolicyArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteEvalRunArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteEvalTestCaseArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteKnowledgeBaseArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteMemoryRecordArgs = {
  memoryRecordId: Scalars['ID']['input'];
};


export type MutationDeleteMessageArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteMobileMemoryCaptureArgs = {
  agentId: Scalars['ID']['input'];
  captureId: Scalars['ID']['input'];
};


export type MutationDeleteQuickActionArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteRecipeArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteRoutineArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteRoutineTriggerArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteRunArgs = {
  runId: Scalars['ID']['input'];
};


export type MutationDeleteTeamArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteThreadArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteThreadLabelArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteWebhookArgs = {
  id: Scalars['ID']['input'];
};


export type MutationEscalateThreadArgs = {
  input: EscalateThreadInput;
};


export type MutationInviteMemberArgs = {
  input: InviteMemberInput;
  tenantId: Scalars['ID']['input'];
};


export type MutationNotifyAgentStatusArgs = {
  agentId: Scalars['ID']['input'];
  name: Scalars['String']['input'];
  status: Scalars['String']['input'];
  tenantId: Scalars['ID']['input'];
};


export type MutationNotifyCostRecordedArgs = {
  agentId?: InputMaybe<Scalars['ID']['input']>;
  agentName?: InputMaybe<Scalars['String']['input']>;
  amountUsd: Scalars['Float']['input'];
  eventType: Scalars['String']['input'];
  model?: InputMaybe<Scalars['String']['input']>;
  tenantId: Scalars['ID']['input'];
};


export type MutationNotifyEvalRunUpdateArgs = {
  agentId?: InputMaybe<Scalars['ID']['input']>;
  errorMessage?: InputMaybe<Scalars['String']['input']>;
  failed?: InputMaybe<Scalars['Int']['input']>;
  passRate?: InputMaybe<Scalars['Float']['input']>;
  passed?: InputMaybe<Scalars['Int']['input']>;
  runId: Scalars['ID']['input'];
  status: Scalars['String']['input'];
  tenantId: Scalars['ID']['input'];
  totalTests?: InputMaybe<Scalars['Int']['input']>;
};


export type MutationNotifyHeartbeatActivityArgs = {
  heartbeatId: Scalars['ID']['input'];
  message?: InputMaybe<Scalars['String']['input']>;
  status: Scalars['String']['input'];
  tenantId: Scalars['ID']['input'];
};


export type MutationNotifyInboxItemUpdateArgs = {
  inboxItemId: Scalars['ID']['input'];
  status: Scalars['String']['input'];
  tenantId: Scalars['ID']['input'];
  title?: InputMaybe<Scalars['String']['input']>;
};


export type MutationNotifyNewMessageArgs = {
  content?: InputMaybe<Scalars['String']['input']>;
  messageId: Scalars['ID']['input'];
  role: Scalars['String']['input'];
  senderId?: InputMaybe<Scalars['ID']['input']>;
  senderType?: InputMaybe<Scalars['String']['input']>;
  tenantId: Scalars['ID']['input'];
  threadId: Scalars['ID']['input'];
};


export type MutationNotifyOrgUpdateArgs = {
  changeType: Scalars['String']['input'];
  entityId?: InputMaybe<Scalars['ID']['input']>;
  entityType?: InputMaybe<Scalars['String']['input']>;
  tenantId: Scalars['ID']['input'];
};


export type MutationNotifyThreadTurnUpdateArgs = {
  agentId?: InputMaybe<Scalars['ID']['input']>;
  runId: Scalars['ID']['input'];
  status: Scalars['String']['input'];
  tenantId: Scalars['ID']['input'];
  threadId?: InputMaybe<Scalars['ID']['input']>;
  triggerId?: InputMaybe<Scalars['ID']['input']>;
  triggerName?: InputMaybe<Scalars['String']['input']>;
};


export type MutationNotifyThreadUpdateArgs = {
  status: Scalars['String']['input'];
  tenantId: Scalars['ID']['input'];
  threadId: Scalars['ID']['input'];
  title: Scalars['String']['input'];
};


export type MutationRefreshGenUiArgs = {
  messageId: Scalars['ID']['input'];
  toolIndex: Scalars['Int']['input'];
};


export type MutationRegenerateWebhookTokenArgs = {
  id: Scalars['ID']['input'];
};


export type MutationRegisterPushTokenArgs = {
  input: RegisterPushTokenInput;
};


export type MutationRejectInboxItemArgs = {
  id: Scalars['ID']['input'];
  input?: InputMaybe<RejectInboxItemInput>;
};


export type MutationReleaseThreadArgs = {
  id: Scalars['ID']['input'];
  input: ReleaseThreadInput;
};


export type MutationReleaseVanityEmailAddressArgs = {
  agentId: Scalars['ID']['input'];
};


export type MutationRemoveInboxItemLinkArgs = {
  id: Scalars['ID']['input'];
};


export type MutationRemoveTeamAgentArgs = {
  agentId: Scalars['ID']['input'];
  teamId: Scalars['ID']['input'];
};


export type MutationRemoveTeamUserArgs = {
  teamId: Scalars['ID']['input'];
  userId: Scalars['ID']['input'];
};


export type MutationRemoveTenantMemberArgs = {
  id: Scalars['ID']['input'];
  idempotencyKey?: InputMaybe<Scalars['String']['input']>;
};


export type MutationRemoveThreadDependencyArgs = {
  blockedByThreadId: Scalars['ID']['input'];
  threadId: Scalars['ID']['input'];
};


export type MutationRemoveThreadLabelArgs = {
  labelId: Scalars['ID']['input'];
  threadId: Scalars['ID']['input'];
};


export type MutationReorderQuickActionsArgs = {
  input: ReorderQuickActionsInput;
};


export type MutationRequestRevisionArgs = {
  id: Scalars['ID']['input'];
  input: RequestRevisionInput;
};


export type MutationResetWikiCursorArgs = {
  force?: InputMaybe<Scalars['Boolean']['input']>;
  ownerId: Scalars['ID']['input'];
  tenantId: Scalars['ID']['input'];
};


export type MutationResubmitInboxItemArgs = {
  id: Scalars['ID']['input'];
  input?: InputMaybe<ResubmitInboxItemInput>;
};


export type MutationRevokeAgentApiKeyArgs = {
  id: Scalars['ID']['input'];
};


export type MutationRollbackAgentVersionArgs = {
  agentId: Scalars['ID']['input'];
  versionId: Scalars['ID']['input'];
};


export type MutationSeedEvalTestCasesArgs = {
  categories?: InputMaybe<Array<Scalars['String']['input']>>;
  tenantId: Scalars['ID']['input'];
};


export type MutationSendMessageArgs = {
  input: SendMessageInput;
};


export type MutationSetAgentBudgetPolicyArgs = {
  agentId: Scalars['ID']['input'];
  input: AgentBudgetPolicyInput;
};


export type MutationSetAgentCapabilitiesArgs = {
  agentId: Scalars['ID']['input'];
  capabilities: Array<AgentCapabilityInput>;
  idempotencyKey?: InputMaybe<Scalars['String']['input']>;
};


export type MutationSetAgentKnowledgeBasesArgs = {
  agentId: Scalars['ID']['input'];
  knowledgeBases: Array<AgentKnowledgeBaseInput>;
};


export type MutationSetAgentSkillsArgs = {
  agentId: Scalars['ID']['input'];
  idempotencyKey?: InputMaybe<Scalars['String']['input']>;
  skills: Array<AgentSkillInput>;
};


export type MutationSetRoutineTriggerArgs = {
  input: RoutineTriggerInput;
  routineId: Scalars['ID']['input'];
};


export type MutationStartEvalRunArgs = {
  input: StartEvalRunInput;
  tenantId: Scalars['ID']['input'];
};


export type MutationStartSkillRunArgs = {
  input: StartSkillRunInput;
};


export type MutationSubmitRunFeedbackArgs = {
  input: SubmitRunFeedbackInput;
};


export type MutationSyncKnowledgeBaseArgs = {
  id: Scalars['ID']['input'];
};


export type MutationSyncTemplateToAgentArgs = {
  agentId: Scalars['ID']['input'];
  idempotencyKey?: InputMaybe<Scalars['String']['input']>;
  templateId: Scalars['ID']['input'];
};


export type MutationSyncTemplateToAllAgentsArgs = {
  idempotencyKey?: InputMaybe<Scalars['String']['input']>;
  templateId: Scalars['ID']['input'];
};


export type MutationToggleAgentEmailChannelArgs = {
  agentId: Scalars['ID']['input'];
  enabled: Scalars['Boolean']['input'];
};


export type MutationTriggerRoutineRunArgs = {
  routineId: Scalars['ID']['input'];
};


export type MutationUnpauseAgentArgs = {
  agentId: Scalars['ID']['input'];
};


export type MutationUnregisterPushTokenArgs = {
  token: Scalars['String']['input'];
};


export type MutationUpdateAgentArgs = {
  id: Scalars['ID']['input'];
  input: UpdateAgentInput;
};


export type MutationUpdateAgentEmailAllowlistArgs = {
  agentId: Scalars['ID']['input'];
  allowedSenders: Array<Scalars['String']['input']>;
};


export type MutationUpdateAgentStatusArgs = {
  id: Scalars['ID']['input'];
  status: AgentStatus;
};


export type MutationUpdateAgentTemplateArgs = {
  id: Scalars['ID']['input'];
  input: UpdateAgentTemplateInput;
};


export type MutationUpdateArtifactArgs = {
  id: Scalars['ID']['input'];
  input: UpdateArtifactInput;
};


export type MutationUpdateEvalTestCaseArgs = {
  id: Scalars['ID']['input'];
  input: UpdateEvalTestCaseInput;
};


export type MutationUpdateKnowledgeBaseArgs = {
  id: Scalars['ID']['input'];
  input: UpdateKnowledgeBaseInput;
};


export type MutationUpdateMemoryRecordArgs = {
  content: Scalars['String']['input'];
  memoryRecordId: Scalars['ID']['input'];
};


export type MutationUpdateQuickActionArgs = {
  id: Scalars['ID']['input'];
  input: UpdateQuickActionInput;
};


export type MutationUpdateRecipeArgs = {
  id: Scalars['ID']['input'];
  input: UpdateRecipeInput;
};


export type MutationUpdateRoutineArgs = {
  id: Scalars['ID']['input'];
  input: UpdateRoutineInput;
};


export type MutationUpdateTeamArgs = {
  id: Scalars['ID']['input'];
  input: UpdateTeamInput;
};


export type MutationUpdateTenantArgs = {
  id: Scalars['ID']['input'];
  input: UpdateTenantInput;
};


export type MutationUpdateTenantMemberArgs = {
  id: Scalars['ID']['input'];
  input: UpdateTenantMemberInput;
};


export type MutationUpdateTenantPolicyArgs = {
  input: UpdateTenantPolicyInput;
  tenantId: Scalars['ID']['input'];
};


export type MutationUpdateTenantSettingsArgs = {
  input: UpdateTenantSettingsInput;
  tenantId: Scalars['ID']['input'];
};


export type MutationUpdateThreadArgs = {
  id: Scalars['ID']['input'];
  input: UpdateThreadInput;
};


export type MutationUpdateThreadLabelArgs = {
  id: Scalars['ID']['input'];
  input: UpdateThreadLabelInput;
};


export type MutationUpdateUserArgs = {
  id: Scalars['ID']['input'];
  input: UpdateUserInput;
};


export type MutationUpdateUserProfileArgs = {
  input: UpdateUserProfileInput;
  userId: Scalars['ID']['input'];
};


export type MutationUpdateWebhookArgs = {
  id: Scalars['ID']['input'];
  input: UpdateWebhookInput;
};


export type MutationUpsertBudgetPolicyArgs = {
  input: UpsertBudgetPolicyInput;
  tenantId: Scalars['ID']['input'];
};

export type NewMessageEvent = {
  __typename?: 'NewMessageEvent';
  content?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['AWSDateTime']['output'];
  messageId: Scalars['ID']['output'];
  role: Scalars['String']['output'];
  senderId?: Maybe<Scalars['ID']['output']>;
  senderType?: Maybe<Scalars['String']['output']>;
  tenantId: Scalars['ID']['output'];
  threadId: Scalars['ID']['output'];
};

export type OrgUpdateEvent = {
  __typename?: 'OrgUpdateEvent';
  changeType: Scalars['String']['output'];
  entityId?: Maybe<Scalars['ID']['output']>;
  entityType?: Maybe<Scalars['String']['output']>;
  tenantId: Scalars['ID']['output'];
  updatedAt: Scalars['AWSDateTime']['output'];
};

export type PageInfo = {
  __typename?: 'PageInfo';
  endCursor?: Maybe<Scalars['String']['output']>;
  hasNextPage: Scalars['Boolean']['output'];
};

export type PerformanceTimeSeries = {
  __typename?: 'PerformanceTimeSeries';
  avgDurationMs: Scalars['Float']['output'];
  day: Scalars['String']['output'];
  errorCount: Scalars['Int']['output'];
  invocationCount: Scalars['Int']['output'];
  totalCostUsd: Scalars['Float']['output'];
};

export type PinStatusFile = {
  __typename?: 'PinStatusFile';
  filename: Scalars['String']['output'];
  folderPath?: Maybe<Scalars['String']['output']>;
  latestContent?: Maybe<Scalars['String']['output']>;
  latestSha?: Maybe<Scalars['String']['output']>;
  path: Scalars['String']['output'];
  pinnedContent?: Maybe<Scalars['String']['output']>;
  pinnedSha?: Maybe<Scalars['String']['output']>;
  updateAvailable: Scalars['Boolean']['output'];
};

export type Query = {
  __typename?: 'Query';
  _empty?: Maybe<Scalars['String']['output']>;
  activityLog: Array<ActivityLogEntry>;
  /**
   * Returns the caller's own role on the caller's own tenant.
   *
   * Used by the thinkwork-admin Python skill to pre-flight the
   * server-side role gate before making a gated mutation. The query
   * takes no arguments by design — it cannot be used as an enumeration
   * oracle to probe arbitrary (userId, tenantId) pairs. The
   * authoritative role gate remains `requireAdminOrApiKeyCaller` on
   * each gated mutation.
   */
  adminRoleCheck: AdminRoleCheckResult;
  agent?: Maybe<Agent>;
  agentApiKeys: Array<AgentApiKey>;
  agentBudgetStatus?: Maybe<BudgetStatus>;
  agentCostBreakdown: CostSummary;
  agentEmailCapability?: Maybe<AgentEmailCapability>;
  agentPerformance: Array<AgentPerformance>;
  agentPinStatus: Array<PinStatusFile>;
  agentTemplate?: Maybe<AgentTemplate>;
  agentTemplates: Array<AgentTemplate>;
  agentVersions: Array<AgentVersion>;
  agentWorkspaces: Array<AgentWorkspace>;
  agents: Array<Agent>;
  allTenantAgents: Array<Agent>;
  artifact?: Maybe<Artifact>;
  artifacts: Array<Artifact>;
  budgetPolicies: Array<BudgetPolicy>;
  budgetStatus: Array<BudgetStatus>;
  compositionFeedbackSummary: Array<CompositionFeedbackSummary>;
  concurrencySnapshot: ConcurrencySnapshot;
  costByAgent: Array<AgentCostSummary>;
  costByModel: Array<ModelCostSummary>;
  costSummary: CostSummary;
  costTimeSeries: Array<DailyCostPoint>;
  deploymentStatus: DeploymentStatus;
  evalRun?: Maybe<EvalRun>;
  evalRunResults: Array<EvalResult>;
  evalRuns: EvalRunsPage;
  evalSummary: EvalSummary;
  evalTestCase?: Maybe<EvalTestCase>;
  evalTestCaseHistory: Array<EvalResult>;
  evalTestCases: Array<EvalTestCase>;
  evalTimeSeries: Array<EvalTimeSeriesPoint>;
  inboxItem?: Maybe<InboxItem>;
  inboxItems: Array<InboxItem>;
  knowledgeBase?: Maybe<KnowledgeBase>;
  knowledgeBases: Array<KnowledgeBase>;
  linkedAgentsForTemplate: Array<Agent>;
  me?: Maybe<User>;
  memoryGraph: MemoryGraph;
  memoryRecords: Array<MemoryRecord>;
  memorySearch: MemorySearchResult;
  memorySystemConfig: MemorySystemConfig;
  messages: MessageConnection;
  mobileMemoryCaptures: Array<MobileMemoryCapture>;
  /**
   * Free-text search across the full Hindsight bank for the given agent.
   * Hits Hindsight's recall endpoint (semantic + rerank) and normalizes results
   * back to MobileMemoryCapture so the Memories list can render search results
   * with the same rows it uses for captures. Not filtered by capture_source —
   * search is meant to answer "what does this agent know?", including chat-
   * derived observations.
   */
  mobileMemorySearch: Array<MobileMemoryCapture>;
  /**
   * Ranked wiki-page search for mobile. Runs a Postgres full-text query
   * (`plainto_tsquery('english', …)` + `ts_rank`) against the GIN-indexed
   * `search_tsv` generated column on `wiki_pages` (title || summary ||
   * body_md), scoped to one (tenant, agent) pair. Returns results in
   * `ts_rank` DESC order, tie-broken by `last_compiled_at` DESC.
   *
   * Previously routed through Hindsight semantic recall; on the compiled
   * wiki corpus FTS is near-instant and matches the query shape mobile
   * users actually type (page titles, keywords). `matchingMemoryIds` is
   * retained for wire-format compatibility and is always [] on this path —
   * pages match their own compiled text, not source memory units.
   */
  mobileWikiSearch: Array<MobileWikiSearchResult>;
  modelCatalog: Array<ModelCatalogEntry>;
  performanceTimeSeries: Array<PerformanceTimeSeries>;
  queuedWakeups: Array<AgentWakeupRequest>;
  /**
   * Newest compiled wiki pages for the given agent, ordered by
   * last_compiled_at DESC (falling back to updated_at when the page hasn't
   * been recompiled yet). Intended as the default Memories-tab feed so
   * the user sees fresh pages before they type a search query.
   */
  recentWikiPages: Array<WikiPage>;
  recipe?: Maybe<Recipe>;
  recipes: Array<Recipe>;
  routine?: Maybe<Routine>;
  routineRun?: Maybe<RoutineRun>;
  routineRuns: Array<RoutineRun>;
  routines: Array<Routine>;
  runtimeManifestsByAgent: Array<RuntimeManifest>;
  runtimeManifestsByTemplate: Array<RuntimeManifest>;
  scheduledJob?: Maybe<ScheduledJob>;
  scheduledJobs: Array<ScheduledJob>;
  singleAgentPerformance?: Maybe<AgentPerformance>;
  skillRun?: Maybe<SkillRun>;
  skillRuns: Array<SkillRun>;
  team?: Maybe<Team>;
  teams: Array<Team>;
  templateSyncDiff: TemplateSyncDiff;
  tenant?: Maybe<Tenant>;
  tenantBySlug?: Maybe<Tenant>;
  tenantMembers: Array<TenantMember>;
  thread?: Maybe<Thread>;
  threadByNumber?: Maybe<Thread>;
  threadLabels: Array<ThreadLabel>;
  threadTraces: Array<TraceEvent>;
  threadTurn?: Maybe<ThreadTurn>;
  threadTurnEvents: Array<ThreadTurnEvent>;
  threadTurns: Array<ThreadTurn>;
  threads: Array<Thread>;
  threadsPaged: ThreadsPage;
  turnInvocationLogs: Array<ModelInvocation>;
  unreadThreadCount: Scalars['Int']['output'];
  user?: Maybe<User>;
  userQuickActions: Array<UserQuickAction>;
  webhook?: Maybe<Webhook>;
  webhooks: Array<Webhook>;
  /**
   * Pages that link to the given page. Visibility is derived from the target
   * page's owner scope; caller must be that owner or an admin.
   */
  wikiBacklinks: Array<WikiPage>;
  /**
   * Admin-only: list recent compile jobs for a tenant. When `ownerId` is
   * provided, restricts to that agent's jobs; when null/absent, returns
   * jobs across every agent in the tenant. Ordered newest-first.
   *
   * Powers the `thinkwork wiki status` CLI command.
   */
  wikiCompileJobs: Array<WikiCompileJob>;
  /**
   * Pages this page links OUT to — the "Connected Pages" surface. Mirrors
   * wikiBacklinks in the opposite direction; reads wiki_page_links where
   * from_page_id = pageId. Deduplicated by target so a parent/child pair
   * with both a `reference` link and a `parent_of` link returns once.
   */
  wikiConnectedPages: Array<WikiPage>;
  /**
   * Agent-scoped force-graph: every active wiki page + every page-to-page
   * link whose endpoints are both active in the same `(tenant, owner)`
   * scope. Links that reference archived pages are excluded. One round-trip.
   */
  wikiGraph: WikiGraph;
  /** Read one compiled page by slug. `ownerId` is required. */
  wikiPage?: Maybe<WikiPage>;
  /**
   * Postgres full-text search over compiled pages in a single (tenant, owner)
   * scope. Also matches exact aliases. Ranked by ts_rank + alias-hit boost.
   */
  wikiSearch: Array<WikiSearchResult>;
};


export type QueryActivityLogArgs = {
  action?: InputMaybe<Scalars['String']['input']>;
  actorId?: InputMaybe<Scalars['ID']['input']>;
  actorType?: InputMaybe<Scalars['String']['input']>;
  after?: InputMaybe<Scalars['AWSDateTime']['input']>;
  before?: InputMaybe<Scalars['AWSDateTime']['input']>;
  entityId?: InputMaybe<Scalars['ID']['input']>;
  entityType?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  tenantId: Scalars['ID']['input'];
};


export type QueryAgentArgs = {
  id: Scalars['ID']['input'];
};


export type QueryAgentApiKeysArgs = {
  agentId: Scalars['ID']['input'];
};


export type QueryAgentBudgetStatusArgs = {
  agentId: Scalars['ID']['input'];
};


export type QueryAgentCostBreakdownArgs = {
  agentId: Scalars['ID']['input'];
  from?: InputMaybe<Scalars['AWSDateTime']['input']>;
  tenantId: Scalars['ID']['input'];
  to?: InputMaybe<Scalars['AWSDateTime']['input']>;
};


export type QueryAgentEmailCapabilityArgs = {
  agentId: Scalars['ID']['input'];
};


export type QueryAgentPerformanceArgs = {
  from?: InputMaybe<Scalars['AWSDateTime']['input']>;
  tenantId: Scalars['ID']['input'];
  to?: InputMaybe<Scalars['AWSDateTime']['input']>;
};


export type QueryAgentPinStatusArgs = {
  agentId: Scalars['ID']['input'];
  includeNested?: InputMaybe<Scalars['Boolean']['input']>;
};


export type QueryAgentTemplateArgs = {
  id: Scalars['ID']['input'];
};


export type QueryAgentTemplatesArgs = {
  tenantId: Scalars['ID']['input'];
};


export type QueryAgentVersionsArgs = {
  agentId: Scalars['ID']['input'];
  limit?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryAgentWorkspacesArgs = {
  agentId: Scalars['ID']['input'];
};


export type QueryAgentsArgs = {
  includeSystem?: InputMaybe<Scalars['Boolean']['input']>;
  status?: InputMaybe<AgentStatus>;
  tenantId: Scalars['ID']['input'];
  type?: InputMaybe<AgentType>;
};


export type QueryAllTenantAgentsArgs = {
  includeSubAgents?: InputMaybe<Scalars['Boolean']['input']>;
  includeSystem?: InputMaybe<Scalars['Boolean']['input']>;
  tenantId: Scalars['ID']['input'];
};


export type QueryArtifactArgs = {
  id: Scalars['ID']['input'];
};


export type QueryArtifactsArgs = {
  agentId?: InputMaybe<Scalars['ID']['input']>;
  cursor?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  status?: InputMaybe<ArtifactStatus>;
  tenantId: Scalars['ID']['input'];
  threadId?: InputMaybe<Scalars['ID']['input']>;
  type?: InputMaybe<ArtifactType>;
};


export type QueryBudgetPoliciesArgs = {
  tenantId: Scalars['ID']['input'];
};


export type QueryBudgetStatusArgs = {
  tenantId: Scalars['ID']['input'];
};


export type QueryCompositionFeedbackSummaryArgs = {
  skillId?: InputMaybe<Scalars['String']['input']>;
  tenantId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryConcurrencySnapshotArgs = {
  tenantId: Scalars['ID']['input'];
};


export type QueryCostByAgentArgs = {
  from?: InputMaybe<Scalars['AWSDateTime']['input']>;
  tenantId: Scalars['ID']['input'];
  to?: InputMaybe<Scalars['AWSDateTime']['input']>;
};


export type QueryCostByModelArgs = {
  from?: InputMaybe<Scalars['AWSDateTime']['input']>;
  tenantId: Scalars['ID']['input'];
  to?: InputMaybe<Scalars['AWSDateTime']['input']>;
};


export type QueryCostSummaryArgs = {
  from?: InputMaybe<Scalars['AWSDateTime']['input']>;
  tenantId: Scalars['ID']['input'];
  to?: InputMaybe<Scalars['AWSDateTime']['input']>;
};


export type QueryCostTimeSeriesArgs = {
  days?: InputMaybe<Scalars['Int']['input']>;
  tenantId: Scalars['ID']['input'];
};


export type QueryEvalRunArgs = {
  id: Scalars['ID']['input'];
};


export type QueryEvalRunResultsArgs = {
  runId: Scalars['ID']['input'];
};


export type QueryEvalRunsArgs = {
  agentId?: InputMaybe<Scalars['ID']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  tenantId: Scalars['ID']['input'];
};


export type QueryEvalSummaryArgs = {
  tenantId: Scalars['ID']['input'];
};


export type QueryEvalTestCaseArgs = {
  id: Scalars['ID']['input'];
};


export type QueryEvalTestCaseHistoryArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  testCaseId: Scalars['ID']['input'];
};


export type QueryEvalTestCasesArgs = {
  category?: InputMaybe<Scalars['String']['input']>;
  search?: InputMaybe<Scalars['String']['input']>;
  tenantId: Scalars['ID']['input'];
};


export type QueryEvalTimeSeriesArgs = {
  days?: InputMaybe<Scalars['Int']['input']>;
  tenantId: Scalars['ID']['input'];
};


export type QueryInboxItemArgs = {
  id: Scalars['ID']['input'];
};


export type QueryInboxItemsArgs = {
  entityId?: InputMaybe<Scalars['ID']['input']>;
  entityType?: InputMaybe<Scalars['String']['input']>;
  recipientId?: InputMaybe<Scalars['ID']['input']>;
  status?: InputMaybe<InboxItemStatus>;
  tenantId: Scalars['ID']['input'];
};


export type QueryKnowledgeBaseArgs = {
  id: Scalars['ID']['input'];
};


export type QueryKnowledgeBasesArgs = {
  tenantId: Scalars['ID']['input'];
};


export type QueryLinkedAgentsForTemplateArgs = {
  templateId: Scalars['ID']['input'];
};


export type QueryMemoryGraphArgs = {
  assistantId: Scalars['ID']['input'];
};


export type QueryMemoryRecordsArgs = {
  assistantId: Scalars['ID']['input'];
  namespace: Scalars['String']['input'];
};


export type QueryMemorySearchArgs = {
  assistantId: Scalars['ID']['input'];
  limit?: InputMaybe<Scalars['Int']['input']>;
  query: Scalars['String']['input'];
  strategy?: InputMaybe<MemoryStrategy>;
};


export type QueryMessagesArgs = {
  cursor?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  threadId: Scalars['ID']['input'];
};


export type QueryMobileMemoryCapturesArgs = {
  agentId: Scalars['ID']['input'];
  limit?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryMobileMemorySearchArgs = {
  agentId: Scalars['ID']['input'];
  limit?: InputMaybe<Scalars['Int']['input']>;
  query: Scalars['String']['input'];
};


export type QueryMobileWikiSearchArgs = {
  agentId: Scalars['ID']['input'];
  limit?: InputMaybe<Scalars['Int']['input']>;
  query: Scalars['String']['input'];
};


export type QueryPerformanceTimeSeriesArgs = {
  agentId?: InputMaybe<Scalars['ID']['input']>;
  days?: InputMaybe<Scalars['Int']['input']>;
  tenantId: Scalars['ID']['input'];
};


export type QueryQueuedWakeupsArgs = {
  tenantId: Scalars['ID']['input'];
};


export type QueryRecentWikiPagesArgs = {
  agentId: Scalars['ID']['input'];
  limit?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryRecipeArgs = {
  id: Scalars['ID']['input'];
};


export type QueryRecipesArgs = {
  agentId?: InputMaybe<Scalars['ID']['input']>;
  cursor?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  tenantId: Scalars['ID']['input'];
  threadId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryRoutineArgs = {
  id: Scalars['ID']['input'];
};


export type QueryRoutineRunArgs = {
  id: Scalars['ID']['input'];
};


export type QueryRoutineRunsArgs = {
  cursor?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  routineId: Scalars['ID']['input'];
};


export type QueryRoutinesArgs = {
  agentId?: InputMaybe<Scalars['ID']['input']>;
  status?: InputMaybe<RoutineStatus>;
  teamId?: InputMaybe<Scalars['ID']['input']>;
  tenantId: Scalars['ID']['input'];
};


export type QueryRuntimeManifestsByAgentArgs = {
  agentId: Scalars['ID']['input'];
  limit?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryRuntimeManifestsByTemplateArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  templateId: Scalars['ID']['input'];
};


export type QueryScheduledJobArgs = {
  id: Scalars['ID']['input'];
};


export type QueryScheduledJobsArgs = {
  agentId?: InputMaybe<Scalars['ID']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  routineId?: InputMaybe<Scalars['ID']['input']>;
  tenantId: Scalars['ID']['input'];
  triggerType?: InputMaybe<Scalars['String']['input']>;
};


export type QuerySingleAgentPerformanceArgs = {
  agentId: Scalars['ID']['input'];
  tenantId: Scalars['ID']['input'];
};


export type QuerySkillRunArgs = {
  id: Scalars['ID']['input'];
};


export type QuerySkillRunsArgs = {
  agentId?: InputMaybe<Scalars['ID']['input']>;
  invocationSource?: InputMaybe<Scalars['String']['input']>;
  invokerUserId?: InputMaybe<Scalars['ID']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  skillId?: InputMaybe<Scalars['String']['input']>;
  status?: InputMaybe<Scalars['String']['input']>;
  tenantId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryTeamArgs = {
  id: Scalars['ID']['input'];
};


export type QueryTeamsArgs = {
  tenantId: Scalars['ID']['input'];
};


export type QueryTemplateSyncDiffArgs = {
  agentId: Scalars['ID']['input'];
  templateId: Scalars['ID']['input'];
};


export type QueryTenantArgs = {
  id: Scalars['ID']['input'];
};


export type QueryTenantBySlugArgs = {
  slug: Scalars['String']['input'];
};


export type QueryTenantMembersArgs = {
  tenantId: Scalars['ID']['input'];
};


export type QueryThreadArgs = {
  id: Scalars['ID']['input'];
};


export type QueryThreadByNumberArgs = {
  number: Scalars['Int']['input'];
  tenantId: Scalars['ID']['input'];
};


export type QueryThreadLabelsArgs = {
  tenantId: Scalars['ID']['input'];
};


export type QueryThreadTracesArgs = {
  tenantId: Scalars['ID']['input'];
  threadId: Scalars['ID']['input'];
};


export type QueryThreadTurnArgs = {
  id: Scalars['ID']['input'];
};


export type QueryThreadTurnEventsArgs = {
  afterSeq?: InputMaybe<Scalars['Int']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  runId: Scalars['ID']['input'];
};


export type QueryThreadTurnsArgs = {
  agentId?: InputMaybe<Scalars['ID']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  routineId?: InputMaybe<Scalars['ID']['input']>;
  status?: InputMaybe<Scalars['String']['input']>;
  tenantId: Scalars['ID']['input'];
  threadId?: InputMaybe<Scalars['ID']['input']>;
  triggerId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryThreadsArgs = {
  agentId?: InputMaybe<Scalars['ID']['input']>;
  assigneeId?: InputMaybe<Scalars['ID']['input']>;
  channel?: InputMaybe<ThreadChannel>;
  cursor?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  search?: InputMaybe<Scalars['String']['input']>;
  status?: InputMaybe<ThreadStatus>;
  tenantId: Scalars['ID']['input'];
};


export type QueryThreadsPagedArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  search?: InputMaybe<Scalars['String']['input']>;
  showArchived?: InputMaybe<Scalars['Boolean']['input']>;
  sortDir?: InputMaybe<Scalars['String']['input']>;
  sortField?: InputMaybe<Scalars['String']['input']>;
  statuses?: InputMaybe<Array<Scalars['String']['input']>>;
  tenantId: Scalars['ID']['input'];
};


export type QueryTurnInvocationLogsArgs = {
  tenantId: Scalars['ID']['input'];
  turnId: Scalars['ID']['input'];
};


export type QueryUnreadThreadCountArgs = {
  agentId?: InputMaybe<Scalars['ID']['input']>;
  tenantId: Scalars['ID']['input'];
};


export type QueryUserArgs = {
  id: Scalars['ID']['input'];
};


export type QueryUserQuickActionsArgs = {
  scope?: InputMaybe<QuickActionScope>;
  tenantId: Scalars['ID']['input'];
};


export type QueryWebhookArgs = {
  id: Scalars['ID']['input'];
};


export type QueryWebhooksArgs = {
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  targetType?: InputMaybe<Scalars['String']['input']>;
  tenantId: Scalars['ID']['input'];
};


export type QueryWikiBacklinksArgs = {
  pageId: Scalars['ID']['input'];
};


export type QueryWikiCompileJobsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  ownerId?: InputMaybe<Scalars['ID']['input']>;
  tenantId: Scalars['ID']['input'];
};


export type QueryWikiConnectedPagesArgs = {
  pageId: Scalars['ID']['input'];
};


export type QueryWikiGraphArgs = {
  ownerId: Scalars['ID']['input'];
  tenantId: Scalars['ID']['input'];
};


export type QueryWikiPageArgs = {
  ownerId: Scalars['ID']['input'];
  slug: Scalars['String']['input'];
  tenantId: Scalars['ID']['input'];
  type: WikiPageType;
};


export type QueryWikiSearchArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  ownerId: Scalars['ID']['input'];
  query: Scalars['String']['input'];
  tenantId: Scalars['ID']['input'];
};

export enum QuickActionScope {
  Task = 'task',
  Thread = 'thread'
}

export type Recipe = {
  __typename?: 'Recipe';
  agentId?: Maybe<Scalars['ID']['output']>;
  cachedResult?: Maybe<Scalars['AWSJSON']['output']>;
  createdAt: Scalars['AWSDateTime']['output'];
  genuiType: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  lastError?: Maybe<Scalars['String']['output']>;
  lastRefreshed?: Maybe<Scalars['AWSDateTime']['output']>;
  params: Scalars['AWSJSON']['output'];
  server: Scalars['String']['output'];
  sourceMessageId?: Maybe<Scalars['ID']['output']>;
  summary?: Maybe<Scalars['String']['output']>;
  templates?: Maybe<Scalars['AWSJSON']['output']>;
  tenantId: Scalars['ID']['output'];
  threadId?: Maybe<Scalars['ID']['output']>;
  title: Scalars['String']['output'];
  tool: Scalars['String']['output'];
  updatedAt: Scalars['AWSDateTime']['output'];
};

export type RegisterPushTokenInput = {
  platform: Scalars['String']['input'];
  token: Scalars['String']['input'];
};

export type RejectInboxItemInput = {
  reviewNotes?: InputMaybe<Scalars['String']['input']>;
};

export type ReleaseThreadInput = {
  runId: Scalars['String']['input'];
  status?: InputMaybe<ThreadStatus>;
};

export type ReorderQuickActionsInput = {
  orderedIds: Array<Scalars['ID']['input']>;
  scope?: InputMaybe<QuickActionScope>;
  tenantId: Scalars['ID']['input'];
};

export type RequestRevisionInput = {
  reviewNotes: Scalars['String']['input'];
};

export type ResubmitInboxItemInput = {
  config?: InputMaybe<Scalars['AWSJSON']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  title?: InputMaybe<Scalars['String']['input']>;
};

export type RoleChange = {
  __typename?: 'RoleChange';
  current?: Maybe<Scalars['String']['output']>;
  target?: Maybe<Scalars['String']['output']>;
};

export type Routine = {
  __typename?: 'Routine';
  agent?: Maybe<Agent>;
  agentId?: Maybe<Scalars['ID']['output']>;
  config?: Maybe<Scalars['AWSJSON']['output']>;
  createdAt: Scalars['AWSDateTime']['output'];
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  lastRunAt?: Maybe<Scalars['AWSDateTime']['output']>;
  name: Scalars['String']['output'];
  nextRunAt?: Maybe<Scalars['AWSDateTime']['output']>;
  runs: Array<RoutineRun>;
  schedule?: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
  team?: Maybe<Team>;
  teamId?: Maybe<Scalars['ID']['output']>;
  tenantId: Scalars['ID']['output'];
  triggers: Array<RoutineTrigger>;
  type: Scalars['String']['output'];
  updatedAt: Scalars['AWSDateTime']['output'];
};

export type RoutineRun = {
  __typename?: 'RoutineRun';
  completedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  createdAt: Scalars['AWSDateTime']['output'];
  error?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  metadata?: Maybe<Scalars['AWSJSON']['output']>;
  routineId: Scalars['ID']['output'];
  startedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  status: Scalars['String']['output'];
  steps: Array<RoutineStep>;
  tenantId: Scalars['ID']['output'];
};

export enum RoutineRunStatus {
  Cancelled = 'CANCELLED',
  Completed = 'COMPLETED',
  Failed = 'FAILED',
  Pending = 'PENDING',
  Running = 'RUNNING'
}

export enum RoutineStatus {
  Active = 'ACTIVE',
  Archived = 'ARCHIVED',
  Paused = 'PAUSED'
}

export type RoutineStep = {
  __typename?: 'RoutineStep';
  completedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  createdAt: Scalars['AWSDateTime']['output'];
  error?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  input?: Maybe<Scalars['AWSJSON']['output']>;
  name: Scalars['String']['output'];
  output?: Maybe<Scalars['AWSJSON']['output']>;
  routineId: Scalars['ID']['output'];
  runId: Scalars['ID']['output'];
  startedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  status: Scalars['String']['output'];
  stepIndex: Scalars['Int']['output'];
  tenantId: Scalars['ID']['output'];
};

export type RoutineTrigger = {
  __typename?: 'RoutineTrigger';
  config?: Maybe<Scalars['AWSJSON']['output']>;
  createdAt: Scalars['AWSDateTime']['output'];
  enabled: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  routineId: Scalars['ID']['output'];
  tenantId: Scalars['ID']['output'];
  triggerType: Scalars['String']['output'];
  updatedAt: Scalars['AWSDateTime']['output'];
};

export type RoutineTriggerInput = {
  config?: InputMaybe<Scalars['AWSJSON']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  triggerType: Scalars['String']['input'];
};

export type RuntimeManifest = {
  __typename?: 'RuntimeManifest';
  agentId?: Maybe<Scalars['ID']['output']>;
  createdAt: Scalars['AWSDateTime']['output'];
  id: Scalars['ID']['output'];
  manifestJson: Scalars['AWSJSON']['output'];
  sessionId: Scalars['String']['output'];
  templateId?: Maybe<Scalars['ID']['output']>;
  tenantId: Scalars['ID']['output'];
  userId?: Maybe<Scalars['ID']['output']>;
};

export type ScheduledJob = {
  __typename?: 'ScheduledJob';
  agentId?: Maybe<Scalars['ID']['output']>;
  config?: Maybe<Scalars['AWSJSON']['output']>;
  createdAt: Scalars['AWSDateTime']['output'];
  createdById?: Maybe<Scalars['String']['output']>;
  createdByType?: Maybe<Scalars['String']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  ebScheduleName?: Maybe<Scalars['String']['output']>;
  enabled: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  lastRunAt?: Maybe<Scalars['AWSDateTime']['output']>;
  name: Scalars['String']['output'];
  nextRunAt?: Maybe<Scalars['AWSDateTime']['output']>;
  prompt?: Maybe<Scalars['String']['output']>;
  routineId?: Maybe<Scalars['ID']['output']>;
  scheduleExpression?: Maybe<Scalars['String']['output']>;
  scheduleType?: Maybe<Scalars['String']['output']>;
  teamId?: Maybe<Scalars['ID']['output']>;
  tenantId: Scalars['ID']['output'];
  timezone: Scalars['String']['output'];
  triggerType: Scalars['String']['output'];
  updatedAt: Scalars['AWSDateTime']['output'];
};

export type SendMessageInput = {
  content?: InputMaybe<Scalars['String']['input']>;
  metadata?: InputMaybe<Scalars['AWSJSON']['input']>;
  role: MessageRole;
  senderId?: InputMaybe<Scalars['ID']['input']>;
  senderType?: InputMaybe<Scalars['String']['input']>;
  threadId: Scalars['ID']['input'];
  toolCalls?: InputMaybe<Scalars['AWSJSON']['input']>;
  toolResults?: InputMaybe<Scalars['AWSJSON']['input']>;
};

export type SkillPermissionsDelta = {
  __typename?: 'SkillPermissionsDelta';
  /** Ops the agent will gain after sync (typically empty — intersection narrows). */
  added: Array<Scalars['String']['output']>;
  /** Ops the agent currently has but will lose after sync. */
  removed: Array<Scalars['String']['output']>;
  skillId: Scalars['String']['output'];
};

export type SkillRun = {
  __typename?: 'SkillRun';
  agentId?: Maybe<Scalars['ID']['output']>;
  createdAt: Scalars['AWSDateTime']['output'];
  deleteAt: Scalars['AWSDateTime']['output'];
  deliveredArtifactRef?: Maybe<Scalars['AWSJSON']['output']>;
  deliveryChannels?: Maybe<Scalars['AWSJSON']['output']>;
  failureReason?: Maybe<Scalars['String']['output']>;
  feedbackNote?: Maybe<Scalars['String']['output']>;
  feedbackSignal?: Maybe<Scalars['String']['output']>;
  finishedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  id: Scalars['ID']['output'];
  inputs?: Maybe<Scalars['AWSJSON']['output']>;
  invocationSource: Scalars['String']['output'];
  invokerUserId: Scalars['ID']['output'];
  resolvedInputs?: Maybe<Scalars['AWSJSON']['output']>;
  resolvedInputsHash: Scalars['String']['output'];
  skillId: Scalars['String']['output'];
  skillVersion: Scalars['Int']['output'];
  startedAt: Scalars['AWSDateTime']['output'];
  status: Scalars['String']['output'];
  tenantId: Scalars['ID']['output'];
  updatedAt: Scalars['AWSDateTime']['output'];
};

export type StartEvalRunInput = {
  agentId?: InputMaybe<Scalars['ID']['input']>;
  agentTemplateId?: InputMaybe<Scalars['ID']['input']>;
  categories?: InputMaybe<Array<Scalars['String']['input']>>;
  model?: InputMaybe<Scalars['String']['input']>;
  testCaseIds?: InputMaybe<Array<Scalars['ID']['input']>>;
};

export type StartSkillRunInput = {
  agentId?: InputMaybe<Scalars['ID']['input']>;
  deliveryChannels?: InputMaybe<Scalars['AWSJSON']['input']>;
  inputs?: InputMaybe<Scalars['AWSJSON']['input']>;
  invocationSource: Scalars['String']['input'];
  skillId: Scalars['String']['input'];
  skillVersion?: InputMaybe<Scalars['Int']['input']>;
  tenantId?: InputMaybe<Scalars['ID']['input']>;
};

export type StatusCount = {
  __typename?: 'StatusCount';
  count: Scalars['Int']['output'];
  status: Scalars['String']['output'];
};

export type SubmitRunFeedbackInput = {
  note?: InputMaybe<Scalars['String']['input']>;
  runId: Scalars['ID']['input'];
  signal: Scalars['String']['input'];
};

export type Subscription = {
  __typename?: 'Subscription';
  _empty?: Maybe<Scalars['String']['output']>;
  onAgentStatusChanged?: Maybe<AgentStatusEvent>;
  onCostRecorded?: Maybe<CostRecordedEvent>;
  onEvalRunUpdated?: Maybe<EvalRunUpdateEvent>;
  onHeartbeatActivity?: Maybe<HeartbeatActivityEvent>;
  onInboxItemStatusChanged?: Maybe<InboxItemStatusEvent>;
  onNewMessage?: Maybe<NewMessageEvent>;
  onOrgUpdated?: Maybe<OrgUpdateEvent>;
  onThreadTurnUpdated?: Maybe<ThreadTurnUpdateEvent>;
  onThreadUpdated?: Maybe<ThreadUpdateEvent>;
};


export type SubscriptionOnAgentStatusChangedArgs = {
  tenantId: Scalars['ID']['input'];
};


export type SubscriptionOnCostRecordedArgs = {
  tenantId: Scalars['ID']['input'];
};


export type SubscriptionOnEvalRunUpdatedArgs = {
  tenantId: Scalars['ID']['input'];
};


export type SubscriptionOnHeartbeatActivityArgs = {
  tenantId: Scalars['ID']['input'];
};


export type SubscriptionOnInboxItemStatusChangedArgs = {
  tenantId: Scalars['ID']['input'];
};


export type SubscriptionOnNewMessageArgs = {
  threadId: Scalars['ID']['input'];
};


export type SubscriptionOnOrgUpdatedArgs = {
  tenantId: Scalars['ID']['input'];
};


export type SubscriptionOnThreadTurnUpdatedArgs = {
  tenantId: Scalars['ID']['input'];
};


export type SubscriptionOnThreadUpdatedArgs = {
  tenantId: Scalars['ID']['input'];
};

export type SyncSummary = {
  __typename?: 'SyncSummary';
  agentsFailed: Scalars['Int']['output'];
  agentsSynced: Scalars['Int']['output'];
  errors: Array<Scalars['String']['output']>;
};

export type Team = {
  __typename?: 'Team';
  agents: Array<TeamAgent>;
  budgetMonthlyCents?: Maybe<Scalars['Int']['output']>;
  createdAt: Scalars['AWSDateTime']['output'];
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  metadata?: Maybe<Scalars['AWSJSON']['output']>;
  name: Scalars['String']['output'];
  slug?: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
  tenantId: Scalars['ID']['output'];
  type: Scalars['String']['output'];
  updatedAt: Scalars['AWSDateTime']['output'];
  users: Array<TeamUser>;
};

export type TeamAgent = {
  __typename?: 'TeamAgent';
  agent?: Maybe<Agent>;
  agentId: Scalars['ID']['output'];
  createdAt: Scalars['AWSDateTime']['output'];
  id: Scalars['ID']['output'];
  joinedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  role: Scalars['String']['output'];
  teamId: Scalars['ID']['output'];
  tenantId: Scalars['ID']['output'];
};

export type TeamUser = {
  __typename?: 'TeamUser';
  createdAt: Scalars['AWSDateTime']['output'];
  id: Scalars['ID']['output'];
  joinedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  role: Scalars['String']['output'];
  teamId: Scalars['ID']['output'];
  tenantId: Scalars['ID']['output'];
  user?: Maybe<User>;
  userId: Scalars['ID']['output'];
};

export type TemplateSyncDiff = {
  __typename?: 'TemplateSyncDiff';
  filesAdded: Array<Scalars['String']['output']>;
  filesModified: Array<Scalars['String']['output']>;
  filesSame: Array<Scalars['String']['output']>;
  kbsAdded: Array<Scalars['String']['output']>;
  kbsRemoved: Array<Scalars['String']['output']>;
  /**
   * Per-skill preview of the operations the agent will lose (or gain) if
   * Push is applied now. Only includes entries for skills whose manifest
   * declares `permissions_model: operations` AND where the agent's
   * current state would diverge from the post-sync state. Empty array
   * when no permission change is pending. Surfaces in the sync dialog
   * so operators can see revocations before confirming.
   */
  permissionsChanges: Array<SkillPermissionsDelta>;
  roleChange?: Maybe<RoleChange>;
  skillsAdded: Array<Scalars['String']['output']>;
  skillsChanged: Array<Scalars['String']['output']>;
  skillsRemoved: Array<Scalars['String']['output']>;
};

export type Tenant = {
  __typename?: 'Tenant';
  agents: Array<Agent>;
  /**
   * Compliance classification: "standard" | "regulated" | "hipaa". Only
   * standard tenants may enable the sandbox; a compound CHECK on the tenants
   * table enforces this at the schema layer.
   */
  complianceTier: Scalars['String']['output'];
  createdAt: Scalars['AWSDateTime']['output'];
  /**
   * Per-tenant kill switches for built-in tools (plan #007 R6/R7). Array of
   * slug strings (e.g. ["execute_code", "web_search"]). Empty array = all
   * built-ins available (subject to template blocks). The runtime applies
   * this as a narrow-only filter at Agent(tools=...) construction; template
   * blocks intersect (a template cannot unblock what the tenant disabled).
   * Admin UI for editing this field defers to a follow-up PR; until then
   * operators mutate the column directly.
   */
  disabledBuiltinTools: Array<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  issueCounter: Scalars['Int']['output'];
  issuePrefix?: Maybe<Scalars['String']['output']>;
  members: Array<TenantMember>;
  name: Scalars['String']['output'];
  plan: Scalars['String']['output'];
  /**
   * Sandbox kill switch. When false, the dispatcher does not register the
   * execute_code tool regardless of template opt-in. Default-true for new
   * tenants; the migration that added this column flipped every pre-existing
   * tenant to false so Phase 3b enforcement lands before the sandbox runs.
   */
  sandboxEnabled: Scalars['Boolean']['output'];
  sandboxInterpreterInternalId?: Maybe<Scalars['String']['output']>;
  /**
   * Per-tenant AgentCore Code Interpreter IDs, populated asynchronously by
   * the agentcore-admin Lambda (plan Unit 5). Null during the provisioning
   * window.
   */
  sandboxInterpreterPublicId?: Maybe<Scalars['String']['output']>;
  settings?: Maybe<TenantSettings>;
  slug: Scalars['String']['output'];
  teams: Array<Team>;
  updatedAt: Scalars['AWSDateTime']['output'];
};

export type TenantMember = {
  __typename?: 'TenantMember';
  agent?: Maybe<Agent>;
  createdAt: Scalars['AWSDateTime']['output'];
  id: Scalars['ID']['output'];
  principalId: Scalars['ID']['output'];
  principalType: Scalars['String']['output'];
  role: Scalars['String']['output'];
  status: Scalars['String']['output'];
  tenantId: Scalars['ID']['output'];
  updatedAt: Scalars['AWSDateTime']['output'];
  user?: Maybe<User>;
};

export type TenantSettings = {
  __typename?: 'TenantSettings';
  autoCloseThreadMinutes?: Maybe<Scalars['Int']['output']>;
  budgetMonthlyCents?: Maybe<Scalars['Int']['output']>;
  createdAt: Scalars['AWSDateTime']['output'];
  defaultModel?: Maybe<Scalars['String']['output']>;
  features?: Maybe<Scalars['AWSJSON']['output']>;
  id: Scalars['ID']['output'];
  maxAgents?: Maybe<Scalars['Int']['output']>;
  tenantId: Scalars['ID']['output'];
  updatedAt: Scalars['AWSDateTime']['output'];
};

export type Thread = {
  __typename?: 'Thread';
  agent?: Maybe<Agent>;
  agentId?: Maybe<Scalars['ID']['output']>;
  archivedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  assignee?: Maybe<User>;
  assigneeId?: Maybe<Scalars['ID']['output']>;
  assigneeType?: Maybe<Scalars['String']['output']>;
  attachments: Array<ThreadAttachment>;
  billingCode?: Maybe<Scalars['String']['output']>;
  blockedBy: Array<ThreadDependency>;
  blocks: Array<ThreadDependency>;
  cancelledAt?: Maybe<Scalars['AWSDateTime']['output']>;
  channel: ThreadChannel;
  checkoutRunId?: Maybe<Scalars['String']['output']>;
  checkoutVersion: Scalars['Int']['output'];
  closedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  completedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  costSummary?: Maybe<Scalars['Float']['output']>;
  createdAt: Scalars['AWSDateTime']['output'];
  createdById?: Maybe<Scalars['String']['output']>;
  createdByType?: Maybe<Scalars['String']['output']>;
  dueAt?: Maybe<Scalars['AWSDateTime']['output']>;
  id: Scalars['ID']['output'];
  identifier?: Maybe<Scalars['String']['output']>;
  isBlocked: Scalars['Boolean']['output'];
  labels?: Maybe<Scalars['AWSJSON']['output']>;
  lastActivityAt?: Maybe<Scalars['AWSDateTime']['output']>;
  lastReadAt?: Maybe<Scalars['AWSDateTime']['output']>;
  lastResponsePreview?: Maybe<Scalars['String']['output']>;
  lastTurnCompletedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  lifecycleStatus?: Maybe<ThreadLifecycleStatus>;
  messages: MessageConnection;
  metadata?: Maybe<Scalars['AWSJSON']['output']>;
  number: Scalars['Int']['output'];
  reporter?: Maybe<User>;
  reporterId?: Maybe<Scalars['ID']['output']>;
  startedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  status: ThreadStatus;
  tenantId: Scalars['ID']['output'];
  title: Scalars['String']['output'];
  updatedAt: Scalars['AWSDateTime']['output'];
};


export type ThreadMessagesArgs = {
  cursor?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
};

export type ThreadAttachment = {
  __typename?: 'ThreadAttachment';
  createdAt: Scalars['AWSDateTime']['output'];
  id: Scalars['ID']['output'];
  mimeType?: Maybe<Scalars['String']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  s3Key?: Maybe<Scalars['String']['output']>;
  sizeBytes?: Maybe<Scalars['Int']['output']>;
  tenantId: Scalars['ID']['output'];
  threadId: Scalars['ID']['output'];
  uploadedBy?: Maybe<Scalars['ID']['output']>;
};

export enum ThreadChannel {
  Api = 'API',
  Chat = 'CHAT',
  Email = 'EMAIL',
  Manual = 'MANUAL',
  Schedule = 'SCHEDULE',
  Webhook = 'WEBHOOK'
}

export type ThreadDependency = {
  __typename?: 'ThreadDependency';
  blockedByThread?: Maybe<Thread>;
  blockedByThreadId: Scalars['ID']['output'];
  createdAt: Scalars['AWSDateTime']['output'];
  id: Scalars['ID']['output'];
  tenantId: Scalars['ID']['output'];
  threadId: Scalars['ID']['output'];
};

export type ThreadLabel = {
  __typename?: 'ThreadLabel';
  color?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['AWSDateTime']['output'];
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  tenantId: Scalars['ID']['output'];
};

export type ThreadLabelAssignment = {
  __typename?: 'ThreadLabelAssignment';
  createdAt: Scalars['AWSDateTime']['output'];
  id: Scalars['ID']['output'];
  label?: Maybe<ThreadLabel>;
  labelId: Scalars['ID']['output'];
  tenantId: Scalars['ID']['output'];
  threadId: Scalars['ID']['output'];
};

export enum ThreadLifecycleStatus {
  AwaitingUser = 'AWAITING_USER',
  Cancelled = 'CANCELLED',
  Completed = 'COMPLETED',
  Failed = 'FAILED',
  Idle = 'IDLE',
  Running = 'RUNNING'
}

export enum ThreadStatus {
  Backlog = 'BACKLOG',
  Blocked = 'BLOCKED',
  Cancelled = 'CANCELLED',
  Done = 'DONE',
  InProgress = 'IN_PROGRESS',
  InReview = 'IN_REVIEW',
  Todo = 'TODO'
}

export type ThreadTurn = {
  __typename?: 'ThreadTurn';
  agentId?: Maybe<Scalars['ID']['output']>;
  contextSnapshot?: Maybe<Scalars['AWSJSON']['output']>;
  createdAt: Scalars['AWSDateTime']['output'];
  error?: Maybe<Scalars['String']['output']>;
  errorCode?: Maybe<Scalars['String']['output']>;
  externalRunId?: Maybe<Scalars['String']['output']>;
  finishedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  id: Scalars['ID']['output'];
  invocationSource: Scalars['String']['output'];
  lastActivityAt?: Maybe<Scalars['AWSDateTime']['output']>;
  originTurnId?: Maybe<Scalars['ID']['output']>;
  resultJson?: Maybe<Scalars['AWSJSON']['output']>;
  retryAttempt?: Maybe<Scalars['Int']['output']>;
  routineId?: Maybe<Scalars['ID']['output']>;
  sessionIdAfter?: Maybe<Scalars['String']['output']>;
  sessionIdBefore?: Maybe<Scalars['String']['output']>;
  startedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  status: Scalars['String']['output'];
  tenantId: Scalars['ID']['output'];
  threadId?: Maybe<Scalars['ID']['output']>;
  totalCost?: Maybe<Scalars['Float']['output']>;
  triggerDetail?: Maybe<Scalars['String']['output']>;
  triggerId?: Maybe<Scalars['ID']['output']>;
  triggerName?: Maybe<Scalars['String']['output']>;
  turnNumber?: Maybe<Scalars['Int']['output']>;
  usageJson?: Maybe<Scalars['AWSJSON']['output']>;
  wakeupRequestId?: Maybe<Scalars['ID']['output']>;
};

export type ThreadTurnEvent = {
  __typename?: 'ThreadTurnEvent';
  agentId?: Maybe<Scalars['ID']['output']>;
  color?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['AWSDateTime']['output'];
  eventType: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  level?: Maybe<Scalars['String']['output']>;
  message?: Maybe<Scalars['String']['output']>;
  payload?: Maybe<Scalars['AWSJSON']['output']>;
  runId: Scalars['ID']['output'];
  seq: Scalars['Int']['output'];
  stream?: Maybe<Scalars['String']['output']>;
  tenantId: Scalars['ID']['output'];
};

export type ThreadTurnUpdateEvent = {
  __typename?: 'ThreadTurnUpdateEvent';
  agentId?: Maybe<Scalars['ID']['output']>;
  runId: Scalars['ID']['output'];
  status: Scalars['String']['output'];
  tenantId: Scalars['ID']['output'];
  threadId?: Maybe<Scalars['ID']['output']>;
  triggerId?: Maybe<Scalars['ID']['output']>;
  triggerName?: Maybe<Scalars['String']['output']>;
  updatedAt: Scalars['AWSDateTime']['output'];
};

export type ThreadUpdateEvent = {
  __typename?: 'ThreadUpdateEvent';
  status: Scalars['String']['output'];
  tenantId: Scalars['ID']['output'];
  threadId: Scalars['ID']['output'];
  title: Scalars['String']['output'];
  updatedAt: Scalars['AWSDateTime']['output'];
};

export type ThreadsPage = {
  __typename?: 'ThreadsPage';
  items: Array<Thread>;
  totalCount: Scalars['Int']['output'];
};

export type TraceEvent = {
  __typename?: 'TraceEvent';
  agentId?: Maybe<Scalars['ID']['output']>;
  agentName?: Maybe<Scalars['String']['output']>;
  costUsd?: Maybe<Scalars['Float']['output']>;
  createdAt: Scalars['AWSDateTime']['output'];
  durationMs?: Maybe<Scalars['Int']['output']>;
  estimated?: Maybe<Scalars['Boolean']['output']>;
  inputTokens?: Maybe<Scalars['Int']['output']>;
  model?: Maybe<Scalars['String']['output']>;
  outputTokens?: Maybe<Scalars['Int']['output']>;
  threadId?: Maybe<Scalars['ID']['output']>;
  traceId: Scalars['String']['output'];
};

export type UpdateAgentInput = {
  adapterConfig?: InputMaybe<Scalars['AWSJSON']['input']>;
  adapterType?: InputMaybe<Scalars['String']['input']>;
  avatarUrl?: InputMaybe<Scalars['String']['input']>;
  humanPairId?: InputMaybe<Scalars['ID']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  parentAgentId?: InputMaybe<Scalars['ID']['input']>;
  reportsTo?: InputMaybe<Scalars['ID']['input']>;
  role?: InputMaybe<Scalars['String']['input']>;
  runtimeConfig?: InputMaybe<Scalars['AWSJSON']['input']>;
  systemPrompt?: InputMaybe<Scalars['String']['input']>;
  templateId?: InputMaybe<Scalars['ID']['input']>;
  type?: InputMaybe<AgentType>;
};

export type UpdateAgentTemplateInput = {
  blockedTools?: InputMaybe<Scalars['AWSJSON']['input']>;
  /**
   * Browser Automation opt-in metadata; see AgentTemplate.browser. Pass
   * null to clear; omit to leave unchanged.
   */
  browser?: InputMaybe<Scalars['AWSJSON']['input']>;
  category?: InputMaybe<Scalars['String']['input']>;
  config?: InputMaybe<Scalars['AWSJSON']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  guardrailId?: InputMaybe<Scalars['ID']['input']>;
  icon?: InputMaybe<Scalars['String']['input']>;
  isPublished?: InputMaybe<Scalars['Boolean']['input']>;
  knowledgeBaseIds?: InputMaybe<Scalars['AWSJSON']['input']>;
  model?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  /**
   * Sandbox opt-in metadata; see AgentTemplate.sandbox. Pass null to
   * clear; omit to leave unchanged.
   */
  sandbox?: InputMaybe<Scalars['AWSJSON']['input']>;
  skills?: InputMaybe<Scalars['AWSJSON']['input']>;
  slug?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateArtifactInput = {
  content?: InputMaybe<Scalars['String']['input']>;
  metadata?: InputMaybe<Scalars['AWSJSON']['input']>;
  s3Key?: InputMaybe<Scalars['String']['input']>;
  status?: InputMaybe<ArtifactStatus>;
  summary?: InputMaybe<Scalars['String']['input']>;
  title?: InputMaybe<Scalars['String']['input']>;
  type?: InputMaybe<ArtifactType>;
};

export type UpdateEvalTestCaseInput = {
  agentTemplateId?: InputMaybe<Scalars['ID']['input']>;
  agentcoreEvaluatorIds?: InputMaybe<Array<Scalars['String']['input']>>;
  assertions?: InputMaybe<Array<EvalAssertionInput>>;
  category?: InputMaybe<Scalars['String']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  query?: InputMaybe<Scalars['String']['input']>;
  systemPrompt?: InputMaybe<Scalars['String']['input']>;
  tags?: InputMaybe<Array<Scalars['String']['input']>>;
};

export type UpdateKnowledgeBaseInput = {
  description?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateQuickActionInput = {
  prompt?: InputMaybe<Scalars['String']['input']>;
  scope?: InputMaybe<QuickActionScope>;
  sortOrder?: InputMaybe<Scalars['Int']['input']>;
  title?: InputMaybe<Scalars['String']['input']>;
  workspaceAgentId?: InputMaybe<Scalars['ID']['input']>;
};

export type UpdateRecipeInput = {
  params?: InputMaybe<Scalars['AWSJSON']['input']>;
  summary?: InputMaybe<Scalars['String']['input']>;
  templates?: InputMaybe<Scalars['AWSJSON']['input']>;
  title?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateRoutineInput = {
  agentId?: InputMaybe<Scalars['ID']['input']>;
  config?: InputMaybe<Scalars['AWSJSON']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  schedule?: InputMaybe<Scalars['String']['input']>;
  status?: InputMaybe<Scalars['String']['input']>;
  teamId?: InputMaybe<Scalars['ID']['input']>;
  type?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateTeamInput = {
  budgetMonthlyCents?: InputMaybe<Scalars['Int']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  metadata?: InputMaybe<Scalars['AWSJSON']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  status?: InputMaybe<Scalars['String']['input']>;
  type?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateTenantInput = {
  /**
   * Optional client-supplied idempotency key. When provided, a retry with
   * the same key returns the prior call's result without re-executing.
   * Null/absent = server derives a key from canonicalized inputs.
   * See packages/api/src/lib/idempotency.ts.
   */
  idempotencyKey?: InputMaybe<Scalars['String']['input']>;
  issuePrefix?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  plan?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateTenantMemberInput = {
  /** Optional idempotency key. See UpdateTenantInput.idempotencyKey. */
  idempotencyKey?: InputMaybe<Scalars['String']['input']>;
  role?: InputMaybe<Scalars['String']['input']>;
  status?: InputMaybe<Scalars['String']['input']>;
};

/**
 * Platform-operator-only input for sandbox + compliance-tier policy changes
 * (plan Unit 6). Separate from UpdateTenantInput because these fields shift
 * the tenant's security boundary and are audited in tenant_policy_events.
 * Caller must be in the THINKWORK_PLATFORM_OPERATOR_EMAILS allowlist on the
 * graphql-http Lambda.
 */
export type UpdateTenantPolicyInput = {
  /** Compliance tier: 'standard' | 'regulated' | 'hipaa'. Non-standard coerces sandboxEnabled = false. */
  complianceTier?: InputMaybe<Scalars['String']['input']>;
  /** Sandbox kill switch. Setting true while complianceTier != 'standard' is rejected. */
  sandboxEnabled?: InputMaybe<Scalars['Boolean']['input']>;
};

export type UpdateTenantSettingsInput = {
  autoCloseThreadMinutes?: InputMaybe<Scalars['Int']['input']>;
  budgetMonthlyCents?: InputMaybe<Scalars['Int']['input']>;
  defaultModel?: InputMaybe<Scalars['String']['input']>;
  features?: InputMaybe<Scalars['AWSJSON']['input']>;
  maxAgents?: InputMaybe<Scalars['Int']['input']>;
};

export type UpdateThreadInput = {
  archivedAt?: InputMaybe<Scalars['AWSDateTime']['input']>;
  assigneeId?: InputMaybe<Scalars['ID']['input']>;
  assigneeType?: InputMaybe<Scalars['String']['input']>;
  billingCode?: InputMaybe<Scalars['String']['input']>;
  channel?: InputMaybe<ThreadChannel>;
  dueAt?: InputMaybe<Scalars['AWSDateTime']['input']>;
  labels?: InputMaybe<Scalars['AWSJSON']['input']>;
  lastReadAt?: InputMaybe<Scalars['AWSDateTime']['input']>;
  metadata?: InputMaybe<Scalars['AWSJSON']['input']>;
  status?: InputMaybe<ThreadStatus>;
  title?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateThreadLabelInput = {
  color?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateUserInput = {
  image?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  phone?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateUserProfileInput = {
  /** Short/preferred name the agent should use in chat. Set via admin UI or agent self-serve tool. */
  callBy?: InputMaybe<Scalars['String']['input']>;
  /** Free-form markdown capturing ongoing context about the human. */
  context?: InputMaybe<Scalars['String']['input']>;
  displayName?: InputMaybe<Scalars['String']['input']>;
  /** Free-form markdown describing the human's family / close contacts. */
  family?: InputMaybe<Scalars['String']['input']>;
  /** Free-form notes about the human's preferences + communication style. */
  notes?: InputMaybe<Scalars['String']['input']>;
  notificationPreferences?: InputMaybe<Scalars['AWSJSON']['input']>;
  pronouns?: InputMaybe<Scalars['String']['input']>;
  theme?: InputMaybe<Scalars['String']['input']>;
  timezone?: InputMaybe<Scalars['String']['input']>;
  title?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateWebhookInput = {
  agentId?: InputMaybe<Scalars['ID']['input']>;
  config?: InputMaybe<Scalars['AWSJSON']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  prompt?: InputMaybe<Scalars['String']['input']>;
  rateLimit?: InputMaybe<Scalars['Int']['input']>;
  routineId?: InputMaybe<Scalars['ID']['input']>;
  targetType?: InputMaybe<Scalars['String']['input']>;
};

export type UpsertBudgetPolicyInput = {
  actionOnExceed?: InputMaybe<Scalars['String']['input']>;
  agentId?: InputMaybe<Scalars['ID']['input']>;
  limitUsd: Scalars['Float']['input'];
  period?: InputMaybe<Scalars['String']['input']>;
  scope: Scalars['String']['input'];
};

export type User = {
  __typename?: 'User';
  createdAt: Scalars['AWSDateTime']['output'];
  email: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  image?: Maybe<Scalars['String']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  phone?: Maybe<Scalars['String']['output']>;
  profile?: Maybe<UserProfile>;
  tenantId: Scalars['ID']['output'];
  updatedAt: Scalars['AWSDateTime']['output'];
};

export type UserProfile = {
  __typename?: 'UserProfile';
  /** Short/preferred name — what the agent should call this human in chat. */
  callBy?: Maybe<Scalars['String']['output']>;
  /** Free-form markdown capturing ongoing context about the human. */
  context?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['AWSDateTime']['output'];
  displayName?: Maybe<Scalars['String']['output']>;
  /** Free-form markdown describing the human's family / close contacts. */
  family?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  /** Free-form notes the agent maintains about this human's preferences + style. */
  notes?: Maybe<Scalars['String']['output']>;
  notificationPreferences?: Maybe<Scalars['AWSJSON']['output']>;
  pronouns?: Maybe<Scalars['String']['output']>;
  tenantId: Scalars['ID']['output'];
  theme?: Maybe<Scalars['String']['output']>;
  timezone?: Maybe<Scalars['String']['output']>;
  title?: Maybe<Scalars['String']['output']>;
  updatedAt: Scalars['AWSDateTime']['output'];
  userId: Scalars['ID']['output'];
};

export type UserQuickAction = {
  __typename?: 'UserQuickAction';
  createdAt: Scalars['AWSDateTime']['output'];
  id: Scalars['ID']['output'];
  prompt: Scalars['String']['output'];
  scope: QuickActionScope;
  sortOrder: Scalars['Int']['output'];
  tenantId: Scalars['ID']['output'];
  title: Scalars['String']['output'];
  updatedAt: Scalars['AWSDateTime']['output'];
  userId: Scalars['ID']['output'];
  workspaceAgentId?: Maybe<Scalars['ID']['output']>;
};

export enum WakeupRequestStatus {
  Cancelled = 'CANCELLED',
  Claimed = 'CLAIMED',
  Coalesced = 'COALESCED',
  Completed = 'COMPLETED',
  Failed = 'FAILED',
  Queued = 'QUEUED',
  Skipped = 'SKIPPED'
}

export type Webhook = {
  __typename?: 'Webhook';
  agentId?: Maybe<Scalars['ID']['output']>;
  config?: Maybe<Scalars['AWSJSON']['output']>;
  createdAt: Scalars['AWSDateTime']['output'];
  createdById?: Maybe<Scalars['String']['output']>;
  createdByType?: Maybe<Scalars['String']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  enabled: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  invocationCount: Scalars['Int']['output'];
  lastInvokedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  name: Scalars['String']['output'];
  prompt?: Maybe<Scalars['String']['output']>;
  rateLimit?: Maybe<Scalars['Int']['output']>;
  routineId?: Maybe<Scalars['ID']['output']>;
  targetType: Scalars['String']['output'];
  tenantId: Scalars['ID']['output'];
  token: Scalars['String']['output'];
  updatedAt: Scalars['AWSDateTime']['output'];
};

export type WikiCompileJob = {
  __typename?: 'WikiCompileJob';
  attempt: Scalars['Int']['output'];
  claimedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  createdAt: Scalars['AWSDateTime']['output'];
  dedupeKey: Scalars['String']['output'];
  error?: Maybe<Scalars['String']['output']>;
  finishedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  id: Scalars['ID']['output'];
  metrics?: Maybe<Scalars['AWSJSON']['output']>;
  ownerId: Scalars['ID']['output'];
  startedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  status: Scalars['String']['output'];
  tenantId: Scalars['ID']['output'];
  trigger: Scalars['String']['output'];
};

export type WikiGraph = {
  __typename?: 'WikiGraph';
  edges: Array<WikiGraphEdge>;
  nodes: Array<WikiGraphNode>;
};

export type WikiGraphEdge = {
  __typename?: 'WikiGraphEdge';
  label: Scalars['String']['output'];
  source: Scalars['ID']['output'];
  target: Scalars['ID']['output'];
  weight: Scalars['Float']['output'];
};

/**
 * Agent-scoped force-graph payload: all active pages and their [[...]] links
 * for one `(tenant, owner)` scope. Shaped to match the legacy `memoryGraph`
 * wire contract so the admin force-graph component can swap data sources
 * with minimal client changes. `type` is always `"page"` on nodes; the
 * Wiki page type (`ENTITY`/`TOPIC`/`DECISION`) lives in `entityType`.
 */
export type WikiGraphNode = {
  __typename?: 'WikiGraphNode';
  edgeCount: Scalars['Int']['output'];
  entityType: WikiPageType;
  id: Scalars['ID']['output'];
  label: Scalars['String']['output'];
  latestThreadId?: Maybe<Scalars['String']['output']>;
  slug: Scalars['String']['output'];
  strategy?: Maybe<Scalars['String']['output']>;
  type: Scalars['String']['output'];
};

/**
 * Dispatch acknowledgement for `bootstrapJournalImport`. The actual ingest
 * runs on a dedicated worker Lambda (`wiki-bootstrap-import`) because
 * Hindsight's LLM-backed retain is too slow to complete within API Gateway's
 * 30-second HTTP ceiling. Operator watches CloudWatch + wiki_compile_jobs
 * for the terminal compile the ingest enqueues.
 */
export type WikiJournalImportDispatch = {
  __typename?: 'WikiJournalImportDispatch';
  accountId: Scalars['ID']['output'];
  agentId: Scalars['ID']['output'];
  dispatched: Scalars['Boolean']['output'];
  dispatchedAt: Scalars['AWSDateTime']['output'];
  error?: Maybe<Scalars['String']['output']>;
  tenantId: Scalars['ID']['output'];
};

export type WikiPage = {
  __typename?: 'WikiPage';
  aliases: Array<Scalars['String']['output']>;
  bodyMd?: Maybe<Scalars['String']['output']>;
  /**
   * Pages that were promoted out of this page's sections — the reverse of
   * `parent`. Empty for pages that have never had a child promoted.
   */
  children: Array<WikiPage>;
  createdAt: Scalars['AWSDateTime']['output'];
  id: Scalars['ID']['output'];
  lastCompiledAt?: Maybe<Scalars['AWSDateTime']['output']>;
  ownerId: Scalars['ID']['output'];
  /**
   * Parent hub when this page was promoted from a section on another page.
   * Null for top-level pages. Reads `wiki_pages.parent_page_id`.
   */
  parent?: Maybe<WikiPage>;
  /**
   * If this page was promoted out of a section on a parent page, the section
   * it came from. Null when this page is top-level or the parent section has
   * since been archived.
   */
  promotedFromSection?: Maybe<WikiPromotedFromSection>;
  /**
   * Active pages rolled up into this page's named section — the denormalized
   * aggregation view (`aggregation.linked_page_ids` on the section jsonb).
   * Empty when the section doesn't exist or carries no aggregation metadata.
   */
  sectionChildren: Array<WikiPage>;
  sections: Array<WikiPageSection>;
  slug: Scalars['String']['output'];
  /**
   * Distinct memory_units (Hindsight records) that source at least one section
   * on this page. Counts through `wiki_section_sources`. Hit on detail screens
   * only — list screens must NOT request this (N+1 risk).
   */
  sourceMemoryCount: Scalars['Int']['output'];
  /**
   * Up to `limit` memory_unit ids that source sections on this page, ordered
   * by most recently-cited. Server-side capped at 50. Pairs with
   * `MemoryRecord` drill-in so a page's "Based on N memories" badge can
   * resolve to the actual records.
   */
  sourceMemoryIds: Array<Scalars['ID']['output']>;
  status: Scalars['String']['output'];
  summary?: Maybe<Scalars['String']['output']>;
  tenantId: Scalars['ID']['output'];
  title: Scalars['String']['output'];
  type: WikiPageType;
  updatedAt: Scalars['AWSDateTime']['output'];
};


export type WikiPageSectionChildrenArgs = {
  sectionSlug: Scalars['String']['input'];
};


export type WikiPageSourceMemoryIdsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
};

export type WikiPageSection = {
  __typename?: 'WikiPageSection';
  bodyMd: Scalars['String']['output'];
  heading: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  lastSourceAt?: Maybe<Scalars['AWSDateTime']['output']>;
  position: Scalars['Int']['output'];
  sectionSlug: Scalars['String']['output'];
};

/**
 * Compounding Memory (wiki) read path.
 *
 * v1 is strictly agent-scoped: every read requires both `tenantId` and
 * `ownerId`. See .prds/compounding-memory-scoping.md.
 */
export enum WikiPageType {
  Decision = 'DECISION',
  Entity = 'ENTITY',
  Topic = 'TOPIC'
}

/**
 * Provenance linkage between a promoted page and the section it was derived
 * from. Populated only for pages whose `parent_page_id` is set AND whose
 * parent has a section in which `aggregation.promoted_page_id` points back.
 */
export type WikiPromotedFromSection = {
  __typename?: 'WikiPromotedFromSection';
  parentPage: WikiPage;
  sectionHeading: Scalars['String']['output'];
  sectionSlug: Scalars['String']['output'];
};

export type WikiResetCursorResult = {
  __typename?: 'WikiResetCursorResult';
  cursorCleared: Scalars['Boolean']['output'];
  ownerId: Scalars['ID']['output'];
  pagesArchived: Scalars['Int']['output'];
  tenantId: Scalars['ID']['output'];
};

export type WikiSearchResult = {
  __typename?: 'WikiSearchResult';
  matchedAlias?: Maybe<Scalars['String']['output']>;
  page: WikiPage;
  score: Scalars['Float']['output'];
};

export type TenantUsersForFormPickerQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
}>;


export type TenantUsersForFormPickerQuery = { __typename?: 'Query', tenantMembers: Array<{ __typename?: 'TenantMember', principalType: string, principalId: string, user?: { __typename?: 'User', id: string, email: string, name?: string | null } | null }> };

export type AgentsQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
  status?: InputMaybe<AgentStatus>;
  type?: InputMaybe<AgentType>;
}>;


export type AgentsQuery = { __typename?: 'Query', agents: Array<{ __typename?: 'Agent', id: string, tenantId: string, name: string, role?: string | null, type: AgentType, status: AgentStatus, templateId: string, systemPrompt?: string | null, adapterType?: string | null, adapterConfig?: any | null, runtimeConfig?: any | null, lastHeartbeatAt?: any | null, avatarUrl?: string | null, reportsToId?: string | null, humanPairId?: string | null, version: number, createdAt: any, updatedAt: any }> };

export type AgentQueryVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type AgentQuery = { __typename?: 'Query', agent?: { __typename?: 'Agent', id: string, tenantId: string, name: string, slug?: string | null, role?: string | null, type: AgentType, status: AgentStatus, templateId: string, systemPrompt?: string | null, adapterType?: string | null, adapterConfig?: any | null, runtimeConfig?: any | null, lastHeartbeatAt?: any | null, avatarUrl?: string | null, reportsToId?: string | null, humanPairId?: string | null, version: number, createdAt: any, updatedAt: any, capabilities: Array<{ __typename?: 'AgentCapability', id: string, capability: string, config?: any | null, enabled: boolean }>, skills: Array<{ __typename?: 'AgentSkill', id: string, skillId: string, config?: any | null, permissions?: any | null, rateLimitRpm?: number | null, enabled: boolean }>, budgetPolicy?: { __typename?: 'AgentBudgetPolicy', id: string, period: string, limitUsd: number, actionOnExceed: string } | null } | null };

export type CreateAgentMutationVariables = Exact<{
  input: CreateAgentInput;
}>;


export type CreateAgentMutation = { __typename?: 'Mutation', createAgent: { __typename?: 'Agent', id: string, tenantId: string, name: string, type: AgentType, status: AgentStatus, createdAt: any } };

export type UpdateAgentMutationVariables = Exact<{
  id: Scalars['ID']['input'];
  input: UpdateAgentInput;
}>;


export type UpdateAgentMutation = { __typename?: 'Mutation', updateAgent: { __typename?: 'Agent', id: string, name: string, role?: string | null, type: AgentType, status: AgentStatus, templateId: string, systemPrompt?: string | null, updatedAt: any } };

export type DeleteAgentMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type DeleteAgentMutation = { __typename?: 'Mutation', deleteAgent: boolean };

export type UpdateAgentStatusMutationVariables = Exact<{
  id: Scalars['ID']['input'];
  status: AgentStatus;
}>;


export type UpdateAgentStatusMutation = { __typename?: 'Mutation', updateAgentStatus: { __typename?: 'Agent', id: string, status: AgentStatus, lastHeartbeatAt?: any | null, updatedAt: any } };

export type SetAgentCapabilitiesMutationVariables = Exact<{
  agentId: Scalars['ID']['input'];
  capabilities: Array<AgentCapabilityInput> | AgentCapabilityInput;
}>;


export type SetAgentCapabilitiesMutation = { __typename?: 'Mutation', setAgentCapabilities: Array<{ __typename?: 'AgentCapability', id: string, capability: string, config?: any | null, enabled: boolean }> };

export type SetAgentSkillsMutationVariables = Exact<{
  agentId: Scalars['ID']['input'];
  skills: Array<AgentSkillInput> | AgentSkillInput;
}>;


export type SetAgentSkillsMutation = { __typename?: 'Mutation', setAgentSkills: Array<{ __typename?: 'AgentSkill', id: string, skillId: string, config?: any | null, enabled: boolean }> };

export type SetAgentBudgetPolicyMutationVariables = Exact<{
  agentId: Scalars['ID']['input'];
  input: AgentBudgetPolicyInput;
}>;


export type SetAgentBudgetPolicyMutation = { __typename?: 'Mutation', setAgentBudgetPolicy: { __typename?: 'AgentBudgetPolicy', id: string, period: string, limitUsd: number, actionOnExceed: string } };

export type SendMessageMutationVariables = Exact<{
  input: SendMessageInput;
}>;


export type SendMessageMutation = { __typename?: 'Mutation', sendMessage: { __typename?: 'Message', id: string, threadId: string, tenantId: string, role: MessageRole, content?: string | null, senderType?: string | null, senderId?: string | null, createdAt: any } };

export type DeleteMessageMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type DeleteMessageMutation = { __typename?: 'Mutation', deleteMessage: boolean };

export type MessagesQueryVariables = Exact<{
  threadId: Scalars['ID']['input'];
  limit?: InputMaybe<Scalars['Int']['input']>;
  cursor?: InputMaybe<Scalars['String']['input']>;
}>;


export type MessagesQuery = { __typename?: 'Query', messages: { __typename?: 'MessageConnection', edges: Array<{ __typename?: 'MessageEdge', cursor: string, node: { __typename?: 'Message', id: string, threadId: string, tenantId: string, role: MessageRole, content?: string | null, senderType?: string | null, senderId?: string | null, toolCalls?: any | null, toolResults?: any | null, metadata?: any | null, tokenCount?: number | null, createdAt: any, durableArtifact?: { __typename?: 'Artifact', id: string, title: string, type: ArtifactType, status: ArtifactStatus, content?: string | null, summary?: string | null } | null } }>, pageInfo: { __typename?: 'PageInfo', hasNextPage: boolean, endCursor?: string | null } } };

export type TeamsQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
}>;


export type TeamsQuery = { __typename?: 'Query', teams: Array<{ __typename?: 'Team', id: string, tenantId: string, name: string, description?: string | null, type: string, status: string, budgetMonthlyCents?: number | null, metadata?: any | null, createdAt: any, updatedAt: any }> };

export type TeamQueryVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type TeamQuery = { __typename?: 'Query', team?: { __typename?: 'Team', id: string, tenantId: string, name: string, description?: string | null, type: string, status: string, budgetMonthlyCents?: number | null, metadata?: any | null, createdAt: any, updatedAt: any, agents: Array<{ __typename?: 'TeamAgent', id: string, agentId: string, role: string, joinedAt?: any | null, agent?: { __typename?: 'Agent', id: string, name: string, type: AgentType, status: AgentStatus, avatarUrl?: string | null } | null }>, users: Array<{ __typename?: 'TeamUser', id: string, userId: string, role: string, joinedAt?: any | null, user?: { __typename?: 'User', id: string, name?: string | null, email: string, image?: string | null } | null }> } | null };

export type CreateTeamMutationVariables = Exact<{
  input: CreateTeamInput;
}>;


export type CreateTeamMutation = { __typename?: 'Mutation', createTeam: { __typename?: 'Team', id: string, tenantId: string, name: string, type: string, status: string, createdAt: any } };

export type UpdateTeamMutationVariables = Exact<{
  id: Scalars['ID']['input'];
  input: UpdateTeamInput;
}>;


export type UpdateTeamMutation = { __typename?: 'Mutation', updateTeam: { __typename?: 'Team', id: string, name: string, description?: string | null, status: string, updatedAt: any } };

export type DeleteTeamMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type DeleteTeamMutation = { __typename?: 'Mutation', deleteTeam: boolean };

export type AddTeamAgentMutationVariables = Exact<{
  teamId: Scalars['ID']['input'];
  input: AddTeamAgentInput;
}>;


export type AddTeamAgentMutation = { __typename?: 'Mutation', addTeamAgent: { __typename?: 'TeamAgent', id: string, teamId: string, agentId: string, role: string, joinedAt?: any | null } };

export type RemoveTeamAgentMutationVariables = Exact<{
  teamId: Scalars['ID']['input'];
  agentId: Scalars['ID']['input'];
}>;


export type RemoveTeamAgentMutation = { __typename?: 'Mutation', removeTeamAgent: boolean };

export type AddTeamUserMutationVariables = Exact<{
  teamId: Scalars['ID']['input'];
  input: AddTeamUserInput;
}>;


export type AddTeamUserMutation = { __typename?: 'Mutation', addTeamUser: { __typename?: 'TeamUser', id: string, teamId: string, userId: string, role: string, joinedAt?: any | null } };

export type RemoveTeamUserMutationVariables = Exact<{
  teamId: Scalars['ID']['input'];
  userId: Scalars['ID']['input'];
}>;


export type RemoveTeamUserMutation = { __typename?: 'Mutation', removeTeamUser: boolean };

export type RoutinesQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
  teamId?: InputMaybe<Scalars['ID']['input']>;
  agentId?: InputMaybe<Scalars['ID']['input']>;
  status?: InputMaybe<RoutineStatus>;
}>;


export type RoutinesQuery = { __typename?: 'Query', routines: Array<{ __typename?: 'Routine', id: string, tenantId: string, teamId?: string | null, agentId?: string | null, name: string, description?: string | null, type: string, status: string, schedule?: string | null, config?: any | null, lastRunAt?: any | null, nextRunAt?: any | null, createdAt: any, updatedAt: any }> };

export type RoutineQueryVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type RoutineQuery = { __typename?: 'Query', routine?: { __typename?: 'Routine', id: string, tenantId: string, teamId?: string | null, agentId?: string | null, name: string, description?: string | null, type: string, status: string, schedule?: string | null, config?: any | null, lastRunAt?: any | null, nextRunAt?: any | null, createdAt: any, updatedAt: any, triggers: Array<{ __typename?: 'RoutineTrigger', id: string, triggerType: string, config?: any | null, enabled: boolean }> } | null };

export type RoutineRunsQueryVariables = Exact<{
  routineId: Scalars['ID']['input'];
  limit?: InputMaybe<Scalars['Int']['input']>;
  cursor?: InputMaybe<Scalars['String']['input']>;
}>;


export type RoutineRunsQuery = { __typename?: 'Query', routineRuns: Array<{ __typename?: 'RoutineRun', id: string, routineId: string, status: string, startedAt?: any | null, completedAt?: any | null, error?: string | null, metadata?: any | null, createdAt: any }> };

export type RoutineRunDetailQueryVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type RoutineRunDetailQuery = { __typename?: 'Query', routineRun?: { __typename?: 'RoutineRun', id: string, routineId: string, status: string, startedAt?: any | null, completedAt?: any | null, error?: string | null, metadata?: any | null, createdAt: any, steps: Array<{ __typename?: 'RoutineStep', id: string, stepIndex: number, name: string, status: string, input?: any | null, output?: any | null, startedAt?: any | null, completedAt?: any | null, error?: string | null }> } | null };

export type CreateRoutineMutationVariables = Exact<{
  input: CreateRoutineInput;
}>;


export type CreateRoutineMutation = { __typename?: 'Mutation', createRoutine: { __typename?: 'Routine', id: string, tenantId: string, name: string, type: string, status: string, createdAt: any } };

export type UpdateRoutineMutationVariables = Exact<{
  id: Scalars['ID']['input'];
  input: UpdateRoutineInput;
}>;


export type UpdateRoutineMutation = { __typename?: 'Mutation', updateRoutine: { __typename?: 'Routine', id: string, name: string, description?: string | null, status: string, schedule?: string | null, updatedAt: any } };

export type DeleteRoutineMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type DeleteRoutineMutation = { __typename?: 'Mutation', deleteRoutine: boolean };

export type TriggerRoutineRunMutationVariables = Exact<{
  routineId: Scalars['ID']['input'];
}>;


export type TriggerRoutineRunMutation = { __typename?: 'Mutation', triggerRoutineRun: { __typename?: 'RoutineRun', id: string, routineId: string, status: string, createdAt: any } };

export type SetRoutineTriggerMutationVariables = Exact<{
  routineId: Scalars['ID']['input'];
  input: RoutineTriggerInput;
}>;


export type SetRoutineTriggerMutation = { __typename?: 'Mutation', setRoutineTrigger: { __typename?: 'RoutineTrigger', id: string, triggerType: string, config?: any | null, enabled: boolean } };

export type DeleteRoutineTriggerMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type DeleteRoutineTriggerMutation = { __typename?: 'Mutation', deleteRoutineTrigger: boolean };

export type ThreadTurnsQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
  agentId?: InputMaybe<Scalars['ID']['input']>;
  status?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
}>;


export type ThreadTurnsQuery = { __typename?: 'Query', threadTurns: Array<{ __typename?: 'ThreadTurn', id: string, tenantId: string, triggerId?: string | null, agentId?: string | null, routineId?: string | null, invocationSource: string, triggerDetail?: string | null, status: string, startedAt?: any | null, finishedAt?: any | null, error?: string | null, errorCode?: string | null, usageJson?: any | null, resultJson?: any | null, createdAt: any }> };

export type ThreadTurnDetailQueryVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type ThreadTurnDetailQuery = { __typename?: 'Query', threadTurn?: { __typename?: 'ThreadTurn', id: string, tenantId: string, triggerId?: string | null, agentId?: string | null, routineId?: string | null, invocationSource: string, triggerDetail?: string | null, wakeupRequestId?: string | null, status: string, startedAt?: any | null, finishedAt?: any | null, error?: string | null, errorCode?: string | null, usageJson?: any | null, resultJson?: any | null, sessionIdBefore?: string | null, sessionIdAfter?: string | null, externalRunId?: string | null, contextSnapshot?: any | null, createdAt: any } | null };

export type ThreadTurnEventsQueryVariables = Exact<{
  runId: Scalars['ID']['input'];
  afterSeq?: InputMaybe<Scalars['Int']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
}>;


export type ThreadTurnEventsQuery = { __typename?: 'Query', threadTurnEvents: Array<{ __typename?: 'ThreadTurnEvent', id: string, runId: string, agentId?: string | null, seq: number, eventType: string, stream?: string | null, level?: string | null, color?: string | null, message?: string | null, payload?: any | null, createdAt: any }> };

export type TurnInvocationLogsQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
  turnId: Scalars['ID']['input'];
}>;


export type TurnInvocationLogsQuery = { __typename?: 'Query', turnInvocationLogs: Array<{ __typename?: 'ModelInvocation', requestId: string, modelId: string, timestamp: any, inputTokenCount: number, outputTokenCount: number, cacheReadTokenCount: number, inputPreview?: string | null, outputPreview?: string | null, toolCount?: number | null, costUsd?: number | null, toolUses?: Array<string> | null, hasToolResult?: boolean | null, branch?: string | null }> };

export type CancelThreadTurnMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type CancelThreadTurnMutation = { __typename?: 'Mutation', cancelThreadTurn: { __typename?: 'ThreadTurn', id: string, status: string, finishedAt?: any | null } };

export type CreateWakeupRequestMutationVariables = Exact<{
  input: CreateWakeupRequestInput;
}>;


export type CreateWakeupRequestMutation = { __typename?: 'Mutation', createWakeupRequest: { __typename?: 'AgentWakeupRequest', id: string, tenantId: string, agentId: string, source: string, status: string, createdAt: any } };

export type ScheduledJobsQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
  agentId?: InputMaybe<Scalars['ID']['input']>;
  routineId?: InputMaybe<Scalars['ID']['input']>;
  triggerType?: InputMaybe<Scalars['String']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
}>;


export type ScheduledJobsQuery = { __typename?: 'Query', scheduledJobs: Array<{ __typename?: 'ScheduledJob', id: string, tenantId: string, triggerType: string, agentId?: string | null, routineId?: string | null, teamId?: string | null, name: string, description?: string | null, scheduleType?: string | null, scheduleExpression?: string | null, timezone: string, enabled: boolean, lastRunAt?: any | null, nextRunAt?: any | null, createdAt: any, updatedAt: any }> };

export type TenantQueryVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type TenantQuery = { __typename?: 'Query', tenant?: { __typename?: 'Tenant', id: string, name: string, slug: string, plan: string, issuePrefix?: string | null, issueCounter: number, createdAt: any, updatedAt: any } | null };

export type TenantBySlugQueryVariables = Exact<{
  slug: Scalars['String']['input'];
}>;


export type TenantBySlugQuery = { __typename?: 'Query', tenantBySlug?: { __typename?: 'Tenant', id: string, name: string, slug: string, plan: string, issuePrefix?: string | null, issueCounter: number, createdAt: any, updatedAt: any } | null };

export type TenantMembersQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
}>;


export type TenantMembersQuery = { __typename?: 'Query', tenantMembers: Array<{ __typename?: 'TenantMember', id: string, tenantId: string, principalType: string, principalId: string, role: string, status: string, createdAt: any, updatedAt: any }> };

export type UpdateTenantMutationVariables = Exact<{
  id: Scalars['ID']['input'];
  input: UpdateTenantInput;
}>;


export type UpdateTenantMutation = { __typename?: 'Mutation', updateTenant: { __typename?: 'Tenant', id: string, name: string, plan: string, issuePrefix?: string | null, updatedAt: any } };

export type UpdateTenantSettingsMutationVariables = Exact<{
  tenantId: Scalars['ID']['input'];
  input: UpdateTenantSettingsInput;
}>;


export type UpdateTenantSettingsMutation = { __typename?: 'Mutation', updateTenantSettings: { __typename?: 'TenantSettings', id: string, defaultModel?: string | null, budgetMonthlyCents?: number | null, autoCloseThreadMinutes?: number | null, maxAgents?: number | null, features?: any | null, updatedAt: any } };

export type AddTenantMemberMutationVariables = Exact<{
  tenantId: Scalars['ID']['input'];
  input: AddTenantMemberInput;
}>;


export type AddTenantMemberMutation = { __typename?: 'Mutation', addTenantMember: { __typename?: 'TenantMember', id: string, principalType: string, principalId: string, role: string, status: string } };

export type RemoveTenantMemberMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type RemoveTenantMemberMutation = { __typename?: 'Mutation', removeTenantMember: boolean };

export type MeQueryVariables = Exact<{ [key: string]: never; }>;


export type MeQuery = { __typename?: 'Query', me?: { __typename?: 'User', id: string, tenantId: string, email: string, name?: string | null, image?: string | null, phone?: string | null, createdAt: any, updatedAt: any } | null };

export type UserQueryVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type UserQuery = { __typename?: 'Query', user?: { __typename?: 'User', id: string, tenantId: string, email: string, name?: string | null, image?: string | null, phone?: string | null, createdAt: any, updatedAt: any } | null };

export type UpdateUserMutationVariables = Exact<{
  id: Scalars['ID']['input'];
  input: UpdateUserInput;
}>;


export type UpdateUserMutation = { __typename?: 'Mutation', updateUser: { __typename?: 'User', id: string, name?: string | null, image?: string | null, phone?: string | null, updatedAt: any } };

export type UpdateUserProfileMutationVariables = Exact<{
  userId: Scalars['ID']['input'];
  input: UpdateUserProfileInput;
}>;


export type UpdateUserProfileMutation = { __typename?: 'Mutation', updateUserProfile: { __typename?: 'UserProfile', id: string, displayName?: string | null, theme?: string | null, notificationPreferences?: any | null, updatedAt: any } };

export type ThreadsQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
  channel?: InputMaybe<ThreadChannel>;
  agentId?: InputMaybe<Scalars['ID']['input']>;
  assigneeId?: InputMaybe<Scalars['ID']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  cursor?: InputMaybe<Scalars['String']['input']>;
}>;


export type ThreadsQuery = { __typename?: 'Query', threads: Array<{ __typename?: 'Thread', id: string, tenantId: string, agentId?: string | null, number: number, identifier?: string | null, title: string, status: ThreadStatus, lifecycleStatus?: ThreadLifecycleStatus | null, channel: ThreadChannel, assigneeType?: string | null, assigneeId?: string | null, reporterId?: string | null, labels?: any | null, metadata?: any | null, dueAt?: any | null, closedAt?: any | null, archivedAt?: any | null, lastActivityAt?: any | null, lastTurnCompletedAt?: any | null, lastReadAt?: any | null, lastResponsePreview?: string | null, createdAt: any, updatedAt: any, assignee?: { __typename?: 'User', id: string, name?: string | null } | null }> };

export type ThreadQueryVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type ThreadQuery = { __typename?: 'Query', thread?: { __typename?: 'Thread', id: string, tenantId: string, agentId?: string | null, number: number, identifier?: string | null, title: string, status: ThreadStatus, lifecycleStatus?: ThreadLifecycleStatus | null, channel: ThreadChannel, assigneeType?: string | null, assigneeId?: string | null, reporterId?: string | null, labels?: any | null, metadata?: any | null, dueAt?: any | null, closedAt?: any | null, createdAt: any, updatedAt: any, messages: { __typename?: 'MessageConnection', edges: Array<{ __typename?: 'MessageEdge', node: { __typename?: 'Message', id: string, role: MessageRole, content?: string | null, senderType?: string | null, senderId?: string | null, createdAt: any, durableArtifact?: { __typename?: 'Artifact', id: string, title: string, type: ArtifactType, status: ArtifactStatus } | null } }> }, attachments: Array<{ __typename?: 'ThreadAttachment', id: string, name?: string | null, s3Key?: string | null, mimeType?: string | null, sizeBytes?: number | null, createdAt: any }> } | null };

export type CreateThreadMutationVariables = Exact<{
  input: CreateThreadInput;
}>;


export type CreateThreadMutation = { __typename?: 'Mutation', createThread: { __typename?: 'Thread', id: string, number: number, title: string, status: ThreadStatus, createdAt: any } };

export type UpdateThreadMutationVariables = Exact<{
  id: Scalars['ID']['input'];
  input: UpdateThreadInput;
}>;


export type UpdateThreadMutation = { __typename?: 'Mutation', updateThread: { __typename?: 'Thread', id: string, title: string, status: ThreadStatus, updatedAt: any } };

export type OnAgentStatusChangedSubscriptionVariables = Exact<{
  tenantId: Scalars['ID']['input'];
}>;


export type OnAgentStatusChangedSubscription = { __typename?: 'Subscription', onAgentStatusChanged?: { __typename?: 'AgentStatusEvent', agentId: string, tenantId: string, status: string, name: string, updatedAt: any } | null };

export type OnNewMessageSubscriptionVariables = Exact<{
  threadId: Scalars['ID']['input'];
}>;


export type OnNewMessageSubscription = { __typename?: 'Subscription', onNewMessage?: { __typename?: 'NewMessageEvent', messageId: string, threadId: string, tenantId: string, role: string, content?: string | null, senderType?: string | null, senderId?: string | null, createdAt: any } | null };

export type OnHeartbeatActivitySubscriptionVariables = Exact<{
  tenantId: Scalars['ID']['input'];
}>;


export type OnHeartbeatActivitySubscription = { __typename?: 'Subscription', onHeartbeatActivity?: { __typename?: 'HeartbeatActivityEvent', heartbeatId: string, tenantId: string, status: string, message?: string | null, createdAt: any } | null };

export type OnThreadUpdatedSubscriptionVariables = Exact<{
  tenantId: Scalars['ID']['input'];
}>;


export type OnThreadUpdatedSubscription = { __typename?: 'Subscription', onThreadUpdated?: { __typename?: 'ThreadUpdateEvent', threadId: string, tenantId: string, status: string, title: string, updatedAt: any } | null };

export type OnThreadTurnUpdatedSubscriptionVariables = Exact<{
  tenantId: Scalars['ID']['input'];
}>;


export type OnThreadTurnUpdatedSubscription = { __typename?: 'Subscription', onThreadTurnUpdated?: { __typename?: 'ThreadTurnUpdateEvent', runId: string, triggerId?: string | null, threadId?: string | null, tenantId: string, status: string, triggerName?: string | null, updatedAt: any } | null };

export type OnInboxItemStatusChangedSubscriptionVariables = Exact<{
  tenantId: Scalars['ID']['input'];
}>;


export type OnInboxItemStatusChangedSubscription = { __typename?: 'Subscription', onInboxItemStatusChanged?: { __typename?: 'InboxItemStatusEvent', inboxItemId: string, tenantId: string, status: string, title?: string | null, updatedAt: any } | null };

export type InboxItemsQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
  status?: InputMaybe<InboxItemStatus>;
  entityType?: InputMaybe<Scalars['String']['input']>;
  entityId?: InputMaybe<Scalars['ID']['input']>;
}>;


export type InboxItemsQuery = { __typename?: 'Query', inboxItems: Array<{ __typename?: 'InboxItem', id: string, tenantId: string, requesterType?: string | null, requesterId?: string | null, type: string, status: InboxItemStatus, title?: string | null, description?: string | null, entityType?: string | null, entityId?: string | null, config?: any | null, revision: number, reviewNotes?: string | null, decidedBy?: string | null, decidedAt?: any | null, expiresAt?: any | null, createdAt: any, updatedAt: any, comments: Array<{ __typename?: 'InboxItemComment', id: string, inboxItemId: string, authorType?: string | null, authorId?: string | null, content: string, createdAt: any }>, links: Array<{ __typename?: 'InboxItemLink', id: string, linkedType?: string | null, linkedId?: string | null, createdAt: any }>, linkedThreads: Array<{ __typename?: 'LinkedThread', id: string, number: number, identifier?: string | null, title: string, status: string }> }> };

export type InboxItemQueryVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type InboxItemQuery = { __typename?: 'Query', inboxItem?: { __typename?: 'InboxItem', id: string, tenantId: string, requesterType?: string | null, requesterId?: string | null, type: string, status: InboxItemStatus, title?: string | null, description?: string | null, entityType?: string | null, entityId?: string | null, config?: any | null, revision: number, reviewNotes?: string | null, decidedBy?: string | null, decidedAt?: any | null, expiresAt?: any | null, createdAt: any, updatedAt: any, comments: Array<{ __typename?: 'InboxItemComment', id: string, inboxItemId: string, authorType?: string | null, authorId?: string | null, content: string, createdAt: any }>, links: Array<{ __typename?: 'InboxItemLink', id: string, linkedType?: string | null, linkedId?: string | null, createdAt: any }>, linkedThreads: Array<{ __typename?: 'LinkedThread', id: string, number: number, identifier?: string | null, title: string, status: string }> } | null };

export type DecideInboxItemMutationVariables = Exact<{
  id: Scalars['ID']['input'];
  input: InboxItemDecisionInput;
}>;


export type DecideInboxItemMutation = { __typename?: 'Mutation', decideInboxItem: { __typename?: 'InboxItem', id: string, status: InboxItemStatus, reviewNotes?: string | null, decidedBy?: string | null, decidedAt?: any | null, updatedAt: any } };

export type AddInboxItemCommentMutationVariables = Exact<{
  input: AddInboxItemCommentInput;
}>;


export type AddInboxItemCommentMutation = { __typename?: 'Mutation', addInboxItemComment: { __typename?: 'InboxItemComment', id: string, inboxItemId: string, content: string, authorType?: string | null, authorId?: string | null, createdAt: any } };

export type OnOrgUpdatedSubscriptionVariables = Exact<{
  tenantId: Scalars['ID']['input'];
}>;


export type OnOrgUpdatedSubscription = { __typename?: 'Subscription', onOrgUpdated?: { __typename?: 'OrgUpdateEvent', tenantId: string, changeType: string, entityType?: string | null, entityId?: string | null, updatedAt: any } | null };

export type ThreadTurnsForThreadQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
  threadId: Scalars['ID']['input'];
  limit?: InputMaybe<Scalars['Int']['input']>;
}>;


export type ThreadTurnsForThreadQuery = { __typename?: 'Query', threadTurns: Array<{ __typename?: 'ThreadTurn', id: string, tenantId: string, agentId?: string | null, invocationSource: string, triggerDetail?: string | null, triggerName?: string | null, threadId?: string | null, turnNumber?: number | null, status: string, startedAt?: any | null, finishedAt?: any | null, error?: string | null, resultJson?: any | null, usageJson?: any | null, totalCost?: number | null, retryAttempt?: number | null, originTurnId?: string | null, createdAt: any }> };

export type ArtifactsForThreadQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
  threadId: Scalars['ID']['input'];
  limit?: InputMaybe<Scalars['Int']['input']>;
}>;


export type ArtifactsForThreadQuery = { __typename?: 'Query', artifacts: Array<{ __typename?: 'Artifact', id: string, tenantId: string, agentId?: string | null, threadId?: string | null, title: string, type: ArtifactType, status: ArtifactStatus, summary?: string | null, createdAt: any, updatedAt: any }> };

export type ArtifactDetailQueryVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type ArtifactDetailQuery = { __typename?: 'Query', artifact?: { __typename?: 'Artifact', id: string, title: string, type: ArtifactType, status: ArtifactStatus, content?: string | null, summary?: string | null, createdAt: any } | null };

export type MemoryRecordsQueryVariables = Exact<{
  assistantId: Scalars['ID']['input'];
  namespace: Scalars['String']['input'];
}>;


export type MemoryRecordsQuery = { __typename?: 'Query', memoryRecords: Array<{ __typename?: 'MemoryRecord', memoryRecordId: string, createdAt?: any | null, updatedAt?: any | null, expiresAt?: any | null, namespace?: string | null, strategyId?: string | null, content?: { __typename?: 'MemoryContent', text?: string | null } | null, wikiPages: Array<{ __typename?: 'WikiPage', id: string, type: WikiPageType, slug: string, title: string }> }> };

export type DeleteMemoryRecordMutationVariables = Exact<{
  memoryRecordId: Scalars['ID']['input'];
}>;


export type DeleteMemoryRecordMutation = { __typename?: 'Mutation', deleteMemoryRecord: boolean };

export type UpdateMemoryRecordMutationVariables = Exact<{
  memoryRecordId: Scalars['ID']['input'];
  content: Scalars['String']['input'];
}>;


export type UpdateMemoryRecordMutation = { __typename?: 'Mutation', updateMemoryRecord: boolean };

export type RegisterPushTokenMutationVariables = Exact<{
  input: RegisterPushTokenInput;
}>;


export type RegisterPushTokenMutation = { __typename?: 'Mutation', registerPushToken: boolean };

export type UnregisterPushTokenMutationVariables = Exact<{
  token: Scalars['String']['input'];
}>;


export type UnregisterPushTokenMutation = { __typename?: 'Mutation', unregisterPushToken: boolean };

export type AgentWorkspacesQueryVariables = Exact<{
  agentId: Scalars['ID']['input'];
}>;


export type AgentWorkspacesQuery = { __typename?: 'Query', agentWorkspaces: Array<{ __typename?: 'AgentWorkspace', slug: string, name: string, purpose?: string | null }> };

export type UserQuickActionsQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
}>;


export type UserQuickActionsQuery = { __typename?: 'Query', userQuickActions: Array<{ __typename?: 'UserQuickAction', id: string, userId: string, tenantId: string, title: string, prompt: string, workspaceAgentId?: string | null, sortOrder: number, createdAt: any, updatedAt: any }> };

export type CreateQuickActionMutationVariables = Exact<{
  input: CreateQuickActionInput;
}>;


export type CreateQuickActionMutation = { __typename?: 'Mutation', createQuickAction: { __typename?: 'UserQuickAction', id: string, userId: string, tenantId: string, title: string, prompt: string, workspaceAgentId?: string | null, sortOrder: number, createdAt: any, updatedAt: any } };

export type UpdateQuickActionMutationVariables = Exact<{
  id: Scalars['ID']['input'];
  input: UpdateQuickActionInput;
}>;


export type UpdateQuickActionMutation = { __typename?: 'Mutation', updateQuickAction: { __typename?: 'UserQuickAction', id: string, userId: string, tenantId: string, title: string, prompt: string, workspaceAgentId?: string | null, sortOrder: number, createdAt: any, updatedAt: any } };

export type DeleteQuickActionMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type DeleteQuickActionMutation = { __typename?: 'Mutation', deleteQuickAction: boolean };

export type ReorderQuickActionsMutationVariables = Exact<{
  input: ReorderQuickActionsInput;
}>;


export type ReorderQuickActionsMutation = { __typename?: 'Mutation', reorderQuickActions: Array<{ __typename?: 'UserQuickAction', id: string, sortOrder: number }> };

export type RefreshGenUiMutationVariables = Exact<{
  messageId: Scalars['ID']['input'];
  toolIndex: Scalars['Int']['input'];
}>;


export type RefreshGenUiMutation = { __typename?: 'Mutation', refreshGenUI?: { __typename?: 'Message', id: string, toolResults?: any | null } | null };

export type CreateRecipeMutationVariables = Exact<{
  input: CreateRecipeInput;
}>;


export type CreateRecipeMutation = { __typename?: 'Mutation', createRecipe: { __typename?: 'Recipe', id: string, title: string, genuiType: string } };


export const TenantUsersForFormPickerDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"TenantUsersForFormPicker"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"tenantMembers"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"principalType"}},{"kind":"Field","name":{"kind":"Name","value":"principalId"}},{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]}}]}}]} as unknown as DocumentNode<TenantUsersForFormPickerQuery, TenantUsersForFormPickerQueryVariables>;
export const AgentsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Agents"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"status"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"AgentStatus"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"type"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"AgentType"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"agents"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"status"},"value":{"kind":"Variable","name":{"kind":"Name","value":"status"}}},{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"Variable","name":{"kind":"Name","value":"type"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"templateId"}},{"kind":"Field","name":{"kind":"Name","value":"systemPrompt"}},{"kind":"Field","name":{"kind":"Name","value":"adapterType"}},{"kind":"Field","name":{"kind":"Name","value":"adapterConfig"}},{"kind":"Field","name":{"kind":"Name","value":"runtimeConfig"}},{"kind":"Field","name":{"kind":"Name","value":"lastHeartbeatAt"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}},{"kind":"Field","name":{"kind":"Name","value":"reportsToId"}},{"kind":"Field","name":{"kind":"Name","value":"humanPairId"}},{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<AgentsQuery, AgentsQueryVariables>;
export const AgentDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Agent"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"agent"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"templateId"}},{"kind":"Field","name":{"kind":"Name","value":"systemPrompt"}},{"kind":"Field","name":{"kind":"Name","value":"adapterType"}},{"kind":"Field","name":{"kind":"Name","value":"adapterConfig"}},{"kind":"Field","name":{"kind":"Name","value":"runtimeConfig"}},{"kind":"Field","name":{"kind":"Name","value":"lastHeartbeatAt"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}},{"kind":"Field","name":{"kind":"Name","value":"reportsToId"}},{"kind":"Field","name":{"kind":"Name","value":"humanPairId"}},{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"capabilities"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"capability"}},{"kind":"Field","name":{"kind":"Name","value":"config"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}}]}},{"kind":"Field","name":{"kind":"Name","value":"skills"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"skillId"}},{"kind":"Field","name":{"kind":"Name","value":"config"}},{"kind":"Field","name":{"kind":"Name","value":"permissions"}},{"kind":"Field","name":{"kind":"Name","value":"rateLimitRpm"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}}]}},{"kind":"Field","name":{"kind":"Name","value":"budgetPolicy"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"period"}},{"kind":"Field","name":{"kind":"Name","value":"limitUsd"}},{"kind":"Field","name":{"kind":"Name","value":"actionOnExceed"}}]}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<AgentQuery, AgentQueryVariables>;
export const CreateAgentDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateAgent"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateAgentInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createAgent"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<CreateAgentMutation, CreateAgentMutationVariables>;
export const UpdateAgentDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateAgent"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateAgentInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateAgent"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"templateId"}},{"kind":"Field","name":{"kind":"Name","value":"systemPrompt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<UpdateAgentMutation, UpdateAgentMutationVariables>;
export const DeleteAgentDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteAgent"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteAgent"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}]}]}}]} as unknown as DocumentNode<DeleteAgentMutation, DeleteAgentMutationVariables>;
export const UpdateAgentStatusDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateAgentStatus"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"status"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"AgentStatus"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateAgentStatus"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"status"},"value":{"kind":"Variable","name":{"kind":"Name","value":"status"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"lastHeartbeatAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<UpdateAgentStatusMutation, UpdateAgentStatusMutationVariables>;
export const SetAgentCapabilitiesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SetAgentCapabilities"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"capabilities"}},"type":{"kind":"NonNullType","type":{"kind":"ListType","type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"AgentCapabilityInput"}}}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"setAgentCapabilities"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"agentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}}},{"kind":"Argument","name":{"kind":"Name","value":"capabilities"},"value":{"kind":"Variable","name":{"kind":"Name","value":"capabilities"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"capability"}},{"kind":"Field","name":{"kind":"Name","value":"config"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}}]}}]}}]} as unknown as DocumentNode<SetAgentCapabilitiesMutation, SetAgentCapabilitiesMutationVariables>;
export const SetAgentSkillsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SetAgentSkills"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"skills"}},"type":{"kind":"NonNullType","type":{"kind":"ListType","type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"AgentSkillInput"}}}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"setAgentSkills"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"agentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}}},{"kind":"Argument","name":{"kind":"Name","value":"skills"},"value":{"kind":"Variable","name":{"kind":"Name","value":"skills"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"skillId"}},{"kind":"Field","name":{"kind":"Name","value":"config"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}}]}}]}}]} as unknown as DocumentNode<SetAgentSkillsMutation, SetAgentSkillsMutationVariables>;
export const SetAgentBudgetPolicyDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SetAgentBudgetPolicy"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"AgentBudgetPolicyInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"setAgentBudgetPolicy"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"agentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"period"}},{"kind":"Field","name":{"kind":"Name","value":"limitUsd"}},{"kind":"Field","name":{"kind":"Name","value":"actionOnExceed"}}]}}]}}]} as unknown as DocumentNode<SetAgentBudgetPolicyMutation, SetAgentBudgetPolicyMutationVariables>;
export const SendMessageDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SendMessage"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SendMessageInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"sendMessage"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"threadId"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"content"}},{"kind":"Field","name":{"kind":"Name","value":"senderType"}},{"kind":"Field","name":{"kind":"Name","value":"senderId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<SendMessageMutation, SendMessageMutationVariables>;
export const DeleteMessageDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteMessage"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteMessage"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}]}]}}]} as unknown as DocumentNode<DeleteMessageMutation, DeleteMessageMutationVariables>;
export const MessagesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Messages"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"threadId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"limit"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"cursor"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"messages"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"threadId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"threadId"}}},{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"Variable","name":{"kind":"Name","value":"limit"}}},{"kind":"Argument","name":{"kind":"Name","value":"cursor"},"value":{"kind":"Variable","name":{"kind":"Name","value":"cursor"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"edges"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"node"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"threadId"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"content"}},{"kind":"Field","name":{"kind":"Name","value":"senderType"}},{"kind":"Field","name":{"kind":"Name","value":"senderId"}},{"kind":"Field","name":{"kind":"Name","value":"toolCalls"}},{"kind":"Field","name":{"kind":"Name","value":"toolResults"}},{"kind":"Field","name":{"kind":"Name","value":"metadata"}},{"kind":"Field","name":{"kind":"Name","value":"tokenCount"}},{"kind":"Field","name":{"kind":"Name","value":"durableArtifact"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"content"}},{"kind":"Field","name":{"kind":"Name","value":"summary"}}]}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"cursor"}}]}},{"kind":"Field","name":{"kind":"Name","value":"pageInfo"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"hasNextPage"}},{"kind":"Field","name":{"kind":"Name","value":"endCursor"}}]}}]}}]}}]} as unknown as DocumentNode<MessagesQuery, MessagesQueryVariables>;
export const TeamsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Teams"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"teams"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"budgetMonthlyCents"}},{"kind":"Field","name":{"kind":"Name","value":"metadata"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<TeamsQuery, TeamsQueryVariables>;
export const TeamDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Team"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"team"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"budgetMonthlyCents"}},{"kind":"Field","name":{"kind":"Name","value":"metadata"}},{"kind":"Field","name":{"kind":"Name","value":"agents"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"joinedAt"}},{"kind":"Field","name":{"kind":"Name","value":"agent"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"users"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"joinedAt"}},{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"image"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<TeamQuery, TeamQueryVariables>;
export const CreateTeamDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateTeam"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateTeamInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createTeam"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<CreateTeamMutation, CreateTeamMutationVariables>;
export const UpdateTeamDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateTeam"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateTeamInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateTeam"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<UpdateTeamMutation, UpdateTeamMutationVariables>;
export const DeleteTeamDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteTeam"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteTeam"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}]}]}}]} as unknown as DocumentNode<DeleteTeamMutation, DeleteTeamMutationVariables>;
export const AddTeamAgentDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AddTeamAgent"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"teamId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"AddTeamAgentInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"addTeamAgent"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"teamId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"teamId"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"joinedAt"}}]}}]}}]} as unknown as DocumentNode<AddTeamAgentMutation, AddTeamAgentMutationVariables>;
export const RemoveTeamAgentDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RemoveTeamAgent"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"teamId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"removeTeamAgent"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"teamId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"teamId"}}},{"kind":"Argument","name":{"kind":"Name","value":"agentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}}}]}]}}]} as unknown as DocumentNode<RemoveTeamAgentMutation, RemoveTeamAgentMutationVariables>;
export const AddTeamUserDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AddTeamUser"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"teamId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"AddTeamUserInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"addTeamUser"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"teamId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"teamId"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"joinedAt"}}]}}]}}]} as unknown as DocumentNode<AddTeamUserMutation, AddTeamUserMutationVariables>;
export const RemoveTeamUserDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RemoveTeamUser"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"teamId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"userId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"removeTeamUser"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"teamId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"teamId"}}},{"kind":"Argument","name":{"kind":"Name","value":"userId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"userId"}}}]}]}}]} as unknown as DocumentNode<RemoveTeamUserMutation, RemoveTeamUserMutationVariables>;
export const RoutinesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Routines"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"teamId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"status"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"RoutineStatus"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"routines"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"teamId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"teamId"}}},{"kind":"Argument","name":{"kind":"Name","value":"agentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}}},{"kind":"Argument","name":{"kind":"Name","value":"status"},"value":{"kind":"Variable","name":{"kind":"Name","value":"status"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"schedule"}},{"kind":"Field","name":{"kind":"Name","value":"config"}},{"kind":"Field","name":{"kind":"Name","value":"lastRunAt"}},{"kind":"Field","name":{"kind":"Name","value":"nextRunAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<RoutinesQuery, RoutinesQueryVariables>;
export const RoutineDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Routine"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"routine"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"schedule"}},{"kind":"Field","name":{"kind":"Name","value":"config"}},{"kind":"Field","name":{"kind":"Name","value":"lastRunAt"}},{"kind":"Field","name":{"kind":"Name","value":"nextRunAt"}},{"kind":"Field","name":{"kind":"Name","value":"triggers"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"triggerType"}},{"kind":"Field","name":{"kind":"Name","value":"config"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}}]}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<RoutineQuery, RoutineQueryVariables>;
export const RoutineRunsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"RoutineRuns"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"routineId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"limit"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"cursor"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"routineRuns"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"routineId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"routineId"}}},{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"Variable","name":{"kind":"Name","value":"limit"}}},{"kind":"Argument","name":{"kind":"Name","value":"cursor"},"value":{"kind":"Variable","name":{"kind":"Name","value":"cursor"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"routineId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"error"}},{"kind":"Field","name":{"kind":"Name","value":"metadata"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<RoutineRunsQuery, RoutineRunsQueryVariables>;
export const RoutineRunDetailDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"RoutineRunDetail"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"routineRun"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"routineId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"error"}},{"kind":"Field","name":{"kind":"Name","value":"metadata"}},{"kind":"Field","name":{"kind":"Name","value":"steps"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"stepIndex"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"input"}},{"kind":"Field","name":{"kind":"Name","value":"output"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"error"}}]}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<RoutineRunDetailQuery, RoutineRunDetailQueryVariables>;
export const CreateRoutineDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateRoutine"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateRoutineInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createRoutine"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<CreateRoutineMutation, CreateRoutineMutationVariables>;
export const UpdateRoutineDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateRoutine"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateRoutineInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateRoutine"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"schedule"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<UpdateRoutineMutation, UpdateRoutineMutationVariables>;
export const DeleteRoutineDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteRoutine"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteRoutine"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}]}]}}]} as unknown as DocumentNode<DeleteRoutineMutation, DeleteRoutineMutationVariables>;
export const TriggerRoutineRunDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"TriggerRoutineRun"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"routineId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"triggerRoutineRun"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"routineId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"routineId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"routineId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<TriggerRoutineRunMutation, TriggerRoutineRunMutationVariables>;
export const SetRoutineTriggerDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SetRoutineTrigger"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"routineId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"RoutineTriggerInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"setRoutineTrigger"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"routineId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"routineId"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"triggerType"}},{"kind":"Field","name":{"kind":"Name","value":"config"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}}]}}]}}]} as unknown as DocumentNode<SetRoutineTriggerMutation, SetRoutineTriggerMutationVariables>;
export const DeleteRoutineTriggerDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteRoutineTrigger"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteRoutineTrigger"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}]}]}}]} as unknown as DocumentNode<DeleteRoutineTriggerMutation, DeleteRoutineTriggerMutationVariables>;
export const ThreadTurnsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ThreadTurns"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"status"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"limit"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"threadTurns"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"agentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}}},{"kind":"Argument","name":{"kind":"Name","value":"status"},"value":{"kind":"Variable","name":{"kind":"Name","value":"status"}}},{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"Variable","name":{"kind":"Name","value":"limit"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"triggerId"}},{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"routineId"}},{"kind":"Field","name":{"kind":"Name","value":"invocationSource"}},{"kind":"Field","name":{"kind":"Name","value":"triggerDetail"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"finishedAt"}},{"kind":"Field","name":{"kind":"Name","value":"error"}},{"kind":"Field","name":{"kind":"Name","value":"errorCode"}},{"kind":"Field","name":{"kind":"Name","value":"usageJson"}},{"kind":"Field","name":{"kind":"Name","value":"resultJson"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<ThreadTurnsQuery, ThreadTurnsQueryVariables>;
export const ThreadTurnDetailDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ThreadTurnDetail"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"threadTurn"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"triggerId"}},{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"routineId"}},{"kind":"Field","name":{"kind":"Name","value":"invocationSource"}},{"kind":"Field","name":{"kind":"Name","value":"triggerDetail"}},{"kind":"Field","name":{"kind":"Name","value":"wakeupRequestId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"finishedAt"}},{"kind":"Field","name":{"kind":"Name","value":"error"}},{"kind":"Field","name":{"kind":"Name","value":"errorCode"}},{"kind":"Field","name":{"kind":"Name","value":"usageJson"}},{"kind":"Field","name":{"kind":"Name","value":"resultJson"}},{"kind":"Field","name":{"kind":"Name","value":"sessionIdBefore"}},{"kind":"Field","name":{"kind":"Name","value":"sessionIdAfter"}},{"kind":"Field","name":{"kind":"Name","value":"externalRunId"}},{"kind":"Field","name":{"kind":"Name","value":"contextSnapshot"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<ThreadTurnDetailQuery, ThreadTurnDetailQueryVariables>;
export const ThreadTurnEventsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ThreadTurnEvents"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"runId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"afterSeq"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"limit"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"threadTurnEvents"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"runId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"runId"}}},{"kind":"Argument","name":{"kind":"Name","value":"afterSeq"},"value":{"kind":"Variable","name":{"kind":"Name","value":"afterSeq"}}},{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"Variable","name":{"kind":"Name","value":"limit"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"runId"}},{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"seq"}},{"kind":"Field","name":{"kind":"Name","value":"eventType"}},{"kind":"Field","name":{"kind":"Name","value":"stream"}},{"kind":"Field","name":{"kind":"Name","value":"level"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"message"}},{"kind":"Field","name":{"kind":"Name","value":"payload"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<ThreadTurnEventsQuery, ThreadTurnEventsQueryVariables>;
export const TurnInvocationLogsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"TurnInvocationLogs"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"turnId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"turnInvocationLogs"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"turnId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"turnId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"requestId"}},{"kind":"Field","name":{"kind":"Name","value":"modelId"}},{"kind":"Field","name":{"kind":"Name","value":"timestamp"}},{"kind":"Field","name":{"kind":"Name","value":"inputTokenCount"}},{"kind":"Field","name":{"kind":"Name","value":"outputTokenCount"}},{"kind":"Field","name":{"kind":"Name","value":"cacheReadTokenCount"}},{"kind":"Field","name":{"kind":"Name","value":"inputPreview"}},{"kind":"Field","name":{"kind":"Name","value":"outputPreview"}},{"kind":"Field","name":{"kind":"Name","value":"toolCount"}},{"kind":"Field","name":{"kind":"Name","value":"costUsd"}},{"kind":"Field","name":{"kind":"Name","value":"toolUses"}},{"kind":"Field","name":{"kind":"Name","value":"hasToolResult"}},{"kind":"Field","name":{"kind":"Name","value":"branch"}}]}}]}}]} as unknown as DocumentNode<TurnInvocationLogsQuery, TurnInvocationLogsQueryVariables>;
export const CancelThreadTurnDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CancelThreadTurn"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cancelThreadTurn"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"finishedAt"}}]}}]}}]} as unknown as DocumentNode<CancelThreadTurnMutation, CancelThreadTurnMutationVariables>;
export const CreateWakeupRequestDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateWakeupRequest"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateWakeupRequestInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createWakeupRequest"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"source"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<CreateWakeupRequestMutation, CreateWakeupRequestMutationVariables>;
export const ScheduledJobsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ScheduledJobs"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"routineId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"triggerType"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"enabled"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"limit"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"scheduledJobs"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"agentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}}},{"kind":"Argument","name":{"kind":"Name","value":"routineId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"routineId"}}},{"kind":"Argument","name":{"kind":"Name","value":"triggerType"},"value":{"kind":"Variable","name":{"kind":"Name","value":"triggerType"}}},{"kind":"Argument","name":{"kind":"Name","value":"enabled"},"value":{"kind":"Variable","name":{"kind":"Name","value":"enabled"}}},{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"Variable","name":{"kind":"Name","value":"limit"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"triggerType"}},{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"routineId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"scheduleType"}},{"kind":"Field","name":{"kind":"Name","value":"scheduleExpression"}},{"kind":"Field","name":{"kind":"Name","value":"timezone"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}},{"kind":"Field","name":{"kind":"Name","value":"lastRunAt"}},{"kind":"Field","name":{"kind":"Name","value":"nextRunAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<ScheduledJobsQuery, ScheduledJobsQueryVariables>;
export const TenantDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Tenant"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"tenant"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"plan"}},{"kind":"Field","name":{"kind":"Name","value":"issuePrefix"}},{"kind":"Field","name":{"kind":"Name","value":"issueCounter"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<TenantQuery, TenantQueryVariables>;
export const TenantBySlugDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"TenantBySlug"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"slug"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"tenantBySlug"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"slug"},"value":{"kind":"Variable","name":{"kind":"Name","value":"slug"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"plan"}},{"kind":"Field","name":{"kind":"Name","value":"issuePrefix"}},{"kind":"Field","name":{"kind":"Name","value":"issueCounter"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<TenantBySlugQuery, TenantBySlugQueryVariables>;
export const TenantMembersDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"TenantMembers"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"tenantMembers"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"principalType"}},{"kind":"Field","name":{"kind":"Name","value":"principalId"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<TenantMembersQuery, TenantMembersQueryVariables>;
export const UpdateTenantDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateTenant"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateTenantInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateTenant"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"plan"}},{"kind":"Field","name":{"kind":"Name","value":"issuePrefix"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<UpdateTenantMutation, UpdateTenantMutationVariables>;
export const UpdateTenantSettingsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateTenantSettings"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateTenantSettingsInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateTenantSettings"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"defaultModel"}},{"kind":"Field","name":{"kind":"Name","value":"budgetMonthlyCents"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseThreadMinutes"}},{"kind":"Field","name":{"kind":"Name","value":"maxAgents"}},{"kind":"Field","name":{"kind":"Name","value":"features"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<UpdateTenantSettingsMutation, UpdateTenantSettingsMutationVariables>;
export const AddTenantMemberDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AddTenantMember"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"AddTenantMemberInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"addTenantMember"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"principalType"}},{"kind":"Field","name":{"kind":"Name","value":"principalId"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]}}]} as unknown as DocumentNode<AddTenantMemberMutation, AddTenantMemberMutationVariables>;
export const RemoveTenantMemberDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RemoveTenantMember"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"removeTenantMember"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}]}]}}]} as unknown as DocumentNode<RemoveTenantMemberMutation, RemoveTenantMemberMutationVariables>;
export const MeDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Me"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"me"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"image"}},{"kind":"Field","name":{"kind":"Name","value":"phone"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<MeQuery, MeQueryVariables>;
export const UserDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"User"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"user"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"image"}},{"kind":"Field","name":{"kind":"Name","value":"phone"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<UserQuery, UserQueryVariables>;
export const UpdateUserDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateUser"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateUserInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateUser"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"image"}},{"kind":"Field","name":{"kind":"Name","value":"phone"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<UpdateUserMutation, UpdateUserMutationVariables>;
export const UpdateUserProfileDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateUserProfile"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"userId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateUserProfileInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateUserProfile"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"userId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"userId"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"displayName"}},{"kind":"Field","name":{"kind":"Name","value":"theme"}},{"kind":"Field","name":{"kind":"Name","value":"notificationPreferences"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<UpdateUserProfileMutation, UpdateUserProfileMutationVariables>;
export const ThreadsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Threads"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"channel"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"ThreadChannel"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"assigneeId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"limit"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"cursor"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"threads"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"channel"},"value":{"kind":"Variable","name":{"kind":"Name","value":"channel"}}},{"kind":"Argument","name":{"kind":"Name","value":"agentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}}},{"kind":"Argument","name":{"kind":"Name","value":"assigneeId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"assigneeId"}}},{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"Variable","name":{"kind":"Name","value":"limit"}}},{"kind":"Argument","name":{"kind":"Name","value":"cursor"},"value":{"kind":"Variable","name":{"kind":"Name","value":"cursor"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"lifecycleStatus"}},{"kind":"Field","name":{"kind":"Name","value":"channel"}},{"kind":"Field","name":{"kind":"Name","value":"assigneeType"}},{"kind":"Field","name":{"kind":"Name","value":"assigneeId"}},{"kind":"Field","name":{"kind":"Name","value":"assignee"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"reporterId"}},{"kind":"Field","name":{"kind":"Name","value":"labels"}},{"kind":"Field","name":{"kind":"Name","value":"metadata"}},{"kind":"Field","name":{"kind":"Name","value":"dueAt"}},{"kind":"Field","name":{"kind":"Name","value":"closedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"lastActivityAt"}},{"kind":"Field","name":{"kind":"Name","value":"lastTurnCompletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"lastReadAt"}},{"kind":"Field","name":{"kind":"Name","value":"lastResponsePreview"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<ThreadsQuery, ThreadsQueryVariables>;
export const ThreadDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Thread"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"thread"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"lifecycleStatus"}},{"kind":"Field","name":{"kind":"Name","value":"channel"}},{"kind":"Field","name":{"kind":"Name","value":"assigneeType"}},{"kind":"Field","name":{"kind":"Name","value":"assigneeId"}},{"kind":"Field","name":{"kind":"Name","value":"reporterId"}},{"kind":"Field","name":{"kind":"Name","value":"labels"}},{"kind":"Field","name":{"kind":"Name","value":"metadata"}},{"kind":"Field","name":{"kind":"Name","value":"dueAt"}},{"kind":"Field","name":{"kind":"Name","value":"closedAt"}},{"kind":"Field","name":{"kind":"Name","value":"messages"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"IntValue","value":"100"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"edges"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"node"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"content"}},{"kind":"Field","name":{"kind":"Name","value":"senderType"}},{"kind":"Field","name":{"kind":"Name","value":"senderId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"durableArtifact"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"attachments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"s3Key"}},{"kind":"Field","name":{"kind":"Name","value":"mimeType"}},{"kind":"Field","name":{"kind":"Name","value":"sizeBytes"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<ThreadQuery, ThreadQueryVariables>;
export const CreateThreadDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateThread"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateThreadInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createThread"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<CreateThreadMutation, CreateThreadMutationVariables>;
export const UpdateThreadDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateThread"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateThreadInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateThread"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<UpdateThreadMutation, UpdateThreadMutationVariables>;
export const OnAgentStatusChangedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"OnAgentStatusChanged"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"onAgentStatusChanged"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<OnAgentStatusChangedSubscription, OnAgentStatusChangedSubscriptionVariables>;
export const OnNewMessageDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"OnNewMessage"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"threadId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"onNewMessage"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"threadId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"threadId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"messageId"}},{"kind":"Field","name":{"kind":"Name","value":"threadId"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"content"}},{"kind":"Field","name":{"kind":"Name","value":"senderType"}},{"kind":"Field","name":{"kind":"Name","value":"senderId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<OnNewMessageSubscription, OnNewMessageSubscriptionVariables>;
export const OnHeartbeatActivityDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"OnHeartbeatActivity"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"onHeartbeatActivity"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"heartbeatId"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"message"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<OnHeartbeatActivitySubscription, OnHeartbeatActivitySubscriptionVariables>;
export const OnThreadUpdatedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"OnThreadUpdated"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"onThreadUpdated"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"threadId"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<OnThreadUpdatedSubscription, OnThreadUpdatedSubscriptionVariables>;
export const OnThreadTurnUpdatedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"OnThreadTurnUpdated"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"onThreadTurnUpdated"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"runId"}},{"kind":"Field","name":{"kind":"Name","value":"triggerId"}},{"kind":"Field","name":{"kind":"Name","value":"threadId"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"triggerName"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<OnThreadTurnUpdatedSubscription, OnThreadTurnUpdatedSubscriptionVariables>;
export const OnInboxItemStatusChangedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"OnInboxItemStatusChanged"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"onInboxItemStatusChanged"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"inboxItemId"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<OnInboxItemStatusChangedSubscription, OnInboxItemStatusChangedSubscriptionVariables>;
export const InboxItemsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"InboxItems"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"status"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"InboxItemStatus"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"entityType"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"entityId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"inboxItems"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"status"},"value":{"kind":"Variable","name":{"kind":"Name","value":"status"}}},{"kind":"Argument","name":{"kind":"Name","value":"entityType"},"value":{"kind":"Variable","name":{"kind":"Name","value":"entityType"}}},{"kind":"Argument","name":{"kind":"Name","value":"entityId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"entityId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"requesterType"}},{"kind":"Field","name":{"kind":"Name","value":"requesterId"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}},{"kind":"Field","name":{"kind":"Name","value":"entityId"}},{"kind":"Field","name":{"kind":"Name","value":"config"}},{"kind":"Field","name":{"kind":"Name","value":"revision"}},{"kind":"Field","name":{"kind":"Name","value":"reviewNotes"}},{"kind":"Field","name":{"kind":"Name","value":"decidedBy"}},{"kind":"Field","name":{"kind":"Name","value":"decidedAt"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"comments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"inboxItemId"}},{"kind":"Field","name":{"kind":"Name","value":"authorType"}},{"kind":"Field","name":{"kind":"Name","value":"authorId"}},{"kind":"Field","name":{"kind":"Name","value":"content"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"links"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"linkedType"}},{"kind":"Field","name":{"kind":"Name","value":"linkedId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"linkedThreads"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<InboxItemsQuery, InboxItemsQueryVariables>;
export const InboxItemDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"InboxItem"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"inboxItem"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"requesterType"}},{"kind":"Field","name":{"kind":"Name","value":"requesterId"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}},{"kind":"Field","name":{"kind":"Name","value":"entityId"}},{"kind":"Field","name":{"kind":"Name","value":"config"}},{"kind":"Field","name":{"kind":"Name","value":"revision"}},{"kind":"Field","name":{"kind":"Name","value":"reviewNotes"}},{"kind":"Field","name":{"kind":"Name","value":"decidedBy"}},{"kind":"Field","name":{"kind":"Name","value":"decidedAt"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"comments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"inboxItemId"}},{"kind":"Field","name":{"kind":"Name","value":"authorType"}},{"kind":"Field","name":{"kind":"Name","value":"authorId"}},{"kind":"Field","name":{"kind":"Name","value":"content"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"links"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"linkedType"}},{"kind":"Field","name":{"kind":"Name","value":"linkedId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"linkedThreads"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<InboxItemQuery, InboxItemQueryVariables>;
export const DecideInboxItemDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DecideInboxItem"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"InboxItemDecisionInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"decideInboxItem"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"reviewNotes"}},{"kind":"Field","name":{"kind":"Name","value":"decidedBy"}},{"kind":"Field","name":{"kind":"Name","value":"decidedAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<DecideInboxItemMutation, DecideInboxItemMutationVariables>;
export const AddInboxItemCommentDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AddInboxItemComment"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"AddInboxItemCommentInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"addInboxItemComment"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"inboxItemId"}},{"kind":"Field","name":{"kind":"Name","value":"content"}},{"kind":"Field","name":{"kind":"Name","value":"authorType"}},{"kind":"Field","name":{"kind":"Name","value":"authorId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<AddInboxItemCommentMutation, AddInboxItemCommentMutationVariables>;
export const OnOrgUpdatedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"OnOrgUpdated"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"onOrgUpdated"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"changeType"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}},{"kind":"Field","name":{"kind":"Name","value":"entityId"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<OnOrgUpdatedSubscription, OnOrgUpdatedSubscriptionVariables>;
export const ThreadTurnsForThreadDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ThreadTurnsForThread"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"threadId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"limit"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"threadTurns"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"threadId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"threadId"}}},{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"Variable","name":{"kind":"Name","value":"limit"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"invocationSource"}},{"kind":"Field","name":{"kind":"Name","value":"triggerDetail"}},{"kind":"Field","name":{"kind":"Name","value":"triggerName"}},{"kind":"Field","name":{"kind":"Name","value":"threadId"}},{"kind":"Field","name":{"kind":"Name","value":"turnNumber"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"finishedAt"}},{"kind":"Field","name":{"kind":"Name","value":"error"}},{"kind":"Field","name":{"kind":"Name","value":"resultJson"}},{"kind":"Field","name":{"kind":"Name","value":"usageJson"}},{"kind":"Field","name":{"kind":"Name","value":"totalCost"}},{"kind":"Field","name":{"kind":"Name","value":"retryAttempt"}},{"kind":"Field","name":{"kind":"Name","value":"originTurnId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<ThreadTurnsForThreadQuery, ThreadTurnsForThreadQueryVariables>;
export const ArtifactsForThreadDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ArtifactsForThread"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"threadId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"limit"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"artifacts"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"threadId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"threadId"}}},{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"Variable","name":{"kind":"Name","value":"limit"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"threadId"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"summary"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<ArtifactsForThreadQuery, ArtifactsForThreadQueryVariables>;
export const ArtifactDetailDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ArtifactDetail"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"artifact"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"content"}},{"kind":"Field","name":{"kind":"Name","value":"summary"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<ArtifactDetailQuery, ArtifactDetailQueryVariables>;
export const MemoryRecordsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MemoryRecords"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"assistantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"namespace"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"memoryRecords"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"assistantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"assistantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"namespace"},"value":{"kind":"Variable","name":{"kind":"Name","value":"namespace"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"memoryRecordId"}},{"kind":"Field","name":{"kind":"Name","value":"content"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"text"}}]}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"namespace"}},{"kind":"Field","name":{"kind":"Name","value":"strategyId"}},{"kind":"Field","name":{"kind":"Name","value":"wikiPages"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"title"}}]}}]}}]}}]} as unknown as DocumentNode<MemoryRecordsQuery, MemoryRecordsQueryVariables>;
export const DeleteMemoryRecordDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteMemoryRecord"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"memoryRecordId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteMemoryRecord"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"memoryRecordId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"memoryRecordId"}}}]}]}}]} as unknown as DocumentNode<DeleteMemoryRecordMutation, DeleteMemoryRecordMutationVariables>;
export const UpdateMemoryRecordDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateMemoryRecord"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"memoryRecordId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"content"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateMemoryRecord"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"memoryRecordId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"memoryRecordId"}}},{"kind":"Argument","name":{"kind":"Name","value":"content"},"value":{"kind":"Variable","name":{"kind":"Name","value":"content"}}}]}]}}]} as unknown as DocumentNode<UpdateMemoryRecordMutation, UpdateMemoryRecordMutationVariables>;
export const RegisterPushTokenDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RegisterPushToken"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"RegisterPushTokenInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"registerPushToken"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<RegisterPushTokenMutation, RegisterPushTokenMutationVariables>;
export const UnregisterPushTokenDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UnregisterPushToken"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"token"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"unregisterPushToken"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"token"},"value":{"kind":"Variable","name":{"kind":"Name","value":"token"}}}]}]}}]} as unknown as DocumentNode<UnregisterPushTokenMutation, UnregisterPushTokenMutationVariables>;
export const AgentWorkspacesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AgentWorkspaces"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"agentWorkspaces"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"agentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"purpose"}}]}}]}}]} as unknown as DocumentNode<AgentWorkspacesQuery, AgentWorkspacesQueryVariables>;
export const UserQuickActionsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserQuickActions"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userQuickActions"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"prompt"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceAgentId"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<UserQuickActionsQuery, UserQuickActionsQueryVariables>;
export const CreateQuickActionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateQuickAction"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateQuickActionInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createQuickAction"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"prompt"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceAgentId"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<CreateQuickActionMutation, CreateQuickActionMutationVariables>;
export const UpdateQuickActionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateQuickAction"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateQuickActionInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateQuickAction"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"prompt"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceAgentId"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<UpdateQuickActionMutation, UpdateQuickActionMutationVariables>;
export const DeleteQuickActionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteQuickAction"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteQuickAction"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}]}]}}]} as unknown as DocumentNode<DeleteQuickActionMutation, DeleteQuickActionMutationVariables>;
export const ReorderQuickActionsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ReorderQuickActions"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ReorderQuickActionsInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"reorderQuickActions"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}}]}}]}}]} as unknown as DocumentNode<ReorderQuickActionsMutation, ReorderQuickActionsMutationVariables>;
export const RefreshGenUiDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RefreshGenUI"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"messageId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"toolIndex"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"refreshGenUI"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"messageId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"messageId"}}},{"kind":"Argument","name":{"kind":"Name","value":"toolIndex"},"value":{"kind":"Variable","name":{"kind":"Name","value":"toolIndex"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"toolResults"}}]}}]}}]} as unknown as DocumentNode<RefreshGenUiMutation, RefreshGenUiMutationVariables>;
export const CreateRecipeDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateRecipe"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateRecipeInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createRecipe"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"genuiType"}}]}}]}}]} as unknown as DocumentNode<CreateRecipeMutation, CreateRecipeMutationVariables>;