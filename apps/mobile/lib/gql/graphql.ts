/* eslint-disable */
import { TypedDocumentNode as DocumentNode } from "@graphql-typed-document-node/core";
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = {
  [K in keyof T]: T[K];
};
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & {
  [SubKey in K]?: Maybe<T[SubKey]>;
};
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & {
  [SubKey in K]: Maybe<T[SubKey]>;
};
export type MakeEmpty<
  T extends { [key: string]: unknown },
  K extends keyof T,
> = { [_ in K]?: never };
export type Incremental<T> =
  | T
  | {
      [P in keyof T]?: P extends " $fragmentName" | "__typename" ? T[P] : never;
    };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string };
  String: { input: string; output: string };
  Boolean: { input: boolean; output: boolean };
  Int: { input: number; output: number };
  Float: { input: number; output: number };
  AWSDateTime: { input: any; output: any };
  AWSJSON: { input: any; output: any };
  AWSURL: { input: any; output: any };
};

export type AccountUsage = {
  __typename?: "AccountUsage";
  daily: Array<AccountUsageDay>;
  models: Array<AccountUsageModel>;
  periodEnd: Scalars["AWSDateTime"]["output"];
  periodStart: Scalars["AWSDateTime"]["output"];
  summary: AccountUsageSummary;
};

export type AccountUsageDay = {
  __typename?: "AccountUsageDay";
  billReconciledUsd: Scalars["Float"]["output"];
  computeUsd: Scalars["Float"]["output"];
  day: Scalars["String"]["output"];
  enforcedUsd: Scalars["Float"]["output"];
  estimatedUsd: Scalars["Float"]["output"];
  eventCount: Scalars["Int"]["output"];
  inputTokens: Scalars["Int"]["output"];
  invocationReconciledUsd: Scalars["Float"]["output"];
  llmUsd: Scalars["Float"]["output"];
  minimumReconciliationState: Scalars["String"]["output"];
  mismatchUsd: Scalars["Float"]["output"];
  outputTokens: Scalars["Int"]["output"];
  toolsUsd: Scalars["Float"]["output"];
  totalUsd: Scalars["Float"]["output"];
  unreconciledUsd: Scalars["Float"]["output"];
};

export type AccountUsageModel = {
  __typename?: "AccountUsageModel";
  billReconciledUsd: Scalars["Float"]["output"];
  displayName: Scalars["String"]["output"];
  enforcedUsd: Scalars["Float"]["output"];
  estimatedUsd: Scalars["Float"]["output"];
  inputTokens: Scalars["Int"]["output"];
  invocationReconciledUsd: Scalars["Float"]["output"];
  minimumReconciliationState: Scalars["String"]["output"];
  mismatchUsd: Scalars["Float"]["output"];
  model: Scalars["String"]["output"];
  outputTokens: Scalars["Int"]["output"];
  totalUsd: Scalars["Float"]["output"];
  unreconciledUsd: Scalars["Float"]["output"];
  usageShare: Scalars["Float"]["output"];
};

export type AccountUsageSummary = {
  __typename?: "AccountUsageSummary";
  billReconciledUsd: Scalars["Float"]["output"];
  computeUsd: Scalars["Float"]["output"];
  enforcedUsd: Scalars["Float"]["output"];
  estimatedUsd: Scalars["Float"]["output"];
  eventCount: Scalars["Int"]["output"];
  inputTokens: Scalars["Int"]["output"];
  invocationReconciledUsd: Scalars["Float"]["output"];
  llmUsd: Scalars["Float"]["output"];
  minimumReconciliationState: Scalars["String"]["output"];
  mismatchUsd: Scalars["Float"]["output"];
  outputTokens: Scalars["Int"]["output"];
  toolsUsd: Scalars["Float"]["output"];
  totalUsd: Scalars["Float"]["output"];
  unreconciledUsd: Scalars["Float"]["output"];
};

export type ActivatePluginInput = {
  installId: Scalars["ID"]["input"];
  /** Client path to land on after the OAuth callback (validated server-side). */
  returnTo?: InputMaybe<Scalars["String"]["input"]>;
};

/**
 * Start of the app-level OAuth activation flow. The caller redirects the user
 * to `authorizeUrl`; the callback upserts the activation and its token records
 * and returns the user to the plugin detail page.
 */
export type ActivatePluginResult = {
  __typename?: "ActivatePluginResult";
  authorizeUrl: Scalars["String"]["output"];
};

export type ActivatePluginWithCredentialsInput = {
  /** Per-user credential values keyed by the plugin manifest's credentialKey fields. */
  credentials: Array<PluginCredentialValueInput>;
  installId: Scalars["ID"]["input"];
};

export type ActivityLogEntry = {
  __typename?: "ActivityLogEntry";
  action: Scalars["String"]["output"];
  actorId: Scalars["ID"]["output"];
  actorType: Scalars["String"]["output"];
  changes?: Maybe<Scalars["AWSJSON"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  entityId?: Maybe<Scalars["ID"]["output"]>;
  entityType?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  metadata?: Maybe<Scalars["AWSJSON"]["output"]>;
  tenantId: Scalars["ID"]["output"];
};

export type AddEmailSpaceSenderAllowlistInput = {
  reason?: InputMaybe<Scalars["String"]["input"]>;
  spaceId: Scalars["ID"]["input"];
  value: Scalars["String"]["input"];
  valueType: EmailAllowlistType;
};

export type AddInboxItemCommentInput = {
  authorId?: InputMaybe<Scalars["ID"]["input"]>;
  authorType?: InputMaybe<Scalars["String"]["input"]>;
  content: Scalars["String"]["input"];
  inboxItemId: Scalars["ID"]["input"];
};

export type AddInboxItemLinkInput = {
  inboxItemId: Scalars["ID"]["input"];
  linkedId: Scalars["ID"]["input"];
  linkedType: Scalars["String"]["input"];
};

export type AddManualUserInput = {
  email: Scalars["String"]["input"];
  /** Required per-submit idempotency key. Reuse the same value only when retrying the same submit. */
  idempotencyKey: Scalars["String"]["input"];
  name?: InputMaybe<Scalars["String"]["input"]>;
  role?: InputMaybe<Scalars["String"]["input"]>;
};

export type AddTenantMemberInput = {
  /** Optional idempotency key. See UpdateTenantInput.idempotencyKey. */
  idempotencyKey?: InputMaybe<Scalars["String"]["input"]>;
  principalId: Scalars["ID"]["input"];
  principalType: Scalars["String"]["input"];
  role?: InputMaybe<Scalars["String"]["input"]>;
};

export type AdminRoleCheckResult = {
  __typename?: "AdminRoleCheckResult";
  /** One of: owner, admin, member, other. */
  role: Scalars["String"]["output"];
};

export type AdminUpdateAppletSourceInput = {
  appId: Scalars["ID"]["input"];
  source: Scalars["String"]["input"];
};

export type Agent = {
  __typename?: "Agent";
  adapterConfig?: Maybe<Scalars["AWSJSON"]["output"]>;
  adapterType?: Maybe<Scalars["String"]["output"]>;
  avatarUrl?: Maybe<Scalars["String"]["output"]>;
  blockedTools?: Maybe<Scalars["AWSJSON"]["output"]>;
  browser?: Maybe<Scalars["AWSJSON"]["output"]>;
  budgetMonthlyCents?: Maybe<Scalars["Int"]["output"]>;
  budgetPolicy?: Maybe<AgentBudgetPolicy>;
  capabilities: Array<AgentCapability>;
  contextEngine?: Maybe<Scalars["AWSJSON"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  guardrailId?: Maybe<Scalars["ID"]["output"]>;
  humanPair?: Maybe<User>;
  humanPairId?: Maybe<Scalars["ID"]["output"]>;
  id: Scalars["ID"]["output"];
  knowledgeBases: Array<AgentKnowledgeBase>;
  lastHeartbeatAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  model?: Maybe<Scalars["String"]["output"]>;
  name: Scalars["String"]["output"];
  parentAgentId?: Maybe<Scalars["ID"]["output"]>;
  reportsTo?: Maybe<Agent>;
  reportsToId?: Maybe<Scalars["ID"]["output"]>;
  role?: Maybe<Scalars["String"]["output"]>;
  runtime: AgentRuntime;
  runtimeConfig?: Maybe<Scalars["AWSJSON"]["output"]>;
  sandbox?: Maybe<Scalars["AWSJSON"]["output"]>;
  sendEmail?: Maybe<Scalars["AWSJSON"]["output"]>;
  skills: Array<AgentSkill>;
  slug?: Maybe<Scalars["String"]["output"]>;
  source?: Maybe<Scalars["String"]["output"]>;
  status: AgentStatus;
  subAgents?: Maybe<Array<Agent>>;
  systemPrompt?: Maybe<Scalars["String"]["output"]>;
  tenantId: Scalars["ID"]["output"];
  type: AgentType;
  updatedAt: Scalars["AWSDateTime"]["output"];
  version: Scalars["Int"]["output"];
  webExtract?: Maybe<Scalars["AWSJSON"]["output"]>;
  webSearch?: Maybe<Scalars["AWSJSON"]["output"]>;
};

export type AgentBudgetPolicy = {
  __typename?: "AgentBudgetPolicy";
  actionOnExceed: Scalars["String"]["output"];
  agentId: Scalars["ID"]["output"];
  createdAt: Scalars["AWSDateTime"]["output"];
  enabled: Scalars["Boolean"]["output"];
  id: Scalars["ID"]["output"];
  limitUsd: Scalars["Float"]["output"];
  period: Scalars["String"]["output"];
  scope: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export type AgentBudgetPolicyInput = {
  actionOnExceed?: InputMaybe<Scalars["String"]["input"]>;
  limitUsd: Scalars["Float"]["input"];
  period: Scalars["String"]["input"];
};

export type AgentCapability = {
  __typename?: "AgentCapability";
  agentId: Scalars["ID"]["output"];
  capability: Scalars["String"]["output"];
  config?: Maybe<Scalars["AWSJSON"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  enabled: Scalars["Boolean"]["output"];
  id: Scalars["ID"]["output"];
  tenantId: Scalars["ID"]["output"];
};

export type AgentCapabilityInput = {
  capability: Scalars["String"]["input"];
  config?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  enabled?: InputMaybe<Scalars["Boolean"]["input"]>;
};

export type AgentCostSummary = {
  __typename?: "AgentCostSummary";
  agentId?: Maybe<Scalars["ID"]["output"]>;
  agentName: Scalars["String"]["output"];
  eventCount: Scalars["Int"]["output"];
  totalUsd: Scalars["Float"]["output"];
};

export type AgentCount = {
  __typename?: "AgentCount";
  agentId: Scalars["ID"]["output"];
  agentName?: Maybe<Scalars["String"]["output"]>;
  count: Scalars["Int"]["output"];
};

export type AgentKnowledgeBase = {
  __typename?: "AgentKnowledgeBase";
  agentId: Scalars["ID"]["output"];
  createdAt: Scalars["AWSDateTime"]["output"];
  enabled: Scalars["Boolean"]["output"];
  id: Scalars["ID"]["output"];
  knowledgeBase?: Maybe<KnowledgeBase>;
  knowledgeBaseId: Scalars["ID"]["output"];
  searchConfig?: Maybe<Scalars["AWSJSON"]["output"]>;
};

export type AgentKnowledgeBaseInput = {
  enabled?: InputMaybe<Scalars["Boolean"]["input"]>;
  knowledgeBaseId: Scalars["ID"]["input"];
  searchConfig?: InputMaybe<Scalars["AWSJSON"]["input"]>;
};

export type AgentLoop = {
  __typename?: "AgentLoop";
  acceptedRunCount: Scalars["Int"]["output"];
  costPerAcceptedRunUsdCents?: Maybe<Scalars["Int"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  currentVersion?: Maybe<AgentLoopVersion>;
  currentVersionId?: Maybe<Scalars["ID"]["output"]>;
  currentVersionNumber?: Maybe<Scalars["Int"]["output"]>;
  description?: Maybe<Scalars["String"]["output"]>;
  enabled: Scalars["Boolean"]["output"];
  escalatedRunCount: Scalars["Int"]["output"];
  id: Scalars["ID"]["output"];
  lastRunAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  lastRunId?: Maybe<Scalars["ID"]["output"]>;
  lastRunStatus?: Maybe<AgentLoopRunStatus>;
  lastRunSummary: Scalars["AWSJSON"]["output"];
  lifecycleStatus: AgentLoopLifecycleStatus;
  name: Scalars["String"]["output"];
  ownerAgentId?: Maybe<Scalars["ID"]["output"]>;
  ownerUserId?: Maybe<Scalars["ID"]["output"]>;
  primaryTriggerFamily: AgentLoopTriggerFamily;
  rejectedRunCount: Scalars["Int"]["output"];
  runs: Array<AgentLoopRun>;
  slug: Scalars["String"]["output"];
  spaceId?: Maybe<Scalars["ID"]["output"]>;
  tenantId: Scalars["ID"]["output"];
  totalCostUsdCents: Scalars["Int"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
  versions: Array<AgentLoopVersion>;
};

export type AgentLoopRunsArgs = {
  cursor?: InputMaybe<Scalars["String"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  status?: InputMaybe<AgentLoopRunStatus>;
};

export type AgentLoopEvidence = {
  __typename?: "AgentLoopEvidence";
  agentLoopId: Scalars["ID"]["output"];
  agentLoopIterationId?: Maybe<Scalars["ID"]["output"]>;
  agentLoopJudgmentId?: Maybe<Scalars["ID"]["output"]>;
  agentLoopRunId?: Maybe<Scalars["ID"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  evidenceType: Scalars["String"]["output"];
  id: Scalars["ID"]["output"];
  redactionState: AgentLoopEvidenceRedactionState;
  retentionExpiresAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  sensitivity?: Maybe<Scalars["String"]["output"]>;
  sourceId?: Maybe<Scalars["String"]["output"]>;
  sourceSystem: Scalars["String"]["output"];
  summary: Scalars["AWSJSON"]["output"];
  tenantId: Scalars["ID"]["output"];
  uri?: Maybe<Scalars["String"]["output"]>;
};

export enum AgentLoopEvidenceRedactionState {
  Offloaded = "offloaded",
  RawAllowed = "raw_allowed",
  Redacted = "redacted",
  SummaryOnly = "summary_only",
}

export type AgentLoopIteration = {
  __typename?: "AgentLoopIteration";
  agentLoopRun?: Maybe<AgentLoopRun>;
  agentLoopRunId: Scalars["ID"]["output"];
  agentWakeupRequestId?: Maybe<Scalars["ID"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  errorCode?: Maybe<Scalars["String"]["output"]>;
  errorMessage?: Maybe<Scalars["String"]["output"]>;
  evidence: Array<AgentLoopEvidence>;
  finishedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  goalModeAction?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  inputSummary?: Maybe<Scalars["AWSJSON"]["output"]>;
  iterationNumber: Scalars["Int"]["output"];
  judgments: Array<AgentLoopJudgment>;
  outputSummary?: Maybe<Scalars["AWSJSON"]["output"]>;
  startedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  status: AgentLoopIterationStatus;
  tenantId: Scalars["ID"]["output"];
  threadId?: Maybe<Scalars["ID"]["output"]>;
  threadTurnId?: Maybe<Scalars["ID"]["output"]>;
  totalCostUsdCents?: Maybe<Scalars["Int"]["output"]>;
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export enum AgentLoopIterationStatus {
  BudgetStopped = "budget_stopped",
  Canceled = "canceled",
  Completed = "completed",
  Failed = "failed",
  Queued = "queued",
  Running = "running",
  WaitingForHuman = "waiting_for_human",
}

export enum AgentLoopJudgeMode {
  EvalThreshold = "eval_threshold",
  ExternalCallback = "external_callback",
  HumanApproval = "human_approval",
  ModelJudge = "model_judge",
  ReviewerAgent = "reviewer_agent",
  SelfCheck = "self_check",
}

export type AgentLoopJudgment = {
  __typename?: "AgentLoopJudgment";
  agentLoopIterationId?: Maybe<Scalars["ID"]["output"]>;
  agentLoopRun?: Maybe<AgentLoopRun>;
  agentLoopRunId: Scalars["ID"]["output"];
  confidence?: Maybe<Scalars["Int"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  id: Scalars["ID"]["output"];
  judgeMode: AgentLoopJudgeMode;
  outcome: AgentLoopJudgmentOutcome;
  rationale?: Maybe<Scalars["String"]["output"]>;
  structuredOutput: Scalars["AWSJSON"]["output"];
  tenantId: Scalars["ID"]["output"];
  terminalReason?: Maybe<Scalars["String"]["output"]>;
};

export enum AgentLoopJudgmentOutcome {
  BudgetStopped = "budget_stopped",
  Complete = "complete",
  Continue = "continue",
  Escalated = "escalated",
  Failed = "failed",
  NeedsHumanApproval = "needs_human_approval",
}

export enum AgentLoopLifecycleStatus {
  Active = "active",
  Archived = "archived",
  Draft = "draft",
  Paused = "paused",
}

export type AgentLoopRun = {
  __typename?: "AgentLoopRun";
  actorId?: Maybe<Scalars["ID"]["output"]>;
  actorType?: Maybe<Scalars["String"]["output"]>;
  agentLoop?: Maybe<AgentLoop>;
  agentLoopId: Scalars["ID"]["output"];
  agentLoopVersion?: Maybe<AgentLoopVersion>;
  agentLoopVersionId?: Maybe<Scalars["ID"]["output"]>;
  correlationId?: Maybe<Scalars["String"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  currentIteration: Scalars["Int"]["output"];
  errorCode?: Maybe<Scalars["String"]["output"]>;
  errorMessage?: Maybe<Scalars["String"]["output"]>;
  evidence: Array<AgentLoopEvidence>;
  finishedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  id: Scalars["ID"]["output"];
  idempotencyKey?: Maybe<Scalars["String"]["output"]>;
  inputSummary?: Maybe<Scalars["AWSJSON"]["output"]>;
  iterations: Array<AgentLoopIteration>;
  judgments: Array<AgentLoopJudgment>;
  lastEventAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  outputSummary?: Maybe<Scalars["AWSJSON"]["output"]>;
  policySnapshot: Scalars["AWSJSON"]["output"];
  scheduledJobId?: Maybe<Scalars["ID"]["output"]>;
  startedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  status: AgentLoopRunStatus;
  tenantId: Scalars["ID"]["output"];
  terminalReason?: Maybe<Scalars["String"]["output"]>;
  threadId?: Maybe<Scalars["ID"]["output"]>;
  totalCostUsdCents?: Maybe<Scalars["Int"]["output"]>;
  triggerFamily: AgentLoopTriggerFamily;
  triggerSource?: Maybe<Scalars["String"]["output"]>;
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export enum AgentLoopRunStatus {
  BudgetStopped = "budget_stopped",
  Canceled = "canceled",
  Completed = "completed",
  Escalated = "escalated",
  Failed = "failed",
  Queued = "queued",
  Running = "running",
  Skipped = "skipped",
  WaitingForHuman = "waiting_for_human",
}

export enum AgentLoopTriggerFamily {
  Api = "api",
  AppEvent = "app_event",
  Manual = "manual",
  N8n = "n8n",
  Schedule = "schedule",
  Webhook = "webhook",
}

export type AgentLoopVersion = {
  __typename?: "AgentLoopVersion";
  agentLoop?: Maybe<AgentLoop>;
  agentLoopId: Scalars["ID"]["output"];
  createdAt: Scalars["AWSDateTime"]["output"];
  createdByActorId?: Maybe<Scalars["ID"]["output"]>;
  createdByActorType?: Maybe<Scalars["String"]["output"]>;
  evidencePolicy: Scalars["AWSJSON"]["output"];
  goalSpec: Scalars["AWSJSON"]["output"];
  id: Scalars["ID"]["output"];
  judgeSpec: Scalars["AWSJSON"]["output"];
  loopPolicy: Scalars["AWSJSON"]["output"];
  publishedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  sourceMetadata: Scalars["AWSJSON"]["output"];
  tenantId: Scalars["ID"]["output"];
  triggerSpec: Scalars["AWSJSON"]["output"];
  versionNumber: Scalars["Int"]["output"];
  versionStatus: AgentLoopVersionStatus;
  workerSpec: Scalars["AWSJSON"]["output"];
};

export enum AgentLoopVersionStatus {
  Active = "active",
  Archived = "archived",
  Draft = "draft",
  Superseded = "superseded",
}

export type AgentPerformance = {
  __typename?: "AgentPerformance";
  agentId: Scalars["ID"]["output"];
  agentName: Scalars["String"]["output"];
  avgDurationMs: Scalars["Float"]["output"];
  errorCount: Scalars["Int"]["output"];
  invocationCount: Scalars["Int"]["output"];
  p95DurationMs: Scalars["Float"]["output"];
  runtimeType?: Maybe<Scalars["String"]["output"]>;
  totalCostUsd: Scalars["Float"]["output"];
  totalInputTokens: Scalars["Int"]["output"];
  totalOutputTokens: Scalars["Int"]["output"];
};

export type AgentProfile = {
  __typename?: "AgentProfile";
  builtInKey?: Maybe<Scalars["String"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  description?: Maybe<Scalars["String"]["output"]>;
  enabled: Scalars["Boolean"]["output"];
  executionControls: Scalars["AWSJSON"]["output"];
  id: Scalars["ID"]["output"];
  instructions: Scalars["String"]["output"];
  model?: Maybe<ModelCatalogEntry>;
  modelId: Scalars["ID"]["output"];
  name: Scalars["String"]["output"];
  routingGuidance?: Maybe<Scalars["String"]["output"]>;
  skillPolicy: Scalars["AWSJSON"]["output"];
  slug: Scalars["String"]["output"];
  spaceAssignments: Array<AgentProfileSpaceAssignment>;
  spaces: Array<Space>;
  tenantId: Scalars["ID"]["output"];
  toolPolicy: Scalars["AWSJSON"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export type AgentProfileEditorCatalog = {
  __typename?: "AgentProfileEditorCatalog";
  builtInTools: Array<Scalars["String"]["output"]>;
  mcpServers: Array<AgentProfileMcpServerOption>;
  models: Array<ModelCatalogEntry>;
  skills: Array<AgentProfileSkillOption>;
  spaces: Array<Space>;
};

export type AgentProfileInput = {
  description?: InputMaybe<Scalars["String"]["input"]>;
  enabled?: InputMaybe<Scalars["Boolean"]["input"]>;
  executionControls?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  instructions: Scalars["String"]["input"];
  modelId: Scalars["ID"]["input"];
  name: Scalars["String"]["input"];
  routingGuidance?: InputMaybe<Scalars["String"]["input"]>;
  skillPolicy?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  slug?: InputMaybe<Scalars["String"]["input"]>;
  spaceIds?: InputMaybe<Array<Scalars["ID"]["input"]>>;
  toolPolicy?: InputMaybe<Scalars["AWSJSON"]["input"]>;
};

export type AgentProfileMcpServerOption = {
  __typename?: "AgentProfileMcpServerOption";
  authType: Scalars["String"]["output"];
  createdAt: Scalars["AWSDateTime"]["output"];
  enabled: Scalars["Boolean"]["output"];
  id: Scalars["ID"]["output"];
  name: Scalars["String"]["output"];
  slug: Scalars["String"]["output"];
  status: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
  tools?: Maybe<Scalars["AWSJSON"]["output"]>;
  transport: Scalars["String"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export type AgentProfileSkillOption = {
  __typename?: "AgentProfileSkillOption";
  category?: Maybe<Scalars["String"]["output"]>;
  description?: Maybe<Scalars["String"]["output"]>;
  displayName?: Maybe<Scalars["String"]["output"]>;
  icon?: Maybe<Scalars["String"]["output"]>;
  slug: Scalars["String"]["output"];
  tags?: Maybe<Array<Scalars["String"]["output"]>>;
};

export type AgentProfileSpaceAssignment = {
  __typename?: "AgentProfileSpaceAssignment";
  createdAt: Scalars["AWSDateTime"]["output"];
  profileId: Scalars["ID"]["output"];
  space?: Maybe<Space>;
  spaceId: Scalars["ID"]["output"];
  tenantId: Scalars["ID"]["output"];
};

export enum AgentRuntime {
  Flue = "FLUE",
}

export type AgentSkill = {
  __typename?: "AgentSkill";
  agentId: Scalars["ID"]["output"];
  config?: Maybe<Scalars["AWSJSON"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  enabled: Scalars["Boolean"]["output"];
  id: Scalars["ID"]["output"];
  modelOverride?: Maybe<Scalars["String"]["output"]>;
  permissions?: Maybe<Scalars["AWSJSON"]["output"]>;
  rateLimitRpm?: Maybe<Scalars["Int"]["output"]>;
  skillId: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
};

export type AgentSkillInput = {
  config?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  enabled?: InputMaybe<Scalars["Boolean"]["input"]>;
  modelOverride?: InputMaybe<Scalars["String"]["input"]>;
  permissions?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  rateLimitRpm?: InputMaybe<Scalars["Int"]["input"]>;
  skillId: Scalars["String"]["input"];
};

export enum AgentStatus {
  Busy = "BUSY",
  Error = "ERROR",
  Idle = "IDLE",
  Offline = "OFFLINE",
}

export type AgentStatusEvent = {
  __typename?: "AgentStatusEvent";
  agentId: Scalars["ID"]["output"];
  name: Scalars["String"]["output"];
  status: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export enum AgentType {
  Agent = "AGENT",
  Gateway = "GATEWAY",
  Supervisor = "SUPERVISOR",
}

export type AgentWakeupRequest = {
  __typename?: "AgentWakeupRequest";
  agent?: Maybe<Agent>;
  agentId: Scalars["ID"]["output"];
  claimedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  coalescedCount: Scalars["Int"]["output"];
  createdAt: Scalars["AWSDateTime"]["output"];
  finishedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  id: Scalars["ID"]["output"];
  idempotencyKey?: Maybe<Scalars["String"]["output"]>;
  payload?: Maybe<Scalars["AWSJSON"]["output"]>;
  reason?: Maybe<Scalars["String"]["output"]>;
  requestedAt: Scalars["AWSDateTime"]["output"];
  requestedByActorId?: Maybe<Scalars["String"]["output"]>;
  requestedByActorType?: Maybe<Scalars["String"]["output"]>;
  runId?: Maybe<Scalars["ID"]["output"]>;
  source: Scalars["String"]["output"];
  status: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
  triggerDetail?: Maybe<Scalars["String"]["output"]>;
};

export type AgentWorkspace = {
  __typename?: "AgentWorkspace";
  name: Scalars["String"]["output"];
  purpose?: Maybe<Scalars["String"]["output"]>;
  slug: Scalars["String"]["output"];
};

export type AgentWorkspaceEvent = {
  __typename?: "AgentWorkspaceEvent";
  actorId?: Maybe<Scalars["String"]["output"]>;
  actorType?: Maybe<Scalars["String"]["output"]>;
  agentId?: Maybe<Scalars["ID"]["output"]>;
  auditObjectKey?: Maybe<Scalars["String"]["output"]>;
  bucket: Scalars["String"]["output"];
  createdAt: Scalars["AWSDateTime"]["output"];
  eventType: Scalars["String"]["output"];
  id: Scalars["ID"]["output"];
  mirrorStatus: Scalars["String"]["output"];
  objectEtag?: Maybe<Scalars["String"]["output"]>;
  objectVersionId?: Maybe<Scalars["String"]["output"]>;
  parentEventId?: Maybe<Scalars["ID"]["output"]>;
  payload?: Maybe<Scalars["AWSJSON"]["output"]>;
  reason?: Maybe<Scalars["String"]["output"]>;
  runId?: Maybe<Scalars["ID"]["output"]>;
  sequencer: Scalars["String"]["output"];
  sourceObjectKey: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
};

export enum AgentWorkspaceEventType {
  EventRejected = "EVENT_REJECTED",
  MemoryChanged = "MEMORY_CHANGED",
  ReviewRequested = "REVIEW_REQUESTED",
  ReviewResponded = "REVIEW_RESPONDED",
  RunBlocked = "RUN_BLOCKED",
  RunCompleted = "RUN_COMPLETED",
  RunFailed = "RUN_FAILED",
  RunStarted = "RUN_STARTED",
  WorkRequested = "WORK_REQUESTED",
}

export type AgentWorkspaceProposedChange = {
  __typename?: "AgentWorkspaceProposedChange";
  after?: Maybe<Scalars["String"]["output"]>;
  before?: Maybe<Scalars["String"]["output"]>;
  diff?: Maybe<Scalars["String"]["output"]>;
  kind: Scalars["String"]["output"];
  path?: Maybe<Scalars["String"]["output"]>;
  summary: Scalars["String"]["output"];
};

export type AgentWorkspaceReview = {
  __typename?: "AgentWorkspaceReview";
  decisionEvents: Array<AgentWorkspaceEvent>;
  events: Array<AgentWorkspaceEvent>;
  kind: WorkspaceReviewKind;
  latestEvent?: Maybe<AgentWorkspaceEvent>;
  payload?: Maybe<Scalars["AWSJSON"]["output"]>;
  proposedChanges: Array<AgentWorkspaceProposedChange>;
  reason?: Maybe<Scalars["String"]["output"]>;
  requestedAt: Scalars["AWSDateTime"]["output"];
  responsibleUserId?: Maybe<Scalars["ID"]["output"]>;
  reviewBody?: Maybe<Scalars["String"]["output"]>;
  reviewEtag?: Maybe<Scalars["String"]["output"]>;
  reviewMissing?: Maybe<Scalars["Boolean"]["output"]>;
  reviewObjectKey?: Maybe<Scalars["String"]["output"]>;
  run: AgentWorkspaceRun;
  targetPath: Scalars["String"]["output"];
  threadId?: Maybe<Scalars["ID"]["output"]>;
};

export type AgentWorkspaceReviewDecisionInput = {
  expectedReviewEtag?: InputMaybe<Scalars["String"]["input"]>;
  idempotencyKey?: InputMaybe<Scalars["String"]["input"]>;
  notes?: InputMaybe<Scalars["String"]["input"]>;
  responseMarkdown?: InputMaybe<Scalars["String"]["input"]>;
};

export type AgentWorkspaceRun = {
  __typename?: "AgentWorkspaceRun";
  agentId: Scalars["ID"]["output"];
  completedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  currentThreadTurnId?: Maybe<Scalars["ID"]["output"]>;
  currentWakeupRequestId?: Maybe<Scalars["ID"]["output"]>;
  depth: Scalars["Int"]["output"];
  id: Scalars["ID"]["output"];
  inboxWriteCount: Scalars["Int"]["output"];
  lastEventAt: Scalars["AWSDateTime"]["output"];
  parentRunId?: Maybe<Scalars["ID"]["output"]>;
  requestObjectKey?: Maybe<Scalars["String"]["output"]>;
  sourceObjectKey?: Maybe<Scalars["String"]["output"]>;
  status: Scalars["String"]["output"];
  targetPath: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
  wakeupRetryCount: Scalars["Int"]["output"];
};

export enum AgentWorkspaceRunStatus {
  AwaitingReview = "AWAITING_REVIEW",
  AwaitingSubrun = "AWAITING_SUBRUN",
  Cancelled = "CANCELLED",
  Claimed = "CLAIMED",
  Completed = "COMPLETED",
  Expired = "EXPIRED",
  Failed = "FAILED",
  Pending = "PENDING",
  Processing = "PROCESSING",
}

export type AgentWorkspaceWait = {
  __typename?: "AgentWorkspaceWait";
  createdAt: Scalars["AWSDateTime"]["output"];
  id: Scalars["ID"]["output"];
  satisfiedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  status: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
  waitForRunId?: Maybe<Scalars["ID"]["output"]>;
  waitForTargetPath?: Maybe<Scalars["String"]["output"]>;
  waitingRunId: Scalars["ID"]["output"];
};

export type Applet = {
  __typename?: "Applet";
  agentVersion?: Maybe<Scalars["String"]["output"]>;
  appId: Scalars["ID"]["output"];
  artifact: Artifact;
  generatedAt: Scalars["AWSDateTime"]["output"];
  modelId?: Maybe<Scalars["String"]["output"]>;
  name: Scalars["String"]["output"];
  prompt?: Maybe<Scalars["String"]["output"]>;
  stdlibVersionAtGeneration: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
  threadId?: Maybe<Scalars["ID"]["output"]>;
  userId?: Maybe<Scalars["ID"]["output"]>;
  userName?: Maybe<Scalars["String"]["output"]>;
  version: Scalars["Int"]["output"];
};

export type AppletConnection = {
  __typename?: "AppletConnection";
  nextCursor?: Maybe<Scalars["String"]["output"]>;
  nodes: Array<Applet>;
};

export type AppletPayload = {
  __typename?: "AppletPayload";
  applet: Applet;
  files: Scalars["AWSJSON"]["output"];
  metadata: Scalars["AWSJSON"]["output"];
  source: Scalars["String"]["output"];
  themeCss?: Maybe<Scalars["String"]["output"]>;
};

export type AppletState = {
  __typename?: "AppletState";
  appId: Scalars["ID"]["output"];
  instanceId: Scalars["ID"]["output"];
  key: Scalars["String"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
  value?: Maybe<Scalars["AWSJSON"]["output"]>;
};

export type ApproveInboxItemInput = {
  decisionValues?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  reviewNotes?: InputMaybe<Scalars["String"]["input"]>;
};

export type ApproveManagedApplicationDeploymentInput = {
  destructiveConfirmation?: InputMaybe<Scalars["String"]["input"]>;
  jobId: Scalars["ID"]["input"];
  manifestDigest: Scalars["String"]["input"];
  planDigest: Scalars["String"]["input"];
};

export type ApproveOntologyChangeSetInput = {
  changeSetId: Scalars["ID"]["input"];
  tenantId: Scalars["ID"]["input"];
};

export type Artifact = {
  __typename?: "Artifact";
  agentId?: Maybe<Scalars["ID"]["output"]>;
  content?: Maybe<Scalars["String"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  favoritedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  id: Scalars["ID"]["output"];
  metadata?: Maybe<Scalars["AWSJSON"]["output"]>;
  s3Key?: Maybe<Scalars["String"]["output"]>;
  sourceMessageId?: Maybe<Scalars["ID"]["output"]>;
  status: ArtifactStatus;
  summary?: Maybe<Scalars["String"]["output"]>;
  tenantId: Scalars["ID"]["output"];
  threadId?: Maybe<Scalars["ID"]["output"]>;
  title: Scalars["String"]["output"];
  type: ArtifactType;
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export enum ArtifactStatus {
  Draft = "DRAFT",
  Final = "FINAL",
  Superseded = "SUPERSEDED",
}

export enum ArtifactType {
  Applet = "APPLET",
  AppletState = "APPLET_STATE",
  DataView = "DATA_VIEW",
  Digest = "DIGEST",
  Draft = "DRAFT",
  Note = "NOTE",
  Plan = "PLAN",
  Report = "REPORT",
}

/**
 * Deployment-scoped auth-provider bridge configuration. Secret values are never
 * exposed here; `clientSecretConfigured` means a server-side secret ref exists.
 */
export type AuthProviderResource = {
  __typename?: "AuthProviderResource";
  authorizeScopes: Scalars["String"]["output"];
  clientId: Scalars["String"]["output"];
  clientSecretConfigured: Scalars["Boolean"]["output"];
  cognitoAppClientIds: Array<Scalars["String"]["output"]>;
  cognitoIdentityProviderName: Scalars["String"]["output"];
  cognitoUserPoolId: Scalars["String"]["output"];
  createdAt: Scalars["AWSDateTime"]["output"];
  diagnostics: Scalars["AWSJSON"]["output"];
  displayName: Scalars["String"]["output"];
  id: Scalars["ID"]["output"];
  issuerUrl: Scalars["String"]["output"];
  lastErrorCode?: Maybe<Scalars["String"]["output"]>;
  lastValidatedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  /** 'workos' in v1. */
  providerKey: Scalars["String"]["output"];
  providerOptions: Scalars["AWSJSON"]["output"];
  /** 'single_sso' | 'provider_specific'. */
  publicOptionMode: Scalars["String"]["output"];
  publicOptionsPublished: Scalars["Boolean"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
  /**
   * 'unconfigured' | 'validating' | 'valid' | 'partially_valid' | 'invalid' |
   * 'rotating_secret' | 'disabled'.
   */
  validationStatus: Scalars["String"]["output"];
};

export type AutomationBuilderSession = {
  __typename?: "AutomationBuilderSession";
  draft: Scalars["AWSJSON"]["output"];
  setupPrompt: Scalars["String"]["output"];
  thread: Thread;
  threadCreated: Scalars["Boolean"]["output"];
};

export type BedrockModelImportCandidate = {
  __typename?: "BedrockModelImportCandidate";
  alreadyImported: Scalars["Boolean"]["output"];
  customizationsSupported: Array<Scalars["String"]["output"]>;
  displayName: Scalars["String"]["output"];
  enabled: Scalars["Boolean"]["output"];
  inferenceTypesSupported: Array<Scalars["String"]["output"]>;
  inputCostPerMillion?: Maybe<Scalars["Float"]["output"]>;
  inputModalities: Array<Scalars["String"]["output"]>;
  lifecycleStatus?: Maybe<Scalars["String"]["output"]>;
  modelId: Scalars["String"]["output"];
  modelName: Scalars["String"]["output"];
  outputCostPerMillion?: Maybe<Scalars["Float"]["output"]>;
  outputModalities: Array<Scalars["String"]["output"]>;
  pricingDiagnostics: Scalars["AWSJSON"]["output"];
  pricingSource?: Maybe<Scalars["String"]["output"]>;
  pricingStatus: Scalars["String"]["output"];
  provider: Scalars["String"]["output"];
  providerName: Scalars["String"]["output"];
  supportsStreaming: Scalars["Boolean"]["output"];
  supportsTools: Scalars["Boolean"]["output"];
  supportsVision: Scalars["Boolean"]["output"];
};

export type BootstrapCredentialLease = {
  __typename?: "BootstrapCredentialLease";
  createdAt: Scalars["AWSDateTime"]["output"];
  expiresAt: Scalars["AWSDateTime"]["output"];
  externalIdHash?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  inUseAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  leaseType: Scalars["String"]["output"];
  revokedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  roleArn?: Maybe<Scalars["String"]["output"]>;
  secretFingerprint: Scalars["String"]["output"];
  sessionId: Scalars["ID"]["output"];
  status: Scalars["String"]["output"];
  transferredAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  updatedAt: Scalars["AWSDateTime"]["output"];
  validatedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
};

export type BootstrapResult = {
  __typename?: "BootstrapResult";
  isNew: Scalars["Boolean"]["output"];
  tenant: Tenant;
  user: User;
};

export type BudgetPolicy = {
  __typename?: "BudgetPolicy";
  actionOnExceed: Scalars["String"]["output"];
  agentId?: Maybe<Scalars["ID"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  enabled: Scalars["Boolean"]["output"];
  id: Scalars["ID"]["output"];
  limitUsd: Scalars["Float"]["output"];
  period: Scalars["String"]["output"];
  scope: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
  userId?: Maybe<Scalars["ID"]["output"]>;
};

export type BudgetStatus = {
  __typename?: "BudgetStatus";
  billReconciledUsd: Scalars["Float"]["output"];
  estimatedUsd: Scalars["Float"]["output"];
  invocationReconciledUsd: Scalars["Float"]["output"];
  minimumReconciliationState: Scalars["String"]["output"];
  mismatchUsd: Scalars["Float"]["output"];
  percentUsed: Scalars["Float"]["output"];
  policy: BudgetPolicy;
  remainingUsd: Scalars["Float"]["output"];
  spentUsd: Scalars["Float"]["output"];
  status: Scalars["String"]["output"];
  unreconciledUsd: Scalars["Float"]["output"];
  visibleSpendUsd: Scalars["Float"]["output"];
};

export type CheckoutThreadInput = {
  runId: Scalars["String"]["input"];
};

export type CompanyBrainCapabilities = {
  __typename?: "CompanyBrainCapabilities";
  launch: Array<CompanyBrainCapability>;
  optional: Array<CompanyBrainCapability>;
};

export type CompanyBrainCapability = {
  __typename?: "CompanyBrainCapability";
  key: Scalars["String"]["output"];
  message?: Maybe<Scalars["String"]["output"]>;
  source?: Maybe<Scalars["String"]["output"]>;
  status: Scalars["String"]["output"];
};

export type CompanyBrainMigrationStatus = {
  __typename?: "CompanyBrainMigrationStatus";
  completedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  errorMessage?: Maybe<Scalars["String"]["output"]>;
  fromStorageTier?: Maybe<Scalars["String"]["output"]>;
  id?: Maybe<Scalars["ID"]["output"]>;
  phase: Scalars["String"]["output"];
  requestedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  rollbackWindowClosesAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  startedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  status: Scalars["String"]["output"];
  toStorageTier?: Maybe<Scalars["String"]["output"]>;
  validationSummary?: Maybe<Scalars["AWSJSON"]["output"]>;
};

export type CompanyBrainOperationalCounters = {
  __typename?: "CompanyBrainOperationalCounters";
  failedIngestCount: Scalars["Int"]["output"];
  graphEdgeCount?: Maybe<Scalars["Int"]["output"]>;
  graphEntityCount?: Maybe<Scalars["Int"]["output"]>;
  ingestionQueueDepth: Scalars["Int"]["output"];
  latestIngestAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  latestProjectionAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  ontologyVersion?: Maybe<Scalars["String"]["output"]>;
  sourceArtifactCount?: Maybe<Scalars["Int"]["output"]>;
  vaultProjectionCount?: Maybe<Scalars["Int"]["output"]>;
};

export type CompanyBrainOperatorEvidence = {
  __typename?: "CompanyBrainOperatorEvidence";
  backendMode?: Maybe<Scalars["String"]["output"]>;
  cogneeEndpoint?: Maybe<Scalars["String"]["output"]>;
  cogneeVersion?: Maybe<Scalars["String"]["output"]>;
  efsFileSystemId?: Maybe<Scalars["String"]["output"]>;
  embeddingModel?: Maybe<Scalars["String"]["output"]>;
  graphProvider?: Maybe<Scalars["String"]["output"]>;
  latestDeploymentJobId?: Maybe<Scalars["ID"]["output"]>;
  managedApplicationId?: Maybe<Scalars["ID"]["output"]>;
  migrationEvidence?: Maybe<Scalars["AWSJSON"]["output"]>;
  neptuneEndpoint?: Maybe<Scalars["String"]["output"]>;
  neptuneGraphId?: Maybe<Scalars["String"]["output"]>;
  operatorEvidence?: Maybe<Scalars["AWSJSON"]["output"]>;
  productionPosture?: Maybe<Scalars["String"]["output"]>;
  s3ArtifactRoot?: Maybe<Scalars["String"]["output"]>;
  s3ManifestRoot?: Maybe<Scalars["String"]["output"]>;
  s3VaultProjectionRoot?: Maybe<Scalars["String"]["output"]>;
  vectorDimension?: Maybe<Scalars["Int"]["output"]>;
  vectorProvider?: Maybe<Scalars["String"]["output"]>;
};

export type CompanyBrainStatus = {
  __typename?: "CompanyBrainStatus";
  activeBackend: Scalars["String"]["output"];
  capabilities: CompanyBrainCapabilities;
  counters: CompanyBrainOperationalCounters;
  createdAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  evidence?: Maybe<CompanyBrainOperatorEvidence>;
  healthStatus: Scalars["String"]["output"];
  migration: CompanyBrainMigrationStatus;
  status: Scalars["String"]["output"];
  storageTier: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
  updatedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
};

export enum ComplianceActorType {
  Agent = "AGENT",
  System = "SYSTEM",
  User = "USER",
}

export enum ComplianceAnchorState {
  Anchored = "ANCHORED",
  Pending = "PENDING",
}

export type ComplianceAnchorStatus = {
  __typename?: "ComplianceAnchorStatus";
  anchoredRecordedAt?: Maybe<Scalars["String"]["output"]>;
  cadenceId?: Maybe<Scalars["ID"]["output"]>;
  nextCadenceWithinMinutes?: Maybe<Scalars["Int"]["output"]>;
  state: ComplianceAnchorState;
};

export type ComplianceEvent = {
  __typename?: "ComplianceEvent";
  actor: Scalars["String"]["output"];
  actorType: ComplianceActorType;
  anchorStatus: ComplianceAnchorStatus;
  eventHash: Scalars["String"]["output"];
  eventId: Scalars["ID"]["output"];
  eventType: ComplianceEventType;
  occurredAt: Scalars["String"]["output"];
  payload: Scalars["AWSJSON"]["output"];
  prevHash?: Maybe<Scalars["String"]["output"]>;
  recordedAt: Scalars["String"]["output"];
  source: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
};

export type ComplianceEventConnection = {
  __typename?: "ComplianceEventConnection";
  edges: Array<ComplianceEventEdge>;
  pageInfo: ComplianceEventPageInfo;
};

export type ComplianceEventEdge = {
  __typename?: "ComplianceEventEdge";
  cursor: Scalars["String"]["output"];
  node: ComplianceEvent;
};

export type ComplianceEventFilter = {
  actorType?: InputMaybe<ComplianceActorType>;
  eventType?: InputMaybe<ComplianceEventType>;
  since?: InputMaybe<Scalars["String"]["input"]>;
  tenantId?: InputMaybe<Scalars["ID"]["input"]>;
  until?: InputMaybe<Scalars["String"]["input"]>;
};

export type ComplianceEventPageInfo = {
  __typename?: "ComplianceEventPageInfo";
  endCursor?: Maybe<Scalars["String"]["output"]>;
  hasNextPage: Scalars["Boolean"]["output"];
};

export enum ComplianceEventType {
  AgentCreated = "AGENT_CREATED",
  AgentDeleted = "AGENT_DELETED",
  AgentMigrated = "AGENT_MIGRATED",
  AgentSkillsChanged = "AGENT_SKILLS_CHANGED",
  ApprovalRecorded = "APPROVAL_RECORDED",
  AttachmentReceived = "ATTACHMENT_RECEIVED",
  AuthSigninFailure = "AUTH_SIGNIN_FAILURE",
  AuthSigninSuccess = "AUTH_SIGNIN_SUCCESS",
  AuthSignout = "AUTH_SIGNOUT",
  DataExportInitiated = "DATA_EXPORT_INITIATED",
  McpAdded = "MCP_ADDED",
  McpRemoved = "MCP_REMOVED",
  OutputArtifactProduced = "OUTPUT_ARTIFACT_PRODUCED",
  PluginActivationGranted = "PLUGIN_ACTIVATION_GRANTED",
  PluginActivationRevoked = "PLUGIN_ACTIVATION_REVOKED",
  PluginCutover = "PLUGIN_CUTOVER",
  PluginEntitlementGranted = "PLUGIN_ENTITLEMENT_GRANTED",
  PluginInstalled = "PLUGIN_INSTALLED",
  PluginInstallKeyCreated = "PLUGIN_INSTALL_KEY_CREATED",
  PluginInstallKeyFailed = "PLUGIN_INSTALL_KEY_FAILED",
  PluginInstallKeyRedeemed = "PLUGIN_INSTALL_KEY_REDEEMED",
  PluginInstallKeyRevoked = "PLUGIN_INSTALL_KEY_REVOKED",
  PluginUninstalled = "PLUGIN_UNINSTALLED",
  PolicyAllowed = "POLICY_ALLOWED",
  PolicyBlocked = "POLICY_BLOCKED",
  PolicyBypassed = "POLICY_BYPASSED",
  PolicyEvaluated = "POLICY_EVALUATED",
  SkillActivated = "SKILL_ACTIVATED",
  UserCreated = "USER_CREATED",
  UserDeleted = "USER_DELETED",
  UserDisabled = "USER_DISABLED",
  UserInvited = "USER_INVITED",
  WorkspaceGovernanceFileEdited = "WORKSPACE_GOVERNANCE_FILE_EDITED",
}

export type ComplianceExport = {
  __typename?: "ComplianceExport";
  completedAt?: Maybe<Scalars["String"]["output"]>;
  filter: Scalars["AWSJSON"]["output"];
  format: ComplianceExportFormat;
  jobError?: Maybe<Scalars["String"]["output"]>;
  jobId: Scalars["ID"]["output"];
  presignedUrl?: Maybe<Scalars["String"]["output"]>;
  presignedUrlExpiresAt?: Maybe<Scalars["String"]["output"]>;
  requestedAt: Scalars["String"]["output"];
  requestedByActorId: Scalars["ID"]["output"];
  s3Key?: Maybe<Scalars["String"]["output"]>;
  startedAt?: Maybe<Scalars["String"]["output"]>;
  status: ComplianceExportStatus;
  tenantId: Scalars["ID"]["output"];
};

export enum ComplianceExportFormat {
  Csv = "CSV",
  Json = "JSON",
}

export enum ComplianceExportStatus {
  Complete = "COMPLETE",
  Failed = "FAILED",
  Queued = "QUEUED",
  Running = "RUNNING",
}

export type ComplianceOperatorCheckResult = {
  __typename?: "ComplianceOperatorCheckResult";
  /**
   * True when the env var is non-empty. False means the dev/staging
   * environment hasn't configured the allowlist; admin UI surfaces a
   * distinct "allowlist not configured" message rather than silently
   * flipping to non-operator UI.
   */
  allowlistConfigured: Scalars["Boolean"]["output"];
  /** True when the caller's email matches THINKWORK_PLATFORM_OPERATOR_EMAILS. */
  isOperator: Scalars["Boolean"]["output"];
};

export type CompositionFeedbackSummary = {
  __typename?: "CompositionFeedbackSummary";
  negative: Scalars["Int"]["output"];
  positive: Scalars["Int"]["output"];
  skillId: Scalars["String"]["output"];
  total: Scalars["Int"]["output"];
};

export type ConcurrencySnapshot = {
  __typename?: "ConcurrencySnapshot";
  byAgent: Array<AgentCount>;
  byStatus: Array<StatusCount>;
  totalActive: Scalars["Int"]["output"];
};

export type ConfigureEmailDomainInput = {
  dnsRecords?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  domain: Scalars["String"]["input"];
  inboundVerifiedAt?: InputMaybe<Scalars["AWSDateTime"]["input"]>;
  ownershipType: EmailDomainOwnershipType;
  providerMetadata?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  sendingVerifiedAt?: InputMaybe<Scalars["AWSDateTime"]["input"]>;
  status?: InputMaybe<EmailDomainStatus>;
};

export type ConfigureEmailProviderInput = {
  activeForProduction?: InputMaybe<Scalars["Boolean"]["input"]>;
  credentialSecretRef?: InputMaybe<Scalars["String"]["input"]>;
  defaultFromEmail?: InputMaybe<Scalars["String"]["input"]>;
  displayName?: InputMaybe<Scalars["String"]["input"]>;
  domain?: InputMaybe<ConfigureEmailDomainInput>;
  metadata?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  provider: EmailChannelProvider;
  providerInstallId?: InputMaybe<Scalars["ID"]["input"]>;
  status?: InputMaybe<EmailProviderInstallStatus>;
  webhookSecretRef?: InputMaybe<Scalars["String"]["input"]>;
};

export type ConfigureWorkosAuthPluginInput = {
  clientId: Scalars["String"]["input"];
  /** Write-only. Required for first-time setup; omit to keep the existing secret. */
  clientSecret?: InputMaybe<Scalars["String"]["input"]>;
  installId: Scalars["ID"]["input"];
  issuerUrl: Scalars["String"]["input"];
  publicOptionLabel?: InputMaybe<Scalars["String"]["input"]>;
};

export type ConfigureWorkosAuthPluginResult = {
  __typename?: "ConfigureWorkosAuthPluginResult";
  install: PluginInstall;
  reference: TenantAuthProviderReference;
  resource: AuthProviderResource;
};

export type ConfirmAutomationDraftInput = {
  builderThreadId: Scalars["ID"]["input"];
  input: SaveAgentLoopInput;
};

export type ConnectN8nWorkflowInput = {
  active?: InputMaybe<Scalars["Boolean"]["input"]>;
  externalWorkflowId: Scalars["String"]["input"];
  externalWorkflowName: Scalars["String"]["input"];
  idempotencyKey: Scalars["String"]["input"];
  installId: Scalars["ID"]["input"];
  lastModifiedAt?: InputMaybe<Scalars["AWSDateTime"]["input"]>;
  triggerTypes?: InputMaybe<Array<Scalars["String"]["input"]>>;
};

export type ConnectN8nWorkflowResult = {
  __typename?: "ConnectN8nWorkflowResult";
  binding: WorkflowEngineBinding;
  created: Scalars["Boolean"]["output"];
  workflow: Workflow;
};

export type CostEvent = {
  __typename?: "CostEvent";
  agentId?: Maybe<Scalars["ID"]["output"]>;
  amountUsd: Scalars["Float"]["output"];
  billingAccountId?: Maybe<Scalars["String"]["output"]>;
  billingAttributionLevel?: Maybe<Scalars["String"]["output"]>;
  billingOperation?: Maybe<Scalars["String"]["output"]>;
  billingPeriodEnd?: Maybe<Scalars["AWSDateTime"]["output"]>;
  billingPeriodStart?: Maybe<Scalars["AWSDateTime"]["output"]>;
  billingServiceCode?: Maybe<Scalars["String"]["output"]>;
  cachedReadTokens?: Maybe<Scalars["Int"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  durationMs?: Maybe<Scalars["Int"]["output"]>;
  eventType: Scalars["String"]["output"];
  id: Scalars["ID"]["output"];
  inputTokens?: Maybe<Scalars["Int"]["output"]>;
  model?: Maybe<Scalars["String"]["output"]>;
  outputTokens?: Maybe<Scalars["Int"]["output"]>;
  provider?: Maybe<Scalars["String"]["output"]>;
  reconciliationAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  reconciliationSource?: Maybe<Scalars["String"]["output"]>;
  reconciliationState?: Maybe<Scalars["String"]["output"]>;
  requestId: Scalars["String"]["output"];
  sourceEvidenceRef?: Maybe<Scalars["AWSJSON"]["output"]>;
  tenantId: Scalars["ID"]["output"];
  traceEventId?: Maybe<Scalars["ID"]["output"]>;
  userId?: Maybe<Scalars["ID"]["output"]>;
};

export type CostRecordedEvent = {
  __typename?: "CostRecordedEvent";
  agentId?: Maybe<Scalars["ID"]["output"]>;
  agentName?: Maybe<Scalars["String"]["output"]>;
  amountUsd: Scalars["Float"]["output"];
  eventType: Scalars["String"]["output"];
  model?: Maybe<Scalars["String"]["output"]>;
  tenantId: Scalars["ID"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
  userEmail?: Maybe<Scalars["String"]["output"]>;
  userId?: Maybe<Scalars["ID"]["output"]>;
  userName?: Maybe<Scalars["String"]["output"]>;
};

export type CostSummary = {
  __typename?: "CostSummary";
  billReconciledUsd: Scalars["Float"]["output"];
  computeUsd: Scalars["Float"]["output"];
  enforcedUsd: Scalars["Float"]["output"];
  estimatedUsd: Scalars["Float"]["output"];
  evalUsd?: Maybe<Scalars["Float"]["output"]>;
  eventCount: Scalars["Int"]["output"];
  invocationReconciledUsd: Scalars["Float"]["output"];
  llmUsd: Scalars["Float"]["output"];
  minimumReconciliationState: Scalars["String"]["output"];
  mismatchUsd: Scalars["Float"]["output"];
  periodEnd: Scalars["AWSDateTime"]["output"];
  periodStart: Scalars["AWSDateTime"]["output"];
  toolsUsd: Scalars["Float"]["output"];
  totalInputTokens: Scalars["Int"]["output"];
  totalOutputTokens: Scalars["Int"]["output"];
  totalUsd: Scalars["Float"]["output"];
  unreconciledUsd: Scalars["Float"]["output"];
};

export type CreateArtifactInput = {
  agentId?: InputMaybe<Scalars["ID"]["input"]>;
  content?: InputMaybe<Scalars["String"]["input"]>;
  metadata?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  s3Key?: InputMaybe<Scalars["String"]["input"]>;
  sourceMessageId?: InputMaybe<Scalars["ID"]["input"]>;
  status?: InputMaybe<ArtifactStatus>;
  summary?: InputMaybe<Scalars["String"]["input"]>;
  tenantId: Scalars["ID"]["input"];
  threadId?: InputMaybe<Scalars["ID"]["input"]>;
  title: Scalars["String"]["input"];
  type: ArtifactType;
};

export type CreateEvalDatasetInput = {
  kind?: InputMaybe<Scalars["String"]["input"]>;
  name?: InputMaybe<Scalars["String"]["input"]>;
  slug: Scalars["String"]["input"];
};

export type CreateEvalTestCaseInput = {
  agentcoreEvaluatorIds?: InputMaybe<Array<Scalars["String"]["input"]>>;
  assertions?: InputMaybe<Array<EvalAssertionInput>>;
  category: Scalars["String"]["input"];
  enabled?: InputMaybe<Scalars["Boolean"]["input"]>;
  name: Scalars["String"]["input"];
  query: Scalars["String"]["input"];
  systemPrompt?: InputMaybe<Scalars["String"]["input"]>;
  tags?: InputMaybe<Array<Scalars["String"]["input"]>>;
};

export type CreateInboxItemInput = {
  config?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  description?: InputMaybe<Scalars["String"]["input"]>;
  entityId?: InputMaybe<Scalars["ID"]["input"]>;
  entityType?: InputMaybe<Scalars["String"]["input"]>;
  expiresAt?: InputMaybe<Scalars["AWSDateTime"]["input"]>;
  recipientId?: InputMaybe<Scalars["ID"]["input"]>;
  requesterId?: InputMaybe<Scalars["ID"]["input"]>;
  requesterType?: InputMaybe<Scalars["String"]["input"]>;
  tenantId: Scalars["ID"]["input"];
  title?: InputMaybe<Scalars["String"]["input"]>;
  type: Scalars["String"]["input"];
};

export type CreateKnowledgeBaseInput = {
  chunkOverlapPercent?: InputMaybe<Scalars["Int"]["input"]>;
  chunkSizeTokens?: InputMaybe<Scalars["Int"]["input"]>;
  chunkingStrategy?: InputMaybe<Scalars["String"]["input"]>;
  description?: InputMaybe<Scalars["String"]["input"]>;
  embeddingModel?: InputMaybe<Scalars["String"]["input"]>;
  name: Scalars["String"]["input"];
  tenantId: Scalars["ID"]["input"];
};

export type CreateN8nWorkflowBridgeInput = {
  idempotencyKey: Scalars["String"]["input"];
  workflowId: Scalars["ID"]["input"];
};

export type CreateQuickActionInput = {
  prompt: Scalars["String"]["input"];
  scope?: InputMaybe<QuickActionScope>;
  sortOrder?: InputMaybe<Scalars["Int"]["input"]>;
  tenantId: Scalars["ID"]["input"];
  title: Scalars["String"]["input"];
  workspaceAgentId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type CreateRecipeInput = {
  agentId?: InputMaybe<Scalars["ID"]["input"]>;
  genuiType: Scalars["String"]["input"];
  params: Scalars["AWSJSON"]["input"];
  server: Scalars["String"]["input"];
  sourceMessageId?: InputMaybe<Scalars["ID"]["input"]>;
  summary?: InputMaybe<Scalars["String"]["input"]>;
  templates?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  tenantId: Scalars["ID"]["input"];
  threadId?: InputMaybe<Scalars["ID"]["input"]>;
  title: Scalars["String"]["input"];
  tool: Scalars["String"]["input"];
};

export type CreateRoutineInput = {
  agentId?: InputMaybe<Scalars["ID"]["input"]>;
  asl?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  description?: InputMaybe<Scalars["String"]["input"]>;
  markdownSummary?: InputMaybe<Scalars["String"]["input"]>;
  name: Scalars["String"]["input"];
  owningAgentId?: InputMaybe<Scalars["ID"]["input"]>;
  stepManifest?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  tenantId: Scalars["ID"]["input"];
  visibility?: InputMaybe<RoutineVisibility>;
};

export type CreateScheduledJobInput = {
  agentId?: InputMaybe<Scalars["ID"]["input"]>;
  config?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  createdById?: InputMaybe<Scalars["String"]["input"]>;
  createdByType?: InputMaybe<Scalars["String"]["input"]>;
  description?: InputMaybe<Scalars["String"]["input"]>;
  name: Scalars["String"]["input"];
  prompt?: InputMaybe<Scalars["String"]["input"]>;
  routineId?: InputMaybe<Scalars["ID"]["input"]>;
  scheduleExpression?: InputMaybe<Scalars["String"]["input"]>;
  scheduleType?: InputMaybe<Scalars["String"]["input"]>;
  spaceId?: InputMaybe<Scalars["ID"]["input"]>;
  tenantId: Scalars["ID"]["input"];
  timezone?: InputMaybe<Scalars["String"]["input"]>;
  triggerType: Scalars["String"]["input"];
};

export type CreateSkillDraftInput = {
  currentContentHash?: InputMaybe<Scalars["String"]["input"]>;
  displayName?: InputMaybe<Scalars["String"]["input"]>;
  slug: Scalars["String"]["input"];
  source?: InputMaybe<SkillDraftSourceInput>;
  summary?: InputMaybe<Scalars["String"]["input"]>;
  title: Scalars["String"]["input"];
};

export type CreateSpaceInput = {
  accessMode?: InputMaybe<SpaceAccessMode>;
  description?: InputMaybe<Scalars["String"]["input"]>;
  name: Scalars["String"]["input"];
  tenantId: Scalars["ID"]["input"];
};

export type CreateTenantCredentialInput = {
  displayName: Scalars["String"]["input"];
  kind: TenantCredentialKind;
  metadataJson?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  secretJson: Scalars["AWSJSON"]["input"];
  slug?: InputMaybe<Scalars["String"]["input"]>;
  tenantId: Scalars["ID"]["input"];
};

export type CreateTenantInput = {
  name: Scalars["String"]["input"];
  plan?: InputMaybe<Scalars["String"]["input"]>;
  slug: Scalars["String"]["input"];
};

export type CreateThreadInput = {
  agentId?: InputMaybe<Scalars["ID"]["input"]>;
  assigneeId?: InputMaybe<Scalars["ID"]["input"]>;
  assigneeType?: InputMaybe<Scalars["String"]["input"]>;
  billingCode?: InputMaybe<Scalars["String"]["input"]>;
  channel?: InputMaybe<ThreadChannel>;
  createdById?: InputMaybe<Scalars["String"]["input"]>;
  createdByType?: InputMaybe<Scalars["String"]["input"]>;
  dueAt?: InputMaybe<Scalars["AWSDateTime"]["input"]>;
  firstMessage?: InputMaybe<Scalars["String"]["input"]>;
  labels?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  metadata?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  mobileTurnAttachments?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  mobileTurnClientId?: InputMaybe<Scalars["String"]["input"]>;
  mobileTurnMetadata?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  mobileTurnUserText?: InputMaybe<Scalars["String"]["input"]>;
  modelId?: InputMaybe<Scalars["String"]["input"]>;
  spaceId?: InputMaybe<Scalars["ID"]["input"]>;
  tenantId: Scalars["ID"]["input"];
  title: Scalars["String"]["input"];
};

export type CreateThreadLabelInput = {
  color?: InputMaybe<Scalars["String"]["input"]>;
  description?: InputMaybe<Scalars["String"]["input"]>;
  name: Scalars["String"]["input"];
  tenantId: Scalars["ID"]["input"];
};

export type CreateWakeupRequestInput = {
  agentId: Scalars["ID"]["input"];
  idempotencyKey?: InputMaybe<Scalars["String"]["input"]>;
  payload?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  reason?: InputMaybe<Scalars["String"]["input"]>;
  requestedByActorId?: InputMaybe<Scalars["String"]["input"]>;
  requestedByActorType?: InputMaybe<Scalars["String"]["input"]>;
  source: Scalars["String"]["input"];
  tenantId: Scalars["ID"]["input"];
  triggerDetail?: InputMaybe<Scalars["String"]["input"]>;
};

export type CreateWebhookInput = {
  agentId?: InputMaybe<Scalars["ID"]["input"]>;
  config?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  description?: InputMaybe<Scalars["String"]["input"]>;
  name: Scalars["String"]["input"];
  prompt?: InputMaybe<Scalars["String"]["input"]>;
  rateLimit?: InputMaybe<Scalars["Int"]["input"]>;
  routineId?: InputMaybe<Scalars["ID"]["input"]>;
  spaceId?: InputMaybe<Scalars["ID"]["input"]>;
  targetType: Scalars["String"]["input"];
  tenantId: Scalars["ID"]["input"];
};

export type CreateWorkItemInput = {
  applicable?: InputMaybe<Scalars["Boolean"]["input"]>;
  blocked?: InputMaybe<Scalars["Boolean"]["input"]>;
  dueAt?: InputMaybe<Scalars["AWSDateTime"]["input"]>;
  metadata?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  notes?: InputMaybe<Scalars["String"]["input"]>;
  ownerAgentId?: InputMaybe<Scalars["ID"]["input"]>;
  ownerUserId?: InputMaybe<Scalars["ID"]["input"]>;
  priority?: InputMaybe<WorkItemPriority>;
  required?: InputMaybe<Scalars["Boolean"]["input"]>;
  spaceId: Scalars["ID"]["input"];
  statusId?: InputMaybe<Scalars["ID"]["input"]>;
  templateSourceId?: InputMaybe<Scalars["ID"]["input"]>;
  tenantId?: InputMaybe<Scalars["ID"]["input"]>;
  threadId?: InputMaybe<Scalars["ID"]["input"]>;
  title: Scalars["String"]["input"];
};

export enum CrmStatusHandleState {
  Failed = "FAILED",
  Pending = "PENDING",
  Posted = "POSTED",
  RequiresReauth = "REQUIRES_REAUTH",
  WritebackBlocked = "WRITEBACK_BLOCKED",
}

export type CrmWorkLink = {
  __typename?: "CrmWorkLink";
  createdAt: Scalars["AWSDateTime"]["output"];
  failureCode?: Maybe<Scalars["String"]["output"]>;
  failureMessage?: Maybe<Scalars["String"]["output"]>;
  goalId?: Maybe<Scalars["ID"]["output"]>;
  id: Scalars["ID"]["output"];
  lastResumedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  lastWritebackState: CrmWritebackState;
  mcpServerId?: Maybe<Scalars["ID"]["output"]>;
  metadata: Scalars["AWSJSON"]["output"];
  objectId: Scalars["String"]["output"];
  objectType: CrmWorkLinkObjectType;
  objectUrl?: Maybe<Scalars["String"]["output"]>;
  outcomeKey: Scalars["String"]["output"];
  pluginInstallId?: Maybe<Scalars["ID"]["output"]>;
  provider: CrmWorkLinkProvider;
  requesterUserId?: Maybe<Scalars["ID"]["output"]>;
  spaceId?: Maybe<Scalars["ID"]["output"]>;
  startedAt: Scalars["AWSDateTime"]["output"];
  state: CrmWorkLinkState;
  statusHandleAction?: Maybe<Scalars["String"]["output"]>;
  statusHandleState: CrmStatusHandleState;
  statusHandleUrl?: Maybe<Scalars["String"]["output"]>;
  tenantId: Scalars["ID"]["output"];
  threadId?: Maybe<Scalars["ID"]["output"]>;
  updatedAt: Scalars["AWSDateTime"]["output"];
  workflowKey: CrmWorkflowKey;
};

export enum CrmWorkLinkObjectType {
  Opportunity = "OPPORTUNITY",
}

export enum CrmWorkLinkProvider {
  Twenty = "TWENTY",
}

export enum CrmWorkLinkState {
  Active = "ACTIVE",
  Archived = "ARCHIVED",
  Cancelled = "CANCELLED",
  Completed = "COMPLETED",
  Failed = "FAILED",
  Starting = "STARTING",
}

export enum CrmWorkflowKey {
  CustomerOnboarding = "CUSTOMER_ONBOARDING",
}

export enum CrmWritebackState {
  Blocked = "BLOCKED",
  Failed = "FAILED",
  Pending = "PENDING",
  Posted = "POSTED",
  RequiresReauth = "REQUIRES_REAUTH",
  Skipped = "SKIPPED",
}

export type CustomerOnboardingLinkedTaskResult = {
  __typename?: "CustomerOnboardingLinkedTaskResult";
  blocked: Scalars["Boolean"]["output"];
  checklistItemId: Scalars["ID"]["output"];
  externalTaskId: Scalars["String"]["output"];
  externalTaskUrl?: Maybe<Scalars["String"]["output"]>;
  provider: LinkedTaskProvider;
  status: LinkedTaskStatus;
  syncStatus: LinkedTaskSyncStatus;
  title: Scalars["String"]["output"];
};

export type CustomizeBindings = {
  __typename?: "CustomizeBindings";
  agentId: Scalars["ID"]["output"];
  connectedSkillIds: Array<Scalars["String"]["output"]>;
  connectedWorkflowSlugs: Array<Scalars["String"]["output"]>;
  connectedWorkflowTemplateSlugs: Array<Scalars["String"]["output"]>;
};

export type DailyCostPoint = {
  __typename?: "DailyCostPoint";
  computeUsd: Scalars["Float"]["output"];
  day: Scalars["String"]["output"];
  eventCount: Scalars["Int"]["output"];
  llmUsd: Scalars["Float"]["output"];
  toolsUsd: Scalars["Float"]["output"];
  totalUsd: Scalars["Float"]["output"];
};

export type DeactivatePluginInput = {
  installId: Scalars["ID"]["input"];
};

export type DecideRoutineApprovalInput = {
  decision: Scalars["AWSJSON"]["input"];
  inboxItemId: Scalars["ID"]["input"];
};

export type DelegateThreadInput = {
  agentId: Scalars["ID"]["input"];
  assigneeId: Scalars["ID"]["input"];
  reason?: InputMaybe<Scalars["String"]["input"]>;
  threadId: Scalars["ID"]["input"];
};

export type DeleteAgentLoopResult = {
  __typename?: "DeleteAgentLoopResult";
  id: Scalars["ID"]["output"];
  ok: Scalars["Boolean"]["output"];
};

/**
 * Result of `deleteScheduledJob`. `id` echoes the row that was removed;
 * `ok` is false when no row matched (already deleted, or tenant mismatch).
 * The EventBridge schedule, when one existed, is removed by the
 * job-schedule-manager Lambda first; if that side-effect fails the
 * resolver throws so the DB row is preserved and the caller can retry.
 */
export type DeleteScheduledJobResult = {
  __typename?: "DeleteScheduledJobResult";
  id: Scalars["ID"]["output"];
  ok: Scalars["Boolean"]["output"];
};

export type DeleteWorkItemViewInput = {
  id: Scalars["ID"]["input"];
  tenantId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type DeploymentEvidence = {
  __typename?: "DeploymentEvidence";
  bucket?: Maybe<Scalars["String"]["output"]>;
  jobId: Scalars["ID"]["output"];
  prefix?: Maybe<Scalars["String"]["output"]>;
  urls: Array<Scalars["String"]["output"]>;
};

export type DeploymentRelease = {
  __typename?: "DeploymentRelease";
  deployable: Scalars["Boolean"]["output"];
  draft: Scalars["Boolean"]["output"];
  htmlUrl: Scalars["String"]["output"];
  manifestSha256: Scalars["String"]["output"];
  manifestUrl: Scalars["String"]["output"];
  name?: Maybe<Scalars["String"]["output"]>;
  prerelease: Scalars["Boolean"]["output"];
  publishedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  signatureUrl?: Maybe<Scalars["String"]["output"]>;
  signed: Scalars["Boolean"]["output"];
  version: Scalars["String"]["output"];
};

export type DeploymentReleaseUpdate = {
  __typename?: "DeploymentReleaseUpdate";
  evidenceBucket?: Maybe<Scalars["String"]["output"]>;
  evidencePrefix: Scalars["String"]["output"];
  executionArn?: Maybe<Scalars["String"]["output"]>;
  message: Scalars["String"]["output"];
  release: DeploymentRelease;
  stateMachineArn: Scalars["String"]["output"];
};

export type DeploymentStatus = {
  __typename?: "DeploymentStatus";
  accountId?: Maybe<Scalars["String"]["output"]>;
  adminUrl?: Maybe<Scalars["String"]["output"]>;
  agentcoreStatus?: Maybe<Scalars["String"]["output"]>;
  apiEndpoint?: Maybe<Scalars["String"]["output"]>;
  appsyncRealtimeUrl?: Maybe<Scalars["String"]["output"]>;
  appsyncUrl?: Maybe<Scalars["String"]["output"]>;
  bucketName?: Maybe<Scalars["String"]["output"]>;
  cogneeBackendMode?: Maybe<Scalars["String"]["output"]>;
  cogneeClusterArn?: Maybe<Scalars["String"]["output"]>;
  cogneeEnabled: Scalars["Boolean"]["output"];
  cogneeEndpoint?: Maybe<Scalars["String"]["output"]>;
  cogneeLogGroupName?: Maybe<Scalars["String"]["output"]>;
  cogneeServiceName?: Maybe<Scalars["String"]["output"]>;
  databaseEndpoint?: Maybe<Scalars["String"]["output"]>;
  deploymentControllerArn?: Maybe<Scalars["String"]["output"]>;
  deploymentEvidenceBucket?: Maybe<Scalars["String"]["output"]>;
  deploymentRunnerProjectName?: Maybe<Scalars["String"]["output"]>;
  docsUrl?: Maybe<Scalars["String"]["output"]>;
  ecrUrl?: Maybe<Scalars["String"]["output"]>;
  hindsightEnabled: Scalars["Boolean"]["output"];
  hindsightEndpoint?: Maybe<Scalars["String"]["output"]>;
  managedApplications: Array<ManagedApplicationDeployment>;
  managedMemoryEnabled: Scalars["Boolean"]["output"];
  region: Scalars["String"]["output"];
  releaseManifestSha256?: Maybe<Scalars["String"]["output"]>;
  releaseManifestUrl?: Maybe<Scalars["String"]["output"]>;
  releaseVersion?: Maybe<Scalars["String"]["output"]>;
  source: Scalars["String"]["output"];
  stage: Scalars["String"]["output"];
  twentyAlbArn?: Maybe<Scalars["String"]["output"]>;
  twentyClusterArn?: Maybe<Scalars["String"]["output"]>;
  twentyProvisioned: Scalars["Boolean"]["output"];
  twentyRuntimeEnabled: Scalars["Boolean"]["output"];
  twentyServerLogGroupName?: Maybe<Scalars["String"]["output"]>;
  twentyServerServiceName?: Maybe<Scalars["String"]["output"]>;
  twentyTargetGroupArn?: Maybe<Scalars["String"]["output"]>;
  twentyUrl?: Maybe<Scalars["String"]["output"]>;
  twentyWorkerLogGroupName?: Maybe<Scalars["String"]["output"]>;
  twentyWorkerServiceName?: Maybe<Scalars["String"]["output"]>;
};

export type DisableSkillInput = {
  agentId: Scalars["ID"]["input"];
  skillId: Scalars["String"]["input"];
};

export type DisableWorkflowInput = {
  agentId: Scalars["ID"]["input"];
  slug: Scalars["String"]["input"];
};

export type DisableWorkflowTemplateInput = {
  agentId: Scalars["ID"]["input"];
  slug: Scalars["String"]["input"];
};

export enum EmailAllowlistType {
  Domain = "DOMAIN",
  Email = "EMAIL",
}

export enum EmailBodyDirection {
  Inbound = "INBOUND",
  Outbound = "OUTBOUND",
}

export type EmailBodyObjectRef = {
  __typename?: "EmailBodyObjectRef";
  contentHash: Scalars["String"]["output"];
  conversationId?: Maybe<Scalars["ID"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  direction: EmailBodyDirection;
  id: Scalars["ID"]["output"];
  metadata: Scalars["AWSJSON"]["output"];
  redactedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  redactedByUserId?: Maybe<Scalars["ID"]["output"]>;
  redactionReason?: Maybe<Scalars["String"]["output"]>;
  retentionUntil: Scalars["AWSDateTime"]["output"];
  tenantId: Scalars["ID"]["output"];
};

/**
 * Provider-neutral Email Channel Plugin contract (THNK-35 U2).
 *
 * Secrets and raw email bodies are intentionally absent from public GraphQL
 * payloads. Provider credentials and webhook secrets are exposed only as
 * configured booleans; retained body rows expose hashes, retention state, and
 * redaction metadata without returning the object reference or body content.
 */
export enum EmailChannelProvider {
  Resend = "RESEND",
  Sendgrid = "SENDGRID",
  Ses = "SES",
}

export type EmailChannelSummary = {
  __typename?: "EmailChannelSummary";
  blockingReadinessChecks: Array<EmailReadinessCheck>;
  domains: Array<EmailDomain>;
  ledgerEventCount: Scalars["Int"]["output"];
  productionReady: Scalars["Boolean"]["output"];
  providers: Array<EmailProviderInstall>;
  readinessChecks: Array<EmailReadinessCheck>;
  spacePolicies: Array<EmailSpacePolicy>;
};

export type EmailConversation = {
  __typename?: "EmailConversation";
  approvedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  approvedByUserId?: Maybe<Scalars["ID"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  id: Scalars["ID"]["output"];
  lastMessageAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  metadata: Scalars["AWSJSON"]["output"];
  participantHash: Scalars["String"]["output"];
  providerInstallId?: Maybe<Scalars["ID"]["output"]>;
  spaceId?: Maybe<Scalars["ID"]["output"]>;
  status: EmailConversationStatus;
  subject?: Maybe<Scalars["String"]["output"]>;
  tenantId: Scalars["ID"]["output"];
  threadId?: Maybe<Scalars["ID"]["output"]>;
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export enum EmailConversationStatus {
  Approved = "APPROVED",
  Blocked = "BLOCKED",
  Closed = "CLOSED",
  PendingApproval = "PENDING_APPROVAL",
}

export type EmailDomain = {
  __typename?: "EmailDomain";
  createdAt: Scalars["AWSDateTime"]["output"];
  dnsRecords: Scalars["AWSJSON"]["output"];
  domain: Scalars["String"]["output"];
  id: Scalars["ID"]["output"];
  inboundVerifiedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  ownershipType: EmailDomainOwnershipType;
  providerInstallId: Scalars["ID"]["output"];
  providerMetadata: Scalars["AWSJSON"]["output"];
  sendingVerifiedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  status: EmailDomainStatus;
  tenantId: Scalars["ID"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export enum EmailDomainOwnershipType {
  CustomerOwned = "CUSTOMER_OWNED",
  ThinkworkOwned = "THINKWORK_OWNED",
}

export enum EmailDomainStatus {
  Disabled = "DISABLED",
  Failed = "FAILED",
  Pending = "PENDING",
  Verified = "VERIFIED",
}

export type EmailLedgerEvent = {
  __typename?: "EmailLedgerEvent";
  actorUserId?: Maybe<Scalars["ID"]["output"]>;
  bodyObject?: Maybe<EmailBodyObjectRef>;
  conversationId?: Maybe<Scalars["ID"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  eventType: EmailLedgerEventType;
  fromEmail?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  inboxItemId?: Maybe<Scalars["ID"]["output"]>;
  messageId?: Maybe<Scalars["ID"]["output"]>;
  metadata: Scalars["AWSJSON"]["output"];
  providerEventId?: Maybe<Scalars["String"]["output"]>;
  providerInstallId?: Maybe<Scalars["ID"]["output"]>;
  providerMessageId?: Maybe<Scalars["String"]["output"]>;
  reasonCode?: Maybe<Scalars["String"]["output"]>;
  spaceId?: Maybe<Scalars["ID"]["output"]>;
  subject?: Maybe<Scalars["String"]["output"]>;
  tenantId: Scalars["ID"]["output"];
  threadId?: Maybe<Scalars["ID"]["output"]>;
  toEmails: Array<Scalars["String"]["output"]>;
};

export enum EmailLedgerEventType {
  ApprovalApproved = "APPROVAL_APPROVED",
  ApprovalDenied = "APPROVAL_DENIED",
  ApprovalRequested = "APPROVAL_REQUESTED",
  BodyRedacted = "BODY_REDACTED",
  BodyRetained = "BODY_RETAINED",
  DraftCreated = "DRAFT_CREATED",
  InboundAuthorized = "INBOUND_AUTHORIZED",
  InboundReceived = "INBOUND_RECEIVED",
  InboundRejected = "INBOUND_REJECTED",
  ProviderEvent = "PROVIDER_EVENT",
  ReadinessCheck = "READINESS_CHECK",
  SendAttempted = "SEND_ATTEMPTED",
  SendBlocked = "SEND_BLOCKED",
  SendFailed = "SEND_FAILED",
  SendSucceeded = "SEND_SUCCEEDED",
}

export type EmailProviderEvent = {
  __typename?: "EmailProviderEvent";
  createdAt: Scalars["AWSDateTime"]["output"];
  eventType: EmailProviderEventType;
  id: Scalars["ID"]["output"];
  ledgerEventId?: Maybe<Scalars["ID"]["output"]>;
  occurredAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  payloadMetadata: Scalars["AWSJSON"]["output"];
  providerEventId: Scalars["String"]["output"];
  providerInstallId: Scalars["ID"]["output"];
  providerMessageId?: Maybe<Scalars["String"]["output"]>;
  tenantId: Scalars["ID"]["output"];
};

export enum EmailProviderEventType {
  Bounced = "BOUNCED",
  Clicked = "CLICKED",
  Complained = "COMPLAINED",
  Delayed = "DELAYED",
  Delivered = "DELIVERED",
  Failed = "FAILED",
  Opened = "OPENED",
  Received = "RECEIVED",
  Sent = "SENT",
}

export type EmailProviderInstall = {
  __typename?: "EmailProviderInstall";
  activeForProduction: Scalars["Boolean"]["output"];
  createdAt: Scalars["AWSDateTime"]["output"];
  credentialConfigured: Scalars["Boolean"]["output"];
  defaultFromEmail?: Maybe<Scalars["String"]["output"]>;
  displayName?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  metadata: Scalars["AWSJSON"]["output"];
  provider: EmailChannelProvider;
  status: EmailProviderInstallStatus;
  tenantId: Scalars["ID"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
  webhookSecretConfigured: Scalars["Boolean"]["output"];
};

export enum EmailProviderInstallStatus {
  Disabled = "DISABLED",
  Failed = "FAILED",
  Pending = "PENDING",
  Ready = "READY",
}

export type EmailReadinessCheck = {
  __typename?: "EmailReadinessCheck";
  checkKey: EmailReadinessCheckKey;
  createdAt: Scalars["AWSDateTime"]["output"];
  domainId?: Maybe<Scalars["ID"]["output"]>;
  failureCode?: Maybe<Scalars["String"]["output"]>;
  failureMessage?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  lastCheckedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  metadata: Scalars["AWSJSON"]["output"];
  providerInstallId: Scalars["ID"]["output"];
  status: EmailReadinessStatus;
  tenantId: Scalars["ID"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export enum EmailReadinessCheckKey {
  Credentials = "CREDENTIALS",
  InboundReceiving = "INBOUND_RECEIVING",
  LoopTest = "LOOP_TEST",
  ProviderEvents = "PROVIDER_EVENTS",
  SendingDomain = "SENDING_DOMAIN",
  WebhookSignature = "WEBHOOK_SIGNATURE",
}

export enum EmailReadinessStatus {
  Blocked = "BLOCKED",
  Fail = "FAIL",
  Pass = "PASS",
  Pending = "PENDING",
}

export type EmailSpacePolicy = {
  __typename?: "EmailSpacePolicy";
  allowlists: Array<EmailSpaceSenderAllowlist>;
  createdAt: Scalars["AWSDateTime"]["output"];
  enabled: Scalars["Boolean"]["output"];
  firstSendReviewRequired: Scalars["Boolean"]["output"];
  id: Scalars["ID"]["output"];
  outsideSenderDefault: Scalars["String"]["output"];
  policy: Scalars["AWSJSON"]["output"];
  privateSpaceMembershipRequired: Scalars["Boolean"]["output"];
  providerInstallId?: Maybe<Scalars["ID"]["output"]>;
  registeredUsersAllowed: Scalars["Boolean"]["output"];
  spaceId: Scalars["ID"]["output"];
  tenantId: Scalars["ID"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export type EmailSpaceSenderAllowlist = {
  __typename?: "EmailSpaceSenderAllowlist";
  createdAt: Scalars["AWSDateTime"]["output"];
  createdByUserId?: Maybe<Scalars["ID"]["output"]>;
  id: Scalars["ID"]["output"];
  reason?: Maybe<Scalars["String"]["output"]>;
  spaceId: Scalars["ID"]["output"];
  tenantId: Scalars["ID"]["output"];
  value: Scalars["String"]["output"];
  valueType: EmailAllowlistType;
};

export type EnableWorkflowInput = {
  agentId: Scalars["ID"]["input"];
  slug: Scalars["String"]["input"];
};

export type EnableWorkflowTemplateInput = {
  agentId: Scalars["ID"]["input"];
  slug: Scalars["String"]["input"];
};

export type EscalateThreadInput = {
  agentId: Scalars["ID"]["input"];
  reason: Scalars["String"]["input"];
  threadId: Scalars["ID"]["input"];
};

export type EvalAssertionInput = {
  path?: InputMaybe<Scalars["String"]["input"]>;
  type: Scalars["String"]["input"];
  value?: InputMaybe<Scalars["String"]["input"]>;
};

export type EvalCaseCompleteness = {
  __typename?: "EvalCaseCompleteness";
  history: Scalars["Boolean"]["output"];
  traces: Scalars["Boolean"]["output"];
  truncated: Scalars["Boolean"]["output"];
  workspace: Scalars["Boolean"]["output"];
};

export type EvalDataset = {
  __typename?: "EvalDataset";
  archivedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  id: Scalars["ID"]["output"];
  kind: Scalars["String"]["output"];
  manifestSha?: Maybe<Scalars["String"]["output"]>;
  name?: Maybe<Scalars["String"]["output"]>;
  slug: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
  version: Scalars["Int"]["output"];
};

export type EvalDatasetCaseInput = {
  agentcoreEvaluatorIds?: InputMaybe<Array<Scalars["String"]["input"]>>;
  assertions?: InputMaybe<Array<EvalAssertionInput>>;
  caseId: Scalars["String"]["input"];
  category: Scalars["String"]["input"];
  enabled?: InputMaybe<Scalars["Boolean"]["input"]>;
  expectedBehavior?: InputMaybe<Scalars["String"]["input"]>;
  name: Scalars["String"]["input"];
  query: Scalars["String"]["input"];
  systemPrompt?: InputMaybe<Scalars["String"]["input"]>;
  tags?: InputMaybe<Array<Scalars["String"]["input"]>>;
};

export type EvalReplayAllowedTool = {
  __typename?: "EvalReplayAllowedTool";
  createdAt: Scalars["AWSDateTime"]["output"];
  id: Scalars["ID"]["output"];
  mode: Scalars["String"]["output"];
  serverName: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
  toolName: Scalars["String"]["output"];
};

export type EvalReplayMcpServer = {
  __typename?: "EvalReplayMcpServer";
  displayName: Scalars["String"]["output"];
  serverName: Scalars["String"]["output"];
  tools: Array<EvalReplayMcpTool>;
};

export type EvalReplayMcpTool = {
  __typename?: "EvalReplayMcpTool";
  access: Scalars["String"]["output"];
  description?: Maybe<Scalars["String"]["output"]>;
  name: Scalars["String"]["output"];
};

export type EvalResult = {
  __typename?: "EvalResult";
  actualOutput?: Maybe<Scalars["String"]["output"]>;
  agentSessionId?: Maybe<Scalars["String"]["output"]>;
  assertions: Scalars["AWSJSON"]["output"];
  category?: Maybe<Scalars["String"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  durationMs?: Maybe<Scalars["Int"]["output"]>;
  effectiveStatus: Scalars["String"]["output"];
  errorCause?: Maybe<Scalars["String"]["output"]>;
  errorMessage?: Maybe<Scalars["String"]["output"]>;
  evaluatorResults: Scalars["AWSJSON"]["output"];
  expected?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  input?: Maybe<Scalars["String"]["output"]>;
  overriddenAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  overriddenBy?: Maybe<Scalars["String"]["output"]>;
  overrideReason?: Maybe<Scalars["String"]["output"]>;
  overrideStatus?: Maybe<Scalars["String"]["output"]>;
  runId: Scalars["ID"]["output"];
  score?: Maybe<Scalars["Float"]["output"]>;
  status: Scalars["String"]["output"];
  systemPrompt?: Maybe<Scalars["String"]["output"]>;
  testCaseId?: Maybe<Scalars["ID"]["output"]>;
  testCaseName?: Maybe<Scalars["String"]["output"]>;
  threadTurnId?: Maybe<Scalars["ID"]["output"]>;
  workspaceProjection?: Maybe<Scalars["AWSJSON"]["output"]>;
};

export type EvalRun = {
  __typename?: "EvalRun";
  agentId?: Maybe<Scalars["ID"]["output"]>;
  agentName?: Maybe<Scalars["String"]["output"]>;
  categories: Array<Scalars["String"]["output"]>;
  completedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  costUsd?: Maybe<Scalars["Float"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  datasetId?: Maybe<Scalars["ID"]["output"]>;
  datasetVersion?: Maybe<Scalars["Int"]["output"]>;
  errorMessage?: Maybe<Scalars["String"]["output"]>;
  errored?: Maybe<Scalars["Int"]["output"]>;
  executionTarget: Scalars["String"]["output"];
  failed: Scalars["Int"]["output"];
  id: Scalars["ID"]["output"];
  isLegacyScoring: Scalars["Boolean"]["output"];
  model?: Maybe<Scalars["String"]["output"]>;
  passRate?: Maybe<Scalars["Float"]["output"]>;
  passed: Scalars["Int"]["output"];
  regression: Scalars["Boolean"]["output"];
  runtimeHost: Scalars["String"]["output"];
  scheduledJobId?: Maybe<Scalars["ID"]["output"]>;
  scoringVersion?: Maybe<Scalars["Int"]["output"]>;
  selectedTestCaseIds: Array<Scalars["ID"]["output"]>;
  startedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  status: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
  totalTests: Scalars["Int"]["output"];
};

export type EvalRunUpdateEvent = {
  __typename?: "EvalRunUpdateEvent";
  agentId?: Maybe<Scalars["ID"]["output"]>;
  errorMessage?: Maybe<Scalars["String"]["output"]>;
  failed?: Maybe<Scalars["Int"]["output"]>;
  passRate?: Maybe<Scalars["Float"]["output"]>;
  passed?: Maybe<Scalars["Int"]["output"]>;
  runId: Scalars["ID"]["output"];
  status: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
  totalTests?: Maybe<Scalars["Int"]["output"]>;
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export type EvalRunsPage = {
  __typename?: "EvalRunsPage";
  items: Array<EvalRun>;
  totalCount: Scalars["Int"]["output"];
};

export type EvalSpan = {
  __typename?: "EvalSpan";
  attributes: Scalars["AWSJSON"]["output"];
  name: Scalars["String"]["output"];
  timestamp?: Maybe<Scalars["AWSDateTime"]["output"]>;
};

export type EvalSummary = {
  __typename?: "EvalSummary";
  avgPassRate?: Maybe<Scalars["Float"]["output"]>;
  latestPassRate?: Maybe<Scalars["Float"]["output"]>;
  regressionCount: Scalars["Int"]["output"];
  totalRuns: Scalars["Int"]["output"];
};

export type EvalTestCase = {
  __typename?: "EvalTestCase";
  agentcoreEvaluatorIds: Array<Scalars["String"]["output"]>;
  assertions: Scalars["AWSJSON"]["output"];
  category: Scalars["String"]["output"];
  createdAt: Scalars["AWSDateTime"]["output"];
  datasetCaseId?: Maybe<Scalars["String"]["output"]>;
  datasetId?: Maybe<Scalars["ID"]["output"]>;
  enabled: Scalars["Boolean"]["output"];
  id: Scalars["ID"]["output"];
  name: Scalars["String"]["output"];
  query: Scalars["String"]["output"];
  source: Scalars["String"]["output"];
  systemPrompt?: Maybe<Scalars["String"]["output"]>;
  tags: Array<Scalars["String"]["output"]>;
  tenantId: Scalars["ID"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export type EvalTimeSeriesPoint = {
  __typename?: "EvalTimeSeriesPoint";
  day: Scalars["String"]["output"];
  failed: Scalars["Int"]["output"];
  passRate?: Maybe<Scalars["Float"]["output"]>;
  passed: Scalars["Int"]["output"];
  runCount: Scalars["Int"]["output"];
};

export type FlagThreadForEvalInput = {
  attributionFallback?: InputMaybe<Scalars["Boolean"]["input"]>;
  datasetSlug?: InputMaybe<Scalars["String"]["input"]>;
  newDatasetName?: InputMaybe<Scalars["String"]["input"]>;
  outcomeKind: Scalars["String"]["input"];
  resolutionTarget: Scalars["String"]["input"];
  skillSlug?: InputMaybe<Scalars["String"]["input"]>;
  threadId: Scalars["ID"]["input"];
  turnId: Scalars["ID"]["input"];
};

export type FlagThreadForEvalResult = {
  __typename?: "FlagThreadForEvalResult";
  case: EvalTestCase;
  completeness: EvalCaseCompleteness;
  dataset: EvalDataset;
};

export type HandleGenUiActionInput = {
  actionId: Scalars["String"]["input"];
  idempotencyKey: Scalars["String"]["input"];
  params?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  partId: Scalars["ID"]["input"];
  sourceMessageId: Scalars["ID"]["input"];
  specHash: Scalars["String"]["input"];
  threadId: Scalars["ID"]["input"];
};

export type HeartbeatActivityEvent = {
  __typename?: "HeartbeatActivityEvent";
  createdAt: Scalars["AWSDateTime"]["output"];
  heartbeatId: Scalars["ID"]["output"];
  message?: Maybe<Scalars["String"]["output"]>;
  status: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
};

export type ImportN8nRoutineInput = {
  description?: InputMaybe<Scalars["String"]["input"]>;
  n8nCredentialSlug?: InputMaybe<Scalars["String"]["input"]>;
  name?: InputMaybe<Scalars["String"]["input"]>;
  pdiCredentialSlug?: InputMaybe<Scalars["String"]["input"]>;
  tenantId: Scalars["ID"]["input"];
  workflowUrl: Scalars["String"]["input"];
};

export type ImportN8nWorkflowDraftInput = {
  description?: InputMaybe<Scalars["String"]["input"]>;
  n8nCredentialSlug?: InputMaybe<Scalars["String"]["input"]>;
  name?: InputMaybe<Scalars["String"]["input"]>;
  pdiCredentialSlug?: InputMaybe<Scalars["String"]["input"]>;
  tenantId: Scalars["ID"]["input"];
  workflowUrl: Scalars["String"]["input"];
};

export type ImportN8nWorkflowDraftResult = {
  __typename?: "ImportN8nWorkflowDraftResult";
  activationBlocked: Scalars["Boolean"]["output"];
  binding: WorkflowEngineBinding;
  credentialRequirements: Scalars["AWSJSON"]["output"];
  diagnostics: Array<N8nWorkflowDraftDiagnostic>;
  sourceMetadata: Scalars["AWSJSON"]["output"];
  workflow: Workflow;
  workflowVersion: WorkflowVersion;
};

export type ImportTenantBedrockModelInput = {
  displayName?: InputMaybe<Scalars["String"]["input"]>;
  enabled?: InputMaybe<Scalars["Boolean"]["input"]>;
  modelId: Scalars["String"]["input"];
};

export type ImportTenantBedrockModelsInput = {
  models: Array<ImportTenantBedrockModelInput>;
  tenantId: Scalars["ID"]["input"];
};

export type InboxItem = {
  __typename?: "InboxItem";
  comments: Array<InboxItemComment>;
  config?: Maybe<Scalars["AWSJSON"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  decidedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  decidedBy?: Maybe<Scalars["ID"]["output"]>;
  description?: Maybe<Scalars["String"]["output"]>;
  entityId?: Maybe<Scalars["ID"]["output"]>;
  entityType?: Maybe<Scalars["String"]["output"]>;
  expiresAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  id: Scalars["ID"]["output"];
  linkedThreads: Array<LinkedThread>;
  links: Array<InboxItemLink>;
  recipientId?: Maybe<Scalars["ID"]["output"]>;
  requesterId?: Maybe<Scalars["ID"]["output"]>;
  requesterType?: Maybe<Scalars["String"]["output"]>;
  reviewNotes?: Maybe<Scalars["String"]["output"]>;
  revision: Scalars["Int"]["output"];
  status: InboxItemStatus;
  tenantId: Scalars["ID"]["output"];
  title?: Maybe<Scalars["String"]["output"]>;
  type: Scalars["String"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export type InboxItemComment = {
  __typename?: "InboxItemComment";
  authorId?: Maybe<Scalars["ID"]["output"]>;
  authorType?: Maybe<Scalars["String"]["output"]>;
  content: Scalars["String"]["output"];
  createdAt: Scalars["AWSDateTime"]["output"];
  id: Scalars["ID"]["output"];
  inboxItemId: Scalars["ID"]["output"];
  tenantId: Scalars["ID"]["output"];
};

export type InboxItemDecisionInput = {
  comment?: InputMaybe<Scalars["String"]["input"]>;
  decisionValues?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  status: InboxItemStatus;
};

export type InboxItemLink = {
  __typename?: "InboxItemLink";
  createdAt: Scalars["AWSDateTime"]["output"];
  id: Scalars["ID"]["output"];
  inboxItemId: Scalars["ID"]["output"];
  linkedId?: Maybe<Scalars["ID"]["output"]>;
  linkedType?: Maybe<Scalars["String"]["output"]>;
  tenantId: Scalars["ID"]["output"];
};

export enum InboxItemStatus {
  Approved = "APPROVED",
  Cancelled = "CANCELLED",
  Expired = "EXPIRED",
  Pending = "PENDING",
  Rejected = "REJECTED",
  RevisionRequested = "REVISION_REQUESTED",
}

export type InboxItemStatusEvent = {
  __typename?: "InboxItemStatusEvent";
  inboxItemId: Scalars["ID"]["output"];
  status: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
  title?: Maybe<Scalars["String"]["output"]>;
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export type InstallPluginInput = {
  idempotencyKey: Scalars["String"]["input"];
  /** ThinkWork-provided one-time key for premium plugins when no entitlement exists. */
  installKey?: InputMaybe<Scalars["String"]["input"]>;
  pluginKey: Scalars["String"]["input"];
  /** Catalog version to pin; defaults to the latest published version. */
  version?: InputMaybe<Scalars["String"]["input"]>;
};

export type InviteMemberInput = {
  email: Scalars["String"]["input"];
  /** Optional idempotency key. See UpdateTenantInput.idempotencyKey. */
  idempotencyKey?: InputMaybe<Scalars["String"]["input"]>;
  name?: InputMaybe<Scalars["String"]["input"]>;
  role?: InputMaybe<Scalars["String"]["input"]>;
};

export type IssuePremiumPluginInstallKeyInput = {
  /** Optional expiry for the key; null means no explicit expiry. */
  expiresAt?: InputMaybe<Scalars["AWSDateTime"]["input"]>;
  pluginKey: Scalars["String"]["input"];
  /** Tenant the one-time key may grant. V1 keys are tenant-scoped for auditability. */
  tenantId: Scalars["ID"]["input"];
};

/**
 * Operator-only result for a one-time premium install key. `installKey` is the
 * raw key and is never stored or returned again.
 */
export type IssuePremiumPluginInstallKeyResult = {
  __typename?: "IssuePremiumPluginInstallKeyResult";
  entitlementProductKey: Scalars["String"]["output"];
  expiresAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  installKey: Scalars["String"]["output"];
  issuedAt: Scalars["AWSDateTime"]["output"];
  keyId: Scalars["ID"]["output"];
  pluginKey: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
};

export type KnowledgeBase = {
  __typename?: "KnowledgeBase";
  awsKbId?: Maybe<Scalars["String"]["output"]>;
  chunkOverlapPercent?: Maybe<Scalars["Int"]["output"]>;
  chunkSizeTokens?: Maybe<Scalars["Int"]["output"]>;
  chunkingStrategy: Scalars["String"]["output"];
  createdAt: Scalars["AWSDateTime"]["output"];
  description?: Maybe<Scalars["String"]["output"]>;
  documentCount?: Maybe<Scalars["Int"]["output"]>;
  embeddingModel: Scalars["String"]["output"];
  errorMessage?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  lastSyncAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  lastSyncStatus?: Maybe<Scalars["String"]["output"]>;
  name: Scalars["String"]["output"];
  slug: Scalars["String"]["output"];
  status: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export type KnowledgeBaseRetrievalHit = {
  __typename?: "KnowledgeBaseRetrievalHit";
  score?: Maybe<Scalars["Float"]["output"]>;
  snippet: Scalars["String"]["output"];
  source?: Maybe<Scalars["String"]["output"]>;
};

export type KnowledgeBaseRetrievalResult = {
  __typename?: "KnowledgeBaseRetrievalResult";
  hits: Array<KnowledgeBaseRetrievalHit>;
  status: Scalars["String"]["output"];
};

export enum KnowledgeGraphArtifactManifestKind {
  Export = "EXPORT",
  IngestionManifest = "INGESTION_MANIFEST",
  MigrationSnapshot = "MIGRATION_SNAPSHOT",
  SourceArtifact = "SOURCE_ARTIFACT",
  VaultProjection = "VAULT_PROJECTION",
}

export enum KnowledgeGraphArtifactManifestStatus {
  Active = "ACTIVE",
  Deleted = "DELETED",
  Failed = "FAILED",
  Superseded = "SUPERSEDED",
}

export type KnowledgeGraphArtifactManifestSummary = {
  __typename?: "KnowledgeGraphArtifactManifestSummary";
  artifactKind: KnowledgeGraphArtifactManifestKind;
  byteLength?: Maybe<Scalars["Int"]["output"]>;
  checksumSha256?: Maybe<Scalars["String"]["output"]>;
  contentEncoding?: Maybe<Scalars["String"]["output"]>;
  contentType?: Maybe<Scalars["String"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  embeddingModel?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  objectCount: Scalars["Int"]["output"];
  objectRef: Scalars["String"]["output"];
  ontologyMechanism?: Maybe<Scalars["String"]["output"]>;
  ontologyVersion?: Maybe<Scalars["String"]["output"]>;
  sourceCount: Scalars["Int"]["output"];
  sourceKind?: Maybe<KnowledgeGraphSourceKind>;
  sourceType?: Maybe<Scalars["String"]["output"]>;
  status: KnowledgeGraphArtifactManifestStatus;
  updatedAt: Scalars["AWSDateTime"]["output"];
  vectorDimension?: Maybe<Scalars["Int"]["output"]>;
};

export type KnowledgeGraphDeploymentChange = {
  __typename?: "KnowledgeGraphDeploymentChange";
  desiredEnabled: Scalars["Boolean"]["output"];
  message: Scalars["String"]["output"];
  workflowUrl: Scalars["String"]["output"];
};

export type KnowledgeGraphEntity = {
  __typename?: "KnowledgeGraphEntity";
  aliases: Array<Scalars["String"]["output"]>;
  cogneeNodeId: Scalars["String"]["output"];
  createdAt: Scalars["AWSDateTime"]["output"];
  diagnostics: Scalars["AWSJSON"]["output"];
  evidence: Array<KnowledgeGraphEvidence>;
  evidenceCount: Scalars["Int"]["output"];
  groundingStatus: KnowledgeGraphGroundingStatus;
  id: Scalars["ID"]["output"];
  ingestRunId: Scalars["ID"]["output"];
  label: Scalars["String"]["output"];
  lastSeenAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  normalizedLabel: Scalars["String"]["output"];
  ontologyEntityTypeId?: Maybe<Scalars["ID"]["output"]>;
  ontologyTypeSlug?: Maybe<Scalars["String"]["output"]>;
  properties: Scalars["AWSJSON"]["output"];
  provenanceStatus: KnowledgeGraphProvenanceStatus;
  relationshipCount: Scalars["Int"]["output"];
  relationships: Array<KnowledgeGraphRelationship>;
  sourceKind: KnowledgeGraphSourceKind;
  sourceRef: Scalars["String"]["output"];
  summary?: Maybe<Scalars["String"]["output"]>;
  tenantId: Scalars["ID"]["output"];
  threadId?: Maybe<Scalars["ID"]["output"]>;
  typeLabel?: Maybe<Scalars["String"]["output"]>;
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export type KnowledgeGraphEvidence = {
  __typename?: "KnowledgeGraphEvidence";
  charEnd?: Maybe<Scalars["Int"]["output"]>;
  charStart?: Maybe<Scalars["Int"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  entityId?: Maybe<Scalars["ID"]["output"]>;
  evidenceSourceKind: KnowledgeGraphEvidenceSourceKind;
  evidenceSourceRef?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  ingestRunId: Scalars["ID"]["output"];
  messageCreatedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  messageId?: Maybe<Scalars["ID"]["output"]>;
  messageRole?: Maybe<Scalars["String"]["output"]>;
  metadata: Scalars["AWSJSON"]["output"];
  observedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  relationshipId?: Maybe<Scalars["ID"]["output"]>;
  snippet: Scalars["String"]["output"];
  sourceKind: KnowledgeGraphSourceKind;
  sourceRef: Scalars["String"]["output"];
  speakerLabel?: Maybe<Scalars["String"]["output"]>;
  tenantId: Scalars["ID"]["output"];
  threadId?: Maybe<Scalars["ID"]["output"]>;
};

export enum KnowledgeGraphEvidenceSourceKind {
  BrainPage = "BRAIN_PAGE",
  BrainSection = "BRAIN_SECTION",
  CogneePayload = "COGNEE_PAYLOAD",
  HindsightObservation = "HINDSIGHT_OBSERVATION",
  Normalizer = "NORMALIZER",
  ThreadMessage = "THREAD_MESSAGE",
  WikiPage = "WIKI_PAGE",
  WikiSection = "WIKI_SECTION",
}

export type KnowledgeGraphGraph = {
  __typename?: "KnowledgeGraphGraph";
  edges: Array<KnowledgeGraphGraphEdge>;
  nodes: Array<KnowledgeGraphGraphNode>;
};

export type KnowledgeGraphGraphEdge = {
  __typename?: "KnowledgeGraphGraphEdge";
  evidenceCount: Scalars["Int"]["output"];
  groundingStatus: KnowledgeGraphGroundingStatus;
  id: Scalars["ID"]["output"];
  label: Scalars["String"]["output"];
  ontologyTypeSlug?: Maybe<Scalars["String"]["output"]>;
  provenanceStatus: KnowledgeGraphProvenanceStatus;
  relationshipId: Scalars["ID"]["output"];
  source: Scalars["ID"]["output"];
  target: Scalars["ID"]["output"];
};

export type KnowledgeGraphGraphNode = {
  __typename?: "KnowledgeGraphGraphNode";
  entityId: Scalars["ID"]["output"];
  evidenceCount: Scalars["Int"]["output"];
  groundingStatus: KnowledgeGraphGroundingStatus;
  id: Scalars["ID"]["output"];
  label: Scalars["String"]["output"];
  ontologyTypeSlug?: Maybe<Scalars["String"]["output"]>;
  provenanceStatus: KnowledgeGraphProvenanceStatus;
  relationshipCount: Scalars["Int"]["output"];
  typeLabel?: Maybe<Scalars["String"]["output"]>;
};

export enum KnowledgeGraphGroundingStatus {
  Conflict = "CONFLICT",
  Grounded = "GROUNDED",
  UnapprovedType = "UNAPPROVED_TYPE",
  Ungrounded = "UNGROUNDED",
  Unknown = "UNKNOWN",
}

export type KnowledgeGraphHealthCheck = {
  __typename?: "KnowledgeGraphHealthCheck";
  checkedAt: Scalars["AWSDateTime"]["output"];
  endpoint?: Maybe<Scalars["String"]["output"]>;
  healthy: Scalars["Boolean"]["output"];
  latencyMs: Scalars["Int"]["output"];
  message: Scalars["String"]["output"];
  statusCode?: Maybe<Scalars["Int"]["output"]>;
};

export type KnowledgeGraphIngestRun = {
  __typename?: "KnowledgeGraphIngestRun";
  artifactManifests: Array<KnowledgeGraphArtifactManifestSummary>;
  cogneeDatasetId?: Maybe<Scalars["String"]["output"]>;
  cogneeDatasetName: Scalars["String"]["output"];
  createdAt: Scalars["AWSDateTime"]["output"];
  diagnosticCount: Scalars["Int"]["output"];
  durationMs?: Maybe<Scalars["Int"]["output"]>;
  entityCount: Scalars["Int"]["output"];
  error?: Maybe<Scalars["String"]["output"]>;
  evidenceCount: Scalars["Int"]["output"];
  finishedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  id: Scalars["ID"]["output"];
  input: Scalars["AWSJSON"]["output"];
  messageCount: Scalars["Int"]["output"];
  metadata: Scalars["AWSJSON"]["output"];
  metrics: Scalars["AWSJSON"]["output"];
  relationshipCount: Scalars["Int"]["output"];
  requestedByUserId?: Maybe<Scalars["ID"]["output"]>;
  sourceKind: KnowledgeGraphSourceKind;
  sourceLabel?: Maybe<Scalars["String"]["output"]>;
  sourceRef: Scalars["String"]["output"];
  startedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  status: KnowledgeGraphIngestStatus;
  tenantId: Scalars["ID"]["output"];
  threadId?: Maybe<Scalars["ID"]["output"]>;
  trigger: Scalars["String"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export enum KnowledgeGraphIngestStatus {
  Canceled = "CANCELED",
  Failed = "FAILED",
  Queued = "QUEUED",
  Running = "RUNNING",
  StaleNoop = "STALE_NOOP",
  Succeeded = "SUCCEEDED",
}

export enum KnowledgeGraphProvenanceStatus {
  Missing = "MISSING",
  Strong = "STRONG",
  Weak = "WEAK",
}

export type KnowledgeGraphRelationship = {
  __typename?: "KnowledgeGraphRelationship";
  cogneeEdgeId?: Maybe<Scalars["String"]["output"]>;
  confidence?: Maybe<Scalars["Float"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  diagnostics: Scalars["AWSJSON"]["output"];
  evidence: Array<KnowledgeGraphEvidence>;
  evidenceCount: Scalars["Int"]["output"];
  groundingStatus: KnowledgeGraphGroundingStatus;
  id: Scalars["ID"]["output"];
  ingestRunId: Scalars["ID"]["output"];
  label: Scalars["String"]["output"];
  lastSeenAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  ontologyRelationshipTypeId?: Maybe<Scalars["ID"]["output"]>;
  ontologyTypeSlug?: Maybe<Scalars["String"]["output"]>;
  properties: Scalars["AWSJSON"]["output"];
  provenanceStatus: KnowledgeGraphProvenanceStatus;
  sourceEntityId: Scalars["ID"]["output"];
  sourceKind: KnowledgeGraphSourceKind;
  sourceRef: Scalars["String"]["output"];
  targetEntityId: Scalars["ID"]["output"];
  tenantId: Scalars["ID"]["output"];
  threadId?: Maybe<Scalars["ID"]["output"]>;
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export type KnowledgeGraphSearchEntity = {
  __typename?: "KnowledgeGraphSearchEntity";
  aliases: Array<Scalars["String"]["output"]>;
  evidenceCount: Scalars["Int"]["output"];
  id: Scalars["ID"]["output"];
  label: Scalars["String"]["output"];
  observationIds: Array<Scalars["String"]["output"]>;
  relationshipCount: Scalars["Int"]["output"];
  summary?: Maybe<Scalars["String"]["output"]>;
  typeSlug?: Maybe<Scalars["String"]["output"]>;
};

export type KnowledgeGraphSearchRelationship = {
  __typename?: "KnowledgeGraphSearchRelationship";
  fromLabel: Scalars["String"]["output"];
  id: Scalars["ID"]["output"];
  label: Scalars["String"]["output"];
  toLabel: Scalars["String"]["output"];
  typeSlug?: Maybe<Scalars["String"]["output"]>;
};

export type KnowledgeGraphSearchResult = {
  __typename?: "KnowledgeGraphSearchResult";
  entities: Array<KnowledgeGraphSearchEntity>;
  relationships: Array<KnowledgeGraphSearchRelationship>;
};

export enum KnowledgeGraphSourceKind {
  Brain = "BRAIN",
  Observations = "OBSERVATIONS",
  Thread = "THREAD",
  Wiki = "WIKI",
}

export type KnowledgeGraphThreadCandidate = {
  __typename?: "KnowledgeGraphThreadCandidate";
  lastIngestRun?: Maybe<KnowledgeGraphIngestRun>;
  lastMessageAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  messageCount: Scalars["Int"]["output"];
  number: Scalars["Int"]["output"];
  requesterName?: Maybe<Scalars["String"]["output"]>;
  requesterUserId?: Maybe<Scalars["ID"]["output"]>;
  spaceId?: Maybe<Scalars["ID"]["output"]>;
  spaceName?: Maybe<Scalars["String"]["output"]>;
  tenantId: Scalars["ID"]["output"];
  threadId: Scalars["ID"]["output"];
  title: Scalars["String"]["output"];
};

export type LinkedTask = {
  __typename?: "LinkedTask";
  assigneeDisplay?: Maybe<Scalars["String"]["output"]>;
  assigneeExternalId?: Maybe<Scalars["String"]["output"]>;
  blocked: Scalars["Boolean"]["output"];
  checklistItemId?: Maybe<Scalars["ID"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  events: Array<LinkedTaskEvent>;
  externalTaskId: Scalars["String"]["output"];
  externalTaskUrl?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  lastSyncedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  metadata?: Maybe<Scalars["AWSJSON"]["output"]>;
  provider: LinkedTaskProvider;
  required: Scalars["Boolean"]["output"];
  roleKey?: Maybe<Scalars["String"]["output"]>;
  spaceId: Scalars["ID"]["output"];
  status: LinkedTaskStatus;
  syncStatus: LinkedTaskSyncStatus;
  tenantId: Scalars["ID"]["output"];
  threadId: Scalars["ID"]["output"];
  title: Scalars["String"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export type LinkedTaskEvent = {
  __typename?: "LinkedTaskEvent";
  createdAt: Scalars["AWSDateTime"]["output"];
  eventType: LinkedTaskEventType;
  externalEventId?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  linkedTaskId: Scalars["ID"]["output"];
  message?: Maybe<Scalars["String"]["output"]>;
  metadata?: Maybe<Scalars["AWSJSON"]["output"]>;
  newStatus?: Maybe<LinkedTaskStatus>;
  occurredAt: Scalars["AWSDateTime"]["output"];
  previousStatus?: Maybe<LinkedTaskStatus>;
  provider: LinkedTaskProvider;
  spaceId: Scalars["ID"]["output"];
  tenantId: Scalars["ID"]["output"];
  threadId: Scalars["ID"]["output"];
};

export enum LinkedTaskEventType {
  Blocked = "BLOCKED",
  CommentAdded = "COMMENT_ADDED",
  Completed = "COMPLETED",
  Created = "CREATED",
  DueDateChanged = "DUE_DATE_CHANGED",
  Reassigned = "REASSIGNED",
  StatusChanged = "STATUS_CHANGED",
  SyncFailed = "SYNC_FAILED",
  WritebackPosted = "WRITEBACK_POSTED",
}

export enum LinkedTaskProvider {
  Lastmile = "LASTMILE",
  Thinkwork = "THINKWORK",
  Twenty = "TWENTY",
}

export enum LinkedTaskStatus {
  Blocked = "BLOCKED",
  Cancelled = "CANCELLED",
  Completed = "COMPLETED",
  InProgress = "IN_PROGRESS",
  NotApplicable = "NOT_APPLICABLE",
  Todo = "TODO",
  Unknown = "UNKNOWN",
}

export enum LinkedTaskSyncStatus {
  Error = "ERROR",
  Pending = "PENDING",
  Synced = "SYNCED",
  Warning = "WARNING",
}

export type LinkedThread = {
  __typename?: "LinkedThread";
  id: Scalars["ID"]["output"];
  identifier?: Maybe<Scalars["String"]["output"]>;
  number: Scalars["Int"]["output"];
  status: Scalars["String"]["output"];
  title: Scalars["String"]["output"];
};

export type ManagedApplication = {
  __typename?: "ManagedApplication";
  createdAt: Scalars["AWSDateTime"]["output"];
  currentStatus: Scalars["String"]["output"];
  desiredConfig: Scalars["AWSJSON"]["output"];
  desiredStatus: Scalars["String"]["output"];
  displayName: Scalars["String"]["output"];
  id: Scalars["ID"]["output"];
  key: Scalars["String"]["output"];
  lastJobId?: Maybe<Scalars["ID"]["output"]>;
  selectedManifestDigest?: Maybe<Scalars["String"]["output"]>;
  selectedReleaseVersion?: Maybe<Scalars["String"]["output"]>;
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export type ManagedApplicationDeployment = {
  __typename?: "ManagedApplicationDeployment";
  albArn?: Maybe<Scalars["String"]["output"]>;
  backendMode?: Maybe<Scalars["String"]["output"]>;
  clusterArn?: Maybe<Scalars["String"]["output"]>;
  databaseName?: Maybe<Scalars["String"]["output"]>;
  description: Scalars["String"]["output"];
  displayName: Scalars["String"]["output"];
  enabled: Scalars["Boolean"]["output"];
  endpoint?: Maybe<Scalars["String"]["output"]>;
  key: Scalars["String"]["output"];
  logGroupName?: Maybe<Scalars["String"]["output"]>;
  logGroupNames: Array<Scalars["String"]["output"]>;
  managedMcpInstallAvailable: Scalars["Boolean"]["output"];
  managedMcpInstalled: Scalars["Boolean"]["output"];
  managedMcpMessage?: Maybe<Scalars["String"]["output"]>;
  managedMcpServerId?: Maybe<Scalars["ID"]["output"]>;
  managedMcpStatus: Scalars["String"]["output"];
  message?: Maybe<Scalars["String"]["output"]>;
  provisioned: Scalars["Boolean"]["output"];
  runtimeEnabled: Scalars["Boolean"]["output"];
  serviceName?: Maybe<Scalars["String"]["output"]>;
  serviceNames: Array<Scalars["String"]["output"]>;
  status: Scalars["String"]["output"];
  storageBucketName?: Maybe<Scalars["String"]["output"]>;
  targetGroupArn?: Maybe<Scalars["String"]["output"]>;
  url?: Maybe<Scalars["String"]["output"]>;
  workflowCapabilityFlags: Scalars["AWSJSON"]["output"];
  workflowReadinessReasons: Scalars["AWSJSON"]["output"];
  workflowReadinessState: Scalars["String"]["output"];
};

export enum ManagedApplicationDeploymentAction {
  Destroy = "DESTROY",
  Enable = "ENABLE",
  Park = "PARK",
}

export type ManagedApplicationDeploymentChange = {
  __typename?: "ManagedApplicationDeploymentChange";
  action: Scalars["String"]["output"];
  desiredEnabled: Scalars["Boolean"]["output"];
  key: Scalars["String"]["output"];
  message: Scalars["String"]["output"];
  provisioned: Scalars["Boolean"]["output"];
  runtimeEnabled: Scalars["Boolean"]["output"];
  workflowUrl: Scalars["String"]["output"];
};

export type ManagedApplicationDeploymentEvent = {
  __typename?: "ManagedApplicationDeploymentEvent";
  createdAt: Scalars["AWSDateTime"]["output"];
  eventType: Scalars["String"]["output"];
  id: Scalars["ID"]["output"];
  jobId: Scalars["ID"]["output"];
  message: Scalars["String"]["output"];
  payload: Scalars["AWSJSON"]["output"];
};

export type ManagedApplicationDeploymentJob = {
  __typename?: "ManagedApplicationDeploymentJob";
  appKey: Scalars["String"]["output"];
  applicationId?: Maybe<Scalars["ID"]["output"]>;
  applyExecutionArn?: Maybe<Scalars["String"]["output"]>;
  approvalRequired: Scalars["Boolean"]["output"];
  approvedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  approvedByUserId?: Maybe<Scalars["ID"]["output"]>;
  codebuildBuildArn?: Maybe<Scalars["String"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  dataImpact: Scalars["AWSJSON"]["output"];
  desiredConfigVersion: Scalars["String"]["output"];
  errorMessage?: Maybe<Scalars["String"]["output"]>;
  events: Array<ManagedApplicationDeploymentEvent>;
  evidenceBucket?: Maybe<Scalars["String"]["output"]>;
  evidencePrefix?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  manifestDigest: Scalars["String"]["output"];
  operation: Scalars["String"]["output"];
  planDigest?: Maybe<Scalars["String"]["output"]>;
  planExecutionArn?: Maybe<Scalars["String"]["output"]>;
  planSummary: Scalars["AWSJSON"]["output"];
  rejectedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  rejectedByUserId?: Maybe<Scalars["ID"]["output"]>;
  releaseVersion: Scalars["String"]["output"];
  requestedByUserId?: Maybe<Scalars["ID"]["output"]>;
  stateMachineArn?: Maybe<Scalars["String"]["output"]>;
  status: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export type ManagedApplicationHealthCheck = {
  __typename?: "ManagedApplicationHealthCheck";
  checkedAt: Scalars["AWSDateTime"]["output"];
  endpoint?: Maybe<Scalars["String"]["output"]>;
  healthy: Scalars["Boolean"]["output"];
  key: Scalars["String"]["output"];
  latencyMs: Scalars["Int"]["output"];
  message: Scalars["String"]["output"];
  statusCode?: Maybe<Scalars["Int"]["output"]>;
};

export type ManagedApplicationMcpRegistration = {
  __typename?: "ManagedApplicationMcpRegistration";
  installed: Scalars["Boolean"]["output"];
  key: Scalars["String"]["output"];
  message: Scalars["String"]["output"];
  serverId?: Maybe<Scalars["ID"]["output"]>;
  status: Scalars["String"]["output"];
};

/**
 * Batch mark a caller's threads read or unread. The tenant is resolved from the
 * authenticated caller (never the input); only the caller's own
 * thread_participants rows are written. read: false marks unread.
 */
export type MarkThreadsReadInput = {
  read?: Scalars["Boolean"]["input"];
  threadIds: Array<Scalars["ID"]["input"]>;
};

export type MarkThreadsReadResult = {
  __typename?: "MarkThreadsReadResult";
  updated: Scalars["Int"]["output"];
};

export type MemoryContent = {
  __typename?: "MemoryContent";
  text?: Maybe<Scalars["String"]["output"]>;
};

export type MemoryGraph = {
  __typename?: "MemoryGraph";
  edges: Array<MemoryGraphEdge>;
  nodes: Array<MemoryGraphNode>;
};

export type MemoryGraphEdge = {
  __typename?: "MemoryGraphEdge";
  label?: Maybe<Scalars["String"]["output"]>;
  source: Scalars["String"]["output"];
  target: Scalars["String"]["output"];
  type: Scalars["String"]["output"];
  weight: Scalars["Float"]["output"];
};

export type MemoryGraphNode = {
  __typename?: "MemoryGraphNode";
  edgeCount: Scalars["Int"]["output"];
  entityType?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  label: Scalars["String"]["output"];
  latestThreadId?: Maybe<Scalars["String"]["output"]>;
  strategy?: Maybe<Scalars["String"]["output"]>;
  type: Scalars["String"]["output"];
};

export type MemoryRecord = {
  __typename?: "MemoryRecord";
  accessCount?: Maybe<Scalars["Int"]["output"]>;
  /** @deprecated Use userSlug */
  agentSlug?: Maybe<Scalars["String"]["output"]>;
  confidence?: Maybe<Scalars["Float"]["output"]>;
  content?: Maybe<MemoryContent>;
  context?: Maybe<Scalars["String"]["output"]>;
  createdAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  eventDate?: Maybe<Scalars["AWSDateTime"]["output"]>;
  expiresAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  factType?: Maybe<Scalars["String"]["output"]>;
  memoryRecordId: Scalars["ID"]["output"];
  mentionedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  namespace?: Maybe<Scalars["String"]["output"]>;
  occurredEnd?: Maybe<Scalars["AWSDateTime"]["output"]>;
  occurredStart?: Maybe<Scalars["AWSDateTime"]["output"]>;
  proofCount?: Maybe<Scalars["Int"]["output"]>;
  score?: Maybe<Scalars["Float"]["output"]>;
  strategy?: Maybe<Scalars["String"]["output"]>;
  strategyId?: Maybe<Scalars["String"]["output"]>;
  tags?: Maybe<Array<Scalars["String"]["output"]>>;
  threadId?: Maybe<Scalars["String"]["output"]>;
  updatedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  userSlug?: Maybe<Scalars["String"]["output"]>;
  /**
   * Compiled wiki pages (Compounding Memory) that cite this memory unit as
   * a source. Populated from wiki_section_sources.source_ref. Returns pages
   * scoped to the same user as this memory (there is no cross-user
   * citation in v1). Returned pages have empty `sections`/`aliases` — fetch
   * `wikiPage(tenantId, userId, type, slug)` for full detail.
   */
  wikiPages: Array<WikiPage>;
};

export type MemorySearchResult = {
  __typename?: "MemorySearchResult";
  records: Array<MemoryRecord>;
  totalCount: Scalars["Int"]["output"];
};

export enum MemoryStrategy {
  Episodes = "EPISODES",
  Preferences = "PREFERENCES",
  Reflections = "REFLECTIONS",
  Semantic = "SEMANTIC",
  Summaries = "SUMMARIES",
}

/**
 * Runtime memory system configuration exposed to the admin UI.
 * Lets the UI decide which views to render (e.g. Knowledge Graph toggle is
 * only meaningful when Hindsight is deployed alongside managed memory).
 */
export type MemorySystemConfig = {
  __typename?: "MemorySystemConfig";
  /**
   * True when the optional Hindsight add-on is deployed (ECS + ALB). Gates
   * the Knowledge Graph / entity-graph views in the admin UI.
   */
  hindsightEnabled: Scalars["Boolean"]["output"];
  /**
   * True when managed AgentCore Memory is provisioned and wired into the
   * agent container. This is the always-on baseline — when false, memory
   * features may be unavailable.
   */
  managedMemoryEnabled: Scalars["Boolean"]["output"];
};

export type Message = {
  __typename?: "Message";
  artifacts: Array<MessageArtifact>;
  content?: Maybe<Scalars["String"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  durableArtifact?: Maybe<Artifact>;
  id: Scalars["ID"]["output"];
  mentions: Array<MessageMention>;
  metadata?: Maybe<Scalars["AWSJSON"]["output"]>;
  ownerId?: Maybe<Scalars["ID"]["output"]>;
  ownerType: Scalars["String"]["output"];
  parts?: Maybe<Scalars["AWSJSON"]["output"]>;
  role: MessageRole;
  sender?: Maybe<MessageSender>;
  senderId?: Maybe<Scalars["ID"]["output"]>;
  senderType?: Maybe<Scalars["String"]["output"]>;
  tenantId: Scalars["ID"]["output"];
  threadId: Scalars["ID"]["output"];
  tokenCount?: Maybe<Scalars["Int"]["output"]>;
  toolCalls?: Maybe<Scalars["AWSJSON"]["output"]>;
  toolResults?: Maybe<Scalars["AWSJSON"]["output"]>;
  userQuestion?: Maybe<UserQuestion>;
};

export type MessageArtifact = {
  __typename?: "MessageArtifact";
  artifactType: Scalars["String"]["output"];
  content?: Maybe<Scalars["String"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  id: Scalars["ID"]["output"];
  messageId: Scalars["ID"]["output"];
  metadata?: Maybe<Scalars["AWSJSON"]["output"]>;
  mimeType?: Maybe<Scalars["String"]["output"]>;
  name?: Maybe<Scalars["String"]["output"]>;
  s3Key?: Maybe<Scalars["String"]["output"]>;
  sizeBytes?: Maybe<Scalars["Int"]["output"]>;
  tenantId: Scalars["ID"]["output"];
  threadId: Scalars["ID"]["output"];
};

export type MessageConnection = {
  __typename?: "MessageConnection";
  edges: Array<MessageEdge>;
  pageInfo: PageInfo;
};

export enum MessageDispatchMode {
  ManagedDefault = "MANAGED_DEFAULT",
}

export type MessageEdge = {
  __typename?: "MessageEdge";
  cursor: Scalars["String"]["output"];
  node: Message;
};

export type MessageMention = {
  __typename?: "MessageMention";
  agent?: Maybe<Agent>;
  createdAt: Scalars["AWSDateTime"]["output"];
  displayName: Scalars["String"]["output"];
  endOffset?: Maybe<Scalars["Int"]["output"]>;
  id: Scalars["ID"]["output"];
  messageId: Scalars["ID"]["output"];
  metadata?: Maybe<Scalars["AWSJSON"]["output"]>;
  rawText?: Maybe<Scalars["String"]["output"]>;
  startOffset?: Maybe<Scalars["Int"]["output"]>;
  targetId: Scalars["ID"]["output"];
  targetType: MessageMentionTargetType;
  tenantId: Scalars["ID"]["output"];
  threadId: Scalars["ID"]["output"];
  user?: Maybe<User>;
};

export enum MessageMentionTargetType {
  Agent = "AGENT",
  AgentProfile = "AGENT_PROFILE",
  User = "USER",
}

export enum MessageRole {
  Assistant = "ASSISTANT",
  System = "SYSTEM",
  Tool = "TOOL",
  User = "USER",
}

export type MessageSender = {
  __typename?: "MessageSender";
  avatarUrl?: Maybe<Scalars["String"]["output"]>;
  displayName: Scalars["String"]["output"];
  id?: Maybe<Scalars["ID"]["output"]>;
  type: Scalars["String"]["output"];
};

/**
 * Fact-type picker values exposed to the mobile quick-capture footer. Maps to
 * Hindsight's native fact_type via the resolver. FACT is the default when the
 * user doesn't override.
 */
export enum MobileCaptureFactType {
  Experience = "EXPERIENCE",
  Fact = "FACT",
  Observation = "OBSERVATION",
  Preference = "PREFERENCE",
}

export type MobileMemoryCapture = {
  __typename?: "MobileMemoryCapture";
  /** @deprecated Use userId */
  agentId?: Maybe<Scalars["ID"]["output"]>;
  capturedAt: Scalars["AWSDateTime"]["output"];
  content: Scalars["String"]["output"];
  factType: MobileCaptureFactType;
  id: Scalars["ID"]["output"];
  metadata?: Maybe<Scalars["AWSJSON"]["output"]>;
  syncedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  tenantId: Scalars["ID"]["output"];
  userId: Scalars["ID"]["output"];
};

export type MobileWikiSearchResult = {
  __typename?: "MobileWikiSearchResult";
  /**
   * Retained for wire-format compatibility with older mobile clients.
   * Always [] on the FTS path; pages match their own compiled text, not
   * source memory units.
   */
  matchingMemoryIds: Array<Scalars["ID"]["output"]>;
  page: WikiPage;
  /**
   * Postgres `ts_rank(search_tsv, plainto_tsquery('english', query))` on
   * the page's compiled text. Higher is better. Not comparable across
   * queries.
   */
  score: Scalars["Float"]["output"];
};

export type ModelCatalogEntry = {
  __typename?: "ModelCatalogEntry";
  contextWindow?: Maybe<Scalars["Int"]["output"]>;
  displayName: Scalars["String"]["output"];
  id: Scalars["ID"]["output"];
  inputCostPerMillion?: Maybe<Scalars["Float"]["output"]>;
  maxOutputTokens?: Maybe<Scalars["Int"]["output"]>;
  modelId: Scalars["String"]["output"];
  outputCostPerMillion?: Maybe<Scalars["Float"]["output"]>;
  provider: Scalars["String"]["output"];
  supportsTools?: Maybe<Scalars["Boolean"]["output"]>;
  supportsVision?: Maybe<Scalars["Boolean"]["output"]>;
};

export type ModelCostSummary = {
  __typename?: "ModelCostSummary";
  inputTokens: Scalars["Int"]["output"];
  model: Scalars["String"]["output"];
  outputTokens: Scalars["Int"]["output"];
  totalUsd: Scalars["Float"]["output"];
};

export type ModelInvocation = {
  __typename?: "ModelInvocation";
  branch?: Maybe<Scalars["String"]["output"]>;
  cacheReadTokenCount: Scalars["Int"]["output"];
  cacheWriteTokenCount?: Maybe<Scalars["Int"]["output"]>;
  costUsd?: Maybe<Scalars["Float"]["output"]>;
  hasToolResult?: Maybe<Scalars["Boolean"]["output"]>;
  inputPreview?: Maybe<Scalars["String"]["output"]>;
  inputTokenCount: Scalars["Int"]["output"];
  modelId: Scalars["String"]["output"];
  outputPreview?: Maybe<Scalars["String"]["output"]>;
  outputTokenCount: Scalars["Int"]["output"];
  reconciliationConfidence?: Maybe<Scalars["String"]["output"]>;
  reconciliationDiagnostic?: Maybe<Scalars["String"]["output"]>;
  reconciliationReason?: Maybe<Scalars["String"]["output"]>;
  reconciliationRuntimeRequestId?: Maybe<Scalars["String"]["output"]>;
  reconciliationState?: Maybe<Scalars["String"]["output"]>;
  requestId: Scalars["String"]["output"];
  timestamp: Scalars["AWSDateTime"]["output"];
  toolCount?: Maybe<Scalars["Int"]["output"]>;
  toolUses?: Maybe<Array<Scalars["String"]["output"]>>;
};

export type Mutation = {
  __typename?: "Mutation";
  _empty?: Maybe<Scalars["String"]["output"]>;
  acceptAgentWorkspaceReview: AgentWorkspaceRun;
  /**
   * Begin app-level OAuth activation for the calling user — one consent
   * covering all the plugin's MCP servers. Returns the authorize URL.
   */
  activatePlugin: ActivatePluginResult;
  /**
   * Store per-user credentials for plugins whose MCP servers declare
   * user-provided header auth (for example API token + workspace slug). Values
   * are stored only as token secrets and are never exposed through GraphQL.
   */
  activatePluginWithCredentials: UserPluginActivation;
  addEmailSpaceSenderAllowlist: EmailSpaceSenderAllowlist;
  addEvalDatasetCase: EvalTestCase;
  addEvalReplayToolOverride: EvalReplayAllowedTool;
  addInboxItemComment: InboxItemComment;
  addInboxItemLink: InboxItemLink;
  addManualUser: TenantMember;
  addSpaceMember: SpaceMember;
  addTenantMember: TenantMember;
  addThreadDependency: ThreadDependency;
  adminUpdateAppletSource: SaveAppletPayload;
  answerUserQuestion: UserQuestion;
  applySkillUpdate: SkillUpdateApplyResult;
  approveInboxItem: InboxItem;
  approveManagedApplicationDeployment: ManagedApplicationDeploymentJob;
  approveOntologyChangeSet: OntologyChangeSet;
  archiveEvalDataset: EvalDataset;
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
  cancelAgentWorkspaceReview: AgentWorkspaceRun;
  cancelEvalRun: EvalRun;
  cancelInboxItem: InboxItem;
  cancelSkillRun: SkillRun;
  cancelThreadTurn: ThreadTurn;
  captureMobileMemory: MobileMemoryCapture;
  checkoutThread: Thread;
  /**
   * Admin-only: enqueue an ad-hoc compile job for a specific (tenant, user).
   * Returns the job row (newly inserted or the in-flight dedupe hit).
   *
   * When `modelId` is supplied, it is forwarded to the compile Lambda event
   * payload so a single run can override `BEDROCK_MODEL_ID` without a
   * redeploy. The override takes effect only on the direct Event-invoke
   * path; if the invoke fails and a polling worker claims the job later, the
   * compile falls back to the env-default model.
   *
   * Graph mode (plan 2026-06-09-004 U14): when `tenantScope` is true — or
   * the server's wiki source is `graph` — the per-user owner key is ignored
   * and ONE tenant-keyed compile job (null `userId`) is enqueued for the
   * graph→wiki materializer. `modelId` is meaningless on that path (the
   * materializer is deterministic/LLM-free) and is not forwarded.
   */
  compileWikiNow: WikiCompileJob;
  configureEmailProvider: EmailProviderInstall;
  /**
   * Tenant-admin: configure the installed WorkOS Auth plugin with customer-owned
   * AuthKit credentials. Stores the secret server-side, publishes the public SSO
   * option, and updates the auth-provider component state.
   */
  configureWorkosAuthPlugin: ConfigureWorkosAuthPluginResult;
  confirmAutomationDraft: AgentLoop;
  connectN8nWorkflow: ConnectN8nWorkflowResult;
  createAgentProfile: AgentProfile;
  createArtifact: Artifact;
  /**
   * Queue an async export of audit events matching the filter. Validates:
   *   - 90-day cap on (until - since)
   *   - 4 KB serialized filter byte cap
   *   - 10 exports / hour rate limit per actor
   * Throws typed errors with extensions.code in
   *   {RATE_LIMIT_EXCEEDED, FILTER_RANGE_TOO_WIDE, FILTER_TOO_LARGE,
   *    FORBIDDEN, UNAUTHENTICATED, INTERNAL_SERVER_ERROR}.
   * Inserts the job row + emits data.export_initiated audit event in a
   * single transaction; SQS dispatch happens after commit (queue write
   * cannot be rolled back). If SQS send fails, the job is marked FAILED
   * with jobError set.
   */
  createComplianceExport: ComplianceExport;
  createEvalDataset: EvalDataset;
  createEvalTestCase: EvalTestCase;
  createInboxItem: InboxItem;
  createKnowledgeBase: KnowledgeBase;
  createN8nWorkflowBridge: N8nWorkflowBridgeCredential;
  createQuickAction: UserQuickAction;
  createRecipe: Recipe;
  createRoutine: Routine;
  createScheduledJob: ScheduledJob;
  /** Create a tenant-scoped skill draft. */
  createSkillDraft: SkillDraft;
  createSpace: Space;
  createTenant: Tenant;
  createTenantCredential: TenantCredential;
  createThread: Thread;
  createThreadLabel: ThreadLabel;
  createWakeupRequest: AgentWakeupRequest;
  createWebhook: Webhook;
  createWorkItem: WorkItem;
  /**
   * One-time Twenty cutover (tenant admin): adopts the legacy managed Twenty
   * MCP row to plugin ownership (management_source 'plugin' under the
   * tenant's twenty install) and invalidates per-server user tokens so users
   * re-activate at app level. Idempotent — a re-run reports a no-op.
   */
  cutoverTwentyPlugin: TwentyPluginCutoverResult;
  /**
   * Disconnect the calling user's activation: deletes stored token secrets and
   * marks the activation revoked. Local-only — provider-side grants are not
   * revoked in v1 (UI copy says "disconnect").
   */
  deactivatePlugin: UserPluginActivation;
  decideInboxItem: InboxItem;
  decideRoutineApproval: InboxItem;
  delegateThread: Thread;
  deleteAgentLoop: DeleteAgentLoopResult;
  deleteAgentProfile: Scalars["Boolean"]["output"];
  deleteArtifact: Scalars["Boolean"]["output"];
  deleteBudgetPolicy: Scalars["Boolean"]["output"];
  deleteEvalRun: Scalars["Boolean"]["output"];
  deleteEvalTestCase: Scalars["Boolean"]["output"];
  deleteKnowledgeBase: Scalars["Boolean"]["output"];
  deleteMemoryRecord: Scalars["Boolean"]["output"];
  deleteMessage: Scalars["Boolean"]["output"];
  deleteMobileMemoryCapture: Scalars["Boolean"]["output"];
  deleteQuickAction: Scalars["Boolean"]["output"];
  deleteRecipe: Scalars["Boolean"]["output"];
  deleteRoutine: Scalars["Boolean"]["output"];
  deleteRoutineTrigger: Scalars["Boolean"]["output"];
  deleteRun: Scalars["Boolean"]["output"];
  deleteScheduledJob: DeleteScheduledJobResult;
  deleteTenantCredential: Scalars["Boolean"]["output"];
  deleteThread: Scalars["Boolean"]["output"];
  deleteThreadLabel: Scalars["Boolean"]["output"];
  deleteWebhook: Scalars["Boolean"]["output"];
  deleteWorkItemView: Scalars["Boolean"]["output"];
  disableSkill: Scalars["Boolean"]["output"];
  disableWorkflow: Scalars["Boolean"]["output"];
  disableWorkflowTemplate: Scalars["Boolean"]["output"];
  enableWorkflow: WorkflowBinding;
  enableWorkflowTemplate: WorkflowTemplateBinding;
  escalateThread: Thread;
  flagThreadForEval: FlagThreadForEvalResult;
  handleGenUIAction: Message;
  importN8nRoutine: Routine;
  importN8nWorkflowDraft: ImportN8nWorkflowDraftResult;
  importTenantBedrockModels: Array<TenantModelCatalogEntry>;
  installManagedApplicationMcpServer: ManagedApplicationMcpRegistration;
  /**
   * Install a catalog plugin tenant-wide (tenant admin). Idempotent per
   * (tenant, plugin): a concurrent call returns the in-flight install; a
   * stuck-installing install past the staleness threshold re-drives the
   * handler sequence.
   */
  installPlugin: PluginInstall;
  inviteMember: TenantMember;
  /**
   * ThinkWork-operator-only: issue a one-time premium plugin install key for a
   * tenant. Returns the raw key exactly once.
   */
  issuePremiumPluginInstallKey: IssuePremiumPluginInstallKeyResult;
  markThreadsRead: MarkThreadsReadResult;
  notifyAgentStatus?: Maybe<AgentStatusEvent>;
  notifyCostRecorded?: Maybe<CostRecordedEvent>;
  notifyEvalRunUpdate?: Maybe<EvalRunUpdateEvent>;
  notifyHeartbeatActivity?: Maybe<HeartbeatActivityEvent>;
  notifyInboxItemUpdate?: Maybe<InboxItemStatusEvent>;
  notifyNewMessage?: Maybe<NewMessageEvent>;
  notifyOrgUpdate?: Maybe<OrgUpdateEvent>;
  notifyThreadActivity?: Maybe<ThreadActivityEvent>;
  notifyThreadTurnStep?: Maybe<ThreadTurnStepEvent>;
  notifyThreadTurnUpdate?: Maybe<ThreadTurnUpdateEvent>;
  notifyThreadUpdate?: Maybe<ThreadUpdateEvent>;
  notifyWorkspaceAccessRevoked?: Maybe<WorkspaceAccessRevokedEvent>;
  overrideEvalResult: EvalResult;
  pinThread: PinnedThread;
  planRoutineDraft: RoutineDraft;
  promoteDraftApplet: SaveAppletPayload;
  promoteGenUIArtifact: Artifact;
  publishRoutineVersion: RoutineAslVersion;
  /** Tenant-operator approval that publishes a trust-ready draft to the Skill Library. */
  publishSkillDraft: SkillDraft;
  rebuildRoutineVersion: RoutineAslVersion;
  /**
   * Reconcile the skill_catalog index from the S3 catalog. For one tenant
   * (`tenantId`, defaults to the caller's tenant; requires tenant admin), or
   * every tenant (`all: true`, requires platform-operator). `dryRun` reports
   * the counts it would write without mutating. Returns one result per tenant.
   */
  rebuildSkillCatalogIndex: Array<SkillCatalogRebuildResult>;
  /**
   * Tenant-admin: redeem a ThinkWork-provided premium plugin install key into a
   * persistent tenant entitlement.
   */
  redeemPremiumPluginInstallKey: RedeemPremiumPluginInstallKeyResult;
  refreshGenUI?: Maybe<Message>;
  /**
   * Tenant-admin: revalidate the GitHub-backed plugin catalog immediately,
   * bypassing the API freshness TTL while preserving signature/digest checks
   * and stale-safe fallback.
   */
  refreshPluginCatalog: PluginCatalogMetadata;
  refreshThreadProgress: RefreshThreadProgressPayload;
  regenerateApplet: SaveAppletPayload;
  regenerateWebhookToken?: Maybe<Webhook>;
  registerPushToken: Scalars["Boolean"]["output"];
  rejectInboxItem: InboxItem;
  rejectManagedApplicationDeployment: ManagedApplicationDeploymentJob;
  rejectOntologyChangeSet: OntologyChangeSet;
  /** Tenant-operator rejection with rationale. */
  rejectSkillDraft: SkillDraft;
  releaseThread: Thread;
  remediateReleaseRunner: ReleaseUpdateJob;
  removeEmailSpaceSenderAllowlist: Scalars["Boolean"]["output"];
  removeEvalDatasetCase: EvalDataset;
  removeEvalReplayToolOverride: Scalars["Boolean"]["output"];
  removeInboxItemLink: Scalars["Boolean"]["output"];
  removeSpaceMember: Scalars["Boolean"]["output"];
  /** Remove a tenant member. idempotencyKey optional — see UpdateTenantInput.idempotencyKey. */
  removeTenantMember: Scalars["Boolean"]["output"];
  removeThreadDependency: Scalars["Boolean"]["output"];
  removeThreadLabel: Scalars["Boolean"]["output"];
  renameTenantSlug: Tenant;
  reorderPinnedThreads: Array<PinnedThread>;
  reorderQuickActions: Array<UserQuickAction>;
  requestCompanyBrainProductionMigration: CompanyBrainMigrationStatus;
  requestRevision: InboxItem;
  resendMemberInvite: ResendMemberInviteResult;
  /**
   * Admin-only replay: clear the compile cursor for (tenant, user). If
   * `force` is true, also archives every active page in the scope so the
   * next compile rebuilds from scratch. Destructive when force=true.
   */
  resetWikiCursor: WikiResetCursorResult;
  resubmitInboxItem: InboxItem;
  resumeAgentWorkspaceRun: AgentWorkspaceRun;
  retryKnowledgeBase: KnowledgeBase;
  /** Re-drive one failed component (failed → pending) and re-run its handler (tenant admin). */
  retryPluginComponent: PluginInstall;
  reviewGoal: ReviewGoalPayload;
  /**
   * ThinkWork-operator-only: revoke an issued premium plugin install key before
   * redemption.
   */
  revokePremiumPluginInstallKey: RevokePremiumPluginInstallKeyResult;
  rollbackThreadIdleLearningRun: ThreadIdleLearningRun;
  rotateTenantCredential: TenantCredential;
  runEmailReadinessProbe: Array<EmailReadinessCheck>;
  runScheduledJob: RunScheduledJobResult;
  saveAgentLoop: AgentLoop;
  saveApplet: SaveAppletPayload;
  saveAppletState: AppletState;
  saveEmailProviderCredential: EmailProviderInstall;
  saveWorkItemStatuses: Array<WorkItemStatus>;
  saveWorkItemView: WorkItemSavedView;
  seedEvalTestCases: Scalars["Int"]["output"];
  sendMessage: Message;
  setAgentKnowledgeBases: Array<AgentKnowledgeBase>;
  setKnowledgeGraphDeployment: KnowledgeGraphDeploymentChange;
  setManagedApplicationDeployment: ManagedApplicationDeploymentChange;
  setRoutineTrigger: RoutineTrigger;
  setSkillEvalGate: SkillEvalGate;
  setSpaceEmailTriggers: Space;
  setSpaceKnowledgeBases: Array<SpaceKnowledgeBase>;
  setSpaceRuntimeOverrides: Space;
  setSpaceTools: Space;
  setTenantMemberPassword: SetTenantMemberPasswordResult;
  setUserModelApproval: Array<UserModelCatalogEntry>;
  startAutomationBuilder: AutomationBuilderSession;
  startCustomerOnboarding: StartCustomerOnboardingPayload;
  startDeploymentReleaseUpdate: ReleaseUpdateJob;
  startEvalRun: EvalRun;
  startKnowledgeGraphIngest: KnowledgeGraphIngestRun;
  startKnowledgeGraphObservationsIngest: KnowledgeGraphIngestRun;
  startKnowledgeGraphThreadIngest: KnowledgeGraphIngestRun;
  startManagedApplicationPlan: ManagedApplicationDeploymentJob;
  startOntologySuggestionScan: OntologySuggestionScanJob;
  startReleaseUpdatePreflight: ReleaseUpdateJob;
  startSkillRun: SkillRun;
  startSlackWorkspaceInstall: SlackWorkspaceInstallStart;
  startTwentyCustomerOnboarding: StartTwentyCustomerOnboardingPayload;
  submitRunFeedback: SkillRun;
  /** Submit a draft for trust/review. */
  submitSkillDraft: SkillDraft;
  syncKnowledgeBase: KnowledgeBase;
  /**
   * Inserts a synthetic delivery row for the webhook so an operator can
   * confirm the config exists and the delivery-log pipeline is reachable.
   * Does NOT trigger any downstream dispatch — the row carries
   * `resolutionStatus: "test"`, so a follow-up
   * `webhookDeliveries(webhookId)` query shows it. For end-to-end
   * reachability checks against the public URL, curl the webhook's
   * token endpoint directly.
   */
  testWebhook: WebhookDelivery;
  triggerAgentLoopRun: AgentLoopRun;
  triggerRoutineRun: RoutineExecution;
  triggerWorkflowRun: WorkflowRun;
  /**
   * Tear down every component and derived state (tenant admin): activations +
   * token secrets, skill folders + seeded catalog prefix, MCP rows, then the
   * infrastructure destroy job behind the approval gate. Returns the final
   * install snapshot ('uninstalling' while async teardown runs).
   */
  uninstallPlugin: PluginInstall;
  uninstallSlackWorkspace: SlackWorkspace;
  unlinkSlackIdentity: SlackUserLink;
  unpauseAgent: Agent;
  unpauseUserBudget: Scalars["Int"]["output"];
  unpinThread: Scalars["Boolean"]["output"];
  unregisterPushToken: Scalars["Boolean"]["output"];
  updateAgentProfile: AgentProfile;
  updateArtifact: Artifact;
  updateCompanyBrainMigration: CompanyBrainMigrationStatus;
  updateEmailReadinessCheck: EmailReadinessCheck;
  updateEvalDataset: EvalDataset;
  updateEvalDatasetCase: EvalTestCase;
  updateEvalTestCase: EvalTestCase;
  updateKnowledgeBase: KnowledgeBase;
  updateLinkedTask: LinkedTask;
  updateMemoryRecord: Scalars["Boolean"]["output"];
  /** Store or replace the tenant n8n public API key used for workflow discovery. */
  updateN8nPluginApiCredential: UpdateN8nPluginApiCredentialResult;
  /** Update n8n custom package desired config and create/reuse an UPGRADE plan job. */
  updateN8nPluginPackageSettings: UpdateN8nPluginPackageSettingsResult;
  updateOntologyChangeSet: OntologyChangeSet;
  updateOntologyEntityType: OntologyEntityType;
  updateOntologyRelationshipType: OntologyRelationshipType;
  updateQuickAction: UserQuickAction;
  updateRecipe: Recipe;
  updateRoutine: Routine;
  updateRoutineDefinition: RoutineDefinition;
  updateScheduledJob: ScheduledJob;
  /** Update editable draft metadata and current content hash. */
  updateSkillDraft: SkillDraft;
  updateSpace: Space;
  updateSpaceEmailTrigger: Space;
  updateTenant: Tenant;
  updateTenantAgent: Agent;
  updateTenantCredential: TenantCredential;
  updateTenantMember: TenantMember;
  updateTenantModelCatalogEntry: TenantModelCatalogEntry;
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
  updateWorkItem: WorkItem;
  updateWorkItemStatus: WorkItem;
  /**
   * Pin a new catalog version and reconcile the component diff through the
   * install state machine (tenant admin). Scope/auth-domain changes flip
   * affected activations to needs_reauth.
   */
  upgradePlugin: PluginInstall;
  upsertBudgetPolicy: BudgetPolicy;
  upsertEmailSpacePolicy: EmailSpacePolicy;
};

export type MutationAcceptAgentWorkspaceReviewArgs = {
  input?: InputMaybe<AgentWorkspaceReviewDecisionInput>;
  runId: Scalars["ID"]["input"];
};

export type MutationActivatePluginArgs = {
  input: ActivatePluginInput;
};

export type MutationActivatePluginWithCredentialsArgs = {
  input: ActivatePluginWithCredentialsInput;
};

export type MutationAddEmailSpaceSenderAllowlistArgs = {
  input: AddEmailSpaceSenderAllowlistInput;
};

export type MutationAddEvalDatasetCaseArgs = {
  datasetSlug: Scalars["String"]["input"];
  input: EvalDatasetCaseInput;
  tenantId: Scalars["ID"]["input"];
};

export type MutationAddEvalReplayToolOverrideArgs = {
  mode: Scalars["String"]["input"];
  serverName: Scalars["String"]["input"];
  tenantId: Scalars["ID"]["input"];
  toolName: Scalars["String"]["input"];
};

export type MutationAddInboxItemCommentArgs = {
  input: AddInboxItemCommentInput;
};

export type MutationAddInboxItemLinkArgs = {
  input: AddInboxItemLinkInput;
};

export type MutationAddManualUserArgs = {
  input: AddManualUserInput;
  tenantId: Scalars["ID"]["input"];
};

export type MutationAddSpaceMemberArgs = {
  spaceId: Scalars["ID"]["input"];
  userId: Scalars["ID"]["input"];
};

export type MutationAddTenantMemberArgs = {
  input: AddTenantMemberInput;
  tenantId: Scalars["ID"]["input"];
};

export type MutationAddThreadDependencyArgs = {
  blockedByThreadId: Scalars["ID"]["input"];
  threadId: Scalars["ID"]["input"];
};

export type MutationAdminUpdateAppletSourceArgs = {
  input: AdminUpdateAppletSourceInput;
};

export type MutationAnswerUserQuestionArgs = {
  answers: Scalars["AWSJSON"]["input"];
  questionId: Scalars["ID"]["input"];
};

export type MutationApplySkillUpdateArgs = {
  agentId: Scalars["ID"]["input"];
  override?: InputMaybe<Scalars["Boolean"]["input"]>;
  skillSlug: Scalars["String"]["input"];
  tenantId: Scalars["ID"]["input"];
};

export type MutationApproveInboxItemArgs = {
  id: Scalars["ID"]["input"];
  input?: InputMaybe<ApproveInboxItemInput>;
};

export type MutationApproveManagedApplicationDeploymentArgs = {
  input: ApproveManagedApplicationDeploymentInput;
};

export type MutationApproveOntologyChangeSetArgs = {
  input: ApproveOntologyChangeSetInput;
};

export type MutationArchiveEvalDatasetArgs = {
  slug: Scalars["String"]["input"];
  tenantId: Scalars["ID"]["input"];
};

export type MutationAssignThreadLabelArgs = {
  labelId: Scalars["ID"]["input"];
  threadId: Scalars["ID"]["input"];
};

export type MutationBootstrapJournalImportArgs = {
  accountId: Scalars["ID"]["input"];
  agentId?: InputMaybe<Scalars["ID"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  tenantId: Scalars["ID"]["input"];
  userId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type MutationCancelAgentWorkspaceReviewArgs = {
  input?: InputMaybe<AgentWorkspaceReviewDecisionInput>;
  runId: Scalars["ID"]["input"];
};

export type MutationCancelEvalRunArgs = {
  id: Scalars["ID"]["input"];
};

export type MutationCancelInboxItemArgs = {
  id: Scalars["ID"]["input"];
};

export type MutationCancelSkillRunArgs = {
  runId: Scalars["ID"]["input"];
};

export type MutationCancelThreadTurnArgs = {
  id: Scalars["ID"]["input"];
};

export type MutationCaptureMobileMemoryArgs = {
  agentId?: InputMaybe<Scalars["ID"]["input"]>;
  clientCaptureId?: InputMaybe<Scalars["ID"]["input"]>;
  content: Scalars["String"]["input"];
  factType?: InputMaybe<MobileCaptureFactType>;
  metadata?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  tenantId?: InputMaybe<Scalars["ID"]["input"]>;
  userId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type MutationCheckoutThreadArgs = {
  id: Scalars["ID"]["input"];
  input: CheckoutThreadInput;
};

export type MutationCompileWikiNowArgs = {
  forceNew?: InputMaybe<Scalars["Boolean"]["input"]>;
  modelId?: InputMaybe<Scalars["String"]["input"]>;
  ownerId?: InputMaybe<Scalars["ID"]["input"]>;
  tenantId: Scalars["ID"]["input"];
  tenantScope?: InputMaybe<Scalars["Boolean"]["input"]>;
  userId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type MutationConfigureEmailProviderArgs = {
  input: ConfigureEmailProviderInput;
};

export type MutationConfigureWorkosAuthPluginArgs = {
  input: ConfigureWorkosAuthPluginInput;
};

export type MutationConfirmAutomationDraftArgs = {
  input: ConfirmAutomationDraftInput;
};

export type MutationConnectN8nWorkflowArgs = {
  input: ConnectN8nWorkflowInput;
};

export type MutationCreateAgentProfileArgs = {
  input: AgentProfileInput;
  tenantId: Scalars["ID"]["input"];
};

export type MutationCreateArtifactArgs = {
  input: CreateArtifactInput;
};

export type MutationCreateComplianceExportArgs = {
  filter: ComplianceEventFilter;
  format: ComplianceExportFormat;
};

export type MutationCreateEvalDatasetArgs = {
  input: CreateEvalDatasetInput;
  tenantId: Scalars["ID"]["input"];
};

export type MutationCreateEvalTestCaseArgs = {
  input: CreateEvalTestCaseInput;
  tenantId: Scalars["ID"]["input"];
};

export type MutationCreateInboxItemArgs = {
  input: CreateInboxItemInput;
};

export type MutationCreateKnowledgeBaseArgs = {
  input: CreateKnowledgeBaseInput;
};

export type MutationCreateN8nWorkflowBridgeArgs = {
  input: CreateN8nWorkflowBridgeInput;
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

export type MutationCreateSkillDraftArgs = {
  input: CreateSkillDraftInput;
};

export type MutationCreateSpaceArgs = {
  input: CreateSpaceInput;
};

export type MutationCreateTenantArgs = {
  input: CreateTenantInput;
};

export type MutationCreateTenantCredentialArgs = {
  input: CreateTenantCredentialInput;
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

export type MutationCreateWorkItemArgs = {
  input: CreateWorkItemInput;
};

export type MutationDeactivatePluginArgs = {
  input: DeactivatePluginInput;
};

export type MutationDecideInboxItemArgs = {
  id: Scalars["ID"]["input"];
  input: InboxItemDecisionInput;
};

export type MutationDecideRoutineApprovalArgs = {
  input: DecideRoutineApprovalInput;
};

export type MutationDelegateThreadArgs = {
  input: DelegateThreadInput;
};

export type MutationDeleteAgentLoopArgs = {
  id: Scalars["ID"]["input"];
};

export type MutationDeleteAgentProfileArgs = {
  id: Scalars["ID"]["input"];
  tenantId: Scalars["ID"]["input"];
};

export type MutationDeleteArtifactArgs = {
  id: Scalars["ID"]["input"];
};

export type MutationDeleteBudgetPolicyArgs = {
  id: Scalars["ID"]["input"];
};

export type MutationDeleteEvalRunArgs = {
  id: Scalars["ID"]["input"];
};

export type MutationDeleteEvalTestCaseArgs = {
  id: Scalars["ID"]["input"];
};

export type MutationDeleteKnowledgeBaseArgs = {
  id: Scalars["ID"]["input"];
};

export type MutationDeleteMemoryRecordArgs = {
  assistantId?: InputMaybe<Scalars["ID"]["input"]>;
  memoryRecordId: Scalars["ID"]["input"];
  tenantId?: InputMaybe<Scalars["ID"]["input"]>;
  userId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type MutationDeleteMessageArgs = {
  id: Scalars["ID"]["input"];
};

export type MutationDeleteMobileMemoryCaptureArgs = {
  agentId?: InputMaybe<Scalars["ID"]["input"]>;
  captureId: Scalars["ID"]["input"];
  tenantId?: InputMaybe<Scalars["ID"]["input"]>;
  userId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type MutationDeleteQuickActionArgs = {
  id: Scalars["ID"]["input"];
};

export type MutationDeleteRecipeArgs = {
  id: Scalars["ID"]["input"];
};

export type MutationDeleteRoutineArgs = {
  id: Scalars["ID"]["input"];
};

export type MutationDeleteRoutineTriggerArgs = {
  id: Scalars["ID"]["input"];
};

export type MutationDeleteRunArgs = {
  runId: Scalars["ID"]["input"];
};

export type MutationDeleteScheduledJobArgs = {
  id: Scalars["ID"]["input"];
};

export type MutationDeleteTenantCredentialArgs = {
  id: Scalars["ID"]["input"];
};

export type MutationDeleteThreadArgs = {
  id: Scalars["ID"]["input"];
};

export type MutationDeleteThreadLabelArgs = {
  id: Scalars["ID"]["input"];
};

export type MutationDeleteWebhookArgs = {
  id: Scalars["ID"]["input"];
};

export type MutationDeleteWorkItemViewArgs = {
  input: DeleteWorkItemViewInput;
};

export type MutationDisableSkillArgs = {
  input: DisableSkillInput;
};

export type MutationDisableWorkflowArgs = {
  input: DisableWorkflowInput;
};

export type MutationDisableWorkflowTemplateArgs = {
  input: DisableWorkflowTemplateInput;
};

export type MutationEnableWorkflowArgs = {
  input: EnableWorkflowInput;
};

export type MutationEnableWorkflowTemplateArgs = {
  input: EnableWorkflowTemplateInput;
};

export type MutationEscalateThreadArgs = {
  input: EscalateThreadInput;
};

export type MutationFlagThreadForEvalArgs = {
  input: FlagThreadForEvalInput;
};

export type MutationHandleGenUiActionArgs = {
  input: HandleGenUiActionInput;
};

export type MutationImportN8nRoutineArgs = {
  input: ImportN8nRoutineInput;
};

export type MutationImportN8nWorkflowDraftArgs = {
  input: ImportN8nWorkflowDraftInput;
};

export type MutationImportTenantBedrockModelsArgs = {
  input: ImportTenantBedrockModelsInput;
};

export type MutationInstallManagedApplicationMcpServerArgs = {
  key: Scalars["String"]["input"];
};

export type MutationInstallPluginArgs = {
  input: InstallPluginInput;
};

export type MutationInviteMemberArgs = {
  input: InviteMemberInput;
  tenantId: Scalars["ID"]["input"];
};

export type MutationIssuePremiumPluginInstallKeyArgs = {
  input: IssuePremiumPluginInstallKeyInput;
};

export type MutationMarkThreadsReadArgs = {
  input: MarkThreadsReadInput;
};

export type MutationNotifyAgentStatusArgs = {
  agentId: Scalars["ID"]["input"];
  name: Scalars["String"]["input"];
  status: Scalars["String"]["input"];
  tenantId: Scalars["ID"]["input"];
};

export type MutationNotifyCostRecordedArgs = {
  agentId?: InputMaybe<Scalars["ID"]["input"]>;
  agentName?: InputMaybe<Scalars["String"]["input"]>;
  amountUsd: Scalars["Float"]["input"];
  eventType: Scalars["String"]["input"];
  model?: InputMaybe<Scalars["String"]["input"]>;
  tenantId: Scalars["ID"]["input"];
  userEmail?: InputMaybe<Scalars["String"]["input"]>;
  userId?: InputMaybe<Scalars["ID"]["input"]>;
  userName?: InputMaybe<Scalars["String"]["input"]>;
};

export type MutationNotifyEvalRunUpdateArgs = {
  agentId?: InputMaybe<Scalars["ID"]["input"]>;
  errorMessage?: InputMaybe<Scalars["String"]["input"]>;
  failed?: InputMaybe<Scalars["Int"]["input"]>;
  passRate?: InputMaybe<Scalars["Float"]["input"]>;
  passed?: InputMaybe<Scalars["Int"]["input"]>;
  runId: Scalars["ID"]["input"];
  status: Scalars["String"]["input"];
  tenantId: Scalars["ID"]["input"];
  totalTests?: InputMaybe<Scalars["Int"]["input"]>;
};

export type MutationNotifyHeartbeatActivityArgs = {
  heartbeatId: Scalars["ID"]["input"];
  message?: InputMaybe<Scalars["String"]["input"]>;
  status: Scalars["String"]["input"];
  tenantId: Scalars["ID"]["input"];
};

export type MutationNotifyInboxItemUpdateArgs = {
  inboxItemId: Scalars["ID"]["input"];
  status: Scalars["String"]["input"];
  tenantId: Scalars["ID"]["input"];
  title?: InputMaybe<Scalars["String"]["input"]>;
};

export type MutationNotifyNewMessageArgs = {
  content?: InputMaybe<Scalars["String"]["input"]>;
  messageId: Scalars["ID"]["input"];
  ownerId?: InputMaybe<Scalars["ID"]["input"]>;
  ownerType?: InputMaybe<Scalars["String"]["input"]>;
  role: Scalars["String"]["input"];
  senderId?: InputMaybe<Scalars["ID"]["input"]>;
  senderType?: InputMaybe<Scalars["String"]["input"]>;
  tenantId: Scalars["ID"]["input"];
  threadId: Scalars["ID"]["input"];
};

export type MutationNotifyOrgUpdateArgs = {
  changeType: Scalars["String"]["input"];
  entityId?: InputMaybe<Scalars["ID"]["input"]>;
  entityType?: InputMaybe<Scalars["String"]["input"]>;
  tenantId: Scalars["ID"]["input"];
};

export type MutationNotifyThreadActivityArgs = {
  authorId?: InputMaybe<Scalars["ID"]["input"]>;
  authorType: Scalars["String"]["input"];
  createdAt?: InputMaybe<Scalars["AWSDateTime"]["input"]>;
  messageId: Scalars["ID"]["input"];
  snippet?: InputMaybe<Scalars["String"]["input"]>;
  tenantId: Scalars["ID"]["input"];
  threadId: Scalars["ID"]["input"];
  threadTitle?: InputMaybe<Scalars["String"]["input"]>;
  userId: Scalars["ID"]["input"];
};

export type MutationNotifyThreadTurnStepArgs = {
  color?: InputMaybe<Scalars["String"]["input"]>;
  createdAt: Scalars["AWSDateTime"]["input"];
  eventType: Scalars["String"]["input"];
  level?: InputMaybe<Scalars["String"]["input"]>;
  message?: InputMaybe<Scalars["String"]["input"]>;
  payload?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  runId: Scalars["ID"]["input"];
  seq: Scalars["Int"]["input"];
  stream?: InputMaybe<Scalars["String"]["input"]>;
  tenantId: Scalars["ID"]["input"];
  threadId: Scalars["ID"]["input"];
};

export type MutationNotifyThreadTurnUpdateArgs = {
  agentId?: InputMaybe<Scalars["ID"]["input"]>;
  runId: Scalars["ID"]["input"];
  status: Scalars["String"]["input"];
  tenantId: Scalars["ID"]["input"];
  threadId?: InputMaybe<Scalars["ID"]["input"]>;
  triggerId?: InputMaybe<Scalars["ID"]["input"]>;
  triggerName?: InputMaybe<Scalars["String"]["input"]>;
};

export type MutationNotifyThreadUpdateArgs = {
  status: Scalars["String"]["input"];
  tenantId: Scalars["ID"]["input"];
  threadId: Scalars["ID"]["input"];
  title: Scalars["String"]["input"];
};

export type MutationNotifyWorkspaceAccessRevokedArgs = {
  revokedAt: Scalars["AWSDateTime"]["input"];
  spaceId: Scalars["ID"]["input"];
  tenantId: Scalars["ID"]["input"];
  userId: Scalars["ID"]["input"];
};

export type MutationOverrideEvalResultArgs = {
  input: OverrideEvalResultInput;
};

export type MutationPinThreadArgs = {
  tenantId: Scalars["ID"]["input"];
  threadId: Scalars["ID"]["input"];
};

export type MutationPlanRoutineDraftArgs = {
  input: PlanRoutineDraftInput;
};

export type MutationPromoteDraftAppletArgs = {
  input: PromoteDraftAppletInput;
};

export type MutationPromoteGenUiArtifactArgs = {
  input: PromoteGenUiArtifactInput;
};

export type MutationPublishRoutineVersionArgs = {
  input: PublishRoutineVersionInput;
};

export type MutationPublishSkillDraftArgs = {
  input: PublishSkillDraftInput;
};

export type MutationRebuildRoutineVersionArgs = {
  input: RebuildRoutineVersionInput;
};

export type MutationRebuildSkillCatalogIndexArgs = {
  all?: InputMaybe<Scalars["Boolean"]["input"]>;
  dryRun?: InputMaybe<Scalars["Boolean"]["input"]>;
  tenantId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type MutationRedeemPremiumPluginInstallKeyArgs = {
  input: RedeemPremiumPluginInstallKeyInput;
};

export type MutationRefreshGenUiArgs = {
  messageId: Scalars["ID"]["input"];
  toolIndex: Scalars["Int"]["input"];
};

export type MutationRefreshThreadProgressArgs = {
  input: RefreshThreadProgressInput;
};

export type MutationRegenerateAppletArgs = {
  input: SaveAppletInput;
};

export type MutationRegenerateWebhookTokenArgs = {
  id: Scalars["ID"]["input"];
};

export type MutationRegisterPushTokenArgs = {
  input: RegisterPushTokenInput;
};

export type MutationRejectInboxItemArgs = {
  id: Scalars["ID"]["input"];
  input?: InputMaybe<RejectInboxItemInput>;
};

export type MutationRejectManagedApplicationDeploymentArgs = {
  input: RejectManagedApplicationDeploymentInput;
};

export type MutationRejectOntologyChangeSetArgs = {
  input: RejectOntologyChangeSetInput;
};

export type MutationRejectSkillDraftArgs = {
  input: RejectSkillDraftInput;
};

export type MutationReleaseThreadArgs = {
  id: Scalars["ID"]["input"];
  input: ReleaseThreadInput;
};

export type MutationRemediateReleaseRunnerArgs = {
  input: RemediateReleaseRunnerInput;
};

export type MutationRemoveEmailSpaceSenderAllowlistArgs = {
  id: Scalars["ID"]["input"];
};

export type MutationRemoveEvalDatasetCaseArgs = {
  caseId: Scalars["String"]["input"];
  datasetSlug: Scalars["String"]["input"];
  tenantId: Scalars["ID"]["input"];
};

export type MutationRemoveEvalReplayToolOverrideArgs = {
  id: Scalars["ID"]["input"];
};

export type MutationRemoveInboxItemLinkArgs = {
  id: Scalars["ID"]["input"];
};

export type MutationRemoveSpaceMemberArgs = {
  spaceId: Scalars["ID"]["input"];
  userId: Scalars["ID"]["input"];
};

export type MutationRemoveTenantMemberArgs = {
  id: Scalars["ID"]["input"];
  idempotencyKey?: InputMaybe<Scalars["String"]["input"]>;
};

export type MutationRemoveThreadDependencyArgs = {
  blockedByThreadId: Scalars["ID"]["input"];
  threadId: Scalars["ID"]["input"];
};

export type MutationRemoveThreadLabelArgs = {
  labelId: Scalars["ID"]["input"];
  threadId: Scalars["ID"]["input"];
};

export type MutationRenameTenantSlugArgs = {
  newSlug: Scalars["String"]["input"];
  tenantId: Scalars["ID"]["input"];
};

export type MutationReorderPinnedThreadsArgs = {
  tenantId: Scalars["ID"]["input"];
  threadIds: Array<Scalars["ID"]["input"]>;
};

export type MutationReorderQuickActionsArgs = {
  input: ReorderQuickActionsInput;
};

export type MutationRequestCompanyBrainProductionMigrationArgs = {
  input: RequestCompanyBrainProductionMigrationInput;
};

export type MutationRequestRevisionArgs = {
  id: Scalars["ID"]["input"];
  input: RequestRevisionInput;
};

export type MutationResendMemberInviteArgs = {
  input: ResendMemberInviteInput;
  tenantId: Scalars["ID"]["input"];
};

export type MutationResetWikiCursorArgs = {
  dryRun?: InputMaybe<Scalars["Boolean"]["input"]>;
  force?: InputMaybe<Scalars["Boolean"]["input"]>;
  includeBrain?: InputMaybe<Scalars["Boolean"]["input"]>;
  ownerId?: InputMaybe<Scalars["ID"]["input"]>;
  tenantId: Scalars["ID"]["input"];
  userId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type MutationResubmitInboxItemArgs = {
  id: Scalars["ID"]["input"];
  input?: InputMaybe<ResubmitInboxItemInput>;
};

export type MutationResumeAgentWorkspaceRunArgs = {
  input?: InputMaybe<AgentWorkspaceReviewDecisionInput>;
  runId: Scalars["ID"]["input"];
};

export type MutationRetryKnowledgeBaseArgs = {
  id: Scalars["ID"]["input"];
};

export type MutationRetryPluginComponentArgs = {
  input: RetryPluginComponentInput;
};

export type MutationReviewGoalArgs = {
  input: ReviewGoalInput;
};

export type MutationRevokePremiumPluginInstallKeyArgs = {
  input: RevokePremiumPluginInstallKeyInput;
};

export type MutationRollbackThreadIdleLearningRunArgs = {
  runId: Scalars["ID"]["input"];
  tenantId?: InputMaybe<Scalars["ID"]["input"]>;
  userId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type MutationRotateTenantCredentialArgs = {
  input: RotateTenantCredentialInput;
};

export type MutationRunEmailReadinessProbeArgs = {
  providerInstallId: Scalars["ID"]["input"];
};

export type MutationRunScheduledJobArgs = {
  id: Scalars["ID"]["input"];
};

export type MutationSaveAgentLoopArgs = {
  input: SaveAgentLoopInput;
};

export type MutationSaveAppletArgs = {
  input: SaveAppletInput;
};

export type MutationSaveAppletStateArgs = {
  input: SaveAppletStateInput;
};

export type MutationSaveEmailProviderCredentialArgs = {
  input: SaveEmailProviderCredentialInput;
};

export type MutationSaveWorkItemStatusesArgs = {
  input: SaveWorkItemStatusesInput;
};

export type MutationSaveWorkItemViewArgs = {
  input: SaveWorkItemViewInput;
};

export type MutationSeedEvalTestCasesArgs = {
  categories?: InputMaybe<Array<Scalars["String"]["input"]>>;
  tenantId: Scalars["ID"]["input"];
};

export type MutationSendMessageArgs = {
  input: SendMessageInput;
};

export type MutationSetAgentKnowledgeBasesArgs = {
  agentId: Scalars["ID"]["input"];
  knowledgeBases: Array<AgentKnowledgeBaseInput>;
};

export type MutationSetKnowledgeGraphDeploymentArgs = {
  input: SetKnowledgeGraphDeploymentInput;
};

export type MutationSetManagedApplicationDeploymentArgs = {
  input: SetManagedApplicationDeploymentInput;
};

export type MutationSetRoutineTriggerArgs = {
  input: RoutineTriggerInput;
  routineId: Scalars["ID"]["input"];
};

export type MutationSetSkillEvalGateArgs = {
  tenantId: Scalars["ID"]["input"];
  threshold?: InputMaybe<Scalars["Float"]["input"]>;
};

export type MutationSetSpaceEmailTriggersArgs = {
  enabled: Scalars["Boolean"]["input"];
  spaceId: Scalars["ID"]["input"];
};

export type MutationSetSpaceKnowledgeBasesArgs = {
  input: SetSpaceKnowledgeBasesInput;
};

export type MutationSetSpaceRuntimeOverridesArgs = {
  input: SetSpaceRuntimeOverridesInput;
  spaceId: Scalars["ID"]["input"];
};

export type MutationSetSpaceToolsArgs = {
  input: SetSpaceToolsInput;
};

export type MutationSetTenantMemberPasswordArgs = {
  input: SetTenantMemberPasswordInput;
  tenantId: Scalars["ID"]["input"];
};

export type MutationSetUserModelApprovalArgs = {
  approved: Scalars["Boolean"]["input"];
  modelId: Scalars["String"]["input"];
  userId: Scalars["ID"]["input"];
};

export type MutationStartAutomationBuilderArgs = {
  input: StartAutomationBuilderInput;
};

export type MutationStartCustomerOnboardingArgs = {
  input: StartCustomerOnboardingInput;
};

export type MutationStartDeploymentReleaseUpdateArgs = {
  input: StartDeploymentReleaseUpdateInput;
};

export type MutationStartEvalRunArgs = {
  input: StartEvalRunInput;
  tenantId: Scalars["ID"]["input"];
};

export type MutationStartKnowledgeGraphIngestArgs = {
  input: StartKnowledgeGraphIngestInput;
};

export type MutationStartKnowledgeGraphObservationsIngestArgs = {
  input?: InputMaybe<StartKnowledgeGraphObservationsIngestInput>;
};

export type MutationStartKnowledgeGraphThreadIngestArgs = {
  input: StartKnowledgeGraphThreadIngestInput;
};

export type MutationStartManagedApplicationPlanArgs = {
  input: StartManagedApplicationPlanInput;
};

export type MutationStartOntologySuggestionScanArgs = {
  input: StartOntologySuggestionScanInput;
};

export type MutationStartReleaseUpdatePreflightArgs = {
  input: StartReleaseUpdatePreflightInput;
};

export type MutationStartSkillRunArgs = {
  input: StartSkillRunInput;
};

export type MutationStartSlackWorkspaceInstallArgs = {
  input: StartSlackWorkspaceInstallInput;
};

export type MutationStartTwentyCustomerOnboardingArgs = {
  input: StartTwentyCustomerOnboardingInput;
};

export type MutationSubmitRunFeedbackArgs = {
  input: SubmitRunFeedbackInput;
};

export type MutationSubmitSkillDraftArgs = {
  input: SubmitSkillDraftInput;
};

export type MutationSyncKnowledgeBaseArgs = {
  id: Scalars["ID"]["input"];
};

export type MutationTestWebhookArgs = {
  id: Scalars["ID"]["input"];
};

export type MutationTriggerAgentLoopRunArgs = {
  input: TriggerAgentLoopRunInput;
};

export type MutationTriggerRoutineRunArgs = {
  input?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  routineId: Scalars["ID"]["input"];
};

export type MutationTriggerWorkflowRunArgs = {
  input: TriggerWorkflowRunInput;
};

export type MutationUninstallPluginArgs = {
  input: UninstallPluginInput;
};

export type MutationUninstallSlackWorkspaceArgs = {
  id: Scalars["ID"]["input"];
};

export type MutationUnlinkSlackIdentityArgs = {
  id: Scalars["ID"]["input"];
};

export type MutationUnpauseAgentArgs = {
  agentId: Scalars["ID"]["input"];
};

export type MutationUnpauseUserBudgetArgs = {
  tenantId: Scalars["ID"]["input"];
  userId: Scalars["ID"]["input"];
};

export type MutationUnpinThreadArgs = {
  tenantId: Scalars["ID"]["input"];
  threadId: Scalars["ID"]["input"];
};

export type MutationUnregisterPushTokenArgs = {
  token: Scalars["String"]["input"];
};

export type MutationUpdateAgentProfileArgs = {
  id: Scalars["ID"]["input"];
  input: UpdateAgentProfileInput;
  tenantId: Scalars["ID"]["input"];
};

export type MutationUpdateArtifactArgs = {
  id: Scalars["ID"]["input"];
  input: UpdateArtifactInput;
};

export type MutationUpdateCompanyBrainMigrationArgs = {
  input: UpdateCompanyBrainMigrationInput;
};

export type MutationUpdateEmailReadinessCheckArgs = {
  input: UpdateEmailReadinessCheckInput;
};

export type MutationUpdateEvalDatasetArgs = {
  input: UpdateEvalDatasetInput;
  slug: Scalars["String"]["input"];
  tenantId: Scalars["ID"]["input"];
};

export type MutationUpdateEvalDatasetCaseArgs = {
  caseId: Scalars["String"]["input"];
  datasetSlug: Scalars["String"]["input"];
  input: UpdateEvalDatasetCaseInput;
  tenantId: Scalars["ID"]["input"];
};

export type MutationUpdateEvalTestCaseArgs = {
  id: Scalars["ID"]["input"];
  input: UpdateEvalTestCaseInput;
};

export type MutationUpdateKnowledgeBaseArgs = {
  id: Scalars["ID"]["input"];
  input: UpdateKnowledgeBaseInput;
};

export type MutationUpdateLinkedTaskArgs = {
  input: UpdateLinkedTaskInput;
};

export type MutationUpdateMemoryRecordArgs = {
  assistantId?: InputMaybe<Scalars["ID"]["input"]>;
  content: Scalars["String"]["input"];
  memoryRecordId: Scalars["ID"]["input"];
  tenantId?: InputMaybe<Scalars["ID"]["input"]>;
  userId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type MutationUpdateN8nPluginApiCredentialArgs = {
  input: UpdateN8nPluginApiCredentialInput;
};

export type MutationUpdateN8nPluginPackageSettingsArgs = {
  input: UpdateN8nPluginPackageSettingsInput;
};

export type MutationUpdateOntologyChangeSetArgs = {
  input: UpdateOntologyChangeSetInput;
};

export type MutationUpdateOntologyEntityTypeArgs = {
  input: UpdateOntologyEntityTypeInput;
};

export type MutationUpdateOntologyRelationshipTypeArgs = {
  input: UpdateOntologyRelationshipTypeInput;
};

export type MutationUpdateQuickActionArgs = {
  id: Scalars["ID"]["input"];
  input: UpdateQuickActionInput;
};

export type MutationUpdateRecipeArgs = {
  id: Scalars["ID"]["input"];
  input: UpdateRecipeInput;
};

export type MutationUpdateRoutineArgs = {
  id: Scalars["ID"]["input"];
  input: UpdateRoutineInput;
};

export type MutationUpdateRoutineDefinitionArgs = {
  input: UpdateRoutineDefinitionInput;
};

export type MutationUpdateScheduledJobArgs = {
  id: Scalars["ID"]["input"];
  input: UpdateScheduledJobInput;
};

export type MutationUpdateSkillDraftArgs = {
  input: UpdateSkillDraftInput;
};

export type MutationUpdateSpaceArgs = {
  input: UpdateSpaceInput;
};

export type MutationUpdateSpaceEmailTriggerArgs = {
  input: UpdateSpaceEmailTriggerInput;
};

export type MutationUpdateTenantArgs = {
  id: Scalars["ID"]["input"];
  input: UpdateTenantInput;
};

export type MutationUpdateTenantAgentArgs = {
  input: UpdateTenantAgentInput;
  tenantId: Scalars["ID"]["input"];
};

export type MutationUpdateTenantCredentialArgs = {
  id: Scalars["ID"]["input"];
  input: UpdateTenantCredentialInput;
};

export type MutationUpdateTenantMemberArgs = {
  id: Scalars["ID"]["input"];
  input: UpdateTenantMemberInput;
};

export type MutationUpdateTenantModelCatalogEntryArgs = {
  input: UpdateTenantModelCatalogEntryInput;
};

export type MutationUpdateTenantPolicyArgs = {
  input: UpdateTenantPolicyInput;
  tenantId: Scalars["ID"]["input"];
};

export type MutationUpdateTenantSettingsArgs = {
  input: UpdateTenantSettingsInput;
  tenantId: Scalars["ID"]["input"];
};

export type MutationUpdateThreadArgs = {
  id: Scalars["ID"]["input"];
  input: UpdateThreadInput;
};

export type MutationUpdateThreadLabelArgs = {
  id: Scalars["ID"]["input"];
  input: UpdateThreadLabelInput;
};

export type MutationUpdateUserArgs = {
  id: Scalars["ID"]["input"];
  input: UpdateUserInput;
};

export type MutationUpdateUserProfileArgs = {
  input: UpdateUserProfileInput;
  userId: Scalars["ID"]["input"];
};

export type MutationUpdateWebhookArgs = {
  id: Scalars["ID"]["input"];
  input: UpdateWebhookInput;
};

export type MutationUpdateWorkItemArgs = {
  input: UpdateWorkItemInput;
};

export type MutationUpdateWorkItemStatusArgs = {
  input: UpdateWorkItemStatusInput;
};

export type MutationUpgradePluginArgs = {
  input: UpgradePluginInput;
};

export type MutationUpsertBudgetPolicyArgs = {
  input: UpsertBudgetPolicyInput;
  tenantId: Scalars["ID"]["input"];
};

export type MutationUpsertEmailSpacePolicyArgs = {
  input: UpsertEmailSpacePolicyInput;
};

export enum N8nAgentStepResumeStatus {
  Failed = "FAILED",
  NotReady = "NOT_READY",
  Pending = "PENDING",
  Resumed = "RESUMED",
  Resuming = "RESUMING",
}

export type N8nAgentStepRun = {
  __typename?: "N8nAgentStepRun";
  acceptedAt: Scalars["AWSDateTime"]["output"];
  agentId?: Maybe<Scalars["ID"]["output"]>;
  correlationId: Scalars["String"]["output"];
  createdAt: Scalars["AWSDateTime"]["output"];
  errorPayload?: Maybe<Scalars["AWSJSON"]["output"]>;
  executionId: Scalars["String"]["output"];
  expiresAt: Scalars["AWSDateTime"]["output"];
  id: Scalars["ID"]["output"];
  idempotencyKey: Scalars["String"]["output"];
  inputPreview?: Maybe<Scalars["String"]["output"]>;
  instructionsPreview?: Maybe<Scalars["String"]["output"]>;
  lastResumeAttemptAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  lastResumeError?: Maybe<Scalars["String"]["output"]>;
  lastResumeHttpStatus?: Maybe<Scalars["Int"]["output"]>;
  links?: Maybe<Scalars["AWSJSON"]["output"]>;
  managedApplicationId?: Maybe<Scalars["ID"]["output"]>;
  nextResumeAttemptAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  openingMessageId?: Maybe<Scalars["ID"]["output"]>;
  outputPayload?: Maybe<Scalars["AWSJSON"]["output"]>;
  pluginInstallId?: Maybe<Scalars["ID"]["output"]>;
  requestId?: Maybe<Scalars["String"]["output"]>;
  requestMetadata: Scalars["AWSJSON"]["output"];
  resultPayload?: Maybe<Scalars["AWSJSON"]["output"]>;
  resumeAttemptCount: Scalars["Int"]["output"];
  resumeStatus: N8nAgentStepResumeStatus;
  resumeUrlHost?: Maybe<Scalars["String"]["output"]>;
  resumeUrlPath?: Maybe<Scalars["String"]["output"]>;
  resumedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  spaceId: Scalars["ID"]["output"];
  status: N8nAgentStepRunStatus;
  stepId: Scalars["String"]["output"];
  summary?: Maybe<Scalars["String"]["output"]>;
  tenantId: Scalars["ID"]["output"];
  terminalAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  threadId?: Maybe<Scalars["ID"]["output"]>;
  threadTurnId?: Maybe<Scalars["ID"]["output"]>;
  timeoutSeconds: Scalars["Int"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
  workflowId: Scalars["String"]["output"];
  workflowName?: Maybe<Scalars["String"]["output"]>;
};

export enum N8nAgentStepRunStatus {
  Accepted = "ACCEPTED",
  AwaitingHuman = "AWAITING_HUMAN",
  Expired = "EXPIRED",
  Failed = "FAILED",
  Resumed = "RESUMED",
  ResumeFailed = "RESUME_FAILED",
  ResumePending = "RESUME_PENDING",
  Resuming = "RESUMING",
  Waiting = "WAITING",
}

/**
 * Redacted operator-visible telemetry for n8n agent-step bridge runs.
 *
 * This intentionally excludes tenant IDs, idempotency keys, request metadata,
 * resume URL host/path, secret refs, and raw result/output/error payloads.
 */
export type N8nAgentStepRunTelemetry = {
  __typename?: "N8nAgentStepRunTelemetry";
  acceptedAt: Scalars["AWSDateTime"]["output"];
  agentId?: Maybe<Scalars["ID"]["output"]>;
  correlationId: Scalars["String"]["output"];
  createdAt: Scalars["AWSDateTime"]["output"];
  errorMessage?: Maybe<Scalars["String"]["output"]>;
  executionId: Scalars["String"]["output"];
  expiresAt: Scalars["AWSDateTime"]["output"];
  id: Scalars["ID"]["output"];
  inputPreview?: Maybe<Scalars["String"]["output"]>;
  instructionsPreview?: Maybe<Scalars["String"]["output"]>;
  lastResumeAttemptAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  lastResumeError?: Maybe<Scalars["String"]["output"]>;
  lastResumeHttpStatus?: Maybe<Scalars["Int"]["output"]>;
  links?: Maybe<Scalars["AWSJSON"]["output"]>;
  managedApplicationId?: Maybe<Scalars["ID"]["output"]>;
  nextResumeAttemptAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  openingMessageId?: Maybe<Scalars["ID"]["output"]>;
  outputPreview?: Maybe<Scalars["String"]["output"]>;
  pluginInstallId?: Maybe<Scalars["ID"]["output"]>;
  requestId?: Maybe<Scalars["String"]["output"]>;
  resumeAttemptCount: Scalars["Int"]["output"];
  resumeStatus: N8nAgentStepResumeStatus;
  resumedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  spaceId: Scalars["ID"]["output"];
  status: N8nAgentStepRunStatus;
  stepId: Scalars["String"]["output"];
  summary?: Maybe<Scalars["String"]["output"]>;
  terminalAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  threadId?: Maybe<Scalars["ID"]["output"]>;
  threadTurnId?: Maybe<Scalars["ID"]["output"]>;
  timeoutSeconds: Scalars["Int"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
  workflowId: Scalars["String"]["output"];
  workflowName?: Maybe<Scalars["String"]["output"]>;
};

export type N8nDiscoveredWorkflow = {
  __typename?: "N8nDiscoveredWorkflow";
  active?: Maybe<Scalars["Boolean"]["output"]>;
  connectedBindingId?: Maybe<Scalars["ID"]["output"]>;
  connectedWorkflowId?: Maybe<Scalars["ID"]["output"]>;
  externalWorkflowId: Scalars["String"]["output"];
  lastExecutionAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  lastModifiedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  name: Scalars["String"]["output"];
  readinessReasons: Scalars["AWSJSON"]["output"];
  readinessState: WorkflowReadinessState;
  triggerTypes: Array<Scalars["String"]["output"]>;
  warnings: Array<Scalars["String"]["output"]>;
};

export type N8nPackage = {
  __typename?: "N8nPackage";
  name: Scalars["String"]["output"];
  spec: Scalars["String"]["output"];
  version: Scalars["String"]["output"];
};

export type N8nPackageConfig = {
  __typename?: "N8nPackageConfig";
  allowExternal: Scalars["String"]["output"];
  digest: Scalars["String"]["output"];
  packageNames: Array<Scalars["String"]["output"]>;
  packageSpecs: Array<Scalars["String"]["output"]>;
  packages: Array<N8nPackage>;
  schemaVersion: Scalars["Int"]["output"];
};

export type N8nPluginSettings = {
  __typename?: "N8nPluginSettings";
  agentStepBridgeCredentialConfigured: Scalars["Boolean"]["output"];
  agentStepBridgeEndpointPath: Scalars["String"]["output"];
  currentPackageConfig: N8nPackageConfig;
  currentStatus?: Maybe<Scalars["String"]["output"]>;
  desiredConfig: Scalars["AWSJSON"]["output"];
  desiredStatus?: Maybe<Scalars["String"]["output"]>;
  installState: Scalars["String"]["output"];
  lastEvidenceBucket?: Maybe<Scalars["String"]["output"]>;
  lastEvidencePrefix?: Maybe<Scalars["String"]["output"]>;
  lastJobError?: Maybe<Scalars["String"]["output"]>;
  lastJobId?: Maybe<Scalars["ID"]["output"]>;
  lastJobOperation?: Maybe<Scalars["String"]["output"]>;
  lastJobStatus?: Maybe<Scalars["String"]["output"]>;
  managedApplicationId?: Maybe<Scalars["ID"]["output"]>;
  n8nApiCredentialBaseUrl?: Maybe<Scalars["String"]["output"]>;
  n8nApiCredentialConfigured: Scalars["Boolean"]["output"];
  packageImageConfigDigest?: Maybe<Scalars["String"]["output"]>;
  packageImageUri?: Maybe<Scalars["String"]["output"]>;
  pluginInstallId: Scalars["ID"]["output"];
  recentAgentStepRuns: Array<N8nAgentStepRunTelemetry>;
};

export type N8nWorkflowBridgeCredential = {
  __typename?: "N8nWorkflowBridgeCredential";
  bindingId: Scalars["ID"]["output"];
  replayWindowSeconds: Scalars["Int"]["output"];
  secretPreview: Scalars["String"]["output"];
  sharedSecret: Scalars["String"]["output"];
  signingHeader: Scalars["String"]["output"];
  timestampHeader: Scalars["String"]["output"];
  workflowId: Scalars["ID"]["output"];
};

export type N8nWorkflowDiscovery = {
  __typename?: "N8nWorkflowDiscovery";
  installId: Scalars["ID"]["output"];
  readinessReasons: Scalars["AWSJSON"]["output"];
  readinessState: WorkflowReadinessState;
  workflows: Array<N8nDiscoveredWorkflow>;
};

export type N8nWorkflowDraftDiagnostic = {
  __typename?: "N8nWorkflowDraftDiagnostic";
  code: Scalars["String"]["output"];
  message: Scalars["String"]["output"];
  nodeId?: Maybe<Scalars["String"]["output"]>;
  nodeName?: Maybe<Scalars["String"]["output"]>;
  nodeType?: Maybe<Scalars["String"]["output"]>;
  severity: Scalars["String"]["output"];
};

export type NewMessageEvent = {
  __typename?: "NewMessageEvent";
  content?: Maybe<Scalars["String"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  messageId: Scalars["ID"]["output"];
  ownerId?: Maybe<Scalars["ID"]["output"]>;
  ownerType?: Maybe<Scalars["String"]["output"]>;
  role: Scalars["String"]["output"];
  senderId?: Maybe<Scalars["ID"]["output"]>;
  senderType?: Maybe<Scalars["String"]["output"]>;
  tenantId: Scalars["ID"]["output"];
  threadId: Scalars["ID"]["output"];
};

export enum OntologyChangeAction {
  Create = "CREATE",
  Deprecate = "DEPRECATE",
  Reject = "REJECT",
  Update = "UPDATE",
}

export enum OntologyChangeItemType {
  EntityType = "ENTITY_TYPE",
  ExternalMapping = "EXTERNAL_MAPPING",
  FacetTemplate = "FACET_TEMPLATE",
  RelationshipType = "RELATIONSHIP_TYPE",
}

export type OntologyChangeSet = {
  __typename?: "OntologyChangeSet";
  appliedVersionId?: Maybe<Scalars["ID"]["output"]>;
  approvedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  approvedByUserId?: Maybe<Scalars["ID"]["output"]>;
  confidence?: Maybe<Scalars["Float"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  evidenceExamples: Array<OntologyEvidenceExample>;
  expectedImpact: Scalars["AWSJSON"]["output"];
  id: Scalars["ID"]["output"];
  items: Array<OntologyChangeSetItem>;
  observedFrequency: Scalars["Int"]["output"];
  proposedBy: Scalars["String"]["output"];
  proposedByUserId?: Maybe<Scalars["ID"]["output"]>;
  rejectedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  rejectedByUserId?: Maybe<Scalars["ID"]["output"]>;
  status: OntologyChangeSetStatus;
  summary?: Maybe<Scalars["String"]["output"]>;
  tenantId: Scalars["ID"]["output"];
  title: Scalars["String"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export type OntologyChangeSetItem = {
  __typename?: "OntologyChangeSetItem";
  action: OntologyChangeAction;
  changeSetId: Scalars["ID"]["output"];
  confidence?: Maybe<Scalars["Float"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  description?: Maybe<Scalars["String"]["output"]>;
  editedValue?: Maybe<Scalars["AWSJSON"]["output"]>;
  evidenceExamples: Array<OntologyEvidenceExample>;
  id: Scalars["ID"]["output"];
  itemType: OntologyChangeItemType;
  position: Scalars["Int"]["output"];
  proposedValue: Scalars["AWSJSON"]["output"];
  status: OntologyChangeSetStatus;
  targetKind?: Maybe<Scalars["String"]["output"]>;
  targetSlug?: Maybe<Scalars["String"]["output"]>;
  tenantId: Scalars["ID"]["output"];
  title: Scalars["String"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export enum OntologyChangeSetStatus {
  Applied = "APPLIED",
  Approved = "APPROVED",
  Draft = "DRAFT",
  PendingReview = "PENDING_REVIEW",
  Rejected = "REJECTED",
}

export type OntologyDefinitions = {
  __typename?: "OntologyDefinitions";
  activeVersion?: Maybe<OntologyVersion>;
  entityTypes: Array<OntologyEntityType>;
  externalMappings: Array<OntologyExternalMapping>;
  facetTemplates: Array<OntologyFacetTemplate>;
  relationshipTypes: Array<OntologyRelationshipType>;
  tenantId: Scalars["ID"]["output"];
};

export type OntologyEntityType = {
  __typename?: "OntologyEntityType";
  aliases: Array<Scalars["String"]["output"]>;
  approvedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  broadType: Scalars["String"]["output"];
  createdAt: Scalars["AWSDateTime"]["output"];
  deprecatedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  description?: Maybe<Scalars["String"]["output"]>;
  externalMappings: Array<OntologyExternalMapping>;
  facetTemplates: Array<OntologyFacetTemplate>;
  guidanceNotes?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  lifecycleStatus: OntologyLifecycleStatus;
  name: Scalars["String"]["output"];
  propertiesSchema: Scalars["AWSJSON"]["output"];
  rejectedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  slug: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
  versionId?: Maybe<Scalars["ID"]["output"]>;
};

export type OntologyEvidenceExample = {
  __typename?: "OntologyEvidenceExample";
  changeSetId: Scalars["ID"]["output"];
  createdAt: Scalars["AWSDateTime"]["output"];
  id: Scalars["ID"]["output"];
  itemId?: Maybe<Scalars["ID"]["output"]>;
  metadata: Scalars["AWSJSON"]["output"];
  observedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  quote: Scalars["String"]["output"];
  sourceKind: Scalars["String"]["output"];
  sourceLabel?: Maybe<Scalars["String"]["output"]>;
  sourceRef?: Maybe<Scalars["String"]["output"]>;
  tenantId: Scalars["ID"]["output"];
};

export type OntologyExternalMapping = {
  __typename?: "OntologyExternalMapping";
  createdAt: Scalars["AWSDateTime"]["output"];
  externalLabel?: Maybe<Scalars["String"]["output"]>;
  externalUri: Scalars["String"]["output"];
  id: Scalars["ID"]["output"];
  mappingKind: OntologyMappingKind;
  notes?: Maybe<Scalars["String"]["output"]>;
  subjectId: Scalars["ID"]["output"];
  subjectKind: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
  vocabulary: Scalars["String"]["output"];
};

export type OntologyFacetTemplate = {
  __typename?: "OntologyFacetTemplate";
  createdAt: Scalars["AWSDateTime"]["output"];
  entityTypeId: Scalars["ID"]["output"];
  facetType: Scalars["String"]["output"];
  guidanceNotes?: Maybe<Scalars["String"]["output"]>;
  heading: Scalars["String"]["output"];
  id: Scalars["ID"]["output"];
  lifecycleStatus: OntologyLifecycleStatus;
  position: Scalars["Int"]["output"];
  prompt?: Maybe<Scalars["String"]["output"]>;
  slug: Scalars["String"]["output"];
  sourcePriority: Scalars["AWSJSON"]["output"];
  tenantId: Scalars["ID"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export enum OntologyJobStatus {
  Canceled = "CANCELED",
  Failed = "FAILED",
  Pending = "PENDING",
  Running = "RUNNING",
  Succeeded = "SUCCEEDED",
}

export enum OntologyLifecycleStatus {
  Approved = "APPROVED",
  Deprecated = "DEPRECATED",
  Proposed = "PROPOSED",
  Rejected = "REJECTED",
}

export enum OntologyMappingKind {
  Broad = "BROAD",
  Close = "CLOSE",
  Exact = "EXACT",
  Narrow = "NARROW",
  Related = "RELATED",
}

export type OntologyRelationshipType = {
  __typename?: "OntologyRelationshipType";
  aliases: Array<Scalars["String"]["output"]>;
  approvedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  deprecatedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  description?: Maybe<Scalars["String"]["output"]>;
  externalMappings: Array<OntologyExternalMapping>;
  guidanceNotes?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  inverseName?: Maybe<Scalars["String"]["output"]>;
  lifecycleStatus: OntologyLifecycleStatus;
  name: Scalars["String"]["output"];
  rejectedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  slug: Scalars["String"]["output"];
  sourceEntityTypeId?: Maybe<Scalars["ID"]["output"]>;
  sourceTypeSlugs: Array<Scalars["String"]["output"]>;
  targetEntityTypeId?: Maybe<Scalars["ID"]["output"]>;
  targetTypeSlugs: Array<Scalars["String"]["output"]>;
  tenantId: Scalars["ID"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
  versionId?: Maybe<Scalars["ID"]["output"]>;
};

export type OntologyReprocessJob = {
  __typename?: "OntologyReprocessJob";
  attempt: Scalars["Int"]["output"];
  changeSetId?: Maybe<Scalars["ID"]["output"]>;
  claimedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  dedupeKey?: Maybe<Scalars["String"]["output"]>;
  error?: Maybe<Scalars["String"]["output"]>;
  finishedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  id: Scalars["ID"]["output"];
  impact: Scalars["AWSJSON"]["output"];
  input: Scalars["AWSJSON"]["output"];
  metrics: Scalars["AWSJSON"]["output"];
  ontologyVersionId?: Maybe<Scalars["ID"]["output"]>;
  startedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  status: OntologyJobStatus;
  tenantId: Scalars["ID"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export type OntologySuggestionScanJob = {
  __typename?: "OntologySuggestionScanJob";
  createdAt: Scalars["AWSDateTime"]["output"];
  dedupeKey?: Maybe<Scalars["String"]["output"]>;
  error?: Maybe<Scalars["String"]["output"]>;
  finishedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  id: Scalars["ID"]["output"];
  metrics: Scalars["AWSJSON"]["output"];
  result: Scalars["AWSJSON"]["output"];
  startedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  status: OntologyJobStatus;
  tenantId: Scalars["ID"]["output"];
  trigger: Scalars["String"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export type OntologyVersion = {
  __typename?: "OntologyVersion";
  activatedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  id: Scalars["ID"]["output"];
  sourceChangeSetId?: Maybe<Scalars["ID"]["output"]>;
  status: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
  versionNumber: Scalars["Int"]["output"];
};

export type OrgUpdateEvent = {
  __typename?: "OrgUpdateEvent";
  changeType: Scalars["String"]["output"];
  entityId?: Maybe<Scalars["ID"]["output"]>;
  entityType?: Maybe<Scalars["String"]["output"]>;
  tenantId: Scalars["ID"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export type OverrideEvalResultInput = {
  overrideStatus?: InputMaybe<Scalars["String"]["input"]>;
  reason?: InputMaybe<Scalars["String"]["input"]>;
  resultId: Scalars["ID"]["input"];
};

export type PageInfo = {
  __typename?: "PageInfo";
  endCursor?: Maybe<Scalars["String"]["output"]>;
  hasNextPage: Scalars["Boolean"]["output"];
};

export type PerformanceTimeSeries = {
  __typename?: "PerformanceTimeSeries";
  avgDurationMs: Scalars["Float"]["output"];
  day: Scalars["String"]["output"];
  errorCount: Scalars["Int"]["output"];
  invocationCount: Scalars["Int"]["output"];
  totalCostUsd: Scalars["Float"]["output"];
};

export type PinnedThread = {
  __typename?: "PinnedThread";
  pinOrder: Scalars["Int"]["output"];
  pinnedAt: Scalars["AWSDateTime"]["output"];
  thread: Thread;
};

export type PlanRoutineDraftInput = {
  description?: InputMaybe<Scalars["String"]["input"]>;
  name: Scalars["String"]["input"];
  steps?: InputMaybe<Array<RoutineDefinitionStepConfigInput>>;
  tenantId: Scalars["ID"]["input"];
};

/** Display summary of one manifest component for catalog browse. */
export type PluginCatalogComponent = {
  __typename?: "PluginCatalogComponent";
  /** Display name where the manifest declares one; null → render falls back to key. */
  displayName?: Maybe<Scalars["String"]["output"]>;
  key: Scalars["String"]["output"];
  /** 'mcp-server' | 'skills' | 'infrastructure' | 'ui-surface' | 'auth-provider'. */
  type: Scalars["String"]["output"];
};

/**
 * Catalog browse entry: the signed-catalog manifest overlaid with the caller
 * tenant's install state. `install` is null when the plugin is not installed.
 */
export type PluginCatalogEntry = {
  __typename?: "PluginCatalogEntry";
  description: Scalars["String"]["output"];
  displayName: Scalars["String"]["output"];
  /** The caller tenant's active entitlement for this premium plugin, if any. */
  entitlement?: Maybe<PluginEntitlement>;
  /** The caller tenant's install of this plugin, if any. */
  install?: Maybe<PluginInstall>;
  latestVersion: Scalars["String"]["output"];
  /** Public application URL when this installed plugin owns a deployed app. */
  launchUrl?: Maybe<Scalars["String"]["output"]>;
  pluginKey: Scalars["String"]["output"];
  /** Premium metadata when the catalog entry is key-gated; null for included plugins. */
  premium?: Maybe<PluginCatalogPremium>;
  /** True when an install exists and a newer catalog version is available. */
  updateAvailable: Scalars["Boolean"]["output"];
  /** Published versions, newest first. */
  versions: Array<PluginCatalogVersion>;
};

/**
 * Source and freshness metadata for the signed plugin catalog snapshot currently
 * trusted by the GraphQL API. This is a sibling status surface for Settings UI;
 * catalog rows remain the install/version overlay.
 */
export type PluginCatalogMetadata = {
  __typename?: "PluginCatalogMetadata";
  /** GitHub release asset name for release-backed catalogs. */
  assetName?: Maybe<Scalars["String"]["output"]>;
  /** sha256 of the verified catalog snapshot. */
  catalogSha256: Scalars["String"]["output"];
  /** Source commit SHA from signed provenance. */
  commitSha?: Maybe<Scalars["String"]["output"]>;
  /** Last time the API fetched or revalidated the GitHub release metadata. */
  fetchedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  /** Timestamp embedded in the signed catalog payload. */
  generatedAt: Scalars["AWSDateTime"]["output"];
  /** 'fresh' | 'not-modified' | 'stale-fallback' for GitHub-backed catalogs. */
  lastRefreshStatus?: Maybe<Scalars["String"]["output"]>;
  /** Refresh failure detail when stale fallback is active. */
  message?: Maybe<Scalars["String"]["output"]>;
  /** GitHub rate limit remaining header from the last release metadata response. */
  rateLimitRemaining?: Maybe<Scalars["String"]["output"]>;
  /** GitHub rate limit reset header from the last release metadata response. */
  rateLimitReset?: Maybe<Scalars["String"]["output"]>;
  /** Git ref from the signed source provenance when present. */
  ref?: Maybe<Scalars["String"]["output"]>;
  /** GitHub release tag for release-backed catalogs. */
  releaseTag?: Maybe<Scalars["String"]["output"]>;
  /** GitHub repository when the catalog carries source provenance. */
  repository?: Maybe<Scalars["String"]["output"]>;
  /** 'bundled-unsigned' | 'bundled-signed' | 'github-release' | 'github-release-stale'. */
  source: Scalars["String"]["output"];
  /** True when the API is serving the last verified snapshot after a refresh failure. */
  stale: Scalars["Boolean"]["output"];
};

/**
 * Premium catalog metadata declared by the signed plugin manifest. Raw install
 * keys and key digests are never exposed through GraphQL.
 */
export type PluginCatalogPremium = {
  __typename?: "PluginCatalogPremium";
  /** Premium product key used by the entitlement layer. */
  entitlementProductKey: Scalars["String"]["output"];
  /** Customer-facing key prompt copy for unentitled tenants. */
  installKeyPrompt: Scalars["String"]["output"];
  /** True when installation needs a ThinkWork-provided one-time key. */
  installKeyRequired: Scalars["Boolean"]["output"];
};

/** One published version of a plugin in the signed catalog. */
export type PluginCatalogVersion = {
  __typename?: "PluginCatalogVersion";
  components: Array<PluginCatalogComponent>;
  /** sha256 of the version payload (what installs pin). */
  payloadSha256: Scalars["String"]["output"];
  /** OAuth scopes this version's MCP servers require at activation. */
  requiredOauthScopes: Array<Scalars["String"]["output"]>;
  version: Scalars["String"]["output"];
};

/**
 * Application plugins (plan 2026-06-12-001).
 *
 * The plugin engine is the canonical record of install, component, and
 * activation state. Admin mutations (install/upgrade/uninstall/retry) require
 * tenant admin via resolveCallerTenantId; activation mutations bind the
 * canonical caller user id. Install/component status reconciles against linked
 * deployment-job events at read time — no readiness snapshots. Token secret
 * refs are NEVER exposed through this schema.
 */
export type PluginComponent = {
  __typename?: "PluginComponent";
  /** Component key from the pinned manifest version (unique within the install). */
  componentKey: Scalars["String"]["output"];
  /** 'mcp-server' | 'skills' | 'infrastructure' | 'ui-surface' | 'auth-provider'. */
  componentType: Scalars["String"]["output"];
  createdAt: Scalars["AWSDateTime"]["output"];
  /**
   * Handler linkage into real runtime rows, shape by component type:
   * mcp-server { tenantMcpServerId }, skills { seededCatalogPrefix,
   * workspaceFolders }, infrastructure { managedApplicationId, deploymentJobId },
   * auth-provider { status, publicOptionsPublished }.
   */
  handlerRef: Scalars["AWSJSON"]["output"];
  id: Scalars["ID"]["output"];
  lastError?: Maybe<Scalars["String"]["output"]>;
  /** 'pending' | 'provisioned' | 'failed' (failed → pending on retry). */
  state: Scalars["String"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export type PluginCredentialValueInput = {
  key: Scalars["String"]["input"];
  value: Scalars["String"]["input"];
};

/**
 * Persistent tenant entitlement for a premium plugin. Entitlement state is
 * separate from install state so reinstall/update can bypass another key.
 */
export type PluginEntitlement = {
  __typename?: "PluginEntitlement";
  createdAt: Scalars["AWSDateTime"]["output"];
  entitlementProductKey: Scalars["String"]["output"];
  grantedAt: Scalars["AWSDateTime"]["output"];
  id: Scalars["ID"]["output"];
  pluginKey: Scalars["String"]["output"];
  revokedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  /** 'install_key' | 'backdoor_key' | 'operator_grant' | 'migration'. */
  source: Scalars["String"]["output"];
  /** 'active' | 'revoked'. */
  status: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export type PluginInstall = {
  __typename?: "PluginInstall";
  /** Count of 'active' user activations — powers the uninstall warning. */
  activatedUserCount: Scalars["Int"]["output"];
  components: Array<PluginComponent>;
  createdAt: Scalars["AWSDateTime"]["output"];
  id: Scalars["ID"]["output"];
  lastError?: Maybe<Scalars["String"]["output"]>;
  /** Set on every state transition; staleness re-drive input. */
  lastTransitionAt: Scalars["AWSDateTime"]["output"];
  /** sha256 of the pinned version payload. */
  pinnedPayloadSha256: Scalars["String"]["output"];
  /** Catalog version pinned at install/upgrade time. */
  pinnedVersion: Scalars["String"]["output"];
  /** Plugin key from the signed catalog (e.g. 'lastmile'). */
  pluginKey: Scalars["String"]["output"];
  /**
   * 'installing' | 'awaiting_approval' | 'installed' | 'partially_installed' |
   * 'failed' | 'uninstalling'.
   */
  state: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export type PromoteDraftAppletInput = {
  computerId: Scalars["ID"]["input"];
  draftId: Scalars["ID"]["input"];
  files: Scalars["AWSJSON"]["input"];
  metadata?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  name: Scalars["String"]["input"];
  promotionProof: Scalars["String"]["input"];
  promotionProofExpiresAt: Scalars["AWSDateTime"]["input"];
  sourceDigest: Scalars["String"]["input"];
  threadId: Scalars["ID"]["input"];
};

export type PromoteGenUiArtifactInput = {
  idempotencyKey: Scalars["String"]["input"];
  partId: Scalars["String"]["input"];
  sourceMessageId: Scalars["ID"]["input"];
  specHash: Scalars["String"]["input"];
  threadId: Scalars["ID"]["input"];
};

export type PublishRoutineVersionInput = {
  asl: Scalars["AWSJSON"]["input"];
  markdownSummary: Scalars["String"]["input"];
  routineId: Scalars["ID"]["input"];
  stepManifest: Scalars["AWSJSON"]["input"];
};

export type PublishSkillDraftInput = {
  confirmReplace?: InputMaybe<Scalars["Boolean"]["input"]>;
  id: Scalars["ID"]["input"];
};

export type Query = {
  __typename?: "Query";
  _empty?: Maybe<Scalars["String"]["output"]>;
  accountUsage: AccountUsage;
  activityLog: Array<ActivityLogEntry>;
  adminApplet?: Maybe<AppletPayload>;
  adminApplets: AppletConnection;
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
  agentBudgetStatus?: Maybe<BudgetStatus>;
  agentCostBreakdown: CostSummary;
  agentLoop?: Maybe<AgentLoop>;
  agentLoopRun?: Maybe<AgentLoopRun>;
  agentLoops: Array<AgentLoop>;
  agentPerformance: Array<AgentPerformance>;
  agentProfile?: Maybe<AgentProfile>;
  agentProfileEditorCatalog: AgentProfileEditorCatalog;
  agentProfiles: Array<AgentProfile>;
  agentWorkspaceEvents: Array<AgentWorkspaceEvent>;
  agentWorkspaceReview?: Maybe<AgentWorkspaceReview>;
  agentWorkspaceReviews: Array<AgentWorkspaceReview>;
  agentWorkspaceRuns: Array<AgentWorkspaceRun>;
  applet?: Maybe<AppletPayload>;
  appletState?: Maybe<AppletState>;
  applets: AppletConnection;
  artifact?: Maybe<Artifact>;
  artifacts: Array<Artifact>;
  bedrockModelImportCandidates: Array<BedrockModelImportCandidate>;
  budgetPolicies: Array<BudgetPolicy>;
  budgetStatus: Array<BudgetStatus>;
  companyBrainStatus: CompanyBrainStatus;
  /**
   * Single event by event_id. Non-operator callers reading another tenant's
   * event_id see null (existence-oracle defense — SQL filter applies in the
   * WHERE clause so the timing-side-channel is closed).
   */
  complianceEvent?: Maybe<ComplianceEvent>;
  /**
   * Single event by event_hash. Used by the chain-position panel's
   * prev_hash click-through and the walk-back-N-events iterator.
   * Tenant-scoped for non-operators. The eventHash MUST be a 64-char
   * lowercase hex SHA-256 digest; malformed input returns null without
   * hitting the DB (resolver-level format guard).
   */
  complianceEventByHash?: Maybe<ComplianceEvent>;
  /**
   * Paginated audit-event list, sorted by `occurred_at DESC, event_id DESC`
   * (matches the existing `(tenant_id, occurred_at DESC)` index on
   * `compliance.audit_events`). Cursor encodes
   * `{occurred_at_iso_with_microseconds, event_id}` as base64-url JSON.
   * Page size capped at 200 server-side; client-recommended default 50.
   */
  complianceEvents: ComplianceEventConnection;
  /**
   * Caller's recent export jobs, sorted requested_at DESC, LIMIT 50.
   * Operators see all tenants; non-operators are tenant-scoped via the
   * same auth model as complianceEvents.
   */
  complianceExports: Array<ComplianceExport>;
  /**
   * Caller's compliance-operator status + dev-environment configuration
   * signal. Mirrors the adminRoleCheck pattern (top-level Query field,
   * NOT a User-type field — operator status is caller-dependent and
   * attaching it to User would leak the semantic across every
   * User-returning query).
   */
  complianceOperatorCheck: ComplianceOperatorCheckResult;
  /**
   * Distinct tenant_ids visible to the caller. Operators get the full
   * set (DISTINCT tenant_id from compliance.audit_events); non-operators
   * get a 1-element list of their own tenant. Powers the operator
   * tenant-filter typeahead in the admin Compliance section.
   */
  complianceTenants: Array<Scalars["ID"]["output"]>;
  compositionFeedbackSummary: Array<CompositionFeedbackSummary>;
  concurrencySnapshot: ConcurrencySnapshot;
  costByAgent: Array<AgentCostSummary>;
  costByModel: Array<ModelCostSummary>;
  costByUser: Array<UserCostSummary>;
  costSummary: CostSummary;
  costTimeSeries: Array<DailyCostPoint>;
  customerOnboardingSpace?: Maybe<Space>;
  customizeBindings?: Maybe<CustomizeBindings>;
  deploymentEvidence: DeploymentEvidence;
  deploymentReleases: Array<DeploymentRelease>;
  deploymentStatus: DeploymentStatus;
  discoverN8nWorkflows: N8nWorkflowDiscovery;
  emailChannelLedger: Array<EmailLedgerEvent>;
  emailChannelSummary: EmailChannelSummary;
  emailSpaceEmailPolicy?: Maybe<EmailSpacePolicy>;
  evalDataset?: Maybe<EvalDataset>;
  evalDatasets: Array<EvalDataset>;
  evalReplayAvailableMcpTools: Array<EvalReplayMcpServer>;
  evalReplayToolAllowlist: Array<EvalReplayAllowedTool>;
  evalResultSpans: Array<EvalSpan>;
  evalRun?: Maybe<EvalRun>;
  evalRunResults: Array<EvalResult>;
  evalRuns: EvalRunsPage;
  evalSummary: EvalSummary;
  evalTestCase?: Maybe<EvalTestCase>;
  evalTestCaseHistory: Array<EvalResult>;
  evalTestCases: Array<EvalTestCase>;
  evalTimeSeries: Array<EvalTimeSeriesPoint>;
  flaggedTurnSkillCandidates: SkillAttributionCandidates;
  inboxItem?: Maybe<InboxItem>;
  inboxItems: Array<InboxItem>;
  knowledgeBase?: Maybe<KnowledgeBase>;
  knowledgeBases: Array<KnowledgeBase>;
  knowledgeGraphEntities: Array<KnowledgeGraphEntity>;
  knowledgeGraphEntity?: Maybe<KnowledgeGraphEntity>;
  knowledgeGraphGraph: KnowledgeGraphGraph;
  knowledgeGraphHealthCheck: KnowledgeGraphHealthCheck;
  knowledgeGraphIngestRuns: Array<KnowledgeGraphIngestRun>;
  knowledgeGraphSearch: KnowledgeGraphSearchResult;
  knowledgeGraphThreadCandidates: Array<KnowledgeGraphThreadCandidate>;
  managedApplicationDeployment?: Maybe<ManagedApplicationDeploymentJob>;
  managedApplicationHealthCheck: ManagedApplicationHealthCheck;
  managedApplications: Array<ManagedApplication>;
  me?: Maybe<User>;
  memoryGraph: MemoryGraph;
  memoryRecords: Array<MemoryRecord>;
  memorySearch: MemorySearchResult;
  memorySystemConfig: MemorySystemConfig;
  messages: MessageConnection;
  mobileMemoryCaptures: Array<MobileMemoryCapture>;
  /**
   * Free-text search across the full Hindsight bank for the given user.
   * Hits Hindsight's recall endpoint (semantic + rerank) and normalizes results
   * back to MobileMemoryCapture so the Memories list can render search results
   * with the same rows it uses for captures. Not filtered by capture_source —
   * search is meant to answer "what does this user know?", including chat-
   * derived observations.
   */
  mobileMemorySearch: Array<MobileMemoryCapture>;
  /**
   * Ranked wiki-page search for mobile. Runs a Postgres full-text query
   * (`plainto_tsquery('english', …)` + `ts_rank`) against the GIN-indexed
   * `search_tsv` generated column on `wiki_pages` (title || summary ||
   * body_md), scoped to tenant-shared pages (null owner) plus the
   * requesting user's own pages. Returns results in `ts_rank` DESC order,
   * tie-broken by `last_compiled_at` DESC.
   *
   * Previously routed through Hindsight semantic recall; on the compiled
   * wiki corpus FTS is near-instant and matches the query shape mobile
   * users actually type (page titles, keywords). `matchingMemoryIds` is
   * retained for wire-format compatibility and is always [] on this path —
   * pages match their own compiled text, not source memory units.
   */
  mobileWikiSearch: Array<MobileWikiSearchResult>;
  modelCatalog: Array<ModelCatalogEntry>;
  myApprovedModelCatalog: Array<ModelCatalogEntry>;
  /** The caller's plugin activations across the tenant's installs. */
  myPluginActivations: Array<UserPluginActivation>;
  mySlackLinks: Array<SlackUserLink>;
  n8nAgentStepRuns: Array<N8nAgentStepRunTelemetry>;
  /** Operator settings for the installed n8n plugin package image config. */
  n8nPluginSettings?: Maybe<N8nPluginSettings>;
  ontologyChangeSets: Array<OntologyChangeSet>;
  ontologyDefinitions: OntologyDefinitions;
  ontologyReprocessJob?: Maybe<OntologyReprocessJob>;
  ontologySuggestionScanJob?: Maybe<OntologySuggestionScanJob>;
  pendingSystemReviewsCount: Scalars["Int"]["output"];
  performanceTimeSeries: Array<PerformanceTimeSeries>;
  pinnedThreads: Array<PinnedThread>;
  /**
   * Browse the signed plugin catalog overlaid with the caller tenant's install
   * state. Fails closed (GraphQL error) on catalog signature/digest failure.
   */
  pluginCatalog: Array<PluginCatalogEntry>;
  /** Source, provenance, and freshness metadata for the trusted plugin catalog snapshot. */
  pluginCatalogMetadata: PluginCatalogMetadata;
  /** One install by id, with read-time component status reconciliation. */
  pluginInstall?: Maybe<PluginInstall>;
  /** The caller tenant's plugin installs (admin status surface). */
  pluginInstalls: Array<PluginInstall>;
  queuedWakeups: Array<AgentWakeupRequest>;
  /**
   * Newest compiled wiki pages readable by the given user — tenant-shared
   * pages (null owner) plus their own — ordered by last_compiled_at DESC
   * (falling back to updated_at when the page hasn't been recompiled yet).
   * Intended as the default Memories-tab feed so the user sees fresh pages
   * before they type a search query.
   */
  recentWikiPages: Array<WikiPage>;
  recipe?: Maybe<Recipe>;
  recipes: Array<Recipe>;
  releaseUpdateJob?: Maybe<ReleaseUpdateJob>;
  routine?: Maybe<Routine>;
  routineAslVersion?: Maybe<RoutineAslVersion>;
  routineDefinition?: Maybe<RoutineDefinition>;
  routineExecution?: Maybe<RoutineExecution>;
  routineExecutions: Array<RoutineExecution>;
  routineRecipeCatalog: Array<RoutineRecipe>;
  routineStepEvents: Array<RoutineStepEvent>;
  routines: Array<Routine>;
  runtimeManifestsByAgent: Array<RuntimeManifest>;
  scheduledJob?: Maybe<ScheduledJob>;
  scheduledJobs: Array<ScheduledJob>;
  singleAgentPerformance?: Maybe<AgentPerformance>;
  /** Read a single tenant-scoped draft. */
  skillDraft?: Maybe<SkillDraft>;
  /**
   * List skill drafts for the caller tenant. Non-operators receive only drafts
   * they requested. Operators receive tenant-wide drafts and may optionally
   * filter by status or requester.
   */
  skillDrafts: Array<SkillDraftSummary>;
  skillEvalGate: SkillEvalGate;
  skillEvalScore: SkillEvalScore;
  skillRun?: Maybe<SkillRun>;
  skillRuns: Array<SkillRun>;
  slackWorkspaces: Array<SlackWorkspace>;
  space?: Maybe<Space>;
  spaces: Array<Space>;
  tenant?: Maybe<Tenant>;
  tenantAgent: Agent;
  tenantBySlug?: Maybe<Tenant>;
  tenantCredentials: Array<TenantCredential>;
  tenantMembers: Array<TenantMember>;
  tenantMentionTargets: Array<ThreadMentionTarget>;
  tenantModelCatalog: Array<TenantModelCatalogEntry>;
  /**
   * List the caller-tenant's skill catalog (the derived skill_catalog index) for
   * composer/skill pickers. When `agentId` is provided, entries are annotated
   * with `installed` and skills blocked on that agent (agent.blocked_tools) are
   * omitted — the popup never offers a blocked skill. The authoritative blocklist
   * guardrail is also enforced server-side at dispatch.
   */
  tenantSkillCatalog: Array<SkillCatalogEntry>;
  tenantToolInventory: TenantToolInventory;
  testKnowledgeBaseRetrieval: KnowledgeBaseRetrievalResult;
  thread?: Maybe<Thread>;
  threadByNumber?: Maybe<Thread>;
  threadGoal?: Maybe<ThreadGoal>;
  threadGoalFiles?: Maybe<ThreadGoalFiles>;
  threadIdleLearningRun?: Maybe<ThreadIdleLearningRun>;
  threadIdleLearningRuns: Array<ThreadIdleLearningRun>;
  threadLabels: Array<ThreadLabel>;
  threadLinkedTasks: Array<LinkedTask>;
  threadMentionTargets: Array<ThreadMentionTarget>;
  threadProgress?: Maybe<ThreadProgress>;
  threadProgressMarkdown?: Maybe<ThreadProgressMarkdown>;
  threadTraces: Array<TraceEvent>;
  threadTurn?: Maybe<ThreadTurn>;
  threadTurnEvents: Array<ThreadTurnEvent>;
  threadTurns: Array<ThreadTurn>;
  threadWorkItems: Array<WorkItem>;
  threads: Array<Thread>;
  threadsPaged: ThreadsPage;
  turnInvocationLogs: Array<ModelInvocation>;
  unreadThreadCount: Scalars["Int"]["output"];
  user?: Maybe<User>;
  userBudgetStatus?: Maybe<BudgetStatus>;
  userModelCatalog: Array<UserModelCatalogEntry>;
  userQuickActions: Array<UserQuickAction>;
  webhook?: Maybe<Webhook>;
  /**
   * List recent webhook deliveries for one webhook. Tenant-scoped via the
   * webhook's row (cross-tenant ids return empty). Newest first. Hard
   * cap of 500 rows; default 50.
   */
  webhookDeliveries: Array<WebhookDelivery>;
  webhooks: Array<Webhook>;
  /**
   * Pages that link to the given page. Visibility is derived from the target
   * page's owner scope; caller must be that owner or an admin.
   */
  wikiBacklinks: Array<WikiPage>;
  /**
   * Admin-only: list recent compile jobs for a tenant. When `userId` is
   * provided, restricts to that user's jobs; when null/absent, returns
   * jobs across every user in the tenant — including tenant-keyed
   * graph-mode jobs (null `userId`). Ordered newest-first.
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
   * Force-graph over the readable scope: tenant-scoped pages plus the
   * requesting user's own pages, with every page-to-page link whose
   * endpoints are both active and readable. Links that reference archived
   * pages are excluded. One round-trip. `userId` is optional and defaults
   * to the caller.
   */
  wikiGraph: WikiGraph;
  /**
   * Read one compiled page by slug. Serves tenant-scoped pages (null owner)
   * plus the requesting user's own pages; `userId` is optional and defaults
   * to the caller. When a user page and a tenant page share a slug during
   * the transition window, the user's own page wins.
   */
  wikiPage?: Maybe<WikiPage>;
  /**
   * Postgres full-text search over compiled pages — tenant-scoped pages plus
   * the requesting user's own pages. Also matches exact aliases. Ranked by
   * ts_rank + alias-hit boost.
   */
  wikiSearch: Array<WikiSearchResult>;
  workItem?: Maybe<WorkItem>;
  workItemSavedViews: Array<WorkItemSavedView>;
  workItemStatuses: Array<WorkItemStatus>;
  workItems: Array<WorkItem>;
  workflow?: Maybe<Workflow>;
  workflowCatalog: Array<WorkflowCatalogItem>;
  workflowRun?: Maybe<WorkflowRun>;
  workflowRuns: Array<WorkflowRun>;
  workflowTemplateCatalog: Array<WorkflowTemplateCatalogItem>;
  workflows: Array<Workflow>;
};

export type QueryAccountUsageArgs = {
  days?: InputMaybe<Scalars["Int"]["input"]>;
  tenantId: Scalars["ID"]["input"];
  userId: Scalars["ID"]["input"];
};

export type QueryActivityLogArgs = {
  action?: InputMaybe<Scalars["String"]["input"]>;
  actorId?: InputMaybe<Scalars["ID"]["input"]>;
  actorType?: InputMaybe<Scalars["String"]["input"]>;
  after?: InputMaybe<Scalars["AWSDateTime"]["input"]>;
  before?: InputMaybe<Scalars["AWSDateTime"]["input"]>;
  entityId?: InputMaybe<Scalars["ID"]["input"]>;
  entityType?: InputMaybe<Scalars["String"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  tenantId: Scalars["ID"]["input"];
};

export type QueryAdminAppletArgs = {
  appId: Scalars["ID"]["input"];
};

export type QueryAdminAppletsArgs = {
  cursor?: InputMaybe<Scalars["String"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  tenantId: Scalars["ID"]["input"];
  userId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type QueryAgentBudgetStatusArgs = {
  agentId: Scalars["ID"]["input"];
};

export type QueryAgentCostBreakdownArgs = {
  agentId: Scalars["ID"]["input"];
  from?: InputMaybe<Scalars["AWSDateTime"]["input"]>;
  tenantId: Scalars["ID"]["input"];
  to?: InputMaybe<Scalars["AWSDateTime"]["input"]>;
};

export type QueryAgentLoopArgs = {
  id: Scalars["ID"]["input"];
};

export type QueryAgentLoopRunArgs = {
  id: Scalars["ID"]["input"];
};

export type QueryAgentLoopsArgs = {
  cursor?: InputMaybe<Scalars["String"]["input"]>;
  enabled?: InputMaybe<Scalars["Boolean"]["input"]>;
  lifecycleStatus?: InputMaybe<AgentLoopLifecycleStatus>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  tenantId: Scalars["ID"]["input"];
};

export type QueryAgentPerformanceArgs = {
  from?: InputMaybe<Scalars["AWSDateTime"]["input"]>;
  tenantId: Scalars["ID"]["input"];
  to?: InputMaybe<Scalars["AWSDateTime"]["input"]>;
};

export type QueryAgentProfileArgs = {
  id?: InputMaybe<Scalars["ID"]["input"]>;
  slug?: InputMaybe<Scalars["String"]["input"]>;
  tenantId: Scalars["ID"]["input"];
};

export type QueryAgentProfileEditorCatalogArgs = {
  tenantId: Scalars["ID"]["input"];
};

export type QueryAgentProfilesArgs = {
  includeDisabled?: InputMaybe<Scalars["Boolean"]["input"]>;
  tenantId: Scalars["ID"]["input"];
};

export type QueryAgentWorkspaceEventsArgs = {
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  runId: Scalars["ID"]["input"];
};

export type QueryAgentWorkspaceReviewArgs = {
  runId: Scalars["ID"]["input"];
};

export type QueryAgentWorkspaceReviewsArgs = {
  agentId?: InputMaybe<Scalars["ID"]["input"]>;
  kind?: InputMaybe<WorkspaceReviewKind>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  responsibleUserId?: InputMaybe<Scalars["ID"]["input"]>;
  status?: InputMaybe<Scalars["String"]["input"]>;
  tenantId: Scalars["ID"]["input"];
};

export type QueryAgentWorkspaceRunsArgs = {
  agentId?: InputMaybe<Scalars["ID"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  status?: InputMaybe<Scalars["String"]["input"]>;
  targetPath?: InputMaybe<Scalars["String"]["input"]>;
};

export type QueryAppletArgs = {
  appId: Scalars["ID"]["input"];
};

export type QueryAppletStateArgs = {
  appId: Scalars["ID"]["input"];
  instanceId: Scalars["ID"]["input"];
  key: Scalars["String"]["input"];
};

export type QueryAppletsArgs = {
  cursor?: InputMaybe<Scalars["String"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
};

export type QueryArtifactArgs = {
  id: Scalars["ID"]["input"];
};

export type QueryArtifactsArgs = {
  agentId?: InputMaybe<Scalars["ID"]["input"]>;
  cursor?: InputMaybe<Scalars["String"]["input"]>;
  favoritedOnly?: InputMaybe<Scalars["Boolean"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  status?: InputMaybe<ArtifactStatus>;
  tenantId: Scalars["ID"]["input"];
  threadId?: InputMaybe<Scalars["ID"]["input"]>;
  type?: InputMaybe<ArtifactType>;
};

export type QueryBedrockModelImportCandidatesArgs = {
  tenantId: Scalars["ID"]["input"];
};

export type QueryBudgetPoliciesArgs = {
  tenantId: Scalars["ID"]["input"];
};

export type QueryBudgetStatusArgs = {
  tenantId: Scalars["ID"]["input"];
};

export type QueryComplianceEventArgs = {
  eventId: Scalars["ID"]["input"];
};

export type QueryComplianceEventByHashArgs = {
  eventHash: Scalars["String"]["input"];
};

export type QueryComplianceEventsArgs = {
  after?: InputMaybe<Scalars["String"]["input"]>;
  filter?: InputMaybe<ComplianceEventFilter>;
  first?: InputMaybe<Scalars["Int"]["input"]>;
};

export type QueryCompositionFeedbackSummaryArgs = {
  skillId?: InputMaybe<Scalars["String"]["input"]>;
  tenantId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type QueryConcurrencySnapshotArgs = {
  tenantId: Scalars["ID"]["input"];
};

export type QueryCostByAgentArgs = {
  from?: InputMaybe<Scalars["AWSDateTime"]["input"]>;
  tenantId: Scalars["ID"]["input"];
  to?: InputMaybe<Scalars["AWSDateTime"]["input"]>;
};

export type QueryCostByModelArgs = {
  from?: InputMaybe<Scalars["AWSDateTime"]["input"]>;
  tenantId: Scalars["ID"]["input"];
  to?: InputMaybe<Scalars["AWSDateTime"]["input"]>;
};

export type QueryCostByUserArgs = {
  from?: InputMaybe<Scalars["AWSDateTime"]["input"]>;
  tenantId: Scalars["ID"]["input"];
  to?: InputMaybe<Scalars["AWSDateTime"]["input"]>;
};

export type QueryCostSummaryArgs = {
  from?: InputMaybe<Scalars["AWSDateTime"]["input"]>;
  tenantId: Scalars["ID"]["input"];
  to?: InputMaybe<Scalars["AWSDateTime"]["input"]>;
};

export type QueryCostTimeSeriesArgs = {
  days?: InputMaybe<Scalars["Int"]["input"]>;
  tenantId: Scalars["ID"]["input"];
};

export type QueryCustomerOnboardingSpaceArgs = {
  tenantId: Scalars["ID"]["input"];
};

export type QueryDeploymentEvidenceArgs = {
  jobId: Scalars["ID"]["input"];
};

export type QueryDeploymentReleasesArgs = {
  limit?: InputMaybe<Scalars["Int"]["input"]>;
};

export type QueryDiscoverN8nWorkflowsArgs = {
  installId: Scalars["ID"]["input"];
};

export type QueryEmailChannelLedgerArgs = {
  conversationId?: InputMaybe<Scalars["ID"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  spaceId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type QueryEmailSpaceEmailPolicyArgs = {
  spaceId: Scalars["ID"]["input"];
};

export type QueryEvalDatasetArgs = {
  slug: Scalars["String"]["input"];
  tenantId: Scalars["ID"]["input"];
};

export type QueryEvalDatasetsArgs = {
  includeArchived?: InputMaybe<Scalars["Boolean"]["input"]>;
  tenantId: Scalars["ID"]["input"];
};

export type QueryEvalReplayAvailableMcpToolsArgs = {
  tenantId: Scalars["ID"]["input"];
};

export type QueryEvalReplayToolAllowlistArgs = {
  tenantId: Scalars["ID"]["input"];
};

export type QueryEvalResultSpansArgs = {
  runId: Scalars["ID"]["input"];
  testCaseId: Scalars["ID"]["input"];
};

export type QueryEvalRunArgs = {
  id: Scalars["ID"]["input"];
};

export type QueryEvalRunResultsArgs = {
  runId: Scalars["ID"]["input"];
};

export type QueryEvalRunsArgs = {
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  offset?: InputMaybe<Scalars["Int"]["input"]>;
  tenantId: Scalars["ID"]["input"];
};

export type QueryEvalSummaryArgs = {
  tenantId: Scalars["ID"]["input"];
};

export type QueryEvalTestCaseArgs = {
  id: Scalars["ID"]["input"];
};

export type QueryEvalTestCaseHistoryArgs = {
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  testCaseId: Scalars["ID"]["input"];
};

export type QueryEvalTestCasesArgs = {
  category?: InputMaybe<Scalars["String"]["input"]>;
  datasetId?: InputMaybe<Scalars["ID"]["input"]>;
  search?: InputMaybe<Scalars["String"]["input"]>;
  tenantId: Scalars["ID"]["input"];
};

export type QueryEvalTimeSeriesArgs = {
  days?: InputMaybe<Scalars["Int"]["input"]>;
  tenantId: Scalars["ID"]["input"];
};

export type QueryFlaggedTurnSkillCandidatesArgs = {
  tenantId: Scalars["ID"]["input"];
  threadId: Scalars["ID"]["input"];
  turnId: Scalars["ID"]["input"];
};

export type QueryInboxItemArgs = {
  id: Scalars["ID"]["input"];
};

export type QueryInboxItemsArgs = {
  entityId?: InputMaybe<Scalars["ID"]["input"]>;
  entityType?: InputMaybe<Scalars["String"]["input"]>;
  recipientId?: InputMaybe<Scalars["ID"]["input"]>;
  status?: InputMaybe<InboxItemStatus>;
  tenantId: Scalars["ID"]["input"];
};

export type QueryKnowledgeBaseArgs = {
  id: Scalars["ID"]["input"];
};

export type QueryKnowledgeBasesArgs = {
  tenantId: Scalars["ID"]["input"];
};

export type QueryKnowledgeGraphEntitiesArgs = {
  groundingStatus?: InputMaybe<KnowledgeGraphGroundingStatus>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  ontologyType?: InputMaybe<Scalars["String"]["input"]>;
  provenanceStatus?: InputMaybe<KnowledgeGraphProvenanceStatus>;
  runId?: InputMaybe<Scalars["ID"]["input"]>;
  search?: InputMaybe<Scalars["String"]["input"]>;
  sourceKind?: InputMaybe<KnowledgeGraphSourceKind>;
  sourceRef?: InputMaybe<Scalars["String"]["input"]>;
  tenantId?: InputMaybe<Scalars["ID"]["input"]>;
  threadId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type QueryKnowledgeGraphEntityArgs = {
  entityId: Scalars["ID"]["input"];
  tenantId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type QueryKnowledgeGraphGraphArgs = {
  groundingStatus?: InputMaybe<KnowledgeGraphGroundingStatus>;
  ontologyType?: InputMaybe<Scalars["String"]["input"]>;
  provenanceStatus?: InputMaybe<KnowledgeGraphProvenanceStatus>;
  runId?: InputMaybe<Scalars["ID"]["input"]>;
  search?: InputMaybe<Scalars["String"]["input"]>;
  sourceKind?: InputMaybe<KnowledgeGraphSourceKind>;
  sourceRef?: InputMaybe<Scalars["String"]["input"]>;
  tenantId?: InputMaybe<Scalars["ID"]["input"]>;
  threadId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type QueryKnowledgeGraphIngestRunsArgs = {
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  sourceKind?: InputMaybe<KnowledgeGraphSourceKind>;
  sourceRef?: InputMaybe<Scalars["String"]["input"]>;
  tenantId?: InputMaybe<Scalars["ID"]["input"]>;
  threadId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type QueryKnowledgeGraphSearchArgs = {
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  query: Scalars["String"]["input"];
  tenantId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type QueryKnowledgeGraphThreadCandidatesArgs = {
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  query?: InputMaybe<Scalars["String"]["input"]>;
  requesterUserId?: InputMaybe<Scalars["ID"]["input"]>;
  tenantId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type QueryManagedApplicationDeploymentArgs = {
  jobId: Scalars["ID"]["input"];
};

export type QueryManagedApplicationHealthCheckArgs = {
  key: Scalars["String"]["input"];
};

export type QueryMemoryGraphArgs = {
  assistantId?: InputMaybe<Scalars["ID"]["input"]>;
  tenantId?: InputMaybe<Scalars["ID"]["input"]>;
  userId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type QueryMemoryRecordsArgs = {
  assistantId?: InputMaybe<Scalars["ID"]["input"]>;
  namespace: Scalars["String"]["input"];
  tenantId?: InputMaybe<Scalars["ID"]["input"]>;
  userId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type QueryMemorySearchArgs = {
  assistantId?: InputMaybe<Scalars["ID"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  query: Scalars["String"]["input"];
  strategy?: InputMaybe<MemoryStrategy>;
  tenantId?: InputMaybe<Scalars["ID"]["input"]>;
  userId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type QueryMessagesArgs = {
  cursor?: InputMaybe<Scalars["String"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  threadId: Scalars["ID"]["input"];
};

export type QueryMobileMemoryCapturesArgs = {
  agentId?: InputMaybe<Scalars["ID"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  tenantId?: InputMaybe<Scalars["ID"]["input"]>;
  userId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type QueryMobileMemorySearchArgs = {
  agentId?: InputMaybe<Scalars["ID"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  query: Scalars["String"]["input"];
  tenantId?: InputMaybe<Scalars["ID"]["input"]>;
  userId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type QueryMobileWikiSearchArgs = {
  agentId?: InputMaybe<Scalars["ID"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  query: Scalars["String"]["input"];
  tenantId?: InputMaybe<Scalars["ID"]["input"]>;
  userId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type QueryMySlackLinksArgs = {
  tenantId: Scalars["ID"]["input"];
};

export type QueryN8nAgentStepRunsArgs = {
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  threadId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type QueryN8nPluginSettingsArgs = {
  installId: Scalars["ID"]["input"];
};

export type QueryOntologyChangeSetsArgs = {
  status?: InputMaybe<OntologyChangeSetStatus>;
  tenantId: Scalars["ID"]["input"];
};

export type QueryOntologyDefinitionsArgs = {
  tenantId: Scalars["ID"]["input"];
};

export type QueryOntologyReprocessJobArgs = {
  jobId: Scalars["ID"]["input"];
  tenantId: Scalars["ID"]["input"];
};

export type QueryOntologySuggestionScanJobArgs = {
  jobId: Scalars["ID"]["input"];
  tenantId: Scalars["ID"]["input"];
};

export type QueryPendingSystemReviewsCountArgs = {
  tenantId: Scalars["ID"]["input"];
};

export type QueryPerformanceTimeSeriesArgs = {
  agentId?: InputMaybe<Scalars["ID"]["input"]>;
  days?: InputMaybe<Scalars["Int"]["input"]>;
  tenantId: Scalars["ID"]["input"];
};

export type QueryPinnedThreadsArgs = {
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  tenantId: Scalars["ID"]["input"];
};

export type QueryPluginInstallArgs = {
  id: Scalars["ID"]["input"];
};

export type QueryQueuedWakeupsArgs = {
  tenantId: Scalars["ID"]["input"];
};

export type QueryRecentWikiPagesArgs = {
  agentId?: InputMaybe<Scalars["ID"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  tenantId?: InputMaybe<Scalars["ID"]["input"]>;
  userId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type QueryRecipeArgs = {
  id: Scalars["ID"]["input"];
};

export type QueryRecipesArgs = {
  agentId?: InputMaybe<Scalars["ID"]["input"]>;
  cursor?: InputMaybe<Scalars["String"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  tenantId: Scalars["ID"]["input"];
  threadId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type QueryReleaseUpdateJobArgs = {
  jobId: Scalars["ID"]["input"];
};

export type QueryRoutineArgs = {
  id: Scalars["ID"]["input"];
};

export type QueryRoutineAslVersionArgs = {
  id: Scalars["ID"]["input"];
};

export type QueryRoutineDefinitionArgs = {
  routineId: Scalars["ID"]["input"];
};

export type QueryRoutineExecutionArgs = {
  id: Scalars["ID"]["input"];
};

export type QueryRoutineExecutionsArgs = {
  cursor?: InputMaybe<Scalars["String"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  routineId: Scalars["ID"]["input"];
  status?: InputMaybe<RoutineExecutionStatus>;
};

export type QueryRoutineRecipeCatalogArgs = {
  tenantId: Scalars["ID"]["input"];
};

export type QueryRoutineStepEventsArgs = {
  executionId: Scalars["ID"]["input"];
};

export type QueryRoutinesArgs = {
  agentId?: InputMaybe<Scalars["ID"]["input"]>;
  status?: InputMaybe<RoutineStatus>;
  tenantId: Scalars["ID"]["input"];
};

export type QueryRuntimeManifestsByAgentArgs = {
  agentId: Scalars["ID"]["input"];
  limit?: InputMaybe<Scalars["Int"]["input"]>;
};

export type QueryScheduledJobArgs = {
  id: Scalars["ID"]["input"];
};

export type QueryScheduledJobsArgs = {
  agentId?: InputMaybe<Scalars["ID"]["input"]>;
  connectionId?: InputMaybe<Scalars["ID"]["input"]>;
  enabled?: InputMaybe<Scalars["Boolean"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  routineId?: InputMaybe<Scalars["ID"]["input"]>;
  spaceId?: InputMaybe<Scalars["ID"]["input"]>;
  tenantId: Scalars["ID"]["input"];
  triggerType?: InputMaybe<Scalars["String"]["input"]>;
};

export type QuerySingleAgentPerformanceArgs = {
  agentId: Scalars["ID"]["input"];
  tenantId: Scalars["ID"]["input"];
};

export type QuerySkillDraftArgs = {
  id: Scalars["ID"]["input"];
};

export type QuerySkillDraftsArgs = {
  requesterId?: InputMaybe<Scalars["ID"]["input"]>;
  status?: InputMaybe<Scalars["String"]["input"]>;
};

export type QuerySkillEvalGateArgs = {
  tenantId: Scalars["ID"]["input"];
};

export type QuerySkillEvalScoreArgs = {
  skillSlug: Scalars["String"]["input"];
  tenantId: Scalars["ID"]["input"];
};

export type QuerySkillRunArgs = {
  id: Scalars["ID"]["input"];
};

export type QuerySkillRunsArgs = {
  agentId?: InputMaybe<Scalars["ID"]["input"]>;
  invocationSource?: InputMaybe<Scalars["String"]["input"]>;
  invokerUserId?: InputMaybe<Scalars["ID"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  skillId?: InputMaybe<Scalars["String"]["input"]>;
  status?: InputMaybe<Scalars["String"]["input"]>;
  tenantId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type QuerySlackWorkspacesArgs = {
  tenantId: Scalars["ID"]["input"];
};

export type QuerySpaceArgs = {
  id: Scalars["ID"]["input"];
};

export type QuerySpacesArgs = {
  includeAllForAdmin?: InputMaybe<Scalars["Boolean"]["input"]>;
  status?: InputMaybe<SpaceStatus>;
  tenantId: Scalars["ID"]["input"];
};

export type QueryTenantArgs = {
  id: Scalars["ID"]["input"];
};

export type QueryTenantAgentArgs = {
  tenantId: Scalars["ID"]["input"];
};

export type QueryTenantBySlugArgs = {
  slug: Scalars["String"]["input"];
};

export type QueryTenantCredentialsArgs = {
  status?: InputMaybe<TenantCredentialStatus>;
  tenantId: Scalars["ID"]["input"];
};

export type QueryTenantMembersArgs = {
  tenantId: Scalars["ID"]["input"];
};

export type QueryTenantMentionTargetsArgs = {
  tenantId: Scalars["ID"]["input"];
};

export type QueryTenantModelCatalogArgs = {
  includeDisabled?: InputMaybe<Scalars["Boolean"]["input"]>;
  tenantId: Scalars["ID"]["input"];
};

export type QueryTenantSkillCatalogArgs = {
  agentId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type QueryTenantToolInventoryArgs = {
  tenantId: Scalars["ID"]["input"];
};

export type QueryTestKnowledgeBaseRetrievalArgs = {
  id: Scalars["ID"]["input"];
  query: Scalars["String"]["input"];
};

export type QueryThreadArgs = {
  id: Scalars["ID"]["input"];
};

export type QueryThreadByNumberArgs = {
  number: Scalars["Int"]["input"];
  tenantId: Scalars["ID"]["input"];
};

export type QueryThreadGoalArgs = {
  tenantId: Scalars["ID"]["input"];
  threadId: Scalars["ID"]["input"];
};

export type QueryThreadGoalFilesArgs = {
  tenantId: Scalars["ID"]["input"];
  threadId: Scalars["ID"]["input"];
};

export type QueryThreadIdleLearningRunArgs = {
  runId: Scalars["ID"]["input"];
  tenantId?: InputMaybe<Scalars["ID"]["input"]>;
  userId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type QueryThreadIdleLearningRunsArgs = {
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  tenantId?: InputMaybe<Scalars["ID"]["input"]>;
  threadId?: InputMaybe<Scalars["ID"]["input"]>;
  userId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type QueryThreadLabelsArgs = {
  tenantId: Scalars["ID"]["input"];
};

export type QueryThreadLinkedTasksArgs = {
  tenantId: Scalars["ID"]["input"];
  threadId: Scalars["ID"]["input"];
};

export type QueryThreadMentionTargetsArgs = {
  threadId: Scalars["ID"]["input"];
};

export type QueryThreadProgressArgs = {
  tenantId: Scalars["ID"]["input"];
  threadId: Scalars["ID"]["input"];
};

export type QueryThreadProgressMarkdownArgs = {
  tenantId: Scalars["ID"]["input"];
  threadId: Scalars["ID"]["input"];
};

export type QueryThreadTracesArgs = {
  tenantId: Scalars["ID"]["input"];
  threadId: Scalars["ID"]["input"];
};

export type QueryThreadTurnArgs = {
  id: Scalars["ID"]["input"];
};

export type QueryThreadTurnEventsArgs = {
  afterSeq?: InputMaybe<Scalars["Int"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  runId: Scalars["ID"]["input"];
};

export type QueryThreadTurnsArgs = {
  agentId?: InputMaybe<Scalars["ID"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  routineId?: InputMaybe<Scalars["ID"]["input"]>;
  status?: InputMaybe<Scalars["String"]["input"]>;
  tenantId: Scalars["ID"]["input"];
  threadId?: InputMaybe<Scalars["ID"]["input"]>;
  triggerId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type QueryThreadWorkItemsArgs = {
  tenantId?: InputMaybe<Scalars["ID"]["input"]>;
  threadId: Scalars["ID"]["input"];
};

export type QueryThreadsArgs = {
  agentId?: InputMaybe<Scalars["ID"]["input"]>;
  assigneeId?: InputMaybe<Scalars["ID"]["input"]>;
  channel?: InputMaybe<ThreadChannel>;
  cursor?: InputMaybe<Scalars["String"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  search?: InputMaybe<Scalars["String"]["input"]>;
  status?: InputMaybe<ThreadStatus>;
  tenantId: Scalars["ID"]["input"];
};

export type QueryThreadsPagedArgs = {
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  offset?: InputMaybe<Scalars["Int"]["input"]>;
  search?: InputMaybe<Scalars["String"]["input"]>;
  showArchived?: InputMaybe<Scalars["Boolean"]["input"]>;
  sortDir?: InputMaybe<Scalars["String"]["input"]>;
  sortField?: InputMaybe<Scalars["String"]["input"]>;
  spaceId?: InputMaybe<Scalars["ID"]["input"]>;
  statuses?: InputMaybe<Array<Scalars["String"]["input"]>>;
  tenantId: Scalars["ID"]["input"];
  unreadOnly?: InputMaybe<Scalars["Boolean"]["input"]>;
};

export type QueryTurnInvocationLogsArgs = {
  tenantId: Scalars["ID"]["input"];
  turnId: Scalars["ID"]["input"];
};

export type QueryUnreadThreadCountArgs = {
  agentId?: InputMaybe<Scalars["ID"]["input"]>;
  tenantId: Scalars["ID"]["input"];
};

export type QueryUserArgs = {
  id: Scalars["ID"]["input"];
};

export type QueryUserBudgetStatusArgs = {
  tenantId: Scalars["ID"]["input"];
  userId: Scalars["ID"]["input"];
};

export type QueryUserModelCatalogArgs = {
  userId: Scalars["ID"]["input"];
};

export type QueryUserQuickActionsArgs = {
  scope?: InputMaybe<QuickActionScope>;
  tenantId: Scalars["ID"]["input"];
};

export type QueryWebhookArgs = {
  id: Scalars["ID"]["input"];
};

export type QueryWebhookDeliveriesArgs = {
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  webhookId: Scalars["ID"]["input"];
};

export type QueryWebhooksArgs = {
  enabled?: InputMaybe<Scalars["Boolean"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  spaceId?: InputMaybe<Scalars["ID"]["input"]>;
  targetType?: InputMaybe<Scalars["String"]["input"]>;
  tenantId: Scalars["ID"]["input"];
};

export type QueryWikiBacklinksArgs = {
  pageId: Scalars["ID"]["input"];
};

export type QueryWikiCompileJobsArgs = {
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  ownerId?: InputMaybe<Scalars["ID"]["input"]>;
  tenantId: Scalars["ID"]["input"];
  userId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type QueryWikiConnectedPagesArgs = {
  pageId: Scalars["ID"]["input"];
};

export type QueryWikiGraphArgs = {
  ownerId?: InputMaybe<Scalars["ID"]["input"]>;
  tenantId: Scalars["ID"]["input"];
  userId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type QueryWikiPageArgs = {
  ownerId?: InputMaybe<Scalars["ID"]["input"]>;
  slug: Scalars["String"]["input"];
  tenantId: Scalars["ID"]["input"];
  type: WikiPageType;
  userId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type QueryWikiSearchArgs = {
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  ownerId?: InputMaybe<Scalars["ID"]["input"]>;
  query: Scalars["String"]["input"];
  tenantId: Scalars["ID"]["input"];
  userId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type QueryWorkItemArgs = {
  id: Scalars["ID"]["input"];
  tenantId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type QueryWorkItemSavedViewsArgs = {
  spaceId?: InputMaybe<Scalars["ID"]["input"]>;
  tenantId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type QueryWorkItemStatusesArgs = {
  spaceId: Scalars["ID"]["input"];
  tenantId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type QueryWorkItemsArgs = {
  input?: InputMaybe<WorkItemsInput>;
};

export type QueryWorkflowArgs = {
  id: Scalars["ID"]["input"];
};

export type QueryWorkflowRunArgs = {
  id: Scalars["ID"]["input"];
};

export type QueryWorkflowRunsArgs = {
  cursor?: InputMaybe<Scalars["String"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  status?: InputMaybe<WorkflowRunStatus>;
  tenantId?: InputMaybe<Scalars["ID"]["input"]>;
  workflowId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type QueryWorkflowsArgs = {
  cursor?: InputMaybe<Scalars["String"]["input"]>;
  lifecycleStatus?: InputMaybe<WorkflowLifecycleStatus>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  readinessState?: InputMaybe<WorkflowReadinessState>;
  tenantId?: InputMaybe<Scalars["ID"]["input"]>;
};

export enum QuickActionScope {
  Task = "task",
  Thread = "thread",
}

export type RebuildRoutineVersionInput = {
  routineId: Scalars["ID"]["input"];
};

export type Recipe = {
  __typename?: "Recipe";
  agentId?: Maybe<Scalars["ID"]["output"]>;
  cachedResult?: Maybe<Scalars["AWSJSON"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  genuiType: Scalars["String"]["output"];
  id: Scalars["ID"]["output"];
  lastError?: Maybe<Scalars["String"]["output"]>;
  lastRefreshed?: Maybe<Scalars["AWSDateTime"]["output"]>;
  params: Scalars["AWSJSON"]["output"];
  server: Scalars["String"]["output"];
  sourceMessageId?: Maybe<Scalars["ID"]["output"]>;
  summary?: Maybe<Scalars["String"]["output"]>;
  templates?: Maybe<Scalars["AWSJSON"]["output"]>;
  tenantId: Scalars["ID"]["output"];
  threadId?: Maybe<Scalars["ID"]["output"]>;
  title: Scalars["String"]["output"];
  tool: Scalars["String"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export type RedeemPremiumPluginInstallKeyInput = {
  /** ThinkWork-provided one-time install key. */
  installKey: Scalars["String"]["input"];
  pluginKey: Scalars["String"]["input"];
};

export type RedeemPremiumPluginInstallKeyResult = {
  __typename?: "RedeemPremiumPluginInstallKeyResult";
  entitlement: PluginEntitlement;
  source: Scalars["String"]["output"];
};

export type RefreshThreadProgressInput = {
  tenantId: Scalars["ID"]["input"];
  threadId: Scalars["ID"]["input"];
};

export type RefreshThreadProgressPayload = {
  __typename?: "RefreshThreadProgressPayload";
  threadGoalFiles?: Maybe<ThreadGoalFiles>;
};

export type RegisterPushTokenInput = {
  platform: Scalars["String"]["input"];
  token: Scalars["String"]["input"];
};

export type RejectInboxItemInput = {
  reviewNotes?: InputMaybe<Scalars["String"]["input"]>;
};

export type RejectManagedApplicationDeploymentInput = {
  jobId: Scalars["ID"]["input"];
  reason?: InputMaybe<Scalars["String"]["input"]>;
};

export type RejectOntologyChangeSetInput = {
  changeSetId: Scalars["ID"]["input"];
  reason?: InputMaybe<Scalars["String"]["input"]>;
  tenantId: Scalars["ID"]["input"];
};

export type RejectSkillDraftInput = {
  id: Scalars["ID"]["input"];
  rationale: Scalars["String"]["input"];
};

export type ReleaseThreadInput = {
  runId: Scalars["String"]["input"];
  status?: InputMaybe<ThreadStatus>;
};

export type ReleaseUpdateEvent = {
  __typename?: "ReleaseUpdateEvent";
  createdAt: Scalars["AWSDateTime"]["output"];
  eventType: Scalars["String"]["output"];
  id: Scalars["ID"]["output"];
  jobId: Scalars["ID"]["output"];
  message: Scalars["String"]["output"];
  payload: Scalars["AWSJSON"]["output"];
};

export type ReleaseUpdateJob = {
  __typename?: "ReleaseUpdateJob";
  codebuildBuildArn?: Maybe<Scalars["String"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  currentReleaseVersion?: Maybe<Scalars["String"]["output"]>;
  events: Array<ReleaseUpdateEvent>;
  evidenceBucket?: Maybe<Scalars["String"]["output"]>;
  evidencePrefix?: Maybe<Scalars["String"]["output"]>;
  executionArn?: Maybe<Scalars["String"]["output"]>;
  failureCategory?: Maybe<Scalars["String"]["output"]>;
  failureMessage?: Maybe<Scalars["String"]["output"]>;
  finalStatus: Scalars["AWSJSON"]["output"];
  id: Scalars["ID"]["output"];
  manifestSha256: Scalars["String"]["output"];
  manifestSigned: Scalars["Boolean"]["output"];
  manifestTrustPolicy?: Maybe<Scalars["String"]["output"]>;
  manifestUrl: Scalars["String"]["output"];
  preflightSummary: Scalars["AWSJSON"]["output"];
  preservedConfigSummary: Scalars["AWSJSON"]["output"];
  recoveryAction?: Maybe<Scalars["String"]["output"]>;
  remediationSummary: Scalars["AWSJSON"]["output"];
  requestedByUserId?: Maybe<Scalars["ID"]["output"]>;
  stateMachineArn?: Maybe<Scalars["String"]["output"]>;
  status: Scalars["String"]["output"];
  statusPointerBucket?: Maybe<Scalars["String"]["output"]>;
  statusPointerKey?: Maybe<Scalars["String"]["output"]>;
  targetReleaseVersion: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
  terraformModuleVersion?: Maybe<Scalars["String"]["output"]>;
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export type RemediateReleaseRunnerInput = {
  idempotencyKey?: InputMaybe<Scalars["String"]["input"]>;
  jobId: Scalars["ID"]["input"];
};

export type ReorderQuickActionsInput = {
  orderedIds: Array<Scalars["ID"]["input"]>;
  scope?: InputMaybe<QuickActionScope>;
  tenantId: Scalars["ID"]["input"];
};

export type RequestCompanyBrainProductionMigrationInput = {
  allowEmptySourceSet?: InputMaybe<Scalars["Boolean"]["input"]>;
  embeddingModel?: InputMaybe<Scalars["String"]["input"]>;
  emptySourceReason?: InputMaybe<Scalars["String"]["input"]>;
  operatorEvidence?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  tenantId?: InputMaybe<Scalars["ID"]["input"]>;
  vectorDimension?: InputMaybe<Scalars["Int"]["input"]>;
};

export type RequestRevisionInput = {
  reviewNotes: Scalars["String"]["input"];
};

export type ResendMemberInviteInput = {
  /** Required per-click idempotency key. Reuse the same value only when retrying the same click. */
  idempotencyKey: Scalars["String"]["input"];
  memberId: Scalars["ID"]["input"];
};

export type ResendMemberInviteResult = {
  __typename?: "ResendMemberInviteResult";
  message: Scalars["String"]["output"];
  status: ResendMemberInviteStatus;
};

export enum ResendMemberInviteStatus {
  DeliveryFailed = "DELIVERY_FAILED",
  NotPending = "NOT_PENDING",
  Resent = "RESENT",
}

export type ResubmitInboxItemInput = {
  config?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  description?: InputMaybe<Scalars["String"]["input"]>;
  title?: InputMaybe<Scalars["String"]["input"]>;
};

export type RetryPluginComponentInput = {
  /** Component to re-drive; must be in state 'failed'. */
  componentKey: Scalars["String"]["input"];
  installId: Scalars["ID"]["input"];
};

export enum ReviewGoalAction {
  Cancel = "CANCEL",
  ConfirmCompletion = "CONFIRM_COMPLETION",
  RequestChanges = "REQUEST_CHANGES",
}

export type ReviewGoalInput = {
  action: ReviewGoalAction;
  goalId: Scalars["ID"]["input"];
  notes?: InputMaybe<Scalars["String"]["input"]>;
  tenantId: Scalars["ID"]["input"];
};

export type ReviewGoalPayload = {
  __typename?: "ReviewGoalPayload";
  goal: ThreadGoal;
  thread: Thread;
};

export type RevokePremiumPluginInstallKeyInput = {
  keyId: Scalars["ID"]["input"];
  tenantId: Scalars["ID"]["input"];
};

export type RevokePremiumPluginInstallKeyResult = {
  __typename?: "RevokePremiumPluginInstallKeyResult";
  keyId: Scalars["ID"]["output"];
  pluginKey: Scalars["String"]["output"];
  revokedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  status: Scalars["String"]["output"];
};

export type RotateTenantCredentialInput = {
  id: Scalars["ID"]["input"];
  secretJson: Scalars["AWSJSON"]["input"];
};

export type Routine = {
  __typename?: "Routine";
  agent?: Maybe<Agent>;
  agentId?: Maybe<Scalars["ID"]["output"]>;
  config?: Maybe<Scalars["AWSJSON"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  currentVersion?: Maybe<Scalars["Int"]["output"]>;
  description?: Maybe<Scalars["String"]["output"]>;
  documentationMd?: Maybe<Scalars["String"]["output"]>;
  engine: Scalars["String"]["output"];
  executions?: Maybe<Array<RoutineExecution>>;
  id: Scalars["ID"]["output"];
  lastRunAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  name: Scalars["String"]["output"];
  nextRunAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  owningAgentId?: Maybe<Scalars["ID"]["output"]>;
  schedule?: Maybe<Scalars["String"]["output"]>;
  stateMachineAliasArn?: Maybe<Scalars["String"]["output"]>;
  stateMachineArn?: Maybe<Scalars["String"]["output"]>;
  status: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
  triggers: Array<RoutineTrigger>;
  type: Scalars["String"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
  visibility: RoutineVisibility;
};

export type RoutineAslVersion = {
  __typename?: "RoutineAslVersion";
  aliasWasPointing?: Maybe<Scalars["String"]["output"]>;
  aslJson: Scalars["AWSJSON"]["output"];
  createdAt: Scalars["AWSDateTime"]["output"];
  id: Scalars["ID"]["output"];
  markdownSummary: Scalars["String"]["output"];
  publishedByActorId?: Maybe<Scalars["ID"]["output"]>;
  publishedByActorType?: Maybe<Scalars["String"]["output"]>;
  routineId: Scalars["ID"]["output"];
  stateMachineArn: Scalars["String"]["output"];
  stepManifestJson: Scalars["AWSJSON"]["output"];
  tenantId: Scalars["ID"]["output"];
  validationWarningsJson?: Maybe<Scalars["AWSJSON"]["output"]>;
  versionArn: Scalars["String"]["output"];
  versionNumber: Scalars["Int"]["output"];
};

export type RoutineDefinition = {
  __typename?: "RoutineDefinition";
  aslJson?: Maybe<Scalars["AWSJSON"]["output"]>;
  currentVersion?: Maybe<Scalars["Int"]["output"]>;
  description?: Maybe<Scalars["String"]["output"]>;
  kind: Scalars["String"]["output"];
  markdownSummary?: Maybe<Scalars["String"]["output"]>;
  routineId: Scalars["ID"]["output"];
  stepManifestJson?: Maybe<Scalars["AWSJSON"]["output"]>;
  steps: Array<RoutineDefinitionStep>;
  title: Scalars["String"]["output"];
  versionId?: Maybe<Scalars["ID"]["output"]>;
};

export type RoutineDefinitionConfigField = {
  __typename?: "RoutineDefinitionConfigField";
  control?: Maybe<Scalars["String"]["output"]>;
  editable: Scalars["Boolean"]["output"];
  helpText?: Maybe<Scalars["String"]["output"]>;
  inputType: Scalars["String"]["output"];
  key: Scalars["String"]["output"];
  label: Scalars["String"]["output"];
  max?: Maybe<Scalars["Float"]["output"]>;
  min?: Maybe<Scalars["Float"]["output"]>;
  options?: Maybe<Array<Scalars["String"]["output"]>>;
  pattern?: Maybe<Scalars["String"]["output"]>;
  placeholder?: Maybe<Scalars["String"]["output"]>;
  required: Scalars["Boolean"]["output"];
  value?: Maybe<Scalars["AWSJSON"]["output"]>;
};

export type RoutineDefinitionGraphEdgeInput = {
  condition?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  kind: Scalars["String"]["input"];
  label?: InputMaybe<Scalars["String"]["input"]>;
  source: Scalars["String"]["input"];
  target: Scalars["String"]["input"];
};

export type RoutineDefinitionGraphInput = {
  edges: Array<RoutineDefinitionGraphEdgeInput>;
  nodes: Array<RoutineDefinitionGraphNodeInput>;
  startNodeId?: InputMaybe<Scalars["String"]["input"]>;
};

export type RoutineDefinitionGraphNodeInput = {
  args?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  kind?: InputMaybe<Scalars["String"]["input"]>;
  label?: InputMaybe<Scalars["String"]["input"]>;
  nodeId: Scalars["String"]["input"];
  recipeId?: InputMaybe<Scalars["String"]["input"]>;
};

export type RoutineDefinitionStep = {
  __typename?: "RoutineDefinitionStep";
  args: Scalars["AWSJSON"]["output"];
  configFields: Array<RoutineDefinitionConfigField>;
  label: Scalars["String"]["output"];
  nodeId: Scalars["String"]["output"];
  recipeId: Scalars["String"]["output"];
  recipeName: Scalars["String"]["output"];
};

export type RoutineDefinitionStepConfigInput = {
  args: Scalars["AWSJSON"]["input"];
  label?: InputMaybe<Scalars["String"]["input"]>;
  nodeId: Scalars["String"]["input"];
  recipeId?: InputMaybe<Scalars["String"]["input"]>;
};

export type RoutineDraft = {
  __typename?: "RoutineDraft";
  asl: Scalars["AWSJSON"]["output"];
  description?: Maybe<Scalars["String"]["output"]>;
  kind: Scalars["String"]["output"];
  markdownSummary: Scalars["String"]["output"];
  stepManifest: Scalars["AWSJSON"]["output"];
  steps: Array<RoutineDefinitionStep>;
  title: Scalars["String"]["output"];
};

export enum RoutineEngine {
  LegacyPython = "LEGACY_PYTHON",
  StepFunctions = "STEP_FUNCTIONS",
}

export type RoutineExecution = {
  __typename?: "RoutineExecution";
  aliasArn?: Maybe<Scalars["String"]["output"]>;
  aslVersion?: Maybe<RoutineAslVersion>;
  createdAt: Scalars["AWSDateTime"]["output"];
  errorCode?: Maybe<Scalars["String"]["output"]>;
  errorMessage?: Maybe<Scalars["String"]["output"]>;
  finishedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  id: Scalars["ID"]["output"];
  inputJson?: Maybe<Scalars["AWSJSON"]["output"]>;
  outputJson?: Maybe<Scalars["AWSJSON"]["output"]>;
  routine?: Maybe<Routine>;
  routineId: Scalars["ID"]["output"];
  sfnExecutionArn: Scalars["String"]["output"];
  startedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  stateMachineArn: Scalars["String"]["output"];
  status: Scalars["String"]["output"];
  stepEvents: Array<RoutineStepEvent>;
  tenantId: Scalars["ID"]["output"];
  totalLlmCostUsdCents?: Maybe<Scalars["Int"]["output"]>;
  trigger?: Maybe<RoutineTrigger>;
  triggerId?: Maybe<Scalars["ID"]["output"]>;
  triggerSource: Scalars["String"]["output"];
  versionArn?: Maybe<Scalars["String"]["output"]>;
};

export enum RoutineExecutionStatus {
  AwaitingApproval = "AWAITING_APPROVAL",
  Cancelled = "CANCELLED",
  Failed = "FAILED",
  Running = "RUNNING",
  Succeeded = "SUCCEEDED",
  TimedOut = "TIMED_OUT",
}

export type RoutineRecipe = {
  __typename?: "RoutineRecipe";
  category: Scalars["String"]["output"];
  configFields: Array<RoutineRecipeConfigField>;
  defaultArgs: Scalars["AWSJSON"]["output"];
  description: Scalars["String"]["output"];
  displayName: Scalars["String"]["output"];
  hitlCapable: Scalars["Boolean"]["output"];
  id: Scalars["String"]["output"];
};

export type RoutineRecipeConfigField = {
  __typename?: "RoutineRecipeConfigField";
  control?: Maybe<Scalars["String"]["output"]>;
  editable: Scalars["Boolean"]["output"];
  helpText?: Maybe<Scalars["String"]["output"]>;
  inputType: Scalars["String"]["output"];
  key: Scalars["String"]["output"];
  label: Scalars["String"]["output"];
  max?: Maybe<Scalars["Float"]["output"]>;
  min?: Maybe<Scalars["Float"]["output"]>;
  options?: Maybe<Array<Scalars["String"]["output"]>>;
  pattern?: Maybe<Scalars["String"]["output"]>;
  placeholder?: Maybe<Scalars["String"]["output"]>;
  required: Scalars["Boolean"]["output"];
  value?: Maybe<Scalars["AWSJSON"]["output"]>;
};

export enum RoutineRunStatus {
  Cancelled = "CANCELLED",
  Completed = "COMPLETED",
  Failed = "FAILED",
  Pending = "PENDING",
  Running = "RUNNING",
}

export enum RoutineStatus {
  Active = "ACTIVE",
  Archived = "ARCHIVED",
  Paused = "PAUSED",
}

export type RoutineStepEvent = {
  __typename?: "RoutineStepEvent";
  createdAt: Scalars["AWSDateTime"]["output"];
  errorJson?: Maybe<Scalars["AWSJSON"]["output"]>;
  executionId: Scalars["ID"]["output"];
  finishedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  id: Scalars["ID"]["output"];
  inputJson?: Maybe<Scalars["AWSJSON"]["output"]>;
  llmCostUsdCents?: Maybe<Scalars["Int"]["output"]>;
  nodeId: Scalars["String"]["output"];
  outputJson?: Maybe<Scalars["AWSJSON"]["output"]>;
  recipeType: Scalars["String"]["output"];
  retryCount: Scalars["Int"]["output"];
  startedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  status: Scalars["String"]["output"];
  stderrS3Uri?: Maybe<Scalars["String"]["output"]>;
  stdoutPreview?: Maybe<Scalars["String"]["output"]>;
  stdoutS3Uri?: Maybe<Scalars["String"]["output"]>;
  tenantId: Scalars["ID"]["output"];
  truncated: Scalars["Boolean"]["output"];
};

export type RoutineTrigger = {
  __typename?: "RoutineTrigger";
  config?: Maybe<Scalars["AWSJSON"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  enabled: Scalars["Boolean"]["output"];
  id: Scalars["ID"]["output"];
  routineId: Scalars["ID"]["output"];
  tenantId: Scalars["ID"]["output"];
  triggerType: Scalars["String"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export type RoutineTriggerInput = {
  config?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  enabled?: InputMaybe<Scalars["Boolean"]["input"]>;
  triggerType: Scalars["String"]["input"];
};

export enum RoutineVisibility {
  AgentPrivate = "agent_private",
  TenantShared = "tenant_shared",
}

/**
 * Result of `runScheduledJob`. Synchronously invokes the job-trigger
 * Lambda with the same payload AWS Scheduler would have sent at the
 * next firing — effectively "run now". `dispatched` is true when the
 * Lambda accepted the invocation; downstream side effects (thread turn,
 * routine execution, eval run) happen asynchronously and aren't part of
 * this result. `statusCode` echoes the Lambda's response code so
 * operators can distinguish accept (200/202) vs throttle / error.
 */
export type RunScheduledJobResult = {
  __typename?: "RunScheduledJobResult";
  dispatched: Scalars["Boolean"]["output"];
  errorMessage?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  statusCode?: Maybe<Scalars["Int"]["output"]>;
};

export type RuntimeManifest = {
  __typename?: "RuntimeManifest";
  agentId?: Maybe<Scalars["ID"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  id: Scalars["ID"]["output"];
  manifestJson: Scalars["AWSJSON"]["output"];
  sessionId: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
  userId?: Maybe<Scalars["ID"]["output"]>;
};

export type SaveAgentLoopInput = {
  description?: InputMaybe<Scalars["String"]["input"]>;
  enabled?: InputMaybe<Scalars["Boolean"]["input"]>;
  evidencePolicy?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  goalSpec: Scalars["AWSJSON"]["input"];
  id?: InputMaybe<Scalars["ID"]["input"]>;
  judgeSpec: Scalars["AWSJSON"]["input"];
  lifecycleStatus?: InputMaybe<AgentLoopLifecycleStatus>;
  loopPolicy?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  name: Scalars["String"]["input"];
  ownerAgentId?: InputMaybe<Scalars["ID"]["input"]>;
  ownerUserId?: InputMaybe<Scalars["ID"]["input"]>;
  slug?: InputMaybe<Scalars["String"]["input"]>;
  sourceMetadata?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  spaceId?: InputMaybe<Scalars["ID"]["input"]>;
  tenantId: Scalars["ID"]["input"];
  triggerSpec: Scalars["AWSJSON"]["input"];
  workerSpec: Scalars["AWSJSON"]["input"];
};

export type SaveAppletInput = {
  appId?: InputMaybe<Scalars["ID"]["input"]>;
  files: Scalars["AWSJSON"]["input"];
  metadata?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  name: Scalars["String"]["input"];
};

export type SaveAppletPayload = {
  __typename?: "SaveAppletPayload";
  appId?: Maybe<Scalars["ID"]["output"]>;
  errors: Array<Scalars["AWSJSON"]["output"]>;
  ok: Scalars["Boolean"]["output"];
  persisted: Scalars["Boolean"]["output"];
  validated: Scalars["Boolean"]["output"];
  version?: Maybe<Scalars["Int"]["output"]>;
};

export type SaveAppletStateInput = {
  appId: Scalars["ID"]["input"];
  instanceId: Scalars["ID"]["input"];
  key: Scalars["String"]["input"];
  value?: InputMaybe<Scalars["AWSJSON"]["input"]>;
};

export type SaveEmailProviderCredentialInput = {
  apiKey: Scalars["String"]["input"];
  defaultFromEmail?: InputMaybe<Scalars["String"]["input"]>;
  displayName?: InputMaybe<Scalars["String"]["input"]>;
  domain?: InputMaybe<ConfigureEmailDomainInput>;
  provider: EmailChannelProvider;
  providerInstallId?: InputMaybe<Scalars["ID"]["input"]>;
  webhookSecretRef?: InputMaybe<Scalars["String"]["input"]>;
};

export type SaveWorkItemStatusesInput = {
  spaceId: Scalars["ID"]["input"];
  statuses: Array<WorkItemStatusInput>;
  tenantId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type SaveWorkItemViewInput = {
  filters?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  grouping?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  id?: InputMaybe<Scalars["ID"]["input"]>;
  isDefault?: InputMaybe<Scalars["Boolean"]["input"]>;
  isFavorite?: InputMaybe<Scalars["Boolean"]["input"]>;
  isPrivate?: InputMaybe<Scalars["Boolean"]["input"]>;
  name: Scalars["String"]["input"];
  sorting?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  spaceId?: InputMaybe<Scalars["ID"]["input"]>;
  tenantId?: InputMaybe<Scalars["ID"]["input"]>;
  viewConfig?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  viewType: WorkItemViewType;
};

export type ScheduledJob = {
  __typename?: "ScheduledJob";
  agentId?: Maybe<Scalars["ID"]["output"]>;
  budgetPaused: Scalars["Boolean"]["output"];
  budgetPausedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  budgetPausedReason?: Maybe<Scalars["String"]["output"]>;
  config?: Maybe<Scalars["AWSJSON"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  createdById?: Maybe<Scalars["String"]["output"]>;
  createdByType?: Maybe<Scalars["String"]["output"]>;
  description?: Maybe<Scalars["String"]["output"]>;
  ebScheduleName?: Maybe<Scalars["String"]["output"]>;
  enabled: Scalars["Boolean"]["output"];
  id: Scalars["ID"]["output"];
  lastRunAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  name: Scalars["String"]["output"];
  nextRunAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  prompt?: Maybe<Scalars["String"]["output"]>;
  routineId?: Maybe<Scalars["ID"]["output"]>;
  scheduleExpression?: Maybe<Scalars["String"]["output"]>;
  scheduleType?: Maybe<Scalars["String"]["output"]>;
  spaceId?: Maybe<Scalars["ID"]["output"]>;
  tenantId: Scalars["ID"]["output"];
  timezone: Scalars["String"]["output"];
  triggerType: Scalars["String"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export type SendMessageInput = {
  agentRequested?: InputMaybe<Scalars["Boolean"]["input"]>;
  content?: InputMaybe<Scalars["String"]["input"]>;
  dispatchMode?: InputMaybe<MessageDispatchMode>;
  mentions?: InputMaybe<Array<SendMessageMentionInput>>;
  metadata?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  modelId?: InputMaybe<Scalars["String"]["input"]>;
  role: MessageRole;
  senderId?: InputMaybe<Scalars["ID"]["input"]>;
  senderType?: InputMaybe<Scalars["String"]["input"]>;
  threadId: Scalars["ID"]["input"];
  toolCalls?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  toolResults?: InputMaybe<Scalars["AWSJSON"]["input"]>;
};

export type SendMessageMentionInput = {
  displayName?: InputMaybe<Scalars["String"]["input"]>;
  endOffset?: InputMaybe<Scalars["Int"]["input"]>;
  rawText?: InputMaybe<Scalars["String"]["input"]>;
  startOffset?: InputMaybe<Scalars["Int"]["input"]>;
  targetId: Scalars["ID"]["input"];
  targetType: MessageMentionTargetType;
};

export type SetKnowledgeGraphDeploymentInput = {
  enabled: Scalars["Boolean"]["input"];
  idempotencyKey?: InputMaybe<Scalars["String"]["input"]>;
};

export type SetManagedApplicationDeploymentInput = {
  action?: InputMaybe<ManagedApplicationDeploymentAction>;
  enabled?: InputMaybe<Scalars["Boolean"]["input"]>;
  key: Scalars["String"]["input"];
};

export type SetSpaceKnowledgeBasesInput = {
  knowledgeBases: Array<SpaceKnowledgeBaseInput>;
  spaceId: Scalars["ID"]["input"];
  tenantId: Scalars["ID"]["input"];
};

export type SetSpaceRuntimeOverridesInput = {
  budgetMonthlyCents?: InputMaybe<Scalars["Int"]["input"]>;
  budgetPaused?: InputMaybe<Scalars["Boolean"]["input"]>;
  guardrailId?: InputMaybe<Scalars["ID"]["input"]>;
  model?: InputMaybe<Scalars["String"]["input"]>;
  sandbox?: InputMaybe<Scalars["Boolean"]["input"]>;
};

export type SetSpaceToolsInput = {
  builtInToolSlugs: Array<Scalars["String"]["input"]>;
  mcpServerIds: Array<Scalars["ID"]["input"]>;
  spaceId: Scalars["ID"]["input"];
  tenantId: Scalars["ID"]["input"];
};

export type SetTenantMemberPasswordInput = {
  memberId: Scalars["ID"]["input"];
  password: Scalars["String"]["input"];
  /** When true, the user keeps this password. When false, Cognito requires a password change on next sign-in. */
  permanent?: InputMaybe<Scalars["Boolean"]["input"]>;
};

export type SetTenantMemberPasswordResult = {
  __typename?: "SetTenantMemberPasswordResult";
  message: Scalars["String"]["output"];
  status: Scalars["String"]["output"];
};

export type SkillAttributionCandidate = {
  __typename?: "SkillAttributionCandidate";
  skillSlug: Scalars["String"]["output"];
  source: Scalars["String"]["output"];
};

export type SkillAttributionCandidates = {
  __typename?: "SkillAttributionCandidates";
  candidates: Array<SkillAttributionCandidate>;
  fallback: Scalars["Boolean"]["output"];
};

/**
 * One entry in a tenant's skill catalog, read from the derived skill_catalog
 * index. Powers pickers like the composer slash-command (force-pin a skill onto
 * a message). The `installed` flag is annotated relative to the `agentId`
 * argument; skills blocked on that agent are omitted from results entirely.
 */
export type SkillCatalogEntry = {
  __typename?: "SkillCatalogEntry";
  category?: Maybe<Scalars["String"]["output"]>;
  description?: Maybe<Scalars["String"]["output"]>;
  /** From SKILL.md frontmatter display_name; null → render falls back to slug. */
  displayName?: Maybe<Scalars["String"]["output"]>;
  icon?: Maybe<Scalars["String"]["output"]>;
  /** True when this skill is installed on the agent named by `agentId`. */
  installed: Scalars["Boolean"]["output"];
  /** Folder slug under skill-catalog/. Stable identifier used to pin the skill. */
  slug: Scalars["String"]["output"];
  tags?: Maybe<Array<Scalars["String"]["output"]>>;
};

/**
 * Per-tenant skill catalog index maintenance.
 *
 * The skill_catalog table is a derived read cache of the S3 skill catalog,
 * kept fresh by write-through on catalog put/delete. This mutation reconciles
 * it from S3 wholesale — used for the launch backfill and operator-invoked
 * drift recovery. Powers `thinkwork skill catalog rebuild`.
 */
export type SkillCatalogRebuildResult = {
  __typename?: "SkillCatalogRebuildResult";
  dryRun: Scalars["Boolean"]["output"];
  /** Stale rows removed (slugs no longer in S3). */
  rowsDeleted: Scalars["Int"]["output"];
  /** Skills skipped because their folder had no SKILL.md (partial/mid-upload). */
  rowsSkipped: Scalars["Int"]["output"];
  /** Rows inserted or updated (SKILL.md-backed skills). */
  rowsUpserted: Scalars["Int"]["output"];
  /** Skills present in the tenant's S3 catalog at rebuild time. */
  skillsInS3: Scalars["Int"]["output"];
  tenantId: Scalars["ID"]["output"];
  tenantSlug: Scalars["String"]["output"];
};

export type SkillDraft = {
  __typename?: "SkillDraft";
  createdAt: Scalars["AWSDateTime"]["output"];
  currentContentHash?: Maybe<Scalars["String"]["output"]>;
  displayName?: Maybe<Scalars["String"]["output"]>;
  draftS3Prefix: Scalars["String"]["output"];
  events: Array<SkillDraftEvent>;
  failureMessage?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  inboxItemId?: Maybe<Scalars["ID"]["output"]>;
  publishedCatalogSlug?: Maybe<Scalars["String"]["output"]>;
  publishedContentHash?: Maybe<Scalars["String"]["output"]>;
  rejectedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  requester?: Maybe<SkillDraftRequester>;
  slug: Scalars["String"]["output"];
  source: SkillDraftSource;
  status: Scalars["String"]["output"];
  submittedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  summary?: Maybe<Scalars["String"]["output"]>;
  tenantId: Scalars["ID"]["output"];
  title: Scalars["String"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export type SkillDraftEvent = {
  __typename?: "SkillDraftEvent";
  actorUserId?: Maybe<Scalars["ID"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  draftId: Scalars["ID"]["output"];
  eventType: Scalars["String"]["output"];
  id: Scalars["ID"]["output"];
  message?: Maybe<Scalars["String"]["output"]>;
  payload: Scalars["AWSJSON"]["output"];
};

/**
 * Skill Creator draft lifecycle.
 *
 * Draft files live in the tenant workspace bucket under
 * `tenants/<tenant-slug>/skill-drafts/<draft-id>/`. This GraphQL surface exposes
 * the U1 lifecycle index only; trust evidence and publication readiness are added
 * by later THNK-11 units.
 */
export type SkillDraftRequester = {
  __typename?: "SkillDraftRequester";
  email?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  name?: Maybe<Scalars["String"]["output"]>;
};

export type SkillDraftSource = {
  __typename?: "SkillDraftSource";
  kind: Scalars["String"]["output"];
  messageId?: Maybe<Scalars["ID"]["output"]>;
  threadId?: Maybe<Scalars["ID"]["output"]>;
};

export type SkillDraftSourceInput = {
  kind?: InputMaybe<Scalars["String"]["input"]>;
  messageId?: InputMaybe<Scalars["ID"]["input"]>;
  threadId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type SkillDraftSummary = {
  __typename?: "SkillDraftSummary";
  createdAt: Scalars["AWSDateTime"]["output"];
  currentContentHash?: Maybe<Scalars["String"]["output"]>;
  displayName?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  inboxItemId?: Maybe<Scalars["ID"]["output"]>;
  requester?: Maybe<SkillDraftRequester>;
  slug: Scalars["String"]["output"];
  source: SkillDraftSource;
  status: Scalars["String"]["output"];
  submittedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  summary?: Maybe<Scalars["String"]["output"]>;
  tenantId: Scalars["ID"]["output"];
  title: Scalars["String"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export type SkillEvalGate = {
  __typename?: "SkillEvalGate";
  enabled: Scalars["Boolean"]["output"];
  threshold?: Maybe<Scalars["Float"]["output"]>;
};

export type SkillEvalScore = {
  __typename?: "SkillEvalScore";
  datasetSlug: Scalars["String"]["output"];
  evaluable: Scalars["Boolean"]["output"];
  ineligibleReason?: Maybe<Scalars["String"]["output"]>;
  lastRunAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  lastRunId?: Maybe<Scalars["ID"]["output"]>;
  passRate?: Maybe<Scalars["Float"]["output"]>;
  rated: Scalars["Boolean"]["output"];
  regression: Scalars["Boolean"]["output"];
  skillSlug: Scalars["String"]["output"];
  totalCases: Scalars["Int"]["output"];
};

export type SkillRun = {
  __typename?: "SkillRun";
  agentId?: Maybe<Scalars["ID"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  deleteAt: Scalars["AWSDateTime"]["output"];
  deliveredArtifactRef?: Maybe<Scalars["AWSJSON"]["output"]>;
  deliveryChannels?: Maybe<Scalars["AWSJSON"]["output"]>;
  failureReason?: Maybe<Scalars["String"]["output"]>;
  feedbackNote?: Maybe<Scalars["String"]["output"]>;
  feedbackSignal?: Maybe<Scalars["String"]["output"]>;
  finishedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  id: Scalars["ID"]["output"];
  inputs?: Maybe<Scalars["AWSJSON"]["output"]>;
  invocationSource: Scalars["String"]["output"];
  invokerUserId: Scalars["ID"]["output"];
  resolvedInputs?: Maybe<Scalars["AWSJSON"]["output"]>;
  resolvedInputsHash: Scalars["String"]["output"];
  skillId: Scalars["String"]["output"];
  skillVersion: Scalars["Int"]["output"];
  startedAt: Scalars["AWSDateTime"]["output"];
  status: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export type SkillUpdateApplyResult = {
  __typename?: "SkillUpdateApplyResult";
  applied: Scalars["Boolean"]["output"];
  blocked: Scalars["Boolean"]["output"];
  overridden: Scalars["Boolean"]["output"];
  passRate?: Maybe<Scalars["Float"]["output"]>;
  threshold?: Maybe<Scalars["Float"]["output"]>;
};

export type SlackUserLink = {
  __typename?: "SlackUserLink";
  createdAt: Scalars["AWSDateTime"]["output"];
  id: Scalars["ID"]["output"];
  linkedAt: Scalars["AWSDateTime"]["output"];
  slackTeamId: Scalars["String"]["output"];
  slackTeamName?: Maybe<Scalars["String"]["output"]>;
  slackUserEmail?: Maybe<Scalars["String"]["output"]>;
  slackUserId: Scalars["String"]["output"];
  slackUserName?: Maybe<Scalars["String"]["output"]>;
  status: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
  unlinkedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  updatedAt: Scalars["AWSDateTime"]["output"];
  userId: Scalars["ID"]["output"];
};

export type SlackWorkspace = {
  __typename?: "SlackWorkspace";
  appId: Scalars["String"]["output"];
  botUserId: Scalars["String"]["output"];
  createdAt: Scalars["AWSDateTime"]["output"];
  id: Scalars["ID"]["output"];
  installedAt: Scalars["AWSDateTime"]["output"];
  installedByUserId?: Maybe<Scalars["ID"]["output"]>;
  slackTeamId: Scalars["String"]["output"];
  slackTeamName?: Maybe<Scalars["String"]["output"]>;
  status: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
  uninstalledAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export type SlackWorkspaceInstallStart = {
  __typename?: "SlackWorkspaceInstallStart";
  authorizeUrl: Scalars["AWSURL"]["output"];
  expiresAt: Scalars["AWSDateTime"]["output"];
  state: Scalars["String"]["output"];
};

export type Space = {
  __typename?: "Space";
  accessMode: SpaceAccessMode;
  agentAvailabilityPolicy?: Maybe<Scalars["AWSJSON"]["output"]>;
  builtInTools: Array<Scalars["String"]["output"]>;
  category?: Maybe<Scalars["String"]["output"]>;
  checklistTemplates: Array<SpaceChecklistTemplate>;
  config?: Maybe<Scalars["AWSJSON"]["output"]>;
  connectedDataConfig?: Maybe<Scalars["AWSJSON"]["output"]>;
  contextConfig?: Maybe<Scalars["AWSJSON"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  description?: Maybe<Scalars["String"]["output"]>;
  emailTriggerStatus: SpaceEmailTriggerStatus;
  emailTriggersEnabled: Scalars["Boolean"]["output"];
  icon?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  integrations: Array<SpaceIntegration>;
  kind: SpaceKind;
  knowledgeBases: Array<SpaceKnowledgeBase>;
  lastActivityAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  mcpPolicy?: Maybe<Scalars["AWSJSON"]["output"]>;
  mcpServers: Array<SpaceMcpServer>;
  members: Array<SpaceMember>;
  name: Scalars["String"]["output"];
  prompt?: Maybe<Scalars["String"]["output"]>;
  renderDiagnostics?: Maybe<Scalars["AWSJSON"]["output"]>;
  runtimeOverrides: SpaceRuntimeOverrides;
  slug: Scalars["String"]["output"];
  status: SpaceStatus;
  templateKey?: Maybe<Scalars["String"]["output"]>;
  tenantId: Scalars["ID"]["output"];
  toolPolicy?: Maybe<Scalars["AWSJSON"]["output"]>;
  triggerConfig?: Maybe<Scalars["AWSJSON"]["output"]>;
  unreadThreadCount: Scalars["Int"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export enum SpaceAccessMode {
  Private = "PRIVATE",
  Public = "PUBLIC",
}

export type SpaceChecklistItem = {
  __typename?: "SpaceChecklistItem";
  createdAt: Scalars["AWSDateTime"]["output"];
  description?: Maybe<Scalars["String"]["output"]>;
  externalTaskTemplate?: Maybe<Scalars["AWSJSON"]["output"]>;
  id: Scalars["ID"]["output"];
  key: Scalars["String"]["output"];
  required: Scalars["Boolean"]["output"];
  roleKey?: Maybe<Scalars["String"]["output"]>;
  sortOrder: Scalars["Int"]["output"];
  spaceId: Scalars["ID"]["output"];
  templateId: Scalars["ID"]["output"];
  tenantId: Scalars["ID"]["output"];
  title: Scalars["String"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export type SpaceChecklistTemplate = {
  __typename?: "SpaceChecklistTemplate";
  config?: Maybe<Scalars["AWSJSON"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  description?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  items: Array<SpaceChecklistItem>;
  key: Scalars["String"]["output"];
  name: Scalars["String"]["output"];
  spaceId: Scalars["ID"]["output"];
  tenantId: Scalars["ID"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export enum SpaceEmailTriggerStatus {
  Disabled = "DISABLED",
  Enabled = "ENABLED",
  None = "NONE",
}

export enum SpaceExternalWritebackPolicy {
  Disabled = "DISABLED",
  StatusAndComments = "STATUS_AND_COMMENTS",
  StatusOnly = "STATUS_ONLY",
}

export type SpaceIntegration = {
  __typename?: "SpaceIntegration";
  config?: Maybe<Scalars["AWSJSON"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  id: Scalars["ID"]["output"];
  provider: SpaceIntegrationProvider;
  spaceId: Scalars["ID"]["output"];
  status: SpaceIntegrationStatus;
  tenantId: Scalars["ID"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
  webhookConfigRef?: Maybe<Scalars["String"]["output"]>;
  writebackPolicy: SpaceExternalWritebackPolicy;
};

export enum SpaceIntegrationProvider {
  LastmileTasks = "LASTMILE_TASKS",
  Webhook = "WEBHOOK",
}

export enum SpaceIntegrationStatus {
  Active = "ACTIVE",
  Archived = "ARCHIVED",
  Paused = "PAUSED",
}

export enum SpaceKind {
  Custom = "CUSTOM",
  CustomerOnboarding = "CUSTOMER_ONBOARDING",
}

export type SpaceKnowledgeBase = {
  __typename?: "SpaceKnowledgeBase";
  createdAt: Scalars["AWSDateTime"]["output"];
  enabled: Scalars["Boolean"]["output"];
  id: Scalars["ID"]["output"];
  knowledgeBase?: Maybe<KnowledgeBase>;
  knowledgeBaseId: Scalars["ID"]["output"];
  searchConfig?: Maybe<Scalars["AWSJSON"]["output"]>;
  spaceId: Scalars["ID"]["output"];
  tenantId: Scalars["ID"]["output"];
};

export type SpaceKnowledgeBaseInput = {
  enabled?: InputMaybe<Scalars["Boolean"]["input"]>;
  knowledgeBaseId: Scalars["ID"]["input"];
  searchConfig?: InputMaybe<Scalars["AWSJSON"]["input"]>;
};

export type SpaceMcpServer = {
  __typename?: "SpaceMcpServer";
  config?: Maybe<Scalars["AWSJSON"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  enabled: Scalars["Boolean"]["output"];
  id: Scalars["ID"]["output"];
  mcpServer?: Maybe<SpaceTenantMcpServer>;
  mcpServerId: Scalars["ID"]["output"];
  spaceId: Scalars["ID"]["output"];
  tenantId: Scalars["ID"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export type SpaceMember = {
  __typename?: "SpaceMember";
  createdAt: Scalars["AWSDateTime"]["output"];
  id: Scalars["ID"]["output"];
  notificationPreference: SpaceNotificationPreference;
  role: SpaceMemberRole;
  spaceId: Scalars["ID"]["output"];
  tenantId: Scalars["ID"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
  user?: Maybe<User>;
  userId: Scalars["ID"]["output"];
};

export enum SpaceMemberRole {
  Admin = "ADMIN",
  Member = "MEMBER",
  Owner = "OWNER",
  Viewer = "VIEWER",
}

export enum SpaceNotificationPreference {
  Mentions = "MENTIONS",
  Muted = "MUTED",
  Subscribed = "SUBSCRIBED",
}

export type SpaceRuntimeOverrides = {
  __typename?: "SpaceRuntimeOverrides";
  budgetMonthlyCents?: Maybe<Scalars["Int"]["output"]>;
  budgetPaused?: Maybe<Scalars["Boolean"]["output"]>;
  guardrailId?: Maybe<Scalars["ID"]["output"]>;
  model?: Maybe<Scalars["String"]["output"]>;
  sandbox?: Maybe<Scalars["Boolean"]["output"]>;
};

export enum SpaceStatus {
  Active = "ACTIVE",
  Archived = "ARCHIVED",
}

export type SpaceTenantMcpServer = {
  __typename?: "SpaceTenantMcpServer";
  authType: Scalars["String"]["output"];
  createdAt: Scalars["AWSDateTime"]["output"];
  enabled: Scalars["Boolean"]["output"];
  id: Scalars["ID"]["output"];
  name: Scalars["String"]["output"];
  oauthProvider?: Maybe<Scalars["String"]["output"]>;
  slug: Scalars["String"]["output"];
  status: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
  tools?: Maybe<Scalars["AWSJSON"]["output"]>;
  transport: Scalars["String"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export type StartAutomationBuilderInput = {
  builderThreadId?: InputMaybe<Scalars["ID"]["input"]>;
  prompt?: InputMaybe<Scalars["String"]["input"]>;
  tenantId: Scalars["ID"]["input"];
  title?: InputMaybe<Scalars["String"]["input"]>;
};

export type StartCustomerOnboardingInput = {
  opportunity: Scalars["AWSJSON"]["input"];
  spaceId?: InputMaybe<Scalars["ID"]["input"]>;
  tenantId: Scalars["ID"]["input"];
};

export type StartCustomerOnboardingPayload = {
  __typename?: "StartCustomerOnboardingPayload";
  idempotent: Scalars["Boolean"]["output"];
  linkedTasks: Array<CustomerOnboardingLinkedTaskResult>;
  missingFields: Array<Scalars["String"]["output"]>;
  thread: Thread;
  threadId: Scalars["ID"]["output"];
};

export type StartDeploymentReleaseUpdateInput = {
  idempotencyKey?: InputMaybe<Scalars["String"]["input"]>;
  jobId: Scalars["ID"]["input"];
};

export type StartEvalRunInput = {
  categories?: InputMaybe<Array<Scalars["String"]["input"]>>;
  datasetSlug?: InputMaybe<Scalars["String"]["input"]>;
  model?: InputMaybe<Scalars["String"]["input"]>;
  testCaseIds?: InputMaybe<Array<Scalars["ID"]["input"]>>;
};

export type StartKnowledgeGraphIngestInput = {
  force?: InputMaybe<Scalars["Boolean"]["input"]>;
  metadata?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  ownerUserId?: InputMaybe<Scalars["ID"]["input"]>;
  pageIds?: InputMaybe<Array<Scalars["ID"]["input"]>>;
  sourceKind: KnowledgeGraphSourceKind;
  sourceLabel?: InputMaybe<Scalars["String"]["input"]>;
  sourceRef?: InputMaybe<Scalars["String"]["input"]>;
  tenantId?: InputMaybe<Scalars["ID"]["input"]>;
  threadId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type StartKnowledgeGraphObservationsIngestInput = {
  fullRebuild?: InputMaybe<Scalars["Boolean"]["input"]>;
  metadata?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  tenantId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type StartKnowledgeGraphThreadIngestInput = {
  force?: InputMaybe<Scalars["Boolean"]["input"]>;
  metadata?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  tenantId?: InputMaybe<Scalars["ID"]["input"]>;
  threadId: Scalars["ID"]["input"];
};

export type StartManagedApplicationPlanInput = {
  desiredConfig?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  desiredConfigVersion?: InputMaybe<Scalars["String"]["input"]>;
  idempotencyKey: Scalars["String"]["input"];
  key: Scalars["String"]["input"];
  manifestDigest?: InputMaybe<Scalars["String"]["input"]>;
  manifestImages?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  manifestUrl?: InputMaybe<Scalars["String"]["input"]>;
  operation: Scalars["String"]["input"];
  releaseVersion?: InputMaybe<Scalars["String"]["input"]>;
};

export type StartOntologySuggestionScanInput = {
  dedupeKey?: InputMaybe<Scalars["String"]["input"]>;
  tenantId: Scalars["ID"]["input"];
  trigger?: InputMaybe<Scalars["String"]["input"]>;
};

export type StartReleaseUpdatePreflightInput = {
  idempotencyKey?: InputMaybe<Scalars["String"]["input"]>;
  manifestSha256: Scalars["String"]["input"];
  manifestUrl: Scalars["String"]["input"];
  signatureUrl?: InputMaybe<Scalars["String"]["input"]>;
  signed?: InputMaybe<Scalars["Boolean"]["input"]>;
  version: Scalars["String"]["input"];
};

export type StartSkillRunInput = {
  agentId?: InputMaybe<Scalars["ID"]["input"]>;
  deliveryChannels?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  inputs?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  invocationSource: Scalars["String"]["input"];
  skillId: Scalars["String"]["input"];
  skillVersion?: InputMaybe<Scalars["Int"]["input"]>;
  tenantId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type StartSlackWorkspaceInstallInput = {
  redirectUri?: InputMaybe<Scalars["AWSURL"]["input"]>;
  returnUrl?: InputMaybe<Scalars["AWSURL"]["input"]>;
  tenantId: Scalars["ID"]["input"];
};

export enum StartTwentyCustomerOnboardingAction {
  Created = "CREATED",
  Resumed = "RESUMED",
}

export type StartTwentyCustomerOnboardingInput = {
  companyName?: InputMaybe<Scalars["String"]["input"]>;
  opportunityId: Scalars["ID"]["input"];
  opportunityName?: InputMaybe<Scalars["String"]["input"]>;
  opportunityUrl?: InputMaybe<Scalars["String"]["input"]>;
  outcomeKey?: InputMaybe<Scalars["String"]["input"]>;
  recordSnapshot?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  spaceId?: InputMaybe<Scalars["ID"]["input"]>;
  startSeparateOutcome?: InputMaybe<Scalars["Boolean"]["input"]>;
  tenantId: Scalars["ID"]["input"];
};

export type StartTwentyCustomerOnboardingPayload = {
  __typename?: "StartTwentyCustomerOnboardingPayload";
  action: StartTwentyCustomerOnboardingAction;
  goalId?: Maybe<Scalars["ID"]["output"]>;
  idempotent: Scalars["Boolean"]["output"];
  link: CrmWorkLink;
  linkedTasks: Array<CustomerOnboardingLinkedTaskResult>;
  missingFields: Array<Scalars["String"]["output"]>;
  pluginActivationRequired: Scalars["Boolean"]["output"];
  statusWritebackState: CrmWritebackState;
  thread: Thread;
  threadId: Scalars["ID"]["output"];
};

export type StatusCount = {
  __typename?: "StatusCount";
  count: Scalars["Int"]["output"];
  status: Scalars["String"]["output"];
};

export type SubmitRunFeedbackInput = {
  note?: InputMaybe<Scalars["String"]["input"]>;
  runId: Scalars["ID"]["input"];
  signal: Scalars["String"]["input"];
};

export type SubmitSkillDraftInput = {
  id: Scalars["ID"]["input"];
};

export type Subscription = {
  __typename?: "Subscription";
  _empty?: Maybe<Scalars["String"]["output"]>;
  onAgentStatusChanged?: Maybe<AgentStatusEvent>;
  onCostRecorded?: Maybe<CostRecordedEvent>;
  onEvalRunUpdated?: Maybe<EvalRunUpdateEvent>;
  onHeartbeatActivity?: Maybe<HeartbeatActivityEvent>;
  onInboxItemStatusChanged?: Maybe<InboxItemStatusEvent>;
  onNewMessage?: Maybe<NewMessageEvent>;
  onOrgUpdated?: Maybe<OrgUpdateEvent>;
  onThreadActivity?: Maybe<ThreadActivityEvent>;
  onThreadTurnStep?: Maybe<ThreadTurnStepEvent>;
  onThreadTurnUpdated?: Maybe<ThreadTurnUpdateEvent>;
  onThreadUpdated?: Maybe<ThreadUpdateEvent>;
  onWorkspaceAccessRevoked?: Maybe<WorkspaceAccessRevokedEvent>;
};

export type SubscriptionOnAgentStatusChangedArgs = {
  tenantId: Scalars["ID"]["input"];
};

export type SubscriptionOnCostRecordedArgs = {
  tenantId: Scalars["ID"]["input"];
};

export type SubscriptionOnEvalRunUpdatedArgs = {
  tenantId: Scalars["ID"]["input"];
};

export type SubscriptionOnHeartbeatActivityArgs = {
  tenantId: Scalars["ID"]["input"];
};

export type SubscriptionOnInboxItemStatusChangedArgs = {
  tenantId: Scalars["ID"]["input"];
};

export type SubscriptionOnNewMessageArgs = {
  threadId: Scalars["ID"]["input"];
};

export type SubscriptionOnOrgUpdatedArgs = {
  tenantId: Scalars["ID"]["input"];
};

export type SubscriptionOnThreadActivityArgs = {
  userId: Scalars["ID"]["input"];
};

export type SubscriptionOnThreadTurnStepArgs = {
  threadId: Scalars["ID"]["input"];
};

export type SubscriptionOnThreadTurnUpdatedArgs = {
  tenantId: Scalars["ID"]["input"];
};

export type SubscriptionOnThreadUpdatedArgs = {
  tenantId: Scalars["ID"]["input"];
};

export type SubscriptionOnWorkspaceAccessRevokedArgs = {
  userId: Scalars["ID"]["input"];
};

export type Tenant = {
  __typename?: "Tenant";
  agents: Array<Agent>;
  /**
   * Compliance classification: "standard" | "regulated" | "hipaa". Only
   * standard tenants may enable the sandbox; a compound CHECK on the tenants
   * table enforces this at the schema layer.
   */
  complianceTier: Scalars["String"]["output"];
  createdAt: Scalars["AWSDateTime"]["output"];
  /**
   * Per-tenant kill switches for built-in tools (plan #007 R6/R7). Array of
   * slug strings (e.g. ["execute_code", "web_search"]). Empty array = all
   * built-ins available (subject to template blocks). The runtime applies
   * this as a narrow-only filter at Agent(tools=...) construction; template
   * blocks intersect (a template cannot unblock what the tenant disabled).
   * Admin UI for editing this field defers to a follow-up PR; until then
   * operators mutate the column directly.
   */
  disabledBuiltinTools: Array<Scalars["String"]["output"]>;
  /**
   * True while a bootstrap-created tenant is waiting for the first verified
   * Cognito user whose email matches the pending owner email.
   */
  firstAdminClaimRequired: Scalars["Boolean"]["output"];
  firstAdminClaimedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  firstAdminClaimedUserId?: Maybe<Scalars["ID"]["output"]>;
  id: Scalars["ID"]["output"];
  issueCounter: Scalars["Int"]["output"];
  issuePrefix?: Maybe<Scalars["String"]["output"]>;
  members: Array<TenantMember>;
  name: Scalars["String"]["output"];
  plan: Scalars["String"]["output"];
  /**
   * Sandbox kill switch. When false, the dispatcher does not register the
   * execute_code tool regardless of template opt-in. Default-true for new
   * tenants; the migration that added this column flipped every pre-existing
   * tenant to false so Phase 3b enforcement lands before the sandbox runs.
   */
  sandboxEnabled: Scalars["Boolean"]["output"];
  sandboxInterpreterInternalId?: Maybe<Scalars["String"]["output"]>;
  /**
   * Per-tenant AgentCore Code Interpreter IDs, populated asynchronously by
   * the agentcore-admin Lambda (plan Unit 5). Null during the provisioning
   * window.
   */
  sandboxInterpreterPublicId?: Maybe<Scalars["String"]["output"]>;
  settings?: Maybe<TenantSettings>;
  slug: Scalars["String"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
};

/**
 * Tenant/deployment opt-in for a deployment auth resource. Public login options
 * may be derived from this only after the linked resource validates.
 */
export type TenantAuthProviderReference = {
  __typename?: "TenantAuthProviderReference";
  authProviderResourceId: Scalars["ID"]["output"];
  createdAt: Scalars["AWSDateTime"]["output"];
  disabledAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  enabledAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  hostnames: Array<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  lastErrorCode?: Maybe<Scalars["String"]["output"]>;
  metadata: Scalars["AWSJSON"]["output"];
  pluginInstallId: Scalars["ID"]["output"];
  publicOptionLabel: Scalars["String"]["output"];
  resource: AuthProviderResource;
  /** 'disabled' | 'enabled' | 'invalid' | 'decommissioning'. */
  status: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export type TenantCredential = {
  __typename?: "TenantCredential";
  createdAt: Scalars["AWSDateTime"]["output"];
  createdByUserId?: Maybe<Scalars["ID"]["output"]>;
  deletedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  displayName: Scalars["String"]["output"];
  eventbridgeConnectionArn?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  kind: TenantCredentialKind;
  lastUsedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  lastValidatedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  metadataJson: Scalars["AWSJSON"]["output"];
  schemaJson: Scalars["AWSJSON"]["output"];
  slug: Scalars["String"]["output"];
  status: TenantCredentialStatus;
  tenantId: Scalars["ID"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export enum TenantCredentialKind {
  ApiKey = "api_key",
  BasicAuth = "basic_auth",
  BearerToken = "bearer_token",
  Json = "json",
  SoapPartner = "soap_partner",
  WebhookSigningSecret = "webhook_signing_secret",
}

export enum TenantCredentialStatus {
  Active = "active",
  Deleted = "deleted",
  Disabled = "disabled",
}

export type TenantMember = {
  __typename?: "TenantMember";
  agent?: Maybe<Agent>;
  cognitoStatus?: Maybe<Scalars["String"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  id: Scalars["ID"]["output"];
  principalId: Scalars["ID"]["output"];
  principalType: Scalars["String"]["output"];
  role: Scalars["String"]["output"];
  status: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
  user?: Maybe<User>;
};

export type TenantModelCatalogEntry = {
  __typename?: "TenantModelCatalogEntry";
  canonicalDisplayName: Scalars["String"]["output"];
  contextWindow?: Maybe<Scalars["Int"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  displayName: Scalars["String"]["output"];
  enabled: Scalars["Boolean"]["output"];
  importPayload: Scalars["AWSJSON"]["output"];
  importSource: Scalars["String"]["output"];
  importedAt: Scalars["AWSDateTime"]["output"];
  importedByUserId?: Maybe<Scalars["ID"]["output"]>;
  inputCostPerMillion?: Maybe<Scalars["Float"]["output"]>;
  lastPricedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  maxOutputTokens?: Maybe<Scalars["Int"]["output"]>;
  modelId: Scalars["String"]["output"];
  outputCostPerMillion?: Maybe<Scalars["Float"]["output"]>;
  pricingDiagnostics: Scalars["AWSJSON"]["output"];
  pricingSource?: Maybe<Scalars["String"]["output"]>;
  pricingStatus: Scalars["String"]["output"];
  provider: Scalars["String"]["output"];
  supportsTools?: Maybe<Scalars["Boolean"]["output"]>;
  supportsVision?: Maybe<Scalars["Boolean"]["output"]>;
  tenantId: Scalars["ID"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export type TenantSettings = {
  __typename?: "TenantSettings";
  autoCloseThreadMinutes?: Maybe<Scalars["Int"]["output"]>;
  budgetMonthlyCents?: Maybe<Scalars["Int"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  defaultModel?: Maybe<Scalars["String"]["output"]>;
  features?: Maybe<Scalars["AWSJSON"]["output"]>;
  goalDefaultTokenBudget?: Maybe<Scalars["Int"]["output"]>;
  id: Scalars["ID"]["output"];
  maxAgents?: Maybe<Scalars["Int"]["output"]>;
  tenantId: Scalars["ID"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export type TenantToolInventory = {
  __typename?: "TenantToolInventory";
  agents: Array<TenantToolInventoryAgent>;
  routines: Array<TenantToolInventoryRoutine>;
  skills: Array<TenantToolInventorySkill>;
  tools: Array<TenantToolInventoryTool>;
  workflows: Array<TenantToolInventoryWorkflow>;
};

export type TenantToolInventoryAgent = {
  __typename?: "TenantToolInventoryAgent";
  description?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  name: Scalars["String"]["output"];
};

export type TenantToolInventoryRoutine = {
  __typename?: "TenantToolInventoryRoutine";
  description?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  name: Scalars["String"]["output"];
  visibility?: Maybe<Scalars["String"]["output"]>;
};

export type TenantToolInventorySkill = {
  __typename?: "TenantToolInventorySkill";
  description?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  slug: Scalars["String"]["output"];
};

export type TenantToolInventoryTool = {
  __typename?: "TenantToolInventoryTool";
  argSchemaJson?: Maybe<Scalars["AWSJSON"]["output"]>;
  description?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  name: Scalars["String"]["output"];
  source: Scalars["String"]["output"];
};

export type TenantToolInventoryWorkflow = {
  __typename?: "TenantToolInventoryWorkflow";
  capabilityFlags: Scalars["AWSJSON"]["output"];
  description?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  name: Scalars["String"]["output"];
  readinessReasons: Scalars["AWSJSON"]["output"];
  readinessState: WorkflowReadinessState;
  startCallable: Scalars["Boolean"]["output"];
  triggerFamily: WorkflowTriggerFamily;
  visibility: Scalars["String"]["output"];
};

export type Thread = {
  __typename?: "Thread";
  agent?: Maybe<Agent>;
  agentId?: Maybe<Scalars["ID"]["output"]>;
  archivedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  assignee?: Maybe<User>;
  assigneeId?: Maybe<Scalars["ID"]["output"]>;
  assigneeType?: Maybe<Scalars["String"]["output"]>;
  attachments: Array<ThreadAttachment>;
  billingCode?: Maybe<Scalars["String"]["output"]>;
  blockedBy: Array<ThreadDependency>;
  blocks: Array<ThreadDependency>;
  cancelledAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  channel: ThreadChannel;
  checkoutRunId?: Maybe<Scalars["String"]["output"]>;
  checkoutVersion: Scalars["Int"]["output"];
  closedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  completedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  costSummary?: Maybe<Scalars["Float"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  createdById?: Maybe<Scalars["String"]["output"]>;
  createdByType?: Maybe<Scalars["String"]["output"]>;
  dueAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  goal?: Maybe<ThreadGoal>;
  id: Scalars["ID"]["output"];
  identifier?: Maybe<Scalars["String"]["output"]>;
  isBlocked: Scalars["Boolean"]["output"];
  labels?: Maybe<Scalars["AWSJSON"]["output"]>;
  lastActivityAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  lastModel?: Maybe<Scalars["String"]["output"]>;
  lastReadAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  lastResponsePreview?: Maybe<Scalars["String"]["output"]>;
  lastRuntimeType?: Maybe<Scalars["String"]["output"]>;
  lastTurnCompletedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  lifecycleStatus?: Maybe<ThreadLifecycleStatus>;
  messages: MessageConnection;
  metadata?: Maybe<Scalars["AWSJSON"]["output"]>;
  number: Scalars["Int"]["output"];
  participants: Array<ThreadParticipant>;
  pendingUserQuestion?: Maybe<UserQuestion>;
  reporter?: Maybe<User>;
  reporterId?: Maybe<Scalars["ID"]["output"]>;
  space?: Maybe<Space>;
  spaceId: Scalars["ID"]["output"];
  startedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  status: ThreadStatus;
  tenantId: Scalars["ID"]["output"];
  title: Scalars["String"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
  user?: Maybe<User>;
  userId?: Maybe<Scalars["ID"]["output"]>;
};

export type ThreadMessagesArgs = {
  cursor?: InputMaybe<Scalars["String"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
};

export type ThreadActivityEvent = {
  __typename?: "ThreadActivityEvent";
  authorId?: Maybe<Scalars["ID"]["output"]>;
  authorType: Scalars["String"]["output"];
  createdAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  messageId: Scalars["ID"]["output"];
  snippet?: Maybe<Scalars["String"]["output"]>;
  tenantId: Scalars["ID"]["output"];
  threadId: Scalars["ID"]["output"];
  threadTitle?: Maybe<Scalars["String"]["output"]>;
  userId: Scalars["ID"]["output"];
};

export type ThreadAttachment = {
  __typename?: "ThreadAttachment";
  createdAt: Scalars["AWSDateTime"]["output"];
  id: Scalars["ID"]["output"];
  mimeType?: Maybe<Scalars["String"]["output"]>;
  name?: Maybe<Scalars["String"]["output"]>;
  sizeBytes?: Maybe<Scalars["Int"]["output"]>;
  tenantId: Scalars["ID"]["output"];
  threadId: Scalars["ID"]["output"];
  uploadedBy?: Maybe<Scalars["ID"]["output"]>;
};

export enum ThreadChannel {
  Api = "API",
  Chat = "CHAT",
  Connector = "CONNECTOR",
  Email = "EMAIL",
  Manual = "MANUAL",
  Schedule = "SCHEDULE",
  Slack = "SLACK",
  Task = "TASK",
  Webhook = "WEBHOOK",
}

export type ThreadDependency = {
  __typename?: "ThreadDependency";
  blockedByThread?: Maybe<Thread>;
  blockedByThreadId: Scalars["ID"]["output"];
  createdAt: Scalars["AWSDateTime"]["output"];
  id: Scalars["ID"]["output"];
  tenantId: Scalars["ID"]["output"];
  threadId: Scalars["ID"]["output"];
};

export type ThreadGoal = {
  __typename?: "ThreadGoal";
  agentId?: Maybe<Scalars["ID"]["output"]>;
  cancelledAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  completedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  completionRule?: Maybe<Scalars["AWSJSON"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  id: Scalars["ID"]["output"];
  metadata?: Maybe<Scalars["AWSJSON"]["output"]>;
  mode: ThreadGoalMode;
  outcome: Scalars["String"]["output"];
  ownerId?: Maybe<Scalars["ID"]["output"]>;
  ownerType?: Maybe<Scalars["String"]["output"]>;
  progressModel: Scalars["String"]["output"];
  reviewPolicy?: Maybe<Scalars["AWSJSON"]["output"]>;
  reviewedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  reviewerId?: Maybe<Scalars["ID"]["output"]>;
  reviewerType?: Maybe<Scalars["String"]["output"]>;
  spaceId: Scalars["ID"]["output"];
  startedAt: Scalars["AWSDateTime"]["output"];
  status: ThreadGoalStatus;
  templateKey?: Maybe<Scalars["String"]["output"]>;
  tenantId: Scalars["ID"]["output"];
  threadId: Scalars["ID"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
  userId?: Maybe<Scalars["ID"]["output"]>;
};

export enum ThreadGoalFileKind {
  Artifacts = "ARTIFACTS",
  Decisions = "DECISIONS",
  Goal = "GOAL",
  Handoffs = "HANDOFFS",
  Progress = "PROGRESS",
  Tasks = "TASKS",
  Thread = "THREAD",
}

export type ThreadGoalFiles = {
  __typename?: "ThreadGoalFiles";
  files: Array<ThreadGoalMarkdownFile>;
  goal: ThreadGoal;
};

export type ThreadGoalMarkdownFile = {
  __typename?: "ThreadGoalMarkdownFile";
  content?: Maybe<Scalars["String"]["output"]>;
  file: ThreadGoalFileKind;
  key: Scalars["String"]["output"];
};

export enum ThreadGoalMode {
  Collaborate = "COLLABORATE",
  Delegate = "DELEGATE",
}

export enum ThreadGoalStatus {
  Active = "ACTIVE",
  Cancelled = "CANCELLED",
  Completed = "COMPLETED",
  InReview = "IN_REVIEW",
}

export type ThreadIdleLearningChangedFile = {
  __typename?: "ThreadIdleLearningChangedFile";
  afterBytes?: Maybe<Scalars["Int"]["output"]>;
  afterHash?: Maybe<Scalars["String"]["output"]>;
  beforeBytes?: Maybe<Scalars["Int"]["output"]>;
  beforeHash?: Maybe<Scalars["String"]["output"]>;
  hindsightDocumentId?: Maybe<Scalars["String"]["output"]>;
  hindsightStatus?: Maybe<Scalars["String"]["output"]>;
  key?: Maybe<Scalars["String"]["output"]>;
  path: Scalars["String"]["output"];
  snapshotKey?: Maybe<Scalars["String"]["output"]>;
};

export type ThreadIdleLearningRun = {
  __typename?: "ThreadIdleLearningRun";
  activitySequence: Scalars["Int"]["output"];
  budget?: Maybe<Scalars["AWSJSON"]["output"]>;
  canRollback: Scalars["Boolean"]["output"];
  candidateSummary?: Maybe<Scalars["AWSJSON"]["output"]>;
  changedFiles: Array<ThreadIdleLearningChangedFile>;
  createdAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  error?: Maybe<Scalars["String"]["output"]>;
  finishedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  id: Scalars["ID"]["output"];
  metadata?: Maybe<Scalars["AWSJSON"]["output"]>;
  reportMarkdown?: Maybe<Scalars["String"]["output"]>;
  reportS3Key?: Maybe<Scalars["String"]["output"]>;
  requesterUserId?: Maybe<Scalars["ID"]["output"]>;
  scheduledFor?: Maybe<Scalars["AWSDateTime"]["output"]>;
  scheduledJobId?: Maybe<Scalars["ID"]["output"]>;
  startedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  status: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
  threadId: Scalars["ID"]["output"];
  updatedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
};

export type ThreadLabel = {
  __typename?: "ThreadLabel";
  color?: Maybe<Scalars["String"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  description?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  name: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
};

export type ThreadLabelAssignment = {
  __typename?: "ThreadLabelAssignment";
  createdAt: Scalars["AWSDateTime"]["output"];
  id: Scalars["ID"]["output"];
  label?: Maybe<ThreadLabel>;
  labelId: Scalars["ID"]["output"];
  tenantId: Scalars["ID"]["output"];
  threadId: Scalars["ID"]["output"];
};

export enum ThreadLifecycleStatus {
  AwaitingUser = "AWAITING_USER",
  Cancelled = "CANCELLED",
  Completed = "COMPLETED",
  Failed = "FAILED",
  Idle = "IDLE",
  Running = "RUNNING",
}

export type ThreadMentionTarget = {
  __typename?: "ThreadMentionTarget";
  aliases: Array<Scalars["String"]["output"]>;
  avatarUrl?: Maybe<Scalars["String"]["output"]>;
  /** Agent Profile description — shown as the picker's secondary row for profiles. */
  description?: Maybe<Scalars["String"]["output"]>;
  displayName: Scalars["String"]["output"];
  /** User email — shown as the picker's secondary row. Null for agents. */
  email?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  isDefaultAgent: Scalars["Boolean"]["output"];
  role?: Maybe<Scalars["String"]["output"]>;
  targetId: Scalars["ID"]["output"];
  targetType: MessageMentionTargetType;
};

export type ThreadParticipant = {
  __typename?: "ThreadParticipant";
  agent?: Maybe<Agent>;
  agentId?: Maybe<Scalars["ID"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  id: Scalars["ID"]["output"];
  lastReadAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  notificationPreference: ThreadParticipantNotificationPreference;
  participantType: ThreadParticipantType;
  role: Scalars["String"]["output"];
  source: Scalars["String"]["output"];
  spaceId: Scalars["ID"]["output"];
  tenantId: Scalars["ID"]["output"];
  threadId: Scalars["ID"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
  user?: Maybe<User>;
  userId?: Maybe<Scalars["ID"]["output"]>;
};

export enum ThreadParticipantNotificationPreference {
  Mentions = "MENTIONS",
  Muted = "MUTED",
  Subscribed = "SUBSCRIBED",
}

export enum ThreadParticipantType {
  Agent = "AGENT",
  User = "USER",
}

export type ThreadProgress = {
  __typename?: "ThreadProgress";
  markdown: Scalars["String"]["output"];
  threadId: Scalars["ID"]["output"];
};

export type ThreadProgressMarkdown = {
  __typename?: "ThreadProgressMarkdown";
  content: Scalars["String"]["output"];
  key: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
  tenantSlug: Scalars["String"]["output"];
  threadId: Scalars["ID"]["output"];
};

export enum ThreadStatus {
  Backlog = "BACKLOG",
  Blocked = "BLOCKED",
  Cancelled = "CANCELLED",
  Done = "DONE",
  InProgress = "IN_PROGRESS",
  InReview = "IN_REVIEW",
  Todo = "TODO",
}

export type ThreadTurn = {
  __typename?: "ThreadTurn";
  agentId?: Maybe<Scalars["ID"]["output"]>;
  contextSnapshot?: Maybe<Scalars["AWSJSON"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  error?: Maybe<Scalars["String"]["output"]>;
  errorCode?: Maybe<Scalars["String"]["output"]>;
  externalRunId?: Maybe<Scalars["String"]["output"]>;
  finishedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  id: Scalars["ID"]["output"];
  invocationSource: Scalars["String"]["output"];
  lastActivityAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  originTurnId?: Maybe<Scalars["ID"]["output"]>;
  resultJson?: Maybe<Scalars["AWSJSON"]["output"]>;
  retryAttempt?: Maybe<Scalars["Int"]["output"]>;
  routineId?: Maybe<Scalars["ID"]["output"]>;
  runtimeType?: Maybe<Scalars["String"]["output"]>;
  sessionIdAfter?: Maybe<Scalars["String"]["output"]>;
  sessionIdBefore?: Maybe<Scalars["String"]["output"]>;
  startedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  status: Scalars["String"]["output"];
  systemPrompt?: Maybe<Scalars["String"]["output"]>;
  tenantId: Scalars["ID"]["output"];
  threadId?: Maybe<Scalars["ID"]["output"]>;
  totalCost?: Maybe<Scalars["Float"]["output"]>;
  triggerDetail?: Maybe<Scalars["String"]["output"]>;
  triggerId?: Maybe<Scalars["ID"]["output"]>;
  triggerName?: Maybe<Scalars["String"]["output"]>;
  turnNumber?: Maybe<Scalars["Int"]["output"]>;
  usageJson?: Maybe<Scalars["AWSJSON"]["output"]>;
  wakeupRequestId?: Maybe<Scalars["ID"]["output"]>;
};

export type ThreadTurnEvent = {
  __typename?: "ThreadTurnEvent";
  agentId?: Maybe<Scalars["ID"]["output"]>;
  color?: Maybe<Scalars["String"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  eventType: Scalars["String"]["output"];
  id: Scalars["ID"]["output"];
  level?: Maybe<Scalars["String"]["output"]>;
  message?: Maybe<Scalars["String"]["output"]>;
  payload?: Maybe<Scalars["AWSJSON"]["output"]>;
  runId: Scalars["ID"]["output"];
  seq: Scalars["Int"]["output"];
  stream?: Maybe<Scalars["String"]["output"]>;
  tenantId: Scalars["ID"]["output"];
};

export type ThreadTurnStepEvent = {
  __typename?: "ThreadTurnStepEvent";
  color?: Maybe<Scalars["String"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  eventType: Scalars["String"]["output"];
  level?: Maybe<Scalars["String"]["output"]>;
  message?: Maybe<Scalars["String"]["output"]>;
  payload?: Maybe<Scalars["AWSJSON"]["output"]>;
  runId: Scalars["ID"]["output"];
  seq: Scalars["Int"]["output"];
  stream?: Maybe<Scalars["String"]["output"]>;
  tenantId: Scalars["ID"]["output"];
  threadId: Scalars["ID"]["output"];
};

export type ThreadTurnUpdateEvent = {
  __typename?: "ThreadTurnUpdateEvent";
  agentId?: Maybe<Scalars["ID"]["output"]>;
  runId: Scalars["ID"]["output"];
  status: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
  threadId?: Maybe<Scalars["ID"]["output"]>;
  triggerId?: Maybe<Scalars["ID"]["output"]>;
  triggerName?: Maybe<Scalars["String"]["output"]>;
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export type ThreadUpdateEvent = {
  __typename?: "ThreadUpdateEvent";
  status: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
  threadId: Scalars["ID"]["output"];
  title: Scalars["String"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export type ThreadsPage = {
  __typename?: "ThreadsPage";
  items: Array<Thread>;
  totalCount: Scalars["Int"]["output"];
};

export type TraceCostReconciliationFact = {
  __typename?: "TraceCostReconciliationFact";
  attributionLevel?: Maybe<Scalars["String"]["output"]>;
  billedAmountUsd?: Maybe<Scalars["Float"]["output"]>;
  costEventId?: Maybe<Scalars["ID"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  id: Scalars["ID"]["output"];
  metadata: Scalars["AWSJSON"]["output"];
  model?: Maybe<Scalars["String"]["output"]>;
  provider?: Maybe<Scalars["String"]["output"]>;
  providerAmountUsd?: Maybe<Scalars["Float"]["output"]>;
  providerCachedReadTokens?: Maybe<Scalars["Int"]["output"]>;
  providerInputTokens?: Maybe<Scalars["Int"]["output"]>;
  providerOutputTokens?: Maybe<Scalars["Int"]["output"]>;
  reconciledAt: Scalars["AWSDateTime"]["output"];
  reconciliationScope: Scalars["String"]["output"];
  reconciliationState: Scalars["String"]["output"];
  requestId?: Maybe<Scalars["String"]["output"]>;
  runtimeAmountUsd?: Maybe<Scalars["Float"]["output"]>;
  runtimeCachedReadTokens?: Maybe<Scalars["Int"]["output"]>;
  runtimeInputTokens?: Maybe<Scalars["Int"]["output"]>;
  runtimeOutputTokens?: Maybe<Scalars["Int"]["output"]>;
  sourceEvidenceId?: Maybe<Scalars["ID"]["output"]>;
  traceEventId?: Maybe<Scalars["ID"]["output"]>;
  traceRunId?: Maybe<Scalars["ID"]["output"]>;
  varianceUsd?: Maybe<Scalars["Float"]["output"]>;
};

export type TraceEvent = {
  __typename?: "TraceEvent";
  agentId?: Maybe<Scalars["ID"]["output"]>;
  agentName?: Maybe<Scalars["String"]["output"]>;
  costUsd?: Maybe<Scalars["Float"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  durationMs?: Maybe<Scalars["Int"]["output"]>;
  estimated?: Maybe<Scalars["Boolean"]["output"]>;
  eventType?: Maybe<Scalars["String"]["output"]>;
  inputTokens?: Maybe<Scalars["Int"]["output"]>;
  laneKey?: Maybe<Scalars["String"]["output"]>;
  loopEvidence?: Maybe<Scalars["AWSJSON"]["output"]>;
  loopId?: Maybe<Scalars["String"]["output"]>;
  loopIterationIndex?: Maybe<Scalars["Int"]["output"]>;
  loopOwnerSlug?: Maybe<Scalars["String"]["output"]>;
  loopOwnerType?: Maybe<Scalars["String"]["output"]>;
  loopPhase?: Maybe<Scalars["String"]["output"]>;
  loopStatus?: Maybe<Scalars["String"]["output"]>;
  loopVerdict?: Maybe<Scalars["String"]["output"]>;
  match?: Maybe<Scalars["AWSJSON"]["output"]>;
  metadata?: Maybe<Scalars["AWSJSON"]["output"]>;
  model?: Maybe<Scalars["String"]["output"]>;
  modelRoutingStatus?: Maybe<Scalars["String"]["output"]>;
  outputTokens?: Maybe<Scalars["Int"]["output"]>;
  parentRequestId?: Maybe<Scalars["String"]["output"]>;
  profileId?: Maybe<Scalars["ID"]["output"]>;
  profileName?: Maybe<Scalars["String"]["output"]>;
  profileRunId?: Maybe<Scalars["String"]["output"]>;
  profileSlug?: Maybe<Scalars["String"]["output"]>;
  profileStatus?: Maybe<Scalars["String"]["output"]>;
  reconciliationSource?: Maybe<Scalars["String"]["output"]>;
  reconciliationState?: Maybe<Scalars["String"]["output"]>;
  requestId?: Maybe<Scalars["String"]["output"]>;
  reviewerRole?: Maybe<Scalars["Boolean"]["output"]>;
  ruleSource?: Maybe<Scalars["AWSJSON"]["output"]>;
  runtimeType?: Maybe<Scalars["String"]["output"]>;
  source?: Maybe<Scalars["String"]["output"]>;
  sourceEvidence?: Maybe<Array<TraceSourceEvidence>>;
  threadId?: Maybe<Scalars["ID"]["output"]>;
  toolCallId?: Maybe<Scalars["String"]["output"]>;
  toolName?: Maybe<Scalars["String"]["output"]>;
  traceId: Scalars["String"]["output"];
};

export type TraceSourceEvidence = {
  __typename?: "TraceSourceEvidence";
  createdAt: Scalars["AWSDateTime"]["output"];
  id: Scalars["ID"]["output"];
  metadata: Scalars["AWSJSON"]["output"];
  observedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  redactionState: Scalars["String"]["output"];
  retentionExpiresAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  sourceId?: Maybe<Scalars["String"]["output"]>;
  sourceSystem: Scalars["String"]["output"];
  sourceType: Scalars["String"]["output"];
  summary: Scalars["AWSJSON"]["output"];
  traceEventId?: Maybe<Scalars["ID"]["output"]>;
  traceRunId?: Maybe<Scalars["ID"]["output"]>;
  uri?: Maybe<Scalars["String"]["output"]>;
};

export type TriggerAgentLoopRunInput = {
  agentLoopId: Scalars["ID"]["input"];
  correlationId?: InputMaybe<Scalars["String"]["input"]>;
  idempotencyKey?: InputMaybe<Scalars["String"]["input"]>;
  inputSummary?: InputMaybe<Scalars["AWSJSON"]["input"]>;
};

export type TriggerWorkflowRunInput = {
  actorId?: InputMaybe<Scalars["ID"]["input"]>;
  actorType?: InputMaybe<Scalars["String"]["input"]>;
  agentId?: InputMaybe<Scalars["ID"]["input"]>;
  idempotencyKey?: InputMaybe<Scalars["String"]["input"]>;
  input?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  triggerSource?: InputMaybe<Scalars["String"]["input"]>;
  workflowId: Scalars["ID"]["input"];
};

/** Result of the one-time Twenty plugin cutover (plan 2026-06-12-001 U10). */
export type TwentyPluginCutoverResult = {
  __typename?: "TwentyPluginCutoverResult";
  /** True when this run changed ownership (adoption or legacy-row removal). */
  adopted: Scalars["Boolean"]["output"];
  /** Per-server user tokens invalidated; affected users re-activate at app level. */
  invalidatedUserTokenCount: Scalars["Int"]["output"];
  /** The canonical plugin-owned Twenty MCP server row after the run. */
  mcpServerId?: Maybe<Scalars["ID"]["output"]>;
  message: Scalars["String"]["output"];
};

export type UninstallPluginInput = {
  /**
   * Required when the install has an infrastructure component (mirrors the
   * managed-application destructive confirmation gate).
   */
  destructiveConfirmation?: InputMaybe<Scalars["String"]["input"]>;
  installId: Scalars["ID"]["input"];
};

export type UpdateAgentProfileInput = {
  description?: InputMaybe<Scalars["String"]["input"]>;
  enabled?: InputMaybe<Scalars["Boolean"]["input"]>;
  executionControls?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  instructions?: InputMaybe<Scalars["String"]["input"]>;
  modelId?: InputMaybe<Scalars["ID"]["input"]>;
  name?: InputMaybe<Scalars["String"]["input"]>;
  routingGuidance?: InputMaybe<Scalars["String"]["input"]>;
  skillPolicy?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  slug?: InputMaybe<Scalars["String"]["input"]>;
  spaceIds?: InputMaybe<Array<Scalars["ID"]["input"]>>;
  toolPolicy?: InputMaybe<Scalars["AWSJSON"]["input"]>;
};

export type UpdateArtifactInput = {
  content?: InputMaybe<Scalars["String"]["input"]>;
  favoritedAt?: InputMaybe<Scalars["AWSDateTime"]["input"]>;
  metadata?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  s3Key?: InputMaybe<Scalars["String"]["input"]>;
  status?: InputMaybe<ArtifactStatus>;
  summary?: InputMaybe<Scalars["String"]["input"]>;
  title?: InputMaybe<Scalars["String"]["input"]>;
  type?: InputMaybe<ArtifactType>;
};

export type UpdateCompanyBrainMigrationInput = {
  errorMessage?: InputMaybe<Scalars["String"]["input"]>;
  migrationId: Scalars["ID"]["input"];
  operatorEvidence?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  phase: Scalars["String"]["input"];
  rollbackWindowClosesAt?: InputMaybe<Scalars["AWSDateTime"]["input"]>;
  status?: InputMaybe<Scalars["String"]["input"]>;
  tenantId?: InputMaybe<Scalars["ID"]["input"]>;
  validationSummary?: InputMaybe<Scalars["AWSJSON"]["input"]>;
};

export type UpdateEmailReadinessCheckInput = {
  checkKey: EmailReadinessCheckKey;
  domainId?: InputMaybe<Scalars["ID"]["input"]>;
  failureCode?: InputMaybe<Scalars["String"]["input"]>;
  failureMessage?: InputMaybe<Scalars["String"]["input"]>;
  lastCheckedAt?: InputMaybe<Scalars["AWSDateTime"]["input"]>;
  metadata?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  providerInstallId: Scalars["ID"]["input"];
  status: EmailReadinessStatus;
};

export type UpdateEvalDatasetCaseInput = {
  agentcoreEvaluatorIds?: InputMaybe<Array<Scalars["String"]["input"]>>;
  assertions?: InputMaybe<Array<EvalAssertionInput>>;
  category?: InputMaybe<Scalars["String"]["input"]>;
  enabled?: InputMaybe<Scalars["Boolean"]["input"]>;
  expectedBehavior?: InputMaybe<Scalars["String"]["input"]>;
  name?: InputMaybe<Scalars["String"]["input"]>;
  query?: InputMaybe<Scalars["String"]["input"]>;
  systemPrompt?: InputMaybe<Scalars["String"]["input"]>;
  tags?: InputMaybe<Array<Scalars["String"]["input"]>>;
};

export type UpdateEvalDatasetInput = {
  name?: InputMaybe<Scalars["String"]["input"]>;
};

export type UpdateEvalTestCaseInput = {
  agentcoreEvaluatorIds?: InputMaybe<Array<Scalars["String"]["input"]>>;
  assertions?: InputMaybe<Array<EvalAssertionInput>>;
  category?: InputMaybe<Scalars["String"]["input"]>;
  enabled?: InputMaybe<Scalars["Boolean"]["input"]>;
  name?: InputMaybe<Scalars["String"]["input"]>;
  query?: InputMaybe<Scalars["String"]["input"]>;
  systemPrompt?: InputMaybe<Scalars["String"]["input"]>;
  tags?: InputMaybe<Array<Scalars["String"]["input"]>>;
};

export type UpdateKnowledgeBaseInput = {
  chunkOverlapPercent?: InputMaybe<Scalars["Int"]["input"]>;
  chunkSizeTokens?: InputMaybe<Scalars["Int"]["input"]>;
  chunkingStrategy?: InputMaybe<Scalars["String"]["input"]>;
  description?: InputMaybe<Scalars["String"]["input"]>;
  name?: InputMaybe<Scalars["String"]["input"]>;
};

export type UpdateLinkedTaskInput = {
  linkedTaskId: Scalars["ID"]["input"];
  metadata?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  note?: InputMaybe<Scalars["String"]["input"]>;
  status: LinkedTaskStatus;
  tenantId: Scalars["ID"]["input"];
  threadId: Scalars["ID"]["input"];
};

export type UpdateN8nPluginApiCredentialInput = {
  apiKey: Scalars["String"]["input"];
  baseUrl?: InputMaybe<Scalars["String"]["input"]>;
  idempotencyKey: Scalars["String"]["input"];
  installId: Scalars["ID"]["input"];
};

export type UpdateN8nPluginApiCredentialResult = {
  __typename?: "UpdateN8nPluginApiCredentialResult";
  settings: N8nPluginSettings;
};

export type UpdateN8nPluginPackageSettingsInput = {
  customPackageSpecs: Array<Scalars["String"]["input"]>;
  expectedCurrentDigest?: InputMaybe<Scalars["String"]["input"]>;
  idempotencyKey: Scalars["String"]["input"];
  installId: Scalars["ID"]["input"];
};

export type UpdateN8nPluginPackageSettingsResult = {
  __typename?: "UpdateN8nPluginPackageSettingsResult";
  deploymentJob: ManagedApplicationDeploymentJob;
  settings: N8nPluginSettings;
};

export type UpdateOntologyChangeSetInput = {
  changeSetId: Scalars["ID"]["input"];
  items?: InputMaybe<Array<UpdateOntologyChangeSetItemInput>>;
  status?: InputMaybe<OntologyChangeSetStatus>;
  summary?: InputMaybe<Scalars["String"]["input"]>;
  tenantId: Scalars["ID"]["input"];
  title?: InputMaybe<Scalars["String"]["input"]>;
};

export type UpdateOntologyChangeSetItemInput = {
  editedValue?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  id: Scalars["ID"]["input"];
  status?: InputMaybe<OntologyChangeSetStatus>;
};

export type UpdateOntologyEntityTypeInput = {
  aliases?: InputMaybe<Array<Scalars["String"]["input"]>>;
  broadType?: InputMaybe<Scalars["String"]["input"]>;
  description?: InputMaybe<Scalars["String"]["input"]>;
  entityTypeId: Scalars["ID"]["input"];
  guidanceNotes?: InputMaybe<Scalars["String"]["input"]>;
  lifecycleStatus?: InputMaybe<OntologyLifecycleStatus>;
  name?: InputMaybe<Scalars["String"]["input"]>;
  tenantId: Scalars["ID"]["input"];
};

export type UpdateOntologyRelationshipTypeInput = {
  aliases?: InputMaybe<Array<Scalars["String"]["input"]>>;
  description?: InputMaybe<Scalars["String"]["input"]>;
  guidanceNotes?: InputMaybe<Scalars["String"]["input"]>;
  inverseName?: InputMaybe<Scalars["String"]["input"]>;
  lifecycleStatus?: InputMaybe<OntologyLifecycleStatus>;
  name?: InputMaybe<Scalars["String"]["input"]>;
  relationshipTypeId: Scalars["ID"]["input"];
  sourceTypeSlugs?: InputMaybe<Array<Scalars["String"]["input"]>>;
  targetTypeSlugs?: InputMaybe<Array<Scalars["String"]["input"]>>;
  tenantId: Scalars["ID"]["input"];
};

export type UpdateQuickActionInput = {
  prompt?: InputMaybe<Scalars["String"]["input"]>;
  scope?: InputMaybe<QuickActionScope>;
  sortOrder?: InputMaybe<Scalars["Int"]["input"]>;
  title?: InputMaybe<Scalars["String"]["input"]>;
  workspaceAgentId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type UpdateRecipeInput = {
  params?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  summary?: InputMaybe<Scalars["String"]["input"]>;
  templates?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  title?: InputMaybe<Scalars["String"]["input"]>;
};

export type UpdateRoutineDefinitionInput = {
  graph?: InputMaybe<RoutineDefinitionGraphInput>;
  routineId: Scalars["ID"]["input"];
  steps: Array<RoutineDefinitionStepConfigInput>;
};

export type UpdateRoutineInput = {
  agentId?: InputMaybe<Scalars["ID"]["input"]>;
  description?: InputMaybe<Scalars["String"]["input"]>;
  name?: InputMaybe<Scalars["String"]["input"]>;
  schedule?: InputMaybe<Scalars["String"]["input"]>;
  status?: InputMaybe<Scalars["String"]["input"]>;
  type?: InputMaybe<Scalars["String"]["input"]>;
};

/**
 * Partial-update input for `updateScheduledJob`. Any field set updates that
 * column on the scheduled_jobs row. Changing `scheduleExpression`,
 * `scheduleType`, `timezone`, or `enabled` propagates to AWS EventBridge
 * via the job-schedule-manager Lambda (re-creates the underlying schedule
 * when the expression changes; toggles state when only `enabled` changes).
 * `config` is sent as an object — the resolver passes it through to the
 * Lambda which JSON-serializes for the DB column.
 */
export type UpdateScheduledJobInput = {
  config?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  description?: InputMaybe<Scalars["String"]["input"]>;
  enabled?: InputMaybe<Scalars["Boolean"]["input"]>;
  name?: InputMaybe<Scalars["String"]["input"]>;
  prompt?: InputMaybe<Scalars["String"]["input"]>;
  scheduleExpression?: InputMaybe<Scalars["String"]["input"]>;
  scheduleType?: InputMaybe<Scalars["String"]["input"]>;
  spaceId?: InputMaybe<Scalars["ID"]["input"]>;
  timezone?: InputMaybe<Scalars["String"]["input"]>;
};

export type UpdateSkillDraftInput = {
  currentContentHash?: InputMaybe<Scalars["String"]["input"]>;
  displayName?: InputMaybe<Scalars["String"]["input"]>;
  id: Scalars["ID"]["input"];
  slug?: InputMaybe<Scalars["String"]["input"]>;
  summary?: InputMaybe<Scalars["String"]["input"]>;
  title?: InputMaybe<Scalars["String"]["input"]>;
};

export type UpdateSpaceEmailTriggerInput = {
  emailPrefix?: InputMaybe<Scalars["String"]["input"]>;
  spaceId: Scalars["ID"]["input"];
  status: SpaceEmailTriggerStatus;
};

export type UpdateSpaceInput = {
  accessMode?: InputMaybe<SpaceAccessMode>;
  description?: InputMaybe<Scalars["String"]["input"]>;
  name?: InputMaybe<Scalars["String"]["input"]>;
  spaceId: Scalars["ID"]["input"];
  tenantId: Scalars["ID"]["input"];
};

export type UpdateTenantAgentInput = {
  adapterConfig?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  adapterType?: InputMaybe<Scalars["String"]["input"]>;
  avatarUrl?: InputMaybe<Scalars["String"]["input"]>;
  blockedTools?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  browser?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  budgetMonthlyCents?: InputMaybe<Scalars["Int"]["input"]>;
  budgetPaused?: InputMaybe<Scalars["Boolean"]["input"]>;
  contextEngine?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  guardrailId?: InputMaybe<Scalars["ID"]["input"]>;
  model?: InputMaybe<Scalars["String"]["input"]>;
  name?: InputMaybe<Scalars["String"]["input"]>;
  role?: InputMaybe<Scalars["String"]["input"]>;
  runtime?: InputMaybe<AgentRuntime>;
  runtimeConfig?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  sandbox?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  sendEmail?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  systemPrompt?: InputMaybe<Scalars["String"]["input"]>;
  webExtract?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  webSearch?: InputMaybe<Scalars["AWSJSON"]["input"]>;
};

export type UpdateTenantCredentialInput = {
  displayName?: InputMaybe<Scalars["String"]["input"]>;
  metadataJson?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  slug?: InputMaybe<Scalars["String"]["input"]>;
  status?: InputMaybe<TenantCredentialStatus>;
};

export type UpdateTenantInput = {
  /**
   * Optional client-supplied idempotency key. When provided, a retry with
   * the same key returns the prior call's result without re-executing.
   * Null/absent = server derives a key from canonicalized inputs.
   * See packages/api/src/lib/idempotency.ts.
   */
  idempotencyKey?: InputMaybe<Scalars["String"]["input"]>;
  issuePrefix?: InputMaybe<Scalars["String"]["input"]>;
  name?: InputMaybe<Scalars["String"]["input"]>;
  plan?: InputMaybe<Scalars["String"]["input"]>;
};

export type UpdateTenantMemberInput = {
  /** Optional idempotency key. See UpdateTenantInput.idempotencyKey. */
  idempotencyKey?: InputMaybe<Scalars["String"]["input"]>;
  role?: InputMaybe<Scalars["String"]["input"]>;
  status?: InputMaybe<Scalars["String"]["input"]>;
};

export type UpdateTenantModelCatalogEntryInput = {
  displayName?: InputMaybe<Scalars["String"]["input"]>;
  enabled?: InputMaybe<Scalars["Boolean"]["input"]>;
  inputCostPerMillion?: InputMaybe<Scalars["Float"]["input"]>;
  modelId: Scalars["String"]["input"];
  outputCostPerMillion?: InputMaybe<Scalars["Float"]["input"]>;
  tenantId: Scalars["ID"]["input"];
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
  complianceTier?: InputMaybe<Scalars["String"]["input"]>;
  /** Sandbox kill switch. Setting true while complianceTier != 'standard' is rejected. */
  sandboxEnabled?: InputMaybe<Scalars["Boolean"]["input"]>;
};

export type UpdateTenantSettingsInput = {
  autoCloseThreadMinutes?: InputMaybe<Scalars["Int"]["input"]>;
  budgetMonthlyCents?: InputMaybe<Scalars["Int"]["input"]>;
  defaultModel?: InputMaybe<Scalars["String"]["input"]>;
  features?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  goalDefaultTokenBudget?: InputMaybe<Scalars["Int"]["input"]>;
  maxAgents?: InputMaybe<Scalars["Int"]["input"]>;
};

export type UpdateThreadInput = {
  archivedAt?: InputMaybe<Scalars["AWSDateTime"]["input"]>;
  assigneeId?: InputMaybe<Scalars["ID"]["input"]>;
  assigneeType?: InputMaybe<Scalars["String"]["input"]>;
  billingCode?: InputMaybe<Scalars["String"]["input"]>;
  channel?: InputMaybe<ThreadChannel>;
  dueAt?: InputMaybe<Scalars["AWSDateTime"]["input"]>;
  labels?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  lastReadAt?: InputMaybe<Scalars["AWSDateTime"]["input"]>;
  metadata?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  status?: InputMaybe<ThreadStatus>;
  title?: InputMaybe<Scalars["String"]["input"]>;
};

export type UpdateThreadLabelInput = {
  color?: InputMaybe<Scalars["String"]["input"]>;
  description?: InputMaybe<Scalars["String"]["input"]>;
  name?: InputMaybe<Scalars["String"]["input"]>;
};

export type UpdateUserInput = {
  image?: InputMaybe<Scalars["String"]["input"]>;
  name?: InputMaybe<Scalars["String"]["input"]>;
  phone?: InputMaybe<Scalars["String"]["input"]>;
};

export type UpdateUserProfileInput = {
  /** Short/preferred name the agent should use in chat. Set via admin UI or agent self-serve tool. */
  callBy?: InputMaybe<Scalars["String"]["input"]>;
  /** Free-form markdown capturing ongoing context about the human. */
  context?: InputMaybe<Scalars["String"]["input"]>;
  displayName?: InputMaybe<Scalars["String"]["input"]>;
  /** Free-form markdown describing the human's family / close contacts. */
  family?: InputMaybe<Scalars["String"]["input"]>;
  /** Free-form notes about the human's preferences + communication style. */
  notes?: InputMaybe<Scalars["String"]["input"]>;
  notificationPreferences?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  operatingModel?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  operatingModelHistory?: InputMaybe<Array<Scalars["AWSJSON"]["input"]>>;
  pronouns?: InputMaybe<Scalars["String"]["input"]>;
  theme?: InputMaybe<Scalars["String"]["input"]>;
  timezone?: InputMaybe<Scalars["String"]["input"]>;
  title?: InputMaybe<Scalars["String"]["input"]>;
};

export type UpdateWebhookInput = {
  agentId?: InputMaybe<Scalars["ID"]["input"]>;
  config?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  description?: InputMaybe<Scalars["String"]["input"]>;
  enabled?: InputMaybe<Scalars["Boolean"]["input"]>;
  name?: InputMaybe<Scalars["String"]["input"]>;
  prompt?: InputMaybe<Scalars["String"]["input"]>;
  rateLimit?: InputMaybe<Scalars["Int"]["input"]>;
  routineId?: InputMaybe<Scalars["ID"]["input"]>;
  spaceId?: InputMaybe<Scalars["ID"]["input"]>;
  targetType?: InputMaybe<Scalars["String"]["input"]>;
};

export type UpdateWorkItemInput = {
  applicable?: InputMaybe<Scalars["Boolean"]["input"]>;
  archived?: InputMaybe<Scalars["Boolean"]["input"]>;
  blocked?: InputMaybe<Scalars["Boolean"]["input"]>;
  dueAt?: InputMaybe<Scalars["AWSDateTime"]["input"]>;
  metadata?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  notes?: InputMaybe<Scalars["String"]["input"]>;
  ownerAgentId?: InputMaybe<Scalars["ID"]["input"]>;
  ownerUserId?: InputMaybe<Scalars["ID"]["input"]>;
  priority?: InputMaybe<WorkItemPriority>;
  required?: InputMaybe<Scalars["Boolean"]["input"]>;
  tenantId?: InputMaybe<Scalars["ID"]["input"]>;
  title?: InputMaybe<Scalars["String"]["input"]>;
  workItemId: Scalars["ID"]["input"];
};

export type UpdateWorkItemStatusInput = {
  metadata?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  note?: InputMaybe<Scalars["String"]["input"]>;
  statusCategory?: InputMaybe<WorkItemStatusCategory>;
  statusId?: InputMaybe<Scalars["ID"]["input"]>;
  tenantId?: InputMaybe<Scalars["ID"]["input"]>;
  threadId?: InputMaybe<Scalars["ID"]["input"]>;
  workItemId: Scalars["ID"]["input"];
};

export type UpgradePluginInput = {
  idempotencyKey: Scalars["String"]["input"];
  installId: Scalars["ID"]["input"];
  /** Catalog version to pin (must differ from the pinned version). */
  version: Scalars["String"]["input"];
};

export type UpsertBudgetPolicyInput = {
  actionOnExceed?: InputMaybe<Scalars["String"]["input"]>;
  agentId?: InputMaybe<Scalars["ID"]["input"]>;
  limitUsd: Scalars["Float"]["input"];
  period?: InputMaybe<Scalars["String"]["input"]>;
  scope: Scalars["String"]["input"];
  userId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type UpsertEmailSpacePolicyInput = {
  enabled?: InputMaybe<Scalars["Boolean"]["input"]>;
  firstSendReviewRequired?: InputMaybe<Scalars["Boolean"]["input"]>;
  outsideSenderDefault?: InputMaybe<Scalars["String"]["input"]>;
  policy?: InputMaybe<Scalars["AWSJSON"]["input"]>;
  privateSpaceMembershipRequired?: InputMaybe<Scalars["Boolean"]["input"]>;
  providerInstallId?: InputMaybe<Scalars["ID"]["input"]>;
  registeredUsersAllowed?: InputMaybe<Scalars["Boolean"]["input"]>;
  spaceId: Scalars["ID"]["input"];
};

export type User = {
  __typename?: "User";
  createdAt: Scalars["AWSDateTime"]["output"];
  email: Scalars["String"]["output"];
  id: Scalars["ID"]["output"];
  image?: Maybe<Scalars["String"]["output"]>;
  name?: Maybe<Scalars["String"]["output"]>;
  phone?: Maybe<Scalars["String"]["output"]>;
  profile?: Maybe<UserProfile>;
  tenantId: Scalars["ID"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export type UserCostSummary = {
  __typename?: "UserCostSummary";
  eventCount: Scalars["Int"]["output"];
  isSystem: Scalars["Boolean"]["output"];
  totalUsd: Scalars["Float"]["output"];
  userEmail?: Maybe<Scalars["String"]["output"]>;
  userId?: Maybe<Scalars["ID"]["output"]>;
  userName: Scalars["String"]["output"];
};

export type UserModelCatalogEntry = {
  __typename?: "UserModelCatalogEntry";
  approved: Scalars["Boolean"]["output"];
  contextWindow?: Maybe<Scalars["Int"]["output"]>;
  displayName: Scalars["String"]["output"];
  id: Scalars["ID"]["output"];
  inputCostPerMillion?: Maybe<Scalars["Float"]["output"]>;
  maxOutputTokens?: Maybe<Scalars["Int"]["output"]>;
  modelId: Scalars["String"]["output"];
  outputCostPerMillion?: Maybe<Scalars["Float"]["output"]>;
  provider: Scalars["String"]["output"];
  supportsTools?: Maybe<Scalars["Boolean"]["output"]>;
  supportsVision?: Maybe<Scalars["Boolean"]["output"]>;
};

/**
 * A user's app-level OAuth grant for an installed plugin. One grant covers all
 * of the plugin's MCP servers; token records (secret refs) are internal and
 * never exposed here.
 */
export type UserPluginActivation = {
  __typename?: "UserPluginActivation";
  createdAt: Scalars["AWSDateTime"]["output"];
  grantedAt: Scalars["AWSDateTime"]["output"];
  /** OAuth scopes granted at consent time. */
  grantedScopes: Array<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  pluginInstallId: Scalars["ID"]["output"];
  /** Plugin key of the underlying install, for display without a second query. */
  pluginKey: Scalars["String"]["output"];
  revokedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  /** 'active' | 'needs_reauth' | 'revoked'. */
  status: Scalars["String"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
  userId: Scalars["ID"]["output"];
};

export type UserProfile = {
  __typename?: "UserProfile";
  /** Short/preferred name — what the agent should call this human in chat. */
  callBy?: Maybe<Scalars["String"]["output"]>;
  /** Free-form markdown capturing ongoing context about the human. */
  context?: Maybe<Scalars["String"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  displayName?: Maybe<Scalars["String"]["output"]>;
  /** Free-form markdown describing the human's family / close contacts. */
  family?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  /** Free-form notes the agent maintains about this human's preferences + style. */
  notes?: Maybe<Scalars["String"]["output"]>;
  notificationPreferences?: Maybe<Scalars["AWSJSON"]["output"]>;
  operatingModel?: Maybe<Scalars["AWSJSON"]["output"]>;
  operatingModelHistory: Array<Scalars["AWSJSON"]["output"]>;
  pronouns?: Maybe<Scalars["String"]["output"]>;
  tenantId: Scalars["ID"]["output"];
  theme?: Maybe<Scalars["String"]["output"]>;
  timezone?: Maybe<Scalars["String"]["output"]>;
  title?: Maybe<Scalars["String"]["output"]>;
  updatedAt: Scalars["AWSDateTime"]["output"];
  userId: Scalars["ID"]["output"];
};

export type UserQuestion = {
  __typename?: "UserQuestion";
  answeredAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  answeredBy?: Maybe<Scalars["String"]["output"]>;
  answeredVia?: Maybe<UserQuestionAnsweredVia>;
  answers?: Maybe<Scalars["AWSJSON"]["output"]>;
  id: Scalars["ID"]["output"];
  messageId: Scalars["ID"]["output"];
  questions: Scalars["AWSJSON"]["output"];
  status: UserQuestionStatus;
  threadId: Scalars["ID"]["output"];
};

export enum UserQuestionAnsweredVia {
  Card = "CARD",
  Reply = "REPLY",
}

export enum UserQuestionStatus {
  Answered = "ANSWERED",
  Cancelled = "CANCELLED",
  Pending = "PENDING",
}

export type UserQuickAction = {
  __typename?: "UserQuickAction";
  createdAt: Scalars["AWSDateTime"]["output"];
  id: Scalars["ID"]["output"];
  prompt: Scalars["String"]["output"];
  scope: QuickActionScope;
  sortOrder: Scalars["Int"]["output"];
  tenantId: Scalars["ID"]["output"];
  title: Scalars["String"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
  userId: Scalars["ID"]["output"];
  workspaceAgentId?: Maybe<Scalars["ID"]["output"]>;
};

export enum WakeupRequestStatus {
  Cancelled = "CANCELLED",
  Claimed = "CLAIMED",
  Coalesced = "COALESCED",
  Completed = "COMPLETED",
  Failed = "FAILED",
  Queued = "QUEUED",
  Skipped = "SKIPPED",
}

export type Webhook = {
  __typename?: "Webhook";
  agentId?: Maybe<Scalars["ID"]["output"]>;
  config?: Maybe<Scalars["AWSJSON"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  createdById?: Maybe<Scalars["String"]["output"]>;
  createdByType?: Maybe<Scalars["String"]["output"]>;
  description?: Maybe<Scalars["String"]["output"]>;
  enabled: Scalars["Boolean"]["output"];
  id: Scalars["ID"]["output"];
  invocationCount: Scalars["Int"]["output"];
  lastInvokedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  name: Scalars["String"]["output"];
  prompt?: Maybe<Scalars["String"]["output"]>;
  rateLimit?: Maybe<Scalars["Int"]["output"]>;
  routineId?: Maybe<Scalars["ID"]["output"]>;
  spaceId?: Maybe<Scalars["ID"]["output"]>;
  targetType: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
  token: Scalars["String"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
};

/**
 * A single inbound webhook request as recorded by `POST /webhooks/{token}`.
 * Rows are PII-bearing (provider task titles, customer names, comment
 * text in `bodyPreview`); 90-day retention is enforced by a cleanup
 * Lambda. The GraphQL surface here intentionally redacts nothing — the
 * endpoint is admin-tier via `requireAdminOrServiceCaller`.
 */
export type WebhookDelivery = {
  __typename?: "WebhookDelivery";
  bodyPreview?: Maybe<Scalars["String"]["output"]>;
  bodySha256?: Maybe<Scalars["String"]["output"]>;
  bodySizeBytes?: Maybe<Scalars["Int"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  durationMs?: Maybe<Scalars["Int"]["output"]>;
  errorMessage?: Maybe<Scalars["String"]["output"]>;
  externalTaskId?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  isReplay: Scalars["Boolean"]["output"];
  normalizedKind?: Maybe<Scalars["String"]["output"]>;
  providerEventId?: Maybe<Scalars["String"]["output"]>;
  providerName?: Maybe<Scalars["String"]["output"]>;
  providerUserId?: Maybe<Scalars["String"]["output"]>;
  receivedAt: Scalars["AWSDateTime"]["output"];
  resolutionStatus: Scalars["String"]["output"];
  retryCount: Scalars["Int"]["output"];
  signatureStatus: Scalars["String"]["output"];
  sourceIp?: Maybe<Scalars["String"]["output"]>;
  statusCode?: Maybe<Scalars["Int"]["output"]>;
  targetType?: Maybe<Scalars["String"]["output"]>;
  tenantId?: Maybe<Scalars["ID"]["output"]>;
  threadCreated?: Maybe<Scalars["Boolean"]["output"]>;
  threadId?: Maybe<Scalars["ID"]["output"]>;
  webhookId?: Maybe<Scalars["ID"]["output"]>;
};

export type WikiCompileJob = {
  __typename?: "WikiCompileJob";
  attempt: Scalars["Int"]["output"];
  claimedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  dedupeKey: Scalars["String"]["output"];
  error?: Maybe<Scalars["String"]["output"]>;
  finishedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  id: Scalars["ID"]["output"];
  metrics?: Maybe<Scalars["AWSJSON"]["output"]>;
  /** @deprecated Use userId */
  ownerId?: Maybe<Scalars["ID"]["output"]>;
  startedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  status: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
  trigger: Scalars["String"]["output"];
  /**
   * Owning user. Null for tenant-keyed graph-mode compile jobs (the graph
   * materializer runs one compile per tenant, not per user).
   */
  userId?: Maybe<Scalars["ID"]["output"]>;
};

export type WikiGraph = {
  __typename?: "WikiGraph";
  edges: Array<WikiGraphEdge>;
  nodes: Array<WikiGraphNode>;
};

export type WikiGraphEdge = {
  __typename?: "WikiGraphEdge";
  kind: Scalars["String"]["output"];
  label: Scalars["String"]["output"];
  source: Scalars["ID"]["output"];
  target: Scalars["ID"]["output"];
  weight: Scalars["Float"]["output"];
};

/**
 * User-scoped force-graph payload: all active pages and their [[...]] links
 *   for one `(tenant, user)` scope. Shaped to match the legacy `memoryGraph`
 * wire contract so the admin force-graph component can swap data sources
 * with minimal client changes. `type` is always `"page"` on nodes; the
 * Wiki page type (`ENTITY`/`TOPIC`/`DECISION`) lives in `entityType`.
 */
export type WikiGraphNode = {
  __typename?: "WikiGraphNode";
  displayType: Scalars["String"]["output"];
  edgeCount: Scalars["Int"]["output"];
  entitySubtype?: Maybe<Scalars["String"]["output"]>;
  entityType: WikiPageType;
  id: Scalars["ID"]["output"];
  label: Scalars["String"]["output"];
  latestThreadId?: Maybe<Scalars["String"]["output"]>;
  slug: Scalars["String"]["output"];
  strategy?: Maybe<Scalars["String"]["output"]>;
  type: Scalars["String"]["output"];
};

/**
 * Dispatch acknowledgement for `bootstrapJournalImport`. The actual ingest
 * runs on a dedicated worker Lambda (`wiki-bootstrap-import`) because
 * Hindsight's LLM-backed retain is too slow to complete within API Gateway's
 * 30-second HTTP ceiling. Operator watches CloudWatch + wiki_compile_jobs
 * for the terminal compile the ingest enqueues.
 */
export type WikiJournalImportDispatch = {
  __typename?: "WikiJournalImportDispatch";
  accountId: Scalars["ID"]["output"];
  /** @deprecated Use userId */
  agentId?: Maybe<Scalars["ID"]["output"]>;
  dispatched: Scalars["Boolean"]["output"];
  dispatchedAt: Scalars["AWSDateTime"]["output"];
  error?: Maybe<Scalars["String"]["output"]>;
  tenantId: Scalars["ID"]["output"];
  userId: Scalars["ID"]["output"];
};

export type WikiPage = {
  __typename?: "WikiPage";
  aliases: Array<Scalars["String"]["output"]>;
  bodyMd?: Maybe<Scalars["String"]["output"]>;
  /**
   * Pages that were promoted out of this page's sections — the reverse of
   * `parent`. Empty for pages that have never had a child promoted.
   */
  children: Array<WikiPage>;
  createdAt: Scalars["AWSDateTime"]["output"];
  /**
   * Human-readable type label for list/detail surfaces. Uses the approved
   * ontology entity type when present; falls back to the legacy page type.
   */
  displayType: Scalars["String"]["output"];
  /**
   * Approved ontology entity type slug materialized for this page, for example
   * `customer`, `person`, `place`, or `support_case`. Null only for legacy or
   * non-ontology pages.
   */
  entitySubtype?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  lastCompiledAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  /** @deprecated Use userId */
  ownerId?: Maybe<Scalars["ID"]["output"]>;
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
  slug: Scalars["String"]["output"];
  /**
   * Distinct memory_units (Hindsight records) that source at least one section
   * on this page. Counts through `wiki_section_sources`. Hit on detail screens
   * only — list screens must NOT request this (N+1 risk).
   */
  sourceMemoryCount: Scalars["Int"]["output"];
  /**
   * Up to `limit` memory_unit ids that source sections on this page, ordered
   * by most recently-cited. Server-side capped at 50. Pairs with
   * `MemoryRecord` drill-in so a page's "Based on N memories" badge can
   * resolve to the actual records.
   */
  sourceMemoryIds: Array<Scalars["ID"]["output"]>;
  status: Scalars["String"]["output"];
  summary?: Maybe<Scalars["String"]["output"]>;
  tenantId: Scalars["ID"]["output"];
  title: Scalars["String"]["output"];
  type: WikiPageType;
  updatedAt: Scalars["AWSDateTime"]["output"];
  /**
   * Owning user. Null for tenant-scoped pages produced by the graph
   * materializer — those are readable by any member of the tenant.
   */
  userId?: Maybe<Scalars["ID"]["output"]>;
};

export type WikiPageSectionChildrenArgs = {
  sectionSlug: Scalars["String"]["input"];
};

export type WikiPageSourceMemoryIdsArgs = {
  limit?: InputMaybe<Scalars["Int"]["input"]>;
};

export type WikiPageSection = {
  __typename?: "WikiPageSection";
  bodyMd: Scalars["String"]["output"];
  heading: Scalars["String"]["output"];
  id: Scalars["ID"]["output"];
  lastSourceAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  position: Scalars["Int"]["output"];
  sectionSlug: Scalars["String"]["output"];
};

/**
 * Compounding Memory (wiki) read path.
 *
 * Scope rule (plan 2026-06-09-004 U9/U14): pages are either USER-scoped
 * (`userId`/`ownerId` set — the v1 planner output) or TENANT-scoped
 * (`userId`/`ownerId` null — the graph materializer output, readable by any
 * member of the tenant). Reads serve the transitional union: tenant pages
 * plus the requesting user's own pages, until the U11 archive pass retires
 * the user-scoped corpus.
 */
export enum WikiPageType {
  Decision = "DECISION",
  Entity = "ENTITY",
  Topic = "TOPIC",
}

/**
 * Provenance linkage between a promoted page and the section it was derived
 * from. Populated only for pages whose `parent_page_id` is set AND whose
 * parent has a section in which `aggregation.promoted_page_id` points back.
 */
export type WikiPromotedFromSection = {
  __typename?: "WikiPromotedFromSection";
  parentPage: WikiPage;
  sectionHeading: Scalars["String"]["output"];
  sectionSlug: Scalars["String"]["output"];
};

export type WikiResetCursorResult = {
  __typename?: "WikiResetCursorResult";
  brainIncluded: Scalars["Boolean"]["output"];
  cursorCleared: Scalars["Boolean"]["output"];
  dryRun: Scalars["Boolean"]["output"];
  impact?: Maybe<Scalars["AWSJSON"]["output"]>;
  /** @deprecated Use userId */
  ownerId: Scalars["ID"]["output"];
  pagesArchived: Scalars["Int"]["output"];
  tenantId: Scalars["ID"]["output"];
  userId: Scalars["ID"]["output"];
};

export type WikiSearchResult = {
  __typename?: "WikiSearchResult";
  matchedAlias?: Maybe<Scalars["String"]["output"]>;
  page: WikiPage;
  score: Scalars["Float"]["output"];
};

export type WorkItem = {
  __typename?: "WorkItem";
  applicable: Scalars["Boolean"]["output"];
  archivedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  blocked: Scalars["Boolean"]["output"];
  completedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  completedByAgentId?: Maybe<Scalars["ID"]["output"]>;
  completedByUserId?: Maybe<Scalars["ID"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  createdByAgentId?: Maybe<Scalars["ID"]["output"]>;
  createdByUserId?: Maybe<Scalars["ID"]["output"]>;
  dueAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  events: Array<WorkItemEvent>;
  externalRefs: Array<WorkItemExternalRef>;
  id: Scalars["ID"]["output"];
  metadata?: Maybe<Scalars["AWSJSON"]["output"]>;
  notes?: Maybe<Scalars["String"]["output"]>;
  ownerAgentId?: Maybe<Scalars["ID"]["output"]>;
  ownerUserId?: Maybe<Scalars["ID"]["output"]>;
  priority: WorkItemPriority;
  required: Scalars["Boolean"]["output"];
  spaceId: Scalars["ID"]["output"];
  status?: Maybe<WorkItemStatus>;
  statusId?: Maybe<Scalars["ID"]["output"]>;
  templateSourceId?: Maybe<Scalars["ID"]["output"]>;
  tenantId: Scalars["ID"]["output"];
  threadLinks: Array<WorkItemThreadLink>;
  title: Scalars["String"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export type WorkItemEvent = {
  __typename?: "WorkItemEvent";
  actorAgentId?: Maybe<Scalars["ID"]["output"]>;
  actorUserId?: Maybe<Scalars["ID"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  eventType: WorkItemEventType;
  id: Scalars["ID"]["output"];
  message?: Maybe<Scalars["String"]["output"]>;
  metadata?: Maybe<Scalars["AWSJSON"]["output"]>;
  newStatusId?: Maybe<Scalars["ID"]["output"]>;
  previousStatusId?: Maybe<Scalars["ID"]["output"]>;
  spaceId: Scalars["ID"]["output"];
  tenantId: Scalars["ID"]["output"];
  threadId?: Maybe<Scalars["ID"]["output"]>;
  workItemId: Scalars["ID"]["output"];
};

export enum WorkItemEventType {
  AgentAction = "AGENT_ACTION",
  ApplicabilityChanged = "APPLICABILITY_CHANGED",
  Assigned = "ASSIGNED",
  Blocked = "BLOCKED",
  Completed = "COMPLETED",
  Created = "CREATED",
  DueDateChanged = "DUE_DATE_CHANGED",
  LinkedThread = "LINKED_THREAD",
  StatusChanged = "STATUS_CHANGED",
  Unblocked = "UNBLOCKED",
  Updated = "UPDATED",
}

export type WorkItemExternalRef = {
  __typename?: "WorkItemExternalRef";
  createdAt: Scalars["AWSDateTime"]["output"];
  externalId: Scalars["String"]["output"];
  externalUrl?: Maybe<Scalars["AWSURL"]["output"]>;
  id: Scalars["ID"]["output"];
  metadata?: Maybe<Scalars["AWSJSON"]["output"]>;
  provider: WorkItemExternalRefProvider;
  tenantId: Scalars["ID"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
  workItemId: Scalars["ID"]["output"];
};

export enum WorkItemExternalRefProvider {
  Lastmile = "LASTMILE",
  Linear = "LINEAR",
  Plane = "PLANE",
  Thinkwork = "THINKWORK",
  Twenty = "TWENTY",
}

export enum WorkItemPriority {
  High = "HIGH",
  Low = "LOW",
  Normal = "NORMAL",
  Urgent = "URGENT",
}

export type WorkItemSavedView = {
  __typename?: "WorkItemSavedView";
  createdAt: Scalars["AWSDateTime"]["output"];
  filters?: Maybe<Scalars["AWSJSON"]["output"]>;
  grouping?: Maybe<Scalars["AWSJSON"]["output"]>;
  id: Scalars["ID"]["output"];
  isDefault: Scalars["Boolean"]["output"];
  isFavorite: Scalars["Boolean"]["output"];
  isPrivate: Scalars["Boolean"]["output"];
  name: Scalars["String"]["output"];
  sorting?: Maybe<Scalars["AWSJSON"]["output"]>;
  spaceId?: Maybe<Scalars["ID"]["output"]>;
  tenantId: Scalars["ID"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
  userId?: Maybe<Scalars["ID"]["output"]>;
  viewConfig?: Maybe<Scalars["AWSJSON"]["output"]>;
  viewType: WorkItemViewType;
};

export type WorkItemStatus = {
  __typename?: "WorkItemStatus";
  category: WorkItemStatusCategory;
  color?: Maybe<Scalars["String"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  description?: Maybe<Scalars["String"]["output"]>;
  displayOrder: Scalars["Int"]["output"];
  icon?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  isActive: Scalars["Boolean"]["output"];
  isDefault: Scalars["Boolean"]["output"];
  isFinal: Scalars["Boolean"]["output"];
  name: Scalars["String"]["output"];
  spaceId: Scalars["ID"]["output"];
  tenantId: Scalars["ID"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export enum WorkItemStatusCategory {
  Active = "ACTIVE",
  Blocked = "BLOCKED",
  Done = "DONE",
  Skipped = "SKIPPED",
  Todo = "TODO",
}

export type WorkItemStatusInput = {
  category: WorkItemStatusCategory;
  color?: InputMaybe<Scalars["String"]["input"]>;
  description?: InputMaybe<Scalars["String"]["input"]>;
  displayOrder?: InputMaybe<Scalars["Int"]["input"]>;
  icon?: InputMaybe<Scalars["String"]["input"]>;
  id?: InputMaybe<Scalars["ID"]["input"]>;
  isActive?: InputMaybe<Scalars["Boolean"]["input"]>;
  isDefault?: InputMaybe<Scalars["Boolean"]["input"]>;
  isFinal?: InputMaybe<Scalars["Boolean"]["input"]>;
  name: Scalars["String"]["input"];
};

export type WorkItemThreadLink = {
  __typename?: "WorkItemThreadLink";
  createdAt: Scalars["AWSDateTime"]["output"];
  id: Scalars["ID"]["output"];
  relationship: WorkItemThreadRelationship;
  spaceId: Scalars["ID"]["output"];
  tenantId: Scalars["ID"]["output"];
  threadId: Scalars["ID"]["output"];
  workItemId: Scalars["ID"]["output"];
};

export enum WorkItemThreadRelationship {
  Evidence = "EVIDENCE",
  FollowUp = "FOLLOW_UP",
  Mentioned = "MENTIONED",
  Primary = "PRIMARY",
}

export enum WorkItemViewType {
  Board = "BOARD",
  List = "LIST",
}

export type WorkItemsInput = {
  applicable?: InputMaybe<Scalars["Boolean"]["input"]>;
  blocked?: InputMaybe<Scalars["Boolean"]["input"]>;
  dueAfter?: InputMaybe<Scalars["AWSDateTime"]["input"]>;
  dueBefore?: InputMaybe<Scalars["AWSDateTime"]["input"]>;
  includeArchived?: InputMaybe<Scalars["Boolean"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  ownerAgentId?: InputMaybe<Scalars["ID"]["input"]>;
  ownerUserId?: InputMaybe<Scalars["ID"]["input"]>;
  priority?: InputMaybe<WorkItemPriority>;
  required?: InputMaybe<Scalars["Boolean"]["input"]>;
  search?: InputMaybe<Scalars["String"]["input"]>;
  spaceId?: InputMaybe<Scalars["ID"]["input"]>;
  statusCategory?: InputMaybe<WorkItemStatusCategory>;
  statusId?: InputMaybe<Scalars["ID"]["input"]>;
  tenantId?: InputMaybe<Scalars["ID"]["input"]>;
  threadId?: InputMaybe<Scalars["ID"]["input"]>;
};

export type Workflow = {
  __typename?: "Workflow";
  bindings: Array<WorkflowEngineBinding>;
  capabilityFlags: Scalars["AWSJSON"]["output"];
  createdAt: Scalars["AWSDateTime"]["output"];
  currentVersion?: Maybe<WorkflowVersion>;
  currentVersionId?: Maybe<Scalars["ID"]["output"]>;
  currentVersionNumber?: Maybe<Scalars["Int"]["output"]>;
  description?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  lastRun?: Maybe<WorkflowRun>;
  lastRunAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  lastRunId?: Maybe<Scalars["ID"]["output"]>;
  lifecycleStatus: WorkflowLifecycleStatus;
  name: Scalars["String"]["output"];
  ownerAgentId?: Maybe<Scalars["ID"]["output"]>;
  ownerUserId?: Maybe<Scalars["ID"]["output"]>;
  primaryTriggerFamily: WorkflowTriggerFamily;
  readinessReasons: Scalars["AWSJSON"]["output"];
  readinessState: WorkflowReadinessState;
  runs: Array<WorkflowRun>;
  slug: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
  triggers: Array<WorkflowTrigger>;
  updatedAt: Scalars["AWSDateTime"]["output"];
  visibility: WorkflowVisibility;
};

export type WorkflowRunsArgs = {
  cursor?: InputMaybe<Scalars["String"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  status?: InputMaybe<WorkflowRunStatus>;
};

export type WorkflowBinding = {
  __typename?: "WorkflowBinding";
  agentId: Scalars["ID"]["output"];
  catalogSlug: Scalars["String"]["output"];
  enabled: Scalars["Boolean"]["output"];
  id: Scalars["ID"]["output"];
  status: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export enum WorkflowBindingStatus {
  Archived = "archived",
  BlockedNotReady = "blocked_not_ready",
  Configured = "configured",
  Disabled = "disabled",
  Ready = "ready",
}

export enum WorkflowBindingType {
  ConnectedApp = "connected_app",
  N8nBridge = "n8n_bridge",
  N8nImport = "n8n_import",
  Native = "native",
  StepFunctionsRoutine = "step_functions_routine",
  TwentyCrm = "twenty_crm",
}

export type WorkflowCatalogItem = {
  __typename?: "WorkflowCatalogItem";
  category?: Maybe<Scalars["String"]["output"]>;
  defaultSchedule?: Maybe<Scalars["String"]["output"]>;
  description?: Maybe<Scalars["String"]["output"]>;
  displayName: Scalars["String"]["output"];
  enabled: Scalars["Boolean"]["output"];
  icon?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  slug: Scalars["String"]["output"];
  status: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
};

export type WorkflowEngineBinding = {
  __typename?: "WorkflowEngineBinding";
  bindingStatus: WorkflowBindingStatus;
  bindingType: WorkflowBindingType;
  capabilityFlags: Scalars["AWSJSON"]["output"];
  connectionRef: Scalars["AWSJSON"]["output"];
  createdAt: Scalars["AWSDateTime"]["output"];
  externalVersionId?: Maybe<Scalars["String"]["output"]>;
  externalWorkflowId?: Maybe<Scalars["String"]["output"]>;
  externalWorkflowName?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  managedApplicationId?: Maybe<Scalars["ID"]["output"]>;
  pluginInstallId?: Maybe<Scalars["ID"]["output"]>;
  readinessReasons: Scalars["AWSJSON"]["output"];
  readinessState: WorkflowReadinessState;
  routine?: Maybe<Routine>;
  routineAslVersion?: Maybe<RoutineAslVersion>;
  routineAslVersionId?: Maybe<Scalars["ID"]["output"]>;
  routineId?: Maybe<Scalars["ID"]["output"]>;
  tenantId: Scalars["ID"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
  workflow?: Maybe<Workflow>;
  workflowId: Scalars["ID"]["output"];
  workflowVersion?: Maybe<WorkflowVersion>;
  workflowVersionId?: Maybe<Scalars["ID"]["output"]>;
};

export enum WorkflowEventProvenance {
  AppCallback = "app_callback",
  EngineHistory = "engine_history",
  NativeEvent = "native_event",
  OperatorDecision = "operator_decision",
  OutputInferred = "output_inferred",
}

export type WorkflowEvidence = {
  __typename?: "WorkflowEvidence";
  createdAt: Scalars["AWSDateTime"]["output"];
  evidenceType: Scalars["String"]["output"];
  id: Scalars["ID"]["output"];
  redactionState: WorkflowEvidenceRedactionState;
  retentionExpiresAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  sensitivity?: Maybe<Scalars["String"]["output"]>;
  sourceId?: Maybe<Scalars["String"]["output"]>;
  sourceSystem: Scalars["String"]["output"];
  summary: Scalars["AWSJSON"]["output"];
  tenantId: Scalars["ID"]["output"];
  uri?: Maybe<Scalars["String"]["output"]>;
  workflow?: Maybe<Workflow>;
  workflowId: Scalars["ID"]["output"];
  workflowRun?: Maybe<WorkflowRun>;
  workflowRunId?: Maybe<Scalars["ID"]["output"]>;
};

export enum WorkflowEvidenceRedactionState {
  Offloaded = "offloaded",
  RawAllowed = "raw_allowed",
  Redacted = "redacted",
  SummaryOnly = "summary_only",
}

export enum WorkflowLifecycleStatus {
  Active = "active",
  Archived = "archived",
  Deprecated = "deprecated",
  Draft = "draft",
}

export enum WorkflowReadinessState {
  BlockedNotReady = "blocked_not_ready",
  Disabled = "disabled",
  Ready = "ready",
  Unknown = "unknown",
}

export type WorkflowRun = {
  __typename?: "WorkflowRun";
  actorId?: Maybe<Scalars["ID"]["output"]>;
  actorType?: Maybe<Scalars["String"]["output"]>;
  backendExecutionId?: Maybe<Scalars["String"]["output"]>;
  backendExecutionRef: Scalars["AWSJSON"]["output"];
  capabilitySnapshot: Scalars["AWSJSON"]["output"];
  correlationId?: Maybe<Scalars["String"]["output"]>;
  createdAt: Scalars["AWSDateTime"]["output"];
  engineBinding?: Maybe<WorkflowEngineBinding>;
  engineBindingId?: Maybe<Scalars["ID"]["output"]>;
  errorCode?: Maybe<Scalars["String"]["output"]>;
  errorMessage?: Maybe<Scalars["String"]["output"]>;
  events: Array<WorkflowRunEvent>;
  evidence: Array<WorkflowEvidence>;
  finishedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  id: Scalars["ID"]["output"];
  idempotencyKey?: Maybe<Scalars["String"]["output"]>;
  inputSummary?: Maybe<Scalars["AWSJSON"]["output"]>;
  lastEventAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  outputSummary?: Maybe<Scalars["AWSJSON"]["output"]>;
  readinessSnapshot: Scalars["AWSJSON"]["output"];
  startedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  status: WorkflowRunStatus;
  tenantId: Scalars["ID"]["output"];
  totalCostUsdCents?: Maybe<Scalars["Int"]["output"]>;
  triggerFamily: WorkflowTriggerFamily;
  triggerSource?: Maybe<Scalars["String"]["output"]>;
  updatedAt: Scalars["AWSDateTime"]["output"];
  workflow?: Maybe<Workflow>;
  workflowId: Scalars["ID"]["output"];
  workflowVersion?: Maybe<WorkflowVersion>;
  workflowVersionId?: Maybe<Scalars["ID"]["output"]>;
};

export type WorkflowRunEvent = {
  __typename?: "WorkflowRunEvent";
  createdAt: Scalars["AWSDateTime"]["output"];
  eventStatus?: Maybe<Scalars["String"]["output"]>;
  eventType: Scalars["String"]["output"];
  evidenceRef: Scalars["AWSJSON"]["output"];
  id: Scalars["ID"]["output"];
  message?: Maybe<Scalars["String"]["output"]>;
  occurredAt: Scalars["AWSDateTime"]["output"];
  payloadSummary: Scalars["AWSJSON"]["output"];
  provenance: WorkflowEventProvenance;
  tenantId: Scalars["ID"]["output"];
  workflowRun?: Maybe<WorkflowRun>;
  workflowRunId: Scalars["ID"]["output"];
};

export enum WorkflowRunStatus {
  BlockedNotReady = "blocked_not_ready",
  Canceled = "canceled",
  Failed = "failed",
  Queued = "queued",
  Running = "running",
  Succeeded = "succeeded",
  TimedOut = "timed_out",
}

export type WorkflowTemplateBinding = {
  __typename?: "WorkflowTemplateBinding";
  agentId: Scalars["ID"]["output"];
  catalogSlug: Scalars["String"]["output"];
  enabled: Scalars["Boolean"]["output"];
  id: Scalars["ID"]["output"];
  status: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
  updatedAt: Scalars["AWSDateTime"]["output"];
};

export type WorkflowTemplateCatalogItem = {
  __typename?: "WorkflowTemplateCatalogItem";
  category?: Maybe<Scalars["String"]["output"]>;
  defaultSchedule?: Maybe<Scalars["String"]["output"]>;
  description?: Maybe<Scalars["String"]["output"]>;
  displayName: Scalars["String"]["output"];
  enabled: Scalars["Boolean"]["output"];
  icon?: Maybe<Scalars["String"]["output"]>;
  id: Scalars["ID"]["output"];
  slug: Scalars["String"]["output"];
  status: Scalars["String"]["output"];
  tenantId: Scalars["ID"]["output"];
};

export type WorkflowTrigger = {
  __typename?: "WorkflowTrigger";
  actorContract: Scalars["AWSJSON"]["output"];
  createdAt: Scalars["AWSDateTime"]["output"];
  enabled: Scalars["Boolean"]["output"];
  id: Scalars["ID"]["output"];
  idempotencyRequired: Scalars["Boolean"]["output"];
  readinessReasons: Scalars["AWSJSON"]["output"];
  readinessState: WorkflowReadinessState;
  sourceSystem?: Maybe<Scalars["String"]["output"]>;
  tenantId: Scalars["ID"]["output"];
  triggerConfig: Scalars["AWSJSON"]["output"];
  triggerFamily: WorkflowTriggerFamily;
  updatedAt: Scalars["AWSDateTime"]["output"];
  workflow?: Maybe<Workflow>;
  workflowId: Scalars["ID"]["output"];
  workflowVersion?: Maybe<WorkflowVersion>;
  workflowVersionId?: Maybe<Scalars["ID"]["output"]>;
};

export enum WorkflowTriggerFamily {
  Agent = "agent",
  Api = "api",
  ChildWorkflow = "child_workflow",
  Crm = "crm",
  Manual = "manual",
  N8n = "n8n",
  Schedule = "schedule",
  Webhook = "webhook",
}

export type WorkflowVersion = {
  __typename?: "WorkflowVersion";
  capabilitySnapshot: Scalars["AWSJSON"]["output"];
  createdAt: Scalars["AWSDateTime"]["output"];
  createdByActorId?: Maybe<Scalars["ID"]["output"]>;
  createdByActorType?: Maybe<Scalars["String"]["output"]>;
  definitionSnapshot: Scalars["AWSJSON"]["output"];
  id: Scalars["ID"]["output"];
  publishedAt?: Maybe<Scalars["AWSDateTime"]["output"]>;
  routineAslVersion?: Maybe<RoutineAslVersion>;
  routineAslVersionId?: Maybe<Scalars["ID"]["output"]>;
  sourceKind: Scalars["String"]["output"];
  sourceMetadata: Scalars["AWSJSON"]["output"];
  tenantId: Scalars["ID"]["output"];
  versionNumber: Scalars["Int"]["output"];
  versionStatus: WorkflowVersionStatus;
  workflow?: Maybe<Workflow>;
  workflowId: Scalars["ID"]["output"];
};

export enum WorkflowVersionStatus {
  Active = "active",
  Archived = "archived",
  Draft = "draft",
  Superseded = "superseded",
}

export enum WorkflowVisibility {
  AgentPrivate = "agent_private",
  TenantShared = "tenant_shared",
}

export type WorkspaceAccessRevokedEvent = {
  __typename?: "WorkspaceAccessRevokedEvent";
  revokedAt: Scalars["AWSDateTime"]["output"];
  spaceId: Scalars["ID"]["output"];
  tenantId: Scalars["ID"]["output"];
  userId: Scalars["ID"]["output"];
};

export enum WorkspaceReviewKind {
  Paired = "PAIRED",
  System = "SYSTEM",
  Unrouted = "UNROUTED",
}

export type TenantUsersForFormPickerQueryVariables = Exact<{
  tenantId: Scalars["ID"]["input"];
}>;

export type TenantUsersForFormPickerQuery = {
  __typename?: "Query";
  tenantMembers: Array<{
    __typename?: "TenantMember";
    principalType: string;
    principalId: string;
    user?: {
      __typename?: "User";
      id: string;
      email: string;
      name?: string | null;
    } | null;
  }>;
};

export type AgentsQueryVariables = Exact<{
  tenantId: Scalars["ID"]["input"];
}>;

export type AgentsQuery = {
  __typename?: "Query";
  agent: {
    __typename?: "Agent";
    id: string;
    tenantId: string;
    name: string;
    slug?: string | null;
    role?: string | null;
    type: AgentType;
    status: AgentStatus;
    runtime: AgentRuntime;
    systemPrompt?: string | null;
    adapterType?: string | null;
    adapterConfig?: any | null;
    runtimeConfig?: any | null;
    lastHeartbeatAt?: any | null;
    avatarUrl?: string | null;
    reportsToId?: string | null;
    humanPairId?: string | null;
    version: number;
    createdAt: any;
    updatedAt: any;
  };
};

export type AgentQueryVariables = Exact<{
  tenantId: Scalars["ID"]["input"];
}>;

export type AgentQuery = {
  __typename?: "Query";
  agent: {
    __typename?: "Agent";
    id: string;
    tenantId: string;
    name: string;
    slug?: string | null;
    role?: string | null;
    type: AgentType;
    status: AgentStatus;
    systemPrompt?: string | null;
    adapterType?: string | null;
    adapterConfig?: any | null;
    runtimeConfig?: any | null;
    lastHeartbeatAt?: any | null;
    avatarUrl?: string | null;
    reportsToId?: string | null;
    humanPairId?: string | null;
    version: number;
    createdAt: any;
    updatedAt: any;
    capabilities: Array<{
      __typename?: "AgentCapability";
      id: string;
      capability: string;
      config?: any | null;
      enabled: boolean;
    }>;
    skills: Array<{
      __typename?: "AgentSkill";
      id: string;
      skillId: string;
      config?: any | null;
      permissions?: any | null;
      rateLimitRpm?: number | null;
      enabled: boolean;
    }>;
    budgetPolicy?: {
      __typename?: "AgentBudgetPolicy";
      id: string;
      period: string;
      limitUsd: number;
      actionOnExceed: string;
    } | null;
  };
};

export type CreateAgentMutationVariables = Exact<{
  tenantId: Scalars["ID"]["input"];
  input: UpdateTenantAgentInput;
}>;

export type CreateAgentMutation = {
  __typename?: "Mutation";
  updateTenantAgent: {
    __typename?: "Agent";
    id: string;
    tenantId: string;
    name: string;
    type: AgentType;
    status: AgentStatus;
    createdAt: any;
  };
};

export type UpdateAgentMutationVariables = Exact<{
  tenantId: Scalars["ID"]["input"];
  input: UpdateTenantAgentInput;
}>;

export type UpdateAgentMutation = {
  __typename?: "Mutation";
  updateTenantAgent: {
    __typename?: "Agent";
    id: string;
    name: string;
    role?: string | null;
    type: AgentType;
    status: AgentStatus;
    systemPrompt?: string | null;
    updatedAt: any;
  };
};

export type DeleteAgentMutationVariables = Exact<{
  tenantId: Scalars["ID"]["input"];
}>;

export type DeleteAgentMutation = {
  __typename?: "Mutation";
  updateTenantAgent: { __typename?: "Agent"; id: string };
};

export type UpdateAgentStatusMutationVariables = Exact<{
  tenantId: Scalars["ID"]["input"];
}>;

export type UpdateAgentStatusMutation = {
  __typename?: "Mutation";
  updateTenantAgent: {
    __typename?: "Agent";
    id: string;
    status: AgentStatus;
    lastHeartbeatAt?: any | null;
    updatedAt: any;
  };
};

export type SetAgentCapabilitiesMutationVariables = Exact<{
  tenantId: Scalars["ID"]["input"];
}>;

export type SetAgentCapabilitiesMutation = {
  __typename?: "Mutation";
  updateTenantAgent: {
    __typename?: "Agent";
    id: string;
    capabilities: Array<{
      __typename?: "AgentCapability";
      id: string;
      capability: string;
      config?: any | null;
      enabled: boolean;
    }>;
  };
};

export type SetAgentSkillsMutationVariables = Exact<{
  tenantId: Scalars["ID"]["input"];
}>;

export type SetAgentSkillsMutation = {
  __typename?: "Mutation";
  updateTenantAgent: {
    __typename?: "Agent";
    id: string;
    skills: Array<{
      __typename?: "AgentSkill";
      id: string;
      skillId: string;
      config?: any | null;
      enabled: boolean;
    }>;
  };
};

export type SetAgentBudgetPolicyMutationVariables = Exact<{
  tenantId: Scalars["ID"]["input"];
  input: UpdateTenantAgentInput;
}>;

export type SetAgentBudgetPolicyMutation = {
  __typename?: "Mutation";
  updateTenantAgent: {
    __typename?: "Agent";
    id: string;
    budgetMonthlyCents?: number | null;
  };
};

export type SendMessageMutationVariables = Exact<{
  input: SendMessageInput;
}>;

export type SendMessageMutation = {
  __typename?: "Mutation";
  sendMessage: {
    __typename?: "Message";
    id: string;
    threadId: string;
    tenantId: string;
    role: MessageRole;
    content?: string | null;
    senderType?: string | null;
    senderId?: string | null;
    ownerType: string;
    ownerId?: string | null;
    createdAt: any;
  };
};

export type DeleteMessageMutationVariables = Exact<{
  id: Scalars["ID"]["input"];
}>;

export type DeleteMessageMutation = {
  __typename?: "Mutation";
  deleteMessage: boolean;
};

export type MySlackLinksQueryVariables = Exact<{
  tenantId: Scalars["ID"]["input"];
}>;

export type MySlackLinksQuery = {
  __typename?: "Query";
  mySlackLinks: Array<{
    __typename?: "SlackUserLink";
    id: string;
    tenantId: string;
    slackTeamId: string;
    slackTeamName?: string | null;
    slackUserId: string;
    slackUserName?: string | null;
    slackUserEmail?: string | null;
    userId: string;
    status: string;
    linkedAt: any;
    unlinkedAt?: any | null;
  }>;
};

export type UnlinkSlackIdentityMutationVariables = Exact<{
  id: Scalars["ID"]["input"];
}>;

export type UnlinkSlackIdentityMutation = {
  __typename?: "Mutation";
  unlinkSlackIdentity: {
    __typename?: "SlackUserLink";
    id: string;
    status: string;
    unlinkedAt?: any | null;
  };
};

export type MessagesQueryVariables = Exact<{
  threadId: Scalars["ID"]["input"];
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  cursor?: InputMaybe<Scalars["String"]["input"]>;
}>;

export type MessagesQuery = {
  __typename?: "Query";
  messages: {
    __typename?: "MessageConnection";
    edges: Array<{
      __typename?: "MessageEdge";
      cursor: string;
      node: {
        __typename?: "Message";
        id: string;
        threadId: string;
        tenantId: string;
        role: MessageRole;
        content?: string | null;
        senderType?: string | null;
        senderId?: string | null;
        toolCalls?: any | null;
        toolResults?: any | null;
        parts?: any | null;
        metadata?: any | null;
        tokenCount?: number | null;
        createdAt: any;
        sender?: {
          __typename?: "MessageSender";
          type: string;
          id?: string | null;
          displayName: string;
          avatarUrl?: string | null;
        } | null;
        durableArtifact?: {
          __typename?: "Artifact";
          id: string;
          title: string;
          type: ArtifactType;
          status: ArtifactStatus;
          content?: string | null;
          summary?: string | null;
        } | null;
      };
    }>;
    pageInfo: {
      __typename?: "PageInfo";
      hasNextPage: boolean;
      endCursor?: string | null;
    };
  };
};

export type RoutinesQueryVariables = Exact<{
  tenantId: Scalars["ID"]["input"];
  agentId?: InputMaybe<Scalars["ID"]["input"]>;
  status?: InputMaybe<RoutineStatus>;
}>;

export type RoutinesQuery = {
  __typename?: "Query";
  routines: Array<{
    __typename?: "Routine";
    id: string;
    tenantId: string;
    agentId?: string | null;
    name: string;
    description?: string | null;
    type: string;
    status: string;
    schedule?: string | null;
    config?: any | null;
    lastRunAt?: any | null;
    nextRunAt?: any | null;
    createdAt: any;
    updatedAt: any;
  }>;
};

export type RoutineQueryVariables = Exact<{
  id: Scalars["ID"]["input"];
}>;

export type RoutineQuery = {
  __typename?: "Query";
  routine?: {
    __typename?: "Routine";
    id: string;
    tenantId: string;
    agentId?: string | null;
    name: string;
    description?: string | null;
    type: string;
    status: string;
    schedule?: string | null;
    config?: any | null;
    engine: string;
    currentVersion?: number | null;
    documentationMd?: string | null;
    lastRunAt?: any | null;
    nextRunAt?: any | null;
    createdAt: any;
    updatedAt: any;
    triggers: Array<{
      __typename?: "RoutineTrigger";
      id: string;
      triggerType: string;
      config?: any | null;
      enabled: boolean;
    }>;
  } | null;
};

export type MobileRoutineExecutionsListQueryVariables = Exact<{
  routineId: Scalars["ID"]["input"];
  status?: InputMaybe<RoutineExecutionStatus>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  cursor?: InputMaybe<Scalars["String"]["input"]>;
}>;

export type MobileRoutineExecutionsListQuery = {
  __typename?: "Query";
  routineExecutions: Array<{
    __typename?: "RoutineExecution";
    id: string;
    status: string;
    triggerSource: string;
    startedAt?: any | null;
    finishedAt?: any | null;
    totalLlmCostUsdCents?: number | null;
    errorCode?: string | null;
    createdAt: any;
  }>;
};

export type MobileRoutineExecutionDetailQueryVariables = Exact<{
  id: Scalars["ID"]["input"];
}>;

export type MobileRoutineExecutionDetailQuery = {
  __typename?: "Query";
  routineExecution?: {
    __typename?: "RoutineExecution";
    id: string;
    tenantId: string;
    routineId: string;
    sfnExecutionArn: string;
    triggerSource: string;
    inputJson?: any | null;
    outputJson?: any | null;
    status: string;
    startedAt?: any | null;
    finishedAt?: any | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    totalLlmCostUsdCents?: number | null;
    createdAt: any;
    stepEvents: Array<{
      __typename?: "RoutineStepEvent";
      id: string;
      nodeId: string;
      recipeType: string;
      status: string;
      startedAt?: any | null;
      finishedAt?: any | null;
      inputJson?: any | null;
      outputJson?: any | null;
      errorJson?: any | null;
      llmCostUsdCents?: number | null;
      retryCount: number;
      stdoutS3Uri?: string | null;
      stderrS3Uri?: string | null;
      stdoutPreview?: string | null;
      truncated: boolean;
      createdAt: any;
    }>;
    routine?: {
      __typename?: "Routine";
      id: string;
      name: string;
      description?: string | null;
      currentVersion?: number | null;
      documentationMd?: string | null;
    } | null;
    aslVersion?: {
      __typename?: "RoutineAslVersion";
      id: string;
      versionNumber: number;
      markdownSummary: string;
      stepManifestJson: any;
    } | null;
  } | null;
};

export type CreateRoutineMutationVariables = Exact<{
  input: CreateRoutineInput;
}>;

export type CreateRoutineMutation = {
  __typename?: "Mutation";
  createRoutine: {
    __typename?: "Routine";
    id: string;
    tenantId: string;
    name: string;
    type: string;
    status: string;
    createdAt: any;
  };
};

export type UpdateRoutineMutationVariables = Exact<{
  id: Scalars["ID"]["input"];
  input: UpdateRoutineInput;
}>;

export type UpdateRoutineMutation = {
  __typename?: "Mutation";
  updateRoutine: {
    __typename?: "Routine";
    id: string;
    name: string;
    description?: string | null;
    status: string;
    schedule?: string | null;
    updatedAt: any;
  };
};

export type DeleteRoutineMutationVariables = Exact<{
  id: Scalars["ID"]["input"];
}>;

export type DeleteRoutineMutation = {
  __typename?: "Mutation";
  deleteRoutine: boolean;
};

export type TriggerRoutineRunMutationVariables = Exact<{
  routineId: Scalars["ID"]["input"];
  input?: InputMaybe<Scalars["AWSJSON"]["input"]>;
}>;

export type TriggerRoutineRunMutation = {
  __typename?: "Mutation";
  triggerRoutineRun: {
    __typename?: "RoutineExecution";
    id: string;
    routineId: string;
    status: string;
    sfnExecutionArn: string;
    startedAt?: any | null;
    createdAt: any;
  };
};

export type SetRoutineTriggerMutationVariables = Exact<{
  routineId: Scalars["ID"]["input"];
  input: RoutineTriggerInput;
}>;

export type SetRoutineTriggerMutation = {
  __typename?: "Mutation";
  setRoutineTrigger: {
    __typename?: "RoutineTrigger";
    id: string;
    triggerType: string;
    config?: any | null;
    enabled: boolean;
  };
};

export type DeleteRoutineTriggerMutationVariables = Exact<{
  id: Scalars["ID"]["input"];
}>;

export type DeleteRoutineTriggerMutation = {
  __typename?: "Mutation";
  deleteRoutineTrigger: boolean;
};

export type ThreadTurnsQueryVariables = Exact<{
  tenantId: Scalars["ID"]["input"];
  agentId?: InputMaybe<Scalars["ID"]["input"]>;
  status?: InputMaybe<Scalars["String"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
}>;

export type ThreadTurnsQuery = {
  __typename?: "Query";
  threadTurns: Array<{
    __typename?: "ThreadTurn";
    id: string;
    tenantId: string;
    triggerId?: string | null;
    agentId?: string | null;
    routineId?: string | null;
    invocationSource: string;
    triggerDetail?: string | null;
    status: string;
    startedAt?: any | null;
    finishedAt?: any | null;
    error?: string | null;
    errorCode?: string | null;
    usageJson?: any | null;
    resultJson?: any | null;
    createdAt: any;
  }>;
};

export type ThreadTurnDetailQueryVariables = Exact<{
  id: Scalars["ID"]["input"];
}>;

export type ThreadTurnDetailQuery = {
  __typename?: "Query";
  threadTurn?: {
    __typename?: "ThreadTurn";
    id: string;
    tenantId: string;
    triggerId?: string | null;
    agentId?: string | null;
    routineId?: string | null;
    invocationSource: string;
    triggerDetail?: string | null;
    wakeupRequestId?: string | null;
    status: string;
    startedAt?: any | null;
    finishedAt?: any | null;
    error?: string | null;
    errorCode?: string | null;
    usageJson?: any | null;
    resultJson?: any | null;
    sessionIdBefore?: string | null;
    sessionIdAfter?: string | null;
    externalRunId?: string | null;
    contextSnapshot?: any | null;
    createdAt: any;
  } | null;
};

export type ThreadTurnEventsQueryVariables = Exact<{
  runId: Scalars["ID"]["input"];
  afterSeq?: InputMaybe<Scalars["Int"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
}>;

export type ThreadTurnEventsQuery = {
  __typename?: "Query";
  threadTurnEvents: Array<{
    __typename?: "ThreadTurnEvent";
    id: string;
    runId: string;
    agentId?: string | null;
    seq: number;
    eventType: string;
    stream?: string | null;
    level?: string | null;
    color?: string | null;
    message?: string | null;
    payload?: any | null;
    createdAt: any;
  }>;
};

export type TurnInvocationLogsQueryVariables = Exact<{
  tenantId: Scalars["ID"]["input"];
  turnId: Scalars["ID"]["input"];
}>;

export type TurnInvocationLogsQuery = {
  __typename?: "Query";
  turnInvocationLogs: Array<{
    __typename?: "ModelInvocation";
    requestId: string;
    modelId: string;
    timestamp: any;
    inputTokenCount: number;
    outputTokenCount: number;
    cacheReadTokenCount: number;
    inputPreview?: string | null;
    outputPreview?: string | null;
    toolCount?: number | null;
    costUsd?: number | null;
    toolUses?: Array<string> | null;
    hasToolResult?: boolean | null;
    branch?: string | null;
  }>;
};

export type CancelThreadTurnMutationVariables = Exact<{
  id: Scalars["ID"]["input"];
}>;

export type CancelThreadTurnMutation = {
  __typename?: "Mutation";
  cancelThreadTurn: {
    __typename?: "ThreadTurn";
    id: string;
    status: string;
    finishedAt?: any | null;
  };
};

export type CreateWakeupRequestMutationVariables = Exact<{
  input: CreateWakeupRequestInput;
}>;

export type CreateWakeupRequestMutation = {
  __typename?: "Mutation";
  createWakeupRequest: {
    __typename?: "AgentWakeupRequest";
    id: string;
    tenantId: string;
    agentId: string;
    source: string;
    status: string;
    createdAt: any;
  };
};

export type ScheduledJobsQueryVariables = Exact<{
  tenantId: Scalars["ID"]["input"];
  agentId?: InputMaybe<Scalars["ID"]["input"]>;
  routineId?: InputMaybe<Scalars["ID"]["input"]>;
  triggerType?: InputMaybe<Scalars["String"]["input"]>;
  enabled?: InputMaybe<Scalars["Boolean"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
}>;

export type ScheduledJobsQuery = {
  __typename?: "Query";
  scheduledJobs: Array<{
    __typename?: "ScheduledJob";
    id: string;
    tenantId: string;
    triggerType: string;
    agentId?: string | null;
    routineId?: string | null;
    name: string;
    description?: string | null;
    scheduleType?: string | null;
    scheduleExpression?: string | null;
    timezone: string;
    enabled: boolean;
    lastRunAt?: any | null;
    nextRunAt?: any | null;
    createdAt: any;
    updatedAt: any;
  }>;
};

export type TenantQueryVariables = Exact<{
  id: Scalars["ID"]["input"];
}>;

export type TenantQuery = {
  __typename?: "Query";
  tenant?: {
    __typename?: "Tenant";
    id: string;
    name: string;
    slug: string;
    plan: string;
    issuePrefix?: string | null;
    issueCounter: number;
    createdAt: any;
    updatedAt: any;
  } | null;
};

export type TenantBySlugQueryVariables = Exact<{
  slug: Scalars["String"]["input"];
}>;

export type TenantBySlugQuery = {
  __typename?: "Query";
  tenantBySlug?: {
    __typename?: "Tenant";
    id: string;
    name: string;
    slug: string;
    plan: string;
    issuePrefix?: string | null;
    issueCounter: number;
    createdAt: any;
    updatedAt: any;
  } | null;
};

export type TenantMembersQueryVariables = Exact<{
  tenantId: Scalars["ID"]["input"];
}>;

export type TenantMembersQuery = {
  __typename?: "Query";
  tenantMembers: Array<{
    __typename?: "TenantMember";
    id: string;
    tenantId: string;
    principalType: string;
    principalId: string;
    role: string;
    status: string;
    createdAt: any;
    updatedAt: any;
  }>;
};

export type UpdateTenantMutationVariables = Exact<{
  id: Scalars["ID"]["input"];
  input: UpdateTenantInput;
}>;

export type UpdateTenantMutation = {
  __typename?: "Mutation";
  updateTenant: {
    __typename?: "Tenant";
    id: string;
    name: string;
    plan: string;
    issuePrefix?: string | null;
    updatedAt: any;
  };
};

export type UpdateTenantSettingsMutationVariables = Exact<{
  tenantId: Scalars["ID"]["input"];
  input: UpdateTenantSettingsInput;
}>;

export type UpdateTenantSettingsMutation = {
  __typename?: "Mutation";
  updateTenantSettings: {
    __typename?: "TenantSettings";
    id: string;
    defaultModel?: string | null;
    budgetMonthlyCents?: number | null;
    autoCloseThreadMinutes?: number | null;
    maxAgents?: number | null;
    features?: any | null;
    updatedAt: any;
  };
};

export type AddTenantMemberMutationVariables = Exact<{
  tenantId: Scalars["ID"]["input"];
  input: AddTenantMemberInput;
}>;

export type AddTenantMemberMutation = {
  __typename?: "Mutation";
  addTenantMember: {
    __typename?: "TenantMember";
    id: string;
    principalType: string;
    principalId: string;
    role: string;
    status: string;
  };
};

export type RemoveTenantMemberMutationVariables = Exact<{
  id: Scalars["ID"]["input"];
}>;

export type RemoveTenantMemberMutation = {
  __typename?: "Mutation";
  removeTenantMember: boolean;
};

export type MeQueryVariables = Exact<{ [key: string]: never }>;

export type MeQuery = {
  __typename?: "Query";
  me?: {
    __typename?: "User";
    id: string;
    tenantId: string;
    email: string;
    name?: string | null;
    image?: string | null;
    phone?: string | null;
    createdAt: any;
    updatedAt: any;
  } | null;
};

export type UserQueryVariables = Exact<{
  id: Scalars["ID"]["input"];
}>;

export type UserQuery = {
  __typename?: "Query";
  user?: {
    __typename?: "User";
    id: string;
    tenantId: string;
    email: string;
    name?: string | null;
    image?: string | null;
    phone?: string | null;
    createdAt: any;
    updatedAt: any;
  } | null;
};

export type UpdateUserMutationVariables = Exact<{
  id: Scalars["ID"]["input"];
  input: UpdateUserInput;
}>;

export type UpdateUserMutation = {
  __typename?: "Mutation";
  updateUser: {
    __typename?: "User";
    id: string;
    name?: string | null;
    image?: string | null;
    phone?: string | null;
    updatedAt: any;
  };
};

export type UpdateUserProfileMutationVariables = Exact<{
  userId: Scalars["ID"]["input"];
  input: UpdateUserProfileInput;
}>;

export type UpdateUserProfileMutation = {
  __typename?: "Mutation";
  updateUserProfile: {
    __typename?: "UserProfile";
    id: string;
    displayName?: string | null;
    theme?: string | null;
    notificationPreferences?: any | null;
    updatedAt: any;
  };
};

export type ThreadsQueryVariables = Exact<{
  tenantId: Scalars["ID"]["input"];
  channel?: InputMaybe<ThreadChannel>;
  agentId?: InputMaybe<Scalars["ID"]["input"]>;
  assigneeId?: InputMaybe<Scalars["ID"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  cursor?: InputMaybe<Scalars["String"]["input"]>;
}>;

export type ThreadsQuery = {
  __typename?: "Query";
  threads: Array<{
    __typename?: "Thread";
    id: string;
    tenantId: string;
    agentId?: string | null;
    spaceId: string;
    number: number;
    identifier?: string | null;
    title: string;
    status: ThreadStatus;
    lifecycleStatus?: ThreadLifecycleStatus | null;
    channel: ThreadChannel;
    assigneeType?: string | null;
    assigneeId?: string | null;
    reporterId?: string | null;
    labels?: any | null;
    metadata?: any | null;
    dueAt?: any | null;
    closedAt?: any | null;
    archivedAt?: any | null;
    lastActivityAt?: any | null;
    lastTurnCompletedAt?: any | null;
    lastReadAt?: any | null;
    lastResponsePreview?: string | null;
    createdAt: any;
    updatedAt: any;
    space?: {
      __typename?: "Space";
      id: string;
      name: string;
      slug: string;
      icon?: string | null;
    } | null;
    assignee?: { __typename?: "User"; id: string; name?: string | null } | null;
  }>;
};

export type SpacesQueryVariables = Exact<{
  tenantId: Scalars["ID"]["input"];
}>;

export type SpacesQuery = {
  __typename?: "Query";
  spaces: Array<{
    __typename?: "Space";
    id: string;
    tenantId: string;
    name: string;
    slug: string;
    icon?: string | null;
    status: SpaceStatus;
    updatedAt: any;
  }>;
};

export type NewThreadMentionTargetsQueryVariables = Exact<{
  tenantId: Scalars["ID"]["input"];
}>;

export type NewThreadMentionTargetsQuery = {
  __typename?: "Query";
  tenantMentionTargets: Array<{
    __typename?: "ThreadMentionTarget";
    id: string;
    targetType: MessageMentionTargetType;
    targetId: string;
    displayName: string;
    aliases: Array<string>;
    isDefaultAgent: boolean;
    avatarUrl?: string | null;
    role?: string | null;
  }>;
};

export type ThreadMentionTargetsQueryVariables = Exact<{
  threadId: Scalars["ID"]["input"];
}>;

export type ThreadMentionTargetsQuery = {
  __typename?: "Query";
  threadMentionTargets: Array<{
    __typename?: "ThreadMentionTarget";
    id: string;
    targetType: MessageMentionTargetType;
    targetId: string;
    displayName: string;
    aliases: Array<string>;
    isDefaultAgent: boolean;
    avatarUrl?: string | null;
    role?: string | null;
  }>;
};

export type ThreadQueryVariables = Exact<{
  id: Scalars["ID"]["input"];
}>;

export type ThreadQuery = {
  __typename?: "Query";
  thread?: {
    __typename?: "Thread";
    id: string;
    tenantId: string;
    agentId?: string | null;
    spaceId: string;
    number: number;
    identifier?: string | null;
    title: string;
    status: ThreadStatus;
    lifecycleStatus?: ThreadLifecycleStatus | null;
    channel: ThreadChannel;
    assigneeType?: string | null;
    assigneeId?: string | null;
    reporterId?: string | null;
    labels?: any | null;
    metadata?: any | null;
    dueAt?: any | null;
    closedAt?: any | null;
    createdAt: any;
    updatedAt: any;
    space?: {
      __typename?: "Space";
      id: string;
      name: string;
      slug: string;
    } | null;
    messages: {
      __typename?: "MessageConnection";
      edges: Array<{
        __typename?: "MessageEdge";
        node: {
          __typename?: "Message";
          id: string;
          role: MessageRole;
          content?: string | null;
          senderType?: string | null;
          senderId?: string | null;
          createdAt: any;
          sender?: {
            __typename?: "MessageSender";
            type: string;
            id?: string | null;
            displayName: string;
            avatarUrl?: string | null;
          } | null;
          durableArtifact?: {
            __typename?: "Artifact";
            id: string;
            title: string;
            type: ArtifactType;
            status: ArtifactStatus;
          } | null;
        };
      }>;
    };
    attachments: Array<{
      __typename?: "ThreadAttachment";
      id: string;
      name?: string | null;
      mimeType?: string | null;
      sizeBytes?: number | null;
      createdAt: any;
    }>;
  } | null;
};

export type CreateThreadMutationVariables = Exact<{
  input: CreateThreadInput;
}>;

export type CreateThreadMutation = {
  __typename?: "Mutation";
  createThread: {
    __typename?: "Thread";
    id: string;
    number: number;
    title: string;
    status: ThreadStatus;
    agentId?: string | null;
    createdAt: any;
  };
};

export type UpdateThreadMutationVariables = Exact<{
  id: Scalars["ID"]["input"];
  input: UpdateThreadInput;
}>;

export type UpdateThreadMutation = {
  __typename?: "Mutation";
  updateThread: {
    __typename?: "Thread";
    id: string;
    title: string;
    status: ThreadStatus;
    updatedAt: any;
  };
};

export type OnAgentStatusChangedSubscriptionVariables = Exact<{
  tenantId: Scalars["ID"]["input"];
}>;

export type OnAgentStatusChangedSubscription = {
  __typename?: "Subscription";
  onAgentStatusChanged?: {
    __typename?: "AgentStatusEvent";
    agentId: string;
    tenantId: string;
    status: string;
    name: string;
    updatedAt: any;
  } | null;
};

export type OnNewMessageSubscriptionVariables = Exact<{
  threadId: Scalars["ID"]["input"];
}>;

export type OnNewMessageSubscription = {
  __typename?: "Subscription";
  onNewMessage?: {
    __typename?: "NewMessageEvent";
    messageId: string;
    threadId: string;
    tenantId: string;
    role: string;
    content?: string | null;
    senderType?: string | null;
    senderId?: string | null;
    createdAt: any;
  } | null;
};

export type OnHeartbeatActivitySubscriptionVariables = Exact<{
  tenantId: Scalars["ID"]["input"];
}>;

export type OnHeartbeatActivitySubscription = {
  __typename?: "Subscription";
  onHeartbeatActivity?: {
    __typename?: "HeartbeatActivityEvent";
    heartbeatId: string;
    tenantId: string;
    status: string;
    message?: string | null;
    createdAt: any;
  } | null;
};

export type OnThreadUpdatedSubscriptionVariables = Exact<{
  tenantId: Scalars["ID"]["input"];
}>;

export type OnThreadUpdatedSubscription = {
  __typename?: "Subscription";
  onThreadUpdated?: {
    __typename?: "ThreadUpdateEvent";
    threadId: string;
    tenantId: string;
    status: string;
    title: string;
    updatedAt: any;
  } | null;
};

export type OnThreadTurnUpdatedSubscriptionVariables = Exact<{
  tenantId: Scalars["ID"]["input"];
}>;

export type OnThreadTurnUpdatedSubscription = {
  __typename?: "Subscription";
  onThreadTurnUpdated?: {
    __typename?: "ThreadTurnUpdateEvent";
    runId: string;
    triggerId?: string | null;
    threadId?: string | null;
    tenantId: string;
    status: string;
    triggerName?: string | null;
    updatedAt: any;
  } | null;
};

export type OnInboxItemStatusChangedSubscriptionVariables = Exact<{
  tenantId: Scalars["ID"]["input"];
}>;

export type OnInboxItemStatusChangedSubscription = {
  __typename?: "Subscription";
  onInboxItemStatusChanged?: {
    __typename?: "InboxItemStatusEvent";
    inboxItemId: string;
    tenantId: string;
    status: string;
    title?: string | null;
    updatedAt: any;
  } | null;
};

export type InboxItemsQueryVariables = Exact<{
  tenantId: Scalars["ID"]["input"];
  status?: InputMaybe<InboxItemStatus>;
  entityType?: InputMaybe<Scalars["String"]["input"]>;
  entityId?: InputMaybe<Scalars["ID"]["input"]>;
}>;

export type InboxItemsQuery = {
  __typename?: "Query";
  inboxItems: Array<{
    __typename?: "InboxItem";
    id: string;
    tenantId: string;
    requesterType?: string | null;
    requesterId?: string | null;
    type: string;
    status: InboxItemStatus;
    title?: string | null;
    description?: string | null;
    entityType?: string | null;
    entityId?: string | null;
    config?: any | null;
    revision: number;
    reviewNotes?: string | null;
    decidedBy?: string | null;
    decidedAt?: any | null;
    expiresAt?: any | null;
    createdAt: any;
    updatedAt: any;
    comments: Array<{
      __typename?: "InboxItemComment";
      id: string;
      inboxItemId: string;
      authorType?: string | null;
      authorId?: string | null;
      content: string;
      createdAt: any;
    }>;
    links: Array<{
      __typename?: "InboxItemLink";
      id: string;
      linkedType?: string | null;
      linkedId?: string | null;
      createdAt: any;
    }>;
    linkedThreads: Array<{
      __typename?: "LinkedThread";
      id: string;
      number: number;
      identifier?: string | null;
      title: string;
      status: string;
    }>;
  }>;
};

export type InboxItemQueryVariables = Exact<{
  id: Scalars["ID"]["input"];
}>;

export type InboxItemQuery = {
  __typename?: "Query";
  inboxItem?: {
    __typename?: "InboxItem";
    id: string;
    tenantId: string;
    requesterType?: string | null;
    requesterId?: string | null;
    type: string;
    status: InboxItemStatus;
    title?: string | null;
    description?: string | null;
    entityType?: string | null;
    entityId?: string | null;
    config?: any | null;
    revision: number;
    reviewNotes?: string | null;
    decidedBy?: string | null;
    decidedAt?: any | null;
    expiresAt?: any | null;
    createdAt: any;
    updatedAt: any;
    comments: Array<{
      __typename?: "InboxItemComment";
      id: string;
      inboxItemId: string;
      authorType?: string | null;
      authorId?: string | null;
      content: string;
      createdAt: any;
    }>;
    links: Array<{
      __typename?: "InboxItemLink";
      id: string;
      linkedType?: string | null;
      linkedId?: string | null;
      createdAt: any;
    }>;
    linkedThreads: Array<{
      __typename?: "LinkedThread";
      id: string;
      number: number;
      identifier?: string | null;
      title: string;
      status: string;
    }>;
  } | null;
};

export type DecideInboxItemMutationVariables = Exact<{
  id: Scalars["ID"]["input"];
  input: InboxItemDecisionInput;
}>;

export type DecideInboxItemMutation = {
  __typename?: "Mutation";
  decideInboxItem: {
    __typename?: "InboxItem";
    id: string;
    status: InboxItemStatus;
    reviewNotes?: string | null;
    decidedBy?: string | null;
    decidedAt?: any | null;
    updatedAt: any;
  };
};

export type AddInboxItemCommentMutationVariables = Exact<{
  input: AddInboxItemCommentInput;
}>;

export type AddInboxItemCommentMutation = {
  __typename?: "Mutation";
  addInboxItemComment: {
    __typename?: "InboxItemComment";
    id: string;
    inboxItemId: string;
    content: string;
    authorType?: string | null;
    authorId?: string | null;
    createdAt: any;
  };
};

export type OnOrgUpdatedSubscriptionVariables = Exact<{
  tenantId: Scalars["ID"]["input"];
}>;

export type OnOrgUpdatedSubscription = {
  __typename?: "Subscription";
  onOrgUpdated?: {
    __typename?: "OrgUpdateEvent";
    tenantId: string;
    changeType: string;
    entityType?: string | null;
    entityId?: string | null;
    updatedAt: any;
  } | null;
};

export type ThreadTurnsForThreadQueryVariables = Exact<{
  tenantId: Scalars["ID"]["input"];
  threadId: Scalars["ID"]["input"];
  limit?: InputMaybe<Scalars["Int"]["input"]>;
}>;

export type ThreadTurnsForThreadQuery = {
  __typename?: "Query";
  threadTurns: Array<{
    __typename?: "ThreadTurn";
    id: string;
    tenantId: string;
    agentId?: string | null;
    invocationSource: string;
    triggerDetail?: string | null;
    triggerName?: string | null;
    threadId?: string | null;
    turnNumber?: number | null;
    status: string;
    startedAt?: any | null;
    finishedAt?: any | null;
    error?: string | null;
    resultJson?: any | null;
    usageJson?: any | null;
    totalCost?: number | null;
    retryAttempt?: number | null;
    originTurnId?: string | null;
    createdAt: any;
  }>;
};

export type ArtifactsForThreadQueryVariables = Exact<{
  tenantId: Scalars["ID"]["input"];
  threadId: Scalars["ID"]["input"];
  limit?: InputMaybe<Scalars["Int"]["input"]>;
}>;

export type ArtifactsForThreadQuery = {
  __typename?: "Query";
  artifacts: Array<{
    __typename?: "Artifact";
    id: string;
    tenantId: string;
    agentId?: string | null;
    threadId?: string | null;
    title: string;
    type: ArtifactType;
    status: ArtifactStatus;
    summary?: string | null;
    createdAt: any;
    updatedAt: any;
  }>;
};

export type ArtifactDetailQueryVariables = Exact<{
  id: Scalars["ID"]["input"];
}>;

export type ArtifactDetailQuery = {
  __typename?: "Query";
  artifact?: {
    __typename?: "Artifact";
    id: string;
    title: string;
    type: ArtifactType;
    status: ArtifactStatus;
    content?: string | null;
    summary?: string | null;
    createdAt: any;
  } | null;
};

export type MemoryRecordsQueryVariables = Exact<{
  userId: Scalars["ID"]["input"];
  namespace: Scalars["String"]["input"];
}>;

export type MemoryRecordsQuery = {
  __typename?: "Query";
  memoryRecords: Array<{
    __typename?: "MemoryRecord";
    memoryRecordId: string;
    createdAt?: any | null;
    updatedAt?: any | null;
    expiresAt?: any | null;
    namespace?: string | null;
    strategyId?: string | null;
    content?: { __typename?: "MemoryContent"; text?: string | null } | null;
    wikiPages: Array<{
      __typename?: "WikiPage";
      id: string;
      type: WikiPageType;
      slug: string;
      title: string;
    }>;
  }>;
};

export type DeleteMemoryRecordMutationVariables = Exact<{
  userId: Scalars["ID"]["input"];
  memoryRecordId: Scalars["ID"]["input"];
}>;

export type DeleteMemoryRecordMutation = {
  __typename?: "Mutation";
  deleteMemoryRecord: boolean;
};

export type UpdateMemoryRecordMutationVariables = Exact<{
  userId: Scalars["ID"]["input"];
  memoryRecordId: Scalars["ID"]["input"];
  content: Scalars["String"]["input"];
}>;

export type UpdateMemoryRecordMutation = {
  __typename?: "Mutation";
  updateMemoryRecord: boolean;
};

export type AgentWorkspaceReviewsQueryVariables = Exact<{
  tenantId: Scalars["ID"]["input"];
  agentId?: InputMaybe<Scalars["ID"]["input"]>;
  responsibleUserId?: InputMaybe<Scalars["ID"]["input"]>;
  kind?: InputMaybe<WorkspaceReviewKind>;
  status?: InputMaybe<Scalars["String"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
}>;

export type AgentWorkspaceReviewsQuery = {
  __typename?: "Query";
  agentWorkspaceReviews: Array<{
    __typename?: "AgentWorkspaceReview";
    threadId?: string | null;
    reviewObjectKey?: string | null;
    targetPath: string;
    requestedAt: any;
    reason?: string | null;
    payload?: any | null;
    reviewEtag?: string | null;
    responsibleUserId?: string | null;
    kind: WorkspaceReviewKind;
    run: {
      __typename?: "AgentWorkspaceRun";
      id: string;
      agentId: string;
      targetPath: string;
      status: string;
      currentWakeupRequestId?: string | null;
      currentThreadTurnId?: string | null;
      lastEventAt: any;
      createdAt: any;
      updatedAt: any;
    };
    latestEvent?: {
      __typename?: "AgentWorkspaceEvent";
      id: string;
      eventType: string;
      reason?: string | null;
      sourceObjectKey: string;
      payload?: any | null;
      createdAt: any;
    } | null;
  }>;
};

export type AgentWorkspaceReviewQueryVariables = Exact<{
  runId: Scalars["ID"]["input"];
}>;

export type AgentWorkspaceReviewQuery = {
  __typename?: "Query";
  agentWorkspaceReview?: {
    __typename?: "AgentWorkspaceReview";
    threadId?: string | null;
    reviewObjectKey?: string | null;
    targetPath: string;
    requestedAt: any;
    reason?: string | null;
    payload?: any | null;
    reviewBody?: string | null;
    reviewEtag?: string | null;
    reviewMissing?: boolean | null;
    responsibleUserId?: string | null;
    kind: WorkspaceReviewKind;
    proposedChanges: Array<{
      __typename?: "AgentWorkspaceProposedChange";
      path?: string | null;
      kind: string;
      summary: string;
      diff?: string | null;
      before?: string | null;
      after?: string | null;
    }>;
    run: {
      __typename?: "AgentWorkspaceRun";
      id: string;
      tenantId: string;
      agentId: string;
      targetPath: string;
      status: string;
      currentWakeupRequestId?: string | null;
      currentThreadTurnId?: string | null;
      lastEventAt: any;
      createdAt: any;
      updatedAt: any;
    };
    events: Array<{
      __typename?: "AgentWorkspaceEvent";
      id: string;
      eventType: string;
      reason?: string | null;
      sourceObjectKey: string;
      payload?: any | null;
      createdAt: any;
    }>;
    decisionEvents: Array<{
      __typename?: "AgentWorkspaceEvent";
      id: string;
      eventType: string;
      reason?: string | null;
      actorType?: string | null;
      actorId?: string | null;
      payload?: any | null;
      createdAt: any;
    }>;
  } | null;
};

export type AcceptAgentWorkspaceReviewMutationVariables = Exact<{
  runId: Scalars["ID"]["input"];
  input?: InputMaybe<AgentWorkspaceReviewDecisionInput>;
}>;

export type AcceptAgentWorkspaceReviewMutation = {
  __typename?: "Mutation";
  acceptAgentWorkspaceReview: {
    __typename?: "AgentWorkspaceRun";
    id: string;
    status: string;
    currentWakeupRequestId?: string | null;
    updatedAt: any;
  };
};

export type CancelAgentWorkspaceReviewMutationVariables = Exact<{
  runId: Scalars["ID"]["input"];
  input?: InputMaybe<AgentWorkspaceReviewDecisionInput>;
}>;

export type CancelAgentWorkspaceReviewMutation = {
  __typename?: "Mutation";
  cancelAgentWorkspaceReview: {
    __typename?: "AgentWorkspaceRun";
    id: string;
    status: string;
    updatedAt: any;
  };
};

export type ResumeAgentWorkspaceRunMutationVariables = Exact<{
  runId: Scalars["ID"]["input"];
  input?: InputMaybe<AgentWorkspaceReviewDecisionInput>;
}>;

export type ResumeAgentWorkspaceRunMutation = {
  __typename?: "Mutation";
  resumeAgentWorkspaceRun: {
    __typename?: "AgentWorkspaceRun";
    id: string;
    status: string;
    currentWakeupRequestId?: string | null;
    updatedAt: any;
  };
};

export type RegisterPushTokenMutationVariables = Exact<{
  input: RegisterPushTokenInput;
}>;

export type RegisterPushTokenMutation = {
  __typename?: "Mutation";
  registerPushToken: boolean;
};

export type UnregisterPushTokenMutationVariables = Exact<{
  token: Scalars["String"]["input"];
}>;

export type UnregisterPushTokenMutation = {
  __typename?: "Mutation";
  unregisterPushToken: boolean;
};

export type AgentWorkspacesQueryVariables = Exact<{
  tenantId: Scalars["ID"]["input"];
}>;

export type AgentWorkspacesQuery = {
  __typename?: "Query";
  tenantAgent: {
    __typename?: "Agent";
    id: string;
    subAgents?: Array<{
      __typename?: "Agent";
      id: string;
      slug?: string | null;
      name: string;
      role?: string | null;
    }> | null;
  };
};

export type UserQuickActionsQueryVariables = Exact<{
  tenantId: Scalars["ID"]["input"];
}>;

export type UserQuickActionsQuery = {
  __typename?: "Query";
  userQuickActions: Array<{
    __typename?: "UserQuickAction";
    id: string;
    userId: string;
    tenantId: string;
    title: string;
    prompt: string;
    workspaceAgentId?: string | null;
    sortOrder: number;
    createdAt: any;
    updatedAt: any;
  }>;
};

export type CreateQuickActionMutationVariables = Exact<{
  input: CreateQuickActionInput;
}>;

export type CreateQuickActionMutation = {
  __typename?: "Mutation";
  createQuickAction: {
    __typename?: "UserQuickAction";
    id: string;
    userId: string;
    tenantId: string;
    title: string;
    prompt: string;
    workspaceAgentId?: string | null;
    sortOrder: number;
    createdAt: any;
    updatedAt: any;
  };
};

export type UpdateQuickActionMutationVariables = Exact<{
  id: Scalars["ID"]["input"];
  input: UpdateQuickActionInput;
}>;

export type UpdateQuickActionMutation = {
  __typename?: "Mutation";
  updateQuickAction: {
    __typename?: "UserQuickAction";
    id: string;
    userId: string;
    tenantId: string;
    title: string;
    prompt: string;
    workspaceAgentId?: string | null;
    sortOrder: number;
    createdAt: any;
    updatedAt: any;
  };
};

export type DeleteQuickActionMutationVariables = Exact<{
  id: Scalars["ID"]["input"];
}>;

export type DeleteQuickActionMutation = {
  __typename?: "Mutation";
  deleteQuickAction: boolean;
};

export type ReorderQuickActionsMutationVariables = Exact<{
  input: ReorderQuickActionsInput;
}>;

export type ReorderQuickActionsMutation = {
  __typename?: "Mutation";
  reorderQuickActions: Array<{
    __typename?: "UserQuickAction";
    id: string;
    sortOrder: number;
  }>;
};

export type RefreshGenUiMutationVariables = Exact<{
  messageId: Scalars["ID"]["input"];
  toolIndex: Scalars["Int"]["input"];
}>;

export type RefreshGenUiMutation = {
  __typename?: "Mutation";
  refreshGenUI?: {
    __typename?: "Message";
    id: string;
    toolResults?: any | null;
  } | null;
};

export type CreateRecipeMutationVariables = Exact<{
  input: CreateRecipeInput;
}>;

export type CreateRecipeMutation = {
  __typename?: "Mutation";
  createRecipe: {
    __typename?: "Recipe";
    id: string;
    title: string;
    genuiType: string;
  };
};

export const TenantUsersForFormPickerDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "TenantUsersForFormPicker" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "tenantId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "tenantMembers" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "tenantId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "tenantId" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "Field",
                  name: { kind: "Name", value: "principalType" },
                },
                { kind: "Field", name: { kind: "Name", value: "principalId" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "user" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      { kind: "Field", name: { kind: "Name", value: "id" } },
                      { kind: "Field", name: { kind: "Name", value: "email" } },
                      { kind: "Field", name: { kind: "Name", value: "name" } },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  TenantUsersForFormPickerQuery,
  TenantUsersForFormPickerQueryVariables
>;
export const AgentsDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "Agents" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "tenantId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            alias: { kind: "Name", value: "agent" },
            name: { kind: "Name", value: "tenantAgent" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "tenantId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "tenantId" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "tenantId" } },
                { kind: "Field", name: { kind: "Name", value: "name" } },
                { kind: "Field", name: { kind: "Name", value: "slug" } },
                { kind: "Field", name: { kind: "Name", value: "role" } },
                { kind: "Field", name: { kind: "Name", value: "type" } },
                { kind: "Field", name: { kind: "Name", value: "status" } },
                { kind: "Field", name: { kind: "Name", value: "runtime" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "systemPrompt" },
                },
                { kind: "Field", name: { kind: "Name", value: "adapterType" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "adapterConfig" },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "runtimeConfig" },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "lastHeartbeatAt" },
                },
                { kind: "Field", name: { kind: "Name", value: "avatarUrl" } },
                { kind: "Field", name: { kind: "Name", value: "reportsToId" } },
                { kind: "Field", name: { kind: "Name", value: "humanPairId" } },
                { kind: "Field", name: { kind: "Name", value: "version" } },
                { kind: "Field", name: { kind: "Name", value: "createdAt" } },
                { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<AgentsQuery, AgentsQueryVariables>;
export const AgentDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "Agent" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "tenantId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            alias: { kind: "Name", value: "agent" },
            name: { kind: "Name", value: "tenantAgent" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "tenantId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "tenantId" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "tenantId" } },
                { kind: "Field", name: { kind: "Name", value: "name" } },
                { kind: "Field", name: { kind: "Name", value: "slug" } },
                { kind: "Field", name: { kind: "Name", value: "role" } },
                { kind: "Field", name: { kind: "Name", value: "type" } },
                { kind: "Field", name: { kind: "Name", value: "status" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "systemPrompt" },
                },
                { kind: "Field", name: { kind: "Name", value: "adapterType" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "adapterConfig" },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "runtimeConfig" },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "lastHeartbeatAt" },
                },
                { kind: "Field", name: { kind: "Name", value: "avatarUrl" } },
                { kind: "Field", name: { kind: "Name", value: "reportsToId" } },
                { kind: "Field", name: { kind: "Name", value: "humanPairId" } },
                { kind: "Field", name: { kind: "Name", value: "version" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "capabilities" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      { kind: "Field", name: { kind: "Name", value: "id" } },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "capability" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "config" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "enabled" },
                      },
                    ],
                  },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "skills" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      { kind: "Field", name: { kind: "Name", value: "id" } },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "skillId" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "config" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "permissions" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "rateLimitRpm" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "enabled" },
                      },
                    ],
                  },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "budgetPolicy" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      { kind: "Field", name: { kind: "Name", value: "id" } },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "period" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "limitUsd" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "actionOnExceed" },
                      },
                    ],
                  },
                },
                { kind: "Field", name: { kind: "Name", value: "createdAt" } },
                { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<AgentQuery, AgentQueryVariables>;
export const CreateAgentDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "CreateAgent" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "tenantId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "input" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "UpdateTenantAgentInput" },
            },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "updateTenantAgent" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "tenantId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "tenantId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "input" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "input" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "tenantId" } },
                { kind: "Field", name: { kind: "Name", value: "name" } },
                { kind: "Field", name: { kind: "Name", value: "type" } },
                { kind: "Field", name: { kind: "Name", value: "status" } },
                { kind: "Field", name: { kind: "Name", value: "createdAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<CreateAgentMutation, CreateAgentMutationVariables>;
export const UpdateAgentDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "UpdateAgent" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "tenantId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "input" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "UpdateTenantAgentInput" },
            },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "updateTenantAgent" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "tenantId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "tenantId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "input" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "input" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "name" } },
                { kind: "Field", name: { kind: "Name", value: "role" } },
                { kind: "Field", name: { kind: "Name", value: "type" } },
                { kind: "Field", name: { kind: "Name", value: "status" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "systemPrompt" },
                },
                { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<UpdateAgentMutation, UpdateAgentMutationVariables>;
export const DeleteAgentDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "DeleteAgent" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "tenantId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "updateTenantAgent" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "tenantId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "tenantId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "input" },
                value: { kind: "ObjectValue", fields: [] },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<DeleteAgentMutation, DeleteAgentMutationVariables>;
export const UpdateAgentStatusDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "UpdateAgentStatus" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "tenantId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "updateTenantAgent" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "tenantId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "tenantId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "input" },
                value: { kind: "ObjectValue", fields: [] },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "status" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "lastHeartbeatAt" },
                },
                { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  UpdateAgentStatusMutation,
  UpdateAgentStatusMutationVariables
>;
export const SetAgentCapabilitiesDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "SetAgentCapabilities" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "tenantId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "updateTenantAgent" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "tenantId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "tenantId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "input" },
                value: { kind: "ObjectValue", fields: [] },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "capabilities" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      { kind: "Field", name: { kind: "Name", value: "id" } },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "capability" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "config" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "enabled" },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  SetAgentCapabilitiesMutation,
  SetAgentCapabilitiesMutationVariables
>;
export const SetAgentSkillsDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "SetAgentSkills" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "tenantId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "updateTenantAgent" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "tenantId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "tenantId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "input" },
                value: { kind: "ObjectValue", fields: [] },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "skills" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      { kind: "Field", name: { kind: "Name", value: "id" } },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "skillId" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "config" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "enabled" },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  SetAgentSkillsMutation,
  SetAgentSkillsMutationVariables
>;
export const SetAgentBudgetPolicyDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "SetAgentBudgetPolicy" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "tenantId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "input" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "UpdateTenantAgentInput" },
            },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "updateTenantAgent" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "tenantId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "tenantId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "input" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "input" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "budgetMonthlyCents" },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  SetAgentBudgetPolicyMutation,
  SetAgentBudgetPolicyMutationVariables
>;
export const SendMessageDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "SendMessage" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "input" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "SendMessageInput" },
            },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "sendMessage" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "input" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "input" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "threadId" } },
                { kind: "Field", name: { kind: "Name", value: "tenantId" } },
                { kind: "Field", name: { kind: "Name", value: "role" } },
                { kind: "Field", name: { kind: "Name", value: "content" } },
                { kind: "Field", name: { kind: "Name", value: "senderType" } },
                { kind: "Field", name: { kind: "Name", value: "senderId" } },
                { kind: "Field", name: { kind: "Name", value: "ownerType" } },
                { kind: "Field", name: { kind: "Name", value: "ownerId" } },
                { kind: "Field", name: { kind: "Name", value: "createdAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<SendMessageMutation, SendMessageMutationVariables>;
export const DeleteMessageDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "DeleteMessage" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "id" } },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "deleteMessage" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "id" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "id" },
                },
              },
            ],
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  DeleteMessageMutation,
  DeleteMessageMutationVariables
>;
export const MySlackLinksDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "MySlackLinks" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "tenantId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "mySlackLinks" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "tenantId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "tenantId" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "tenantId" } },
                { kind: "Field", name: { kind: "Name", value: "slackTeamId" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "slackTeamName" },
                },
                { kind: "Field", name: { kind: "Name", value: "slackUserId" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "slackUserName" },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "slackUserEmail" },
                },
                { kind: "Field", name: { kind: "Name", value: "userId" } },
                { kind: "Field", name: { kind: "Name", value: "status" } },
                { kind: "Field", name: { kind: "Name", value: "linkedAt" } },
                { kind: "Field", name: { kind: "Name", value: "unlinkedAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<MySlackLinksQuery, MySlackLinksQueryVariables>;
export const UnlinkSlackIdentityDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "UnlinkSlackIdentity" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "id" } },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "unlinkSlackIdentity" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "id" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "id" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "status" } },
                { kind: "Field", name: { kind: "Name", value: "unlinkedAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  UnlinkSlackIdentityMutation,
  UnlinkSlackIdentityMutationVariables
>;
export const MessagesDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "Messages" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "threadId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "limit" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "cursor" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "String" } },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "messages" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "threadId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "threadId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "limit" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "limit" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "cursor" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "cursor" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "Field",
                  name: { kind: "Name", value: "edges" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "node" },
                        selectionSet: {
                          kind: "SelectionSet",
                          selections: [
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "id" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "threadId" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "tenantId" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "role" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "content" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "senderType" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "senderId" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "sender" },
                              selectionSet: {
                                kind: "SelectionSet",
                                selections: [
                                  {
                                    kind: "Field",
                                    name: { kind: "Name", value: "type" },
                                  },
                                  {
                                    kind: "Field",
                                    name: { kind: "Name", value: "id" },
                                  },
                                  {
                                    kind: "Field",
                                    name: {
                                      kind: "Name",
                                      value: "displayName",
                                    },
                                  },
                                  {
                                    kind: "Field",
                                    name: { kind: "Name", value: "avatarUrl" },
                                  },
                                ],
                              },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "toolCalls" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "toolResults" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "parts" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "metadata" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "tokenCount" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "durableArtifact" },
                              selectionSet: {
                                kind: "SelectionSet",
                                selections: [
                                  {
                                    kind: "Field",
                                    name: { kind: "Name", value: "id" },
                                  },
                                  {
                                    kind: "Field",
                                    name: { kind: "Name", value: "title" },
                                  },
                                  {
                                    kind: "Field",
                                    name: { kind: "Name", value: "type" },
                                  },
                                  {
                                    kind: "Field",
                                    name: { kind: "Name", value: "status" },
                                  },
                                  {
                                    kind: "Field",
                                    name: { kind: "Name", value: "content" },
                                  },
                                  {
                                    kind: "Field",
                                    name: { kind: "Name", value: "summary" },
                                  },
                                ],
                              },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "createdAt" },
                            },
                          ],
                        },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "cursor" },
                      },
                    ],
                  },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "pageInfo" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "hasNextPage" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "endCursor" },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<MessagesQuery, MessagesQueryVariables>;
export const RoutinesDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "Routines" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "tenantId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "agentId" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "status" },
          },
          type: {
            kind: "NamedType",
            name: { kind: "Name", value: "RoutineStatus" },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "routines" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "tenantId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "tenantId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "agentId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "agentId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "status" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "status" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "tenantId" } },
                { kind: "Field", name: { kind: "Name", value: "agentId" } },
                { kind: "Field", name: { kind: "Name", value: "name" } },
                { kind: "Field", name: { kind: "Name", value: "description" } },
                { kind: "Field", name: { kind: "Name", value: "type" } },
                { kind: "Field", name: { kind: "Name", value: "status" } },
                { kind: "Field", name: { kind: "Name", value: "schedule" } },
                { kind: "Field", name: { kind: "Name", value: "config" } },
                { kind: "Field", name: { kind: "Name", value: "lastRunAt" } },
                { kind: "Field", name: { kind: "Name", value: "nextRunAt" } },
                { kind: "Field", name: { kind: "Name", value: "createdAt" } },
                { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<RoutinesQuery, RoutinesQueryVariables>;
export const RoutineDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "Routine" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "id" } },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "routine" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "id" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "id" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "tenantId" } },
                { kind: "Field", name: { kind: "Name", value: "agentId" } },
                { kind: "Field", name: { kind: "Name", value: "name" } },
                { kind: "Field", name: { kind: "Name", value: "description" } },
                { kind: "Field", name: { kind: "Name", value: "type" } },
                { kind: "Field", name: { kind: "Name", value: "status" } },
                { kind: "Field", name: { kind: "Name", value: "schedule" } },
                { kind: "Field", name: { kind: "Name", value: "config" } },
                { kind: "Field", name: { kind: "Name", value: "engine" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "currentVersion" },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "documentationMd" },
                },
                { kind: "Field", name: { kind: "Name", value: "lastRunAt" } },
                { kind: "Field", name: { kind: "Name", value: "nextRunAt" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "triggers" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      { kind: "Field", name: { kind: "Name", value: "id" } },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "triggerType" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "config" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "enabled" },
                      },
                    ],
                  },
                },
                { kind: "Field", name: { kind: "Name", value: "createdAt" } },
                { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<RoutineQuery, RoutineQueryVariables>;
export const MobileRoutineExecutionsListDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "MobileRoutineExecutionsList" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "routineId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "status" },
          },
          type: {
            kind: "NamedType",
            name: { kind: "Name", value: "RoutineExecutionStatus" },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "limit" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "cursor" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "String" } },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "routineExecutions" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "routineId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "routineId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "status" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "status" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "limit" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "limit" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "cursor" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "cursor" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "status" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "triggerSource" },
                },
                { kind: "Field", name: { kind: "Name", value: "startedAt" } },
                { kind: "Field", name: { kind: "Name", value: "finishedAt" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "totalLlmCostUsdCents" },
                },
                { kind: "Field", name: { kind: "Name", value: "errorCode" } },
                { kind: "Field", name: { kind: "Name", value: "createdAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  MobileRoutineExecutionsListQuery,
  MobileRoutineExecutionsListQueryVariables
>;
export const MobileRoutineExecutionDetailDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "MobileRoutineExecutionDetail" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "id" } },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "routineExecution" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "id" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "id" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "tenantId" } },
                { kind: "Field", name: { kind: "Name", value: "routineId" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "sfnExecutionArn" },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "triggerSource" },
                },
                { kind: "Field", name: { kind: "Name", value: "inputJson" } },
                { kind: "Field", name: { kind: "Name", value: "outputJson" } },
                { kind: "Field", name: { kind: "Name", value: "status" } },
                { kind: "Field", name: { kind: "Name", value: "startedAt" } },
                { kind: "Field", name: { kind: "Name", value: "finishedAt" } },
                { kind: "Field", name: { kind: "Name", value: "errorCode" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "errorMessage" },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "totalLlmCostUsdCents" },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "stepEvents" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      { kind: "Field", name: { kind: "Name", value: "id" } },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "nodeId" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "recipeType" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "status" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "startedAt" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "finishedAt" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "inputJson" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "outputJson" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "errorJson" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "llmCostUsdCents" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "retryCount" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "stdoutS3Uri" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "stderrS3Uri" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "stdoutPreview" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "truncated" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "createdAt" },
                      },
                    ],
                  },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "routine" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      { kind: "Field", name: { kind: "Name", value: "id" } },
                      { kind: "Field", name: { kind: "Name", value: "name" } },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "description" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "currentVersion" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "documentationMd" },
                      },
                    ],
                  },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "aslVersion" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      { kind: "Field", name: { kind: "Name", value: "id" } },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "versionNumber" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "markdownSummary" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "stepManifestJson" },
                      },
                    ],
                  },
                },
                { kind: "Field", name: { kind: "Name", value: "createdAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  MobileRoutineExecutionDetailQuery,
  MobileRoutineExecutionDetailQueryVariables
>;
export const CreateRoutineDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "CreateRoutine" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "input" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "CreateRoutineInput" },
            },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "createRoutine" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "input" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "input" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "tenantId" } },
                { kind: "Field", name: { kind: "Name", value: "name" } },
                { kind: "Field", name: { kind: "Name", value: "type" } },
                { kind: "Field", name: { kind: "Name", value: "status" } },
                { kind: "Field", name: { kind: "Name", value: "createdAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  CreateRoutineMutation,
  CreateRoutineMutationVariables
>;
export const UpdateRoutineDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "UpdateRoutine" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "id" } },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "input" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "UpdateRoutineInput" },
            },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "updateRoutine" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "id" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "id" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "input" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "input" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "name" } },
                { kind: "Field", name: { kind: "Name", value: "description" } },
                { kind: "Field", name: { kind: "Name", value: "status" } },
                { kind: "Field", name: { kind: "Name", value: "schedule" } },
                { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  UpdateRoutineMutation,
  UpdateRoutineMutationVariables
>;
export const DeleteRoutineDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "DeleteRoutine" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "id" } },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "deleteRoutine" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "id" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "id" },
                },
              },
            ],
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  DeleteRoutineMutation,
  DeleteRoutineMutationVariables
>;
export const TriggerRoutineRunDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "TriggerRoutineRun" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "routineId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "input" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "AWSJSON" } },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "triggerRoutineRun" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "routineId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "routineId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "input" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "input" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "routineId" } },
                { kind: "Field", name: { kind: "Name", value: "status" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "sfnExecutionArn" },
                },
                { kind: "Field", name: { kind: "Name", value: "startedAt" } },
                { kind: "Field", name: { kind: "Name", value: "createdAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  TriggerRoutineRunMutation,
  TriggerRoutineRunMutationVariables
>;
export const SetRoutineTriggerDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "SetRoutineTrigger" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "routineId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "input" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "RoutineTriggerInput" },
            },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "setRoutineTrigger" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "routineId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "routineId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "input" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "input" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "triggerType" } },
                { kind: "Field", name: { kind: "Name", value: "config" } },
                { kind: "Field", name: { kind: "Name", value: "enabled" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  SetRoutineTriggerMutation,
  SetRoutineTriggerMutationVariables
>;
export const DeleteRoutineTriggerDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "DeleteRoutineTrigger" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "id" } },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "deleteRoutineTrigger" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "id" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "id" },
                },
              },
            ],
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  DeleteRoutineTriggerMutation,
  DeleteRoutineTriggerMutationVariables
>;
export const ThreadTurnsDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "ThreadTurns" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "tenantId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "agentId" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "status" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "String" } },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "limit" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "threadTurns" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "tenantId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "tenantId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "agentId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "agentId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "status" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "status" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "limit" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "limit" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "tenantId" } },
                { kind: "Field", name: { kind: "Name", value: "triggerId" } },
                { kind: "Field", name: { kind: "Name", value: "agentId" } },
                { kind: "Field", name: { kind: "Name", value: "routineId" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "invocationSource" },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "triggerDetail" },
                },
                { kind: "Field", name: { kind: "Name", value: "status" } },
                { kind: "Field", name: { kind: "Name", value: "startedAt" } },
                { kind: "Field", name: { kind: "Name", value: "finishedAt" } },
                { kind: "Field", name: { kind: "Name", value: "error" } },
                { kind: "Field", name: { kind: "Name", value: "errorCode" } },
                { kind: "Field", name: { kind: "Name", value: "usageJson" } },
                { kind: "Field", name: { kind: "Name", value: "resultJson" } },
                { kind: "Field", name: { kind: "Name", value: "createdAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<ThreadTurnsQuery, ThreadTurnsQueryVariables>;
export const ThreadTurnDetailDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "ThreadTurnDetail" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "id" } },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "threadTurn" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "id" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "id" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "tenantId" } },
                { kind: "Field", name: { kind: "Name", value: "triggerId" } },
                { kind: "Field", name: { kind: "Name", value: "agentId" } },
                { kind: "Field", name: { kind: "Name", value: "routineId" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "invocationSource" },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "triggerDetail" },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "wakeupRequestId" },
                },
                { kind: "Field", name: { kind: "Name", value: "status" } },
                { kind: "Field", name: { kind: "Name", value: "startedAt" } },
                { kind: "Field", name: { kind: "Name", value: "finishedAt" } },
                { kind: "Field", name: { kind: "Name", value: "error" } },
                { kind: "Field", name: { kind: "Name", value: "errorCode" } },
                { kind: "Field", name: { kind: "Name", value: "usageJson" } },
                { kind: "Field", name: { kind: "Name", value: "resultJson" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "sessionIdBefore" },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "sessionIdAfter" },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "externalRunId" },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "contextSnapshot" },
                },
                { kind: "Field", name: { kind: "Name", value: "createdAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  ThreadTurnDetailQuery,
  ThreadTurnDetailQueryVariables
>;
export const ThreadTurnEventsDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "ThreadTurnEvents" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "runId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "afterSeq" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "limit" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "threadTurnEvents" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "runId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "runId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "afterSeq" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "afterSeq" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "limit" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "limit" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "runId" } },
                { kind: "Field", name: { kind: "Name", value: "agentId" } },
                { kind: "Field", name: { kind: "Name", value: "seq" } },
                { kind: "Field", name: { kind: "Name", value: "eventType" } },
                { kind: "Field", name: { kind: "Name", value: "stream" } },
                { kind: "Field", name: { kind: "Name", value: "level" } },
                { kind: "Field", name: { kind: "Name", value: "color" } },
                { kind: "Field", name: { kind: "Name", value: "message" } },
                { kind: "Field", name: { kind: "Name", value: "payload" } },
                { kind: "Field", name: { kind: "Name", value: "createdAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  ThreadTurnEventsQuery,
  ThreadTurnEventsQueryVariables
>;
export const TurnInvocationLogsDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "TurnInvocationLogs" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "tenantId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "turnId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "turnInvocationLogs" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "tenantId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "tenantId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "turnId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "turnId" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "requestId" } },
                { kind: "Field", name: { kind: "Name", value: "modelId" } },
                { kind: "Field", name: { kind: "Name", value: "timestamp" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "inputTokenCount" },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "outputTokenCount" },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "cacheReadTokenCount" },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "inputPreview" },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "outputPreview" },
                },
                { kind: "Field", name: { kind: "Name", value: "toolCount" } },
                { kind: "Field", name: { kind: "Name", value: "costUsd" } },
                { kind: "Field", name: { kind: "Name", value: "toolUses" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "hasToolResult" },
                },
                { kind: "Field", name: { kind: "Name", value: "branch" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  TurnInvocationLogsQuery,
  TurnInvocationLogsQueryVariables
>;
export const CancelThreadTurnDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "CancelThreadTurn" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "id" } },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "cancelThreadTurn" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "id" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "id" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "status" } },
                { kind: "Field", name: { kind: "Name", value: "finishedAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  CancelThreadTurnMutation,
  CancelThreadTurnMutationVariables
>;
export const CreateWakeupRequestDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "CreateWakeupRequest" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "input" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "CreateWakeupRequestInput" },
            },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "createWakeupRequest" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "input" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "input" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "tenantId" } },
                { kind: "Field", name: { kind: "Name", value: "agentId" } },
                { kind: "Field", name: { kind: "Name", value: "source" } },
                { kind: "Field", name: { kind: "Name", value: "status" } },
                { kind: "Field", name: { kind: "Name", value: "createdAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  CreateWakeupRequestMutation,
  CreateWakeupRequestMutationVariables
>;
export const ScheduledJobsDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "ScheduledJobs" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "tenantId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "agentId" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "routineId" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "triggerType" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "String" } },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "enabled" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "Boolean" } },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "limit" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "scheduledJobs" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "tenantId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "tenantId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "agentId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "agentId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "routineId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "routineId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "triggerType" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "triggerType" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "enabled" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "enabled" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "limit" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "limit" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "tenantId" } },
                { kind: "Field", name: { kind: "Name", value: "triggerType" } },
                { kind: "Field", name: { kind: "Name", value: "agentId" } },
                { kind: "Field", name: { kind: "Name", value: "routineId" } },
                { kind: "Field", name: { kind: "Name", value: "name" } },
                { kind: "Field", name: { kind: "Name", value: "description" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "scheduleType" },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "scheduleExpression" },
                },
                { kind: "Field", name: { kind: "Name", value: "timezone" } },
                { kind: "Field", name: { kind: "Name", value: "enabled" } },
                { kind: "Field", name: { kind: "Name", value: "lastRunAt" } },
                { kind: "Field", name: { kind: "Name", value: "nextRunAt" } },
                { kind: "Field", name: { kind: "Name", value: "createdAt" } },
                { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<ScheduledJobsQuery, ScheduledJobsQueryVariables>;
export const TenantDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "Tenant" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "id" } },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "tenant" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "id" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "id" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "name" } },
                { kind: "Field", name: { kind: "Name", value: "slug" } },
                { kind: "Field", name: { kind: "Name", value: "plan" } },
                { kind: "Field", name: { kind: "Name", value: "issuePrefix" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "issueCounter" },
                },
                { kind: "Field", name: { kind: "Name", value: "createdAt" } },
                { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<TenantQuery, TenantQueryVariables>;
export const TenantBySlugDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "TenantBySlug" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "slug" } },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "String" },
            },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "tenantBySlug" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "slug" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "slug" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "name" } },
                { kind: "Field", name: { kind: "Name", value: "slug" } },
                { kind: "Field", name: { kind: "Name", value: "plan" } },
                { kind: "Field", name: { kind: "Name", value: "issuePrefix" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "issueCounter" },
                },
                { kind: "Field", name: { kind: "Name", value: "createdAt" } },
                { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<TenantBySlugQuery, TenantBySlugQueryVariables>;
export const TenantMembersDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "TenantMembers" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "tenantId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "tenantMembers" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "tenantId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "tenantId" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "tenantId" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "principalType" },
                },
                { kind: "Field", name: { kind: "Name", value: "principalId" } },
                { kind: "Field", name: { kind: "Name", value: "role" } },
                { kind: "Field", name: { kind: "Name", value: "status" } },
                { kind: "Field", name: { kind: "Name", value: "createdAt" } },
                { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<TenantMembersQuery, TenantMembersQueryVariables>;
export const UpdateTenantDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "UpdateTenant" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "id" } },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "input" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "UpdateTenantInput" },
            },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "updateTenant" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "id" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "id" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "input" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "input" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "name" } },
                { kind: "Field", name: { kind: "Name", value: "plan" } },
                { kind: "Field", name: { kind: "Name", value: "issuePrefix" } },
                { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  UpdateTenantMutation,
  UpdateTenantMutationVariables
>;
export const UpdateTenantSettingsDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "UpdateTenantSettings" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "tenantId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "input" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "UpdateTenantSettingsInput" },
            },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "updateTenantSettings" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "tenantId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "tenantId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "input" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "input" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "defaultModel" },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "budgetMonthlyCents" },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "autoCloseThreadMinutes" },
                },
                { kind: "Field", name: { kind: "Name", value: "maxAgents" } },
                { kind: "Field", name: { kind: "Name", value: "features" } },
                { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  UpdateTenantSettingsMutation,
  UpdateTenantSettingsMutationVariables
>;
export const AddTenantMemberDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "AddTenantMember" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "tenantId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "input" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "AddTenantMemberInput" },
            },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "addTenantMember" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "tenantId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "tenantId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "input" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "input" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "principalType" },
                },
                { kind: "Field", name: { kind: "Name", value: "principalId" } },
                { kind: "Field", name: { kind: "Name", value: "role" } },
                { kind: "Field", name: { kind: "Name", value: "status" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  AddTenantMemberMutation,
  AddTenantMemberMutationVariables
>;
export const RemoveTenantMemberDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "RemoveTenantMember" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "id" } },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "removeTenantMember" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "id" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "id" },
                },
              },
            ],
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  RemoveTenantMemberMutation,
  RemoveTenantMemberMutationVariables
>;
export const MeDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "Me" },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "me" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "tenantId" } },
                { kind: "Field", name: { kind: "Name", value: "email" } },
                { kind: "Field", name: { kind: "Name", value: "name" } },
                { kind: "Field", name: { kind: "Name", value: "image" } },
                { kind: "Field", name: { kind: "Name", value: "phone" } },
                { kind: "Field", name: { kind: "Name", value: "createdAt" } },
                { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<MeQuery, MeQueryVariables>;
export const UserDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "User" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "id" } },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "user" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "id" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "id" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "tenantId" } },
                { kind: "Field", name: { kind: "Name", value: "email" } },
                { kind: "Field", name: { kind: "Name", value: "name" } },
                { kind: "Field", name: { kind: "Name", value: "image" } },
                { kind: "Field", name: { kind: "Name", value: "phone" } },
                { kind: "Field", name: { kind: "Name", value: "createdAt" } },
                { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<UserQuery, UserQueryVariables>;
export const UpdateUserDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "UpdateUser" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "id" } },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "input" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "UpdateUserInput" },
            },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "updateUser" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "id" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "id" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "input" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "input" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "name" } },
                { kind: "Field", name: { kind: "Name", value: "image" } },
                { kind: "Field", name: { kind: "Name", value: "phone" } },
                { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<UpdateUserMutation, UpdateUserMutationVariables>;
export const UpdateUserProfileDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "UpdateUserProfile" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "userId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "input" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "UpdateUserProfileInput" },
            },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "updateUserProfile" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "userId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "userId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "input" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "input" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "displayName" } },
                { kind: "Field", name: { kind: "Name", value: "theme" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "notificationPreferences" },
                },
                { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  UpdateUserProfileMutation,
  UpdateUserProfileMutationVariables
>;
export const ThreadsDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "Threads" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "tenantId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "channel" },
          },
          type: {
            kind: "NamedType",
            name: { kind: "Name", value: "ThreadChannel" },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "agentId" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "assigneeId" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "limit" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "cursor" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "String" } },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "threads" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "tenantId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "tenantId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "channel" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "channel" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "agentId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "agentId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "assigneeId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "assigneeId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "limit" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "limit" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "cursor" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "cursor" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "tenantId" } },
                { kind: "Field", name: { kind: "Name", value: "agentId" } },
                { kind: "Field", name: { kind: "Name", value: "spaceId" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "space" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      { kind: "Field", name: { kind: "Name", value: "id" } },
                      { kind: "Field", name: { kind: "Name", value: "name" } },
                      { kind: "Field", name: { kind: "Name", value: "slug" } },
                      { kind: "Field", name: { kind: "Name", value: "icon" } },
                    ],
                  },
                },
                { kind: "Field", name: { kind: "Name", value: "number" } },
                { kind: "Field", name: { kind: "Name", value: "identifier" } },
                { kind: "Field", name: { kind: "Name", value: "title" } },
                { kind: "Field", name: { kind: "Name", value: "status" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "lifecycleStatus" },
                },
                { kind: "Field", name: { kind: "Name", value: "channel" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "assigneeType" },
                },
                { kind: "Field", name: { kind: "Name", value: "assigneeId" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "assignee" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      { kind: "Field", name: { kind: "Name", value: "id" } },
                      { kind: "Field", name: { kind: "Name", value: "name" } },
                    ],
                  },
                },
                { kind: "Field", name: { kind: "Name", value: "reporterId" } },
                { kind: "Field", name: { kind: "Name", value: "labels" } },
                { kind: "Field", name: { kind: "Name", value: "metadata" } },
                { kind: "Field", name: { kind: "Name", value: "dueAt" } },
                { kind: "Field", name: { kind: "Name", value: "closedAt" } },
                { kind: "Field", name: { kind: "Name", value: "archivedAt" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "lastActivityAt" },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "lastTurnCompletedAt" },
                },
                { kind: "Field", name: { kind: "Name", value: "lastReadAt" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "lastResponsePreview" },
                },
                { kind: "Field", name: { kind: "Name", value: "createdAt" } },
                { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<ThreadsQuery, ThreadsQueryVariables>;
export const SpacesDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "Spaces" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "tenantId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "spaces" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "tenantId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "tenantId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "status" },
                value: { kind: "EnumValue", value: "ACTIVE" },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "tenantId" } },
                { kind: "Field", name: { kind: "Name", value: "name" } },
                { kind: "Field", name: { kind: "Name", value: "slug" } },
                { kind: "Field", name: { kind: "Name", value: "icon" } },
                { kind: "Field", name: { kind: "Name", value: "status" } },
                { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<SpacesQuery, SpacesQueryVariables>;
export const NewThreadMentionTargetsDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "NewThreadMentionTargets" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "tenantId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "tenantMentionTargets" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "tenantId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "tenantId" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "targetType" } },
                { kind: "Field", name: { kind: "Name", value: "targetId" } },
                { kind: "Field", name: { kind: "Name", value: "displayName" } },
                { kind: "Field", name: { kind: "Name", value: "aliases" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "isDefaultAgent" },
                },
                { kind: "Field", name: { kind: "Name", value: "avatarUrl" } },
                { kind: "Field", name: { kind: "Name", value: "role" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  NewThreadMentionTargetsQuery,
  NewThreadMentionTargetsQueryVariables
>;
export const ThreadMentionTargetsDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "ThreadMentionTargets" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "threadId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "threadMentionTargets" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "threadId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "threadId" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "targetType" } },
                { kind: "Field", name: { kind: "Name", value: "targetId" } },
                { kind: "Field", name: { kind: "Name", value: "displayName" } },
                { kind: "Field", name: { kind: "Name", value: "aliases" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "isDefaultAgent" },
                },
                { kind: "Field", name: { kind: "Name", value: "avatarUrl" } },
                { kind: "Field", name: { kind: "Name", value: "role" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  ThreadMentionTargetsQuery,
  ThreadMentionTargetsQueryVariables
>;
export const ThreadDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "Thread" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "id" } },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "thread" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "id" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "id" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "tenantId" } },
                { kind: "Field", name: { kind: "Name", value: "agentId" } },
                { kind: "Field", name: { kind: "Name", value: "spaceId" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "space" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      { kind: "Field", name: { kind: "Name", value: "id" } },
                      { kind: "Field", name: { kind: "Name", value: "name" } },
                      { kind: "Field", name: { kind: "Name", value: "slug" } },
                    ],
                  },
                },
                { kind: "Field", name: { kind: "Name", value: "number" } },
                { kind: "Field", name: { kind: "Name", value: "identifier" } },
                { kind: "Field", name: { kind: "Name", value: "title" } },
                { kind: "Field", name: { kind: "Name", value: "status" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "lifecycleStatus" },
                },
                { kind: "Field", name: { kind: "Name", value: "channel" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "assigneeType" },
                },
                { kind: "Field", name: { kind: "Name", value: "assigneeId" } },
                { kind: "Field", name: { kind: "Name", value: "reporterId" } },
                { kind: "Field", name: { kind: "Name", value: "labels" } },
                { kind: "Field", name: { kind: "Name", value: "metadata" } },
                { kind: "Field", name: { kind: "Name", value: "dueAt" } },
                { kind: "Field", name: { kind: "Name", value: "closedAt" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "messages" },
                  arguments: [
                    {
                      kind: "Argument",
                      name: { kind: "Name", value: "limit" },
                      value: { kind: "IntValue", value: "100" },
                    },
                  ],
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "edges" },
                        selectionSet: {
                          kind: "SelectionSet",
                          selections: [
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "node" },
                              selectionSet: {
                                kind: "SelectionSet",
                                selections: [
                                  {
                                    kind: "Field",
                                    name: { kind: "Name", value: "id" },
                                  },
                                  {
                                    kind: "Field",
                                    name: { kind: "Name", value: "role" },
                                  },
                                  {
                                    kind: "Field",
                                    name: { kind: "Name", value: "content" },
                                  },
                                  {
                                    kind: "Field",
                                    name: { kind: "Name", value: "senderType" },
                                  },
                                  {
                                    kind: "Field",
                                    name: { kind: "Name", value: "senderId" },
                                  },
                                  {
                                    kind: "Field",
                                    name: { kind: "Name", value: "sender" },
                                    selectionSet: {
                                      kind: "SelectionSet",
                                      selections: [
                                        {
                                          kind: "Field",
                                          name: { kind: "Name", value: "type" },
                                        },
                                        {
                                          kind: "Field",
                                          name: { kind: "Name", value: "id" },
                                        },
                                        {
                                          kind: "Field",
                                          name: {
                                            kind: "Name",
                                            value: "displayName",
                                          },
                                        },
                                        {
                                          kind: "Field",
                                          name: {
                                            kind: "Name",
                                            value: "avatarUrl",
                                          },
                                        },
                                      ],
                                    },
                                  },
                                  {
                                    kind: "Field",
                                    name: { kind: "Name", value: "createdAt" },
                                  },
                                  {
                                    kind: "Field",
                                    name: {
                                      kind: "Name",
                                      value: "durableArtifact",
                                    },
                                    selectionSet: {
                                      kind: "SelectionSet",
                                      selections: [
                                        {
                                          kind: "Field",
                                          name: { kind: "Name", value: "id" },
                                        },
                                        {
                                          kind: "Field",
                                          name: {
                                            kind: "Name",
                                            value: "title",
                                          },
                                        },
                                        {
                                          kind: "Field",
                                          name: { kind: "Name", value: "type" },
                                        },
                                        {
                                          kind: "Field",
                                          name: {
                                            kind: "Name",
                                            value: "status",
                                          },
                                        },
                                      ],
                                    },
                                  },
                                ],
                              },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "attachments" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      { kind: "Field", name: { kind: "Name", value: "id" } },
                      { kind: "Field", name: { kind: "Name", value: "name" } },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "mimeType" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "sizeBytes" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "createdAt" },
                      },
                    ],
                  },
                },
                { kind: "Field", name: { kind: "Name", value: "createdAt" } },
                { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<ThreadQuery, ThreadQueryVariables>;
export const CreateThreadDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "CreateThread" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "input" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "CreateThreadInput" },
            },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "createThread" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "input" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "input" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "number" } },
                { kind: "Field", name: { kind: "Name", value: "title" } },
                { kind: "Field", name: { kind: "Name", value: "status" } },
                { kind: "Field", name: { kind: "Name", value: "agentId" } },
                { kind: "Field", name: { kind: "Name", value: "createdAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  CreateThreadMutation,
  CreateThreadMutationVariables
>;
export const UpdateThreadDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "UpdateThread" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "id" } },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "input" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "UpdateThreadInput" },
            },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "updateThread" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "id" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "id" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "input" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "input" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "title" } },
                { kind: "Field", name: { kind: "Name", value: "status" } },
                { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  UpdateThreadMutation,
  UpdateThreadMutationVariables
>;
export const OnAgentStatusChangedDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "subscription",
      name: { kind: "Name", value: "OnAgentStatusChanged" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "tenantId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "onAgentStatusChanged" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "tenantId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "tenantId" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "agentId" } },
                { kind: "Field", name: { kind: "Name", value: "tenantId" } },
                { kind: "Field", name: { kind: "Name", value: "status" } },
                { kind: "Field", name: { kind: "Name", value: "name" } },
                { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  OnAgentStatusChangedSubscription,
  OnAgentStatusChangedSubscriptionVariables
>;
export const OnNewMessageDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "subscription",
      name: { kind: "Name", value: "OnNewMessage" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "threadId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "onNewMessage" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "threadId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "threadId" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "messageId" } },
                { kind: "Field", name: { kind: "Name", value: "threadId" } },
                { kind: "Field", name: { kind: "Name", value: "tenantId" } },
                { kind: "Field", name: { kind: "Name", value: "role" } },
                { kind: "Field", name: { kind: "Name", value: "content" } },
                { kind: "Field", name: { kind: "Name", value: "senderType" } },
                { kind: "Field", name: { kind: "Name", value: "senderId" } },
                { kind: "Field", name: { kind: "Name", value: "createdAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  OnNewMessageSubscription,
  OnNewMessageSubscriptionVariables
>;
export const OnHeartbeatActivityDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "subscription",
      name: { kind: "Name", value: "OnHeartbeatActivity" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "tenantId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "onHeartbeatActivity" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "tenantId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "tenantId" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "heartbeatId" } },
                { kind: "Field", name: { kind: "Name", value: "tenantId" } },
                { kind: "Field", name: { kind: "Name", value: "status" } },
                { kind: "Field", name: { kind: "Name", value: "message" } },
                { kind: "Field", name: { kind: "Name", value: "createdAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  OnHeartbeatActivitySubscription,
  OnHeartbeatActivitySubscriptionVariables
>;
export const OnThreadUpdatedDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "subscription",
      name: { kind: "Name", value: "OnThreadUpdated" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "tenantId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "onThreadUpdated" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "tenantId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "tenantId" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "threadId" } },
                { kind: "Field", name: { kind: "Name", value: "tenantId" } },
                { kind: "Field", name: { kind: "Name", value: "status" } },
                { kind: "Field", name: { kind: "Name", value: "title" } },
                { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  OnThreadUpdatedSubscription,
  OnThreadUpdatedSubscriptionVariables
>;
export const OnThreadTurnUpdatedDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "subscription",
      name: { kind: "Name", value: "OnThreadTurnUpdated" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "tenantId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "onThreadTurnUpdated" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "tenantId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "tenantId" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "runId" } },
                { kind: "Field", name: { kind: "Name", value: "triggerId" } },
                { kind: "Field", name: { kind: "Name", value: "threadId" } },
                { kind: "Field", name: { kind: "Name", value: "tenantId" } },
                { kind: "Field", name: { kind: "Name", value: "status" } },
                { kind: "Field", name: { kind: "Name", value: "triggerName" } },
                { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  OnThreadTurnUpdatedSubscription,
  OnThreadTurnUpdatedSubscriptionVariables
>;
export const OnInboxItemStatusChangedDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "subscription",
      name: { kind: "Name", value: "OnInboxItemStatusChanged" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "tenantId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "onInboxItemStatusChanged" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "tenantId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "tenantId" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "inboxItemId" } },
                { kind: "Field", name: { kind: "Name", value: "tenantId" } },
                { kind: "Field", name: { kind: "Name", value: "status" } },
                { kind: "Field", name: { kind: "Name", value: "title" } },
                { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  OnInboxItemStatusChangedSubscription,
  OnInboxItemStatusChangedSubscriptionVariables
>;
export const InboxItemsDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "InboxItems" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "tenantId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "status" },
          },
          type: {
            kind: "NamedType",
            name: { kind: "Name", value: "InboxItemStatus" },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "entityType" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "String" } },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "entityId" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "inboxItems" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "tenantId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "tenantId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "status" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "status" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "entityType" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "entityType" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "entityId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "entityId" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "tenantId" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "requesterType" },
                },
                { kind: "Field", name: { kind: "Name", value: "requesterId" } },
                { kind: "Field", name: { kind: "Name", value: "type" } },
                { kind: "Field", name: { kind: "Name", value: "status" } },
                { kind: "Field", name: { kind: "Name", value: "title" } },
                { kind: "Field", name: { kind: "Name", value: "description" } },
                { kind: "Field", name: { kind: "Name", value: "entityType" } },
                { kind: "Field", name: { kind: "Name", value: "entityId" } },
                { kind: "Field", name: { kind: "Name", value: "config" } },
                { kind: "Field", name: { kind: "Name", value: "revision" } },
                { kind: "Field", name: { kind: "Name", value: "reviewNotes" } },
                { kind: "Field", name: { kind: "Name", value: "decidedBy" } },
                { kind: "Field", name: { kind: "Name", value: "decidedAt" } },
                { kind: "Field", name: { kind: "Name", value: "expiresAt" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "comments" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      { kind: "Field", name: { kind: "Name", value: "id" } },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "inboxItemId" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "authorType" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "authorId" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "content" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "createdAt" },
                      },
                    ],
                  },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "links" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      { kind: "Field", name: { kind: "Name", value: "id" } },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "linkedType" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "linkedId" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "createdAt" },
                      },
                    ],
                  },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "linkedThreads" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      { kind: "Field", name: { kind: "Name", value: "id" } },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "number" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "identifier" },
                      },
                      { kind: "Field", name: { kind: "Name", value: "title" } },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "status" },
                      },
                    ],
                  },
                },
                { kind: "Field", name: { kind: "Name", value: "createdAt" } },
                { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<InboxItemsQuery, InboxItemsQueryVariables>;
export const InboxItemDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "InboxItem" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "id" } },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "inboxItem" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "id" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "id" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "tenantId" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "requesterType" },
                },
                { kind: "Field", name: { kind: "Name", value: "requesterId" } },
                { kind: "Field", name: { kind: "Name", value: "type" } },
                { kind: "Field", name: { kind: "Name", value: "status" } },
                { kind: "Field", name: { kind: "Name", value: "title" } },
                { kind: "Field", name: { kind: "Name", value: "description" } },
                { kind: "Field", name: { kind: "Name", value: "entityType" } },
                { kind: "Field", name: { kind: "Name", value: "entityId" } },
                { kind: "Field", name: { kind: "Name", value: "config" } },
                { kind: "Field", name: { kind: "Name", value: "revision" } },
                { kind: "Field", name: { kind: "Name", value: "reviewNotes" } },
                { kind: "Field", name: { kind: "Name", value: "decidedBy" } },
                { kind: "Field", name: { kind: "Name", value: "decidedAt" } },
                { kind: "Field", name: { kind: "Name", value: "expiresAt" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "comments" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      { kind: "Field", name: { kind: "Name", value: "id" } },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "inboxItemId" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "authorType" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "authorId" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "content" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "createdAt" },
                      },
                    ],
                  },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "links" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      { kind: "Field", name: { kind: "Name", value: "id" } },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "linkedType" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "linkedId" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "createdAt" },
                      },
                    ],
                  },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "linkedThreads" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      { kind: "Field", name: { kind: "Name", value: "id" } },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "number" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "identifier" },
                      },
                      { kind: "Field", name: { kind: "Name", value: "title" } },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "status" },
                      },
                    ],
                  },
                },
                { kind: "Field", name: { kind: "Name", value: "createdAt" } },
                { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<InboxItemQuery, InboxItemQueryVariables>;
export const DecideInboxItemDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "DecideInboxItem" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "id" } },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "input" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "InboxItemDecisionInput" },
            },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "decideInboxItem" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "id" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "id" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "input" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "input" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "status" } },
                { kind: "Field", name: { kind: "Name", value: "reviewNotes" } },
                { kind: "Field", name: { kind: "Name", value: "decidedBy" } },
                { kind: "Field", name: { kind: "Name", value: "decidedAt" } },
                { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  DecideInboxItemMutation,
  DecideInboxItemMutationVariables
>;
export const AddInboxItemCommentDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "AddInboxItemComment" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "input" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "AddInboxItemCommentInput" },
            },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "addInboxItemComment" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "input" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "input" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "inboxItemId" } },
                { kind: "Field", name: { kind: "Name", value: "content" } },
                { kind: "Field", name: { kind: "Name", value: "authorType" } },
                { kind: "Field", name: { kind: "Name", value: "authorId" } },
                { kind: "Field", name: { kind: "Name", value: "createdAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  AddInboxItemCommentMutation,
  AddInboxItemCommentMutationVariables
>;
export const OnOrgUpdatedDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "subscription",
      name: { kind: "Name", value: "OnOrgUpdated" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "tenantId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "onOrgUpdated" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "tenantId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "tenantId" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "tenantId" } },
                { kind: "Field", name: { kind: "Name", value: "changeType" } },
                { kind: "Field", name: { kind: "Name", value: "entityType" } },
                { kind: "Field", name: { kind: "Name", value: "entityId" } },
                { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  OnOrgUpdatedSubscription,
  OnOrgUpdatedSubscriptionVariables
>;
export const ThreadTurnsForThreadDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "ThreadTurnsForThread" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "tenantId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "threadId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "limit" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "threadTurns" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "tenantId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "tenantId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "threadId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "threadId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "limit" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "limit" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "tenantId" } },
                { kind: "Field", name: { kind: "Name", value: "agentId" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "invocationSource" },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "triggerDetail" },
                },
                { kind: "Field", name: { kind: "Name", value: "triggerName" } },
                { kind: "Field", name: { kind: "Name", value: "threadId" } },
                { kind: "Field", name: { kind: "Name", value: "turnNumber" } },
                { kind: "Field", name: { kind: "Name", value: "status" } },
                { kind: "Field", name: { kind: "Name", value: "startedAt" } },
                { kind: "Field", name: { kind: "Name", value: "finishedAt" } },
                { kind: "Field", name: { kind: "Name", value: "error" } },
                { kind: "Field", name: { kind: "Name", value: "resultJson" } },
                { kind: "Field", name: { kind: "Name", value: "usageJson" } },
                { kind: "Field", name: { kind: "Name", value: "totalCost" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "retryAttempt" },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "originTurnId" },
                },
                { kind: "Field", name: { kind: "Name", value: "createdAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  ThreadTurnsForThreadQuery,
  ThreadTurnsForThreadQueryVariables
>;
export const ArtifactsForThreadDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "ArtifactsForThread" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "tenantId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "threadId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "limit" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "artifacts" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "tenantId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "tenantId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "threadId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "threadId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "limit" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "limit" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "tenantId" } },
                { kind: "Field", name: { kind: "Name", value: "agentId" } },
                { kind: "Field", name: { kind: "Name", value: "threadId" } },
                { kind: "Field", name: { kind: "Name", value: "title" } },
                { kind: "Field", name: { kind: "Name", value: "type" } },
                { kind: "Field", name: { kind: "Name", value: "status" } },
                { kind: "Field", name: { kind: "Name", value: "summary" } },
                { kind: "Field", name: { kind: "Name", value: "createdAt" } },
                { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  ArtifactsForThreadQuery,
  ArtifactsForThreadQueryVariables
>;
export const ArtifactDetailDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "ArtifactDetail" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "id" } },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "artifact" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "id" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "id" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "title" } },
                { kind: "Field", name: { kind: "Name", value: "type" } },
                { kind: "Field", name: { kind: "Name", value: "status" } },
                { kind: "Field", name: { kind: "Name", value: "content" } },
                { kind: "Field", name: { kind: "Name", value: "summary" } },
                { kind: "Field", name: { kind: "Name", value: "createdAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<ArtifactDetailQuery, ArtifactDetailQueryVariables>;
export const MemoryRecordsDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "MemoryRecords" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "userId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "namespace" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "String" },
            },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "memoryRecords" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "userId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "userId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "namespace" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "namespace" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "Field",
                  name: { kind: "Name", value: "memoryRecordId" },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "content" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      { kind: "Field", name: { kind: "Name", value: "text" } },
                    ],
                  },
                },
                { kind: "Field", name: { kind: "Name", value: "createdAt" } },
                { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
                { kind: "Field", name: { kind: "Name", value: "expiresAt" } },
                { kind: "Field", name: { kind: "Name", value: "namespace" } },
                { kind: "Field", name: { kind: "Name", value: "strategyId" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "wikiPages" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      { kind: "Field", name: { kind: "Name", value: "id" } },
                      { kind: "Field", name: { kind: "Name", value: "type" } },
                      { kind: "Field", name: { kind: "Name", value: "slug" } },
                      { kind: "Field", name: { kind: "Name", value: "title" } },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<MemoryRecordsQuery, MemoryRecordsQueryVariables>;
export const DeleteMemoryRecordDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "DeleteMemoryRecord" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "userId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "memoryRecordId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "deleteMemoryRecord" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "userId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "userId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "memoryRecordId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "memoryRecordId" },
                },
              },
            ],
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  DeleteMemoryRecordMutation,
  DeleteMemoryRecordMutationVariables
>;
export const UpdateMemoryRecordDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "UpdateMemoryRecord" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "userId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "memoryRecordId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "content" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "String" },
            },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "updateMemoryRecord" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "userId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "userId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "memoryRecordId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "memoryRecordId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "content" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "content" },
                },
              },
            ],
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  UpdateMemoryRecordMutation,
  UpdateMemoryRecordMutationVariables
>;
export const AgentWorkspaceReviewsDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "AgentWorkspaceReviews" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "tenantId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "agentId" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "responsibleUserId" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
        },
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "kind" } },
          type: {
            kind: "NamedType",
            name: { kind: "Name", value: "WorkspaceReviewKind" },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "status" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "String" } },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "limit" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "agentWorkspaceReviews" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "tenantId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "tenantId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "agentId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "agentId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "responsibleUserId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "responsibleUserId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "kind" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "kind" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "status" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "status" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "limit" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "limit" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "threadId" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "reviewObjectKey" },
                },
                { kind: "Field", name: { kind: "Name", value: "targetPath" } },
                { kind: "Field", name: { kind: "Name", value: "requestedAt" } },
                { kind: "Field", name: { kind: "Name", value: "reason" } },
                { kind: "Field", name: { kind: "Name", value: "payload" } },
                { kind: "Field", name: { kind: "Name", value: "reviewEtag" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "responsibleUserId" },
                },
                { kind: "Field", name: { kind: "Name", value: "kind" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "run" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      { kind: "Field", name: { kind: "Name", value: "id" } },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "agentId" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "targetPath" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "status" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "currentWakeupRequestId" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "currentThreadTurnId" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "lastEventAt" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "createdAt" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "updatedAt" },
                      },
                    ],
                  },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "latestEvent" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      { kind: "Field", name: { kind: "Name", value: "id" } },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "eventType" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "reason" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "sourceObjectKey" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "payload" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "createdAt" },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  AgentWorkspaceReviewsQuery,
  AgentWorkspaceReviewsQueryVariables
>;
export const AgentWorkspaceReviewDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "AgentWorkspaceReview" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "runId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "agentWorkspaceReview" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "runId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "runId" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "threadId" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "reviewObjectKey" },
                },
                { kind: "Field", name: { kind: "Name", value: "targetPath" } },
                { kind: "Field", name: { kind: "Name", value: "requestedAt" } },
                { kind: "Field", name: { kind: "Name", value: "reason" } },
                { kind: "Field", name: { kind: "Name", value: "payload" } },
                { kind: "Field", name: { kind: "Name", value: "reviewBody" } },
                { kind: "Field", name: { kind: "Name", value: "reviewEtag" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "reviewMissing" },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "responsibleUserId" },
                },
                { kind: "Field", name: { kind: "Name", value: "kind" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "proposedChanges" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      { kind: "Field", name: { kind: "Name", value: "path" } },
                      { kind: "Field", name: { kind: "Name", value: "kind" } },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "summary" },
                      },
                      { kind: "Field", name: { kind: "Name", value: "diff" } },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "before" },
                      },
                      { kind: "Field", name: { kind: "Name", value: "after" } },
                    ],
                  },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "run" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      { kind: "Field", name: { kind: "Name", value: "id" } },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "tenantId" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "agentId" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "targetPath" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "status" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "currentWakeupRequestId" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "currentThreadTurnId" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "lastEventAt" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "createdAt" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "updatedAt" },
                      },
                    ],
                  },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "events" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      { kind: "Field", name: { kind: "Name", value: "id" } },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "eventType" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "reason" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "sourceObjectKey" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "payload" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "createdAt" },
                      },
                    ],
                  },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "decisionEvents" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      { kind: "Field", name: { kind: "Name", value: "id" } },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "eventType" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "reason" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "actorType" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "actorId" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "payload" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "createdAt" },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  AgentWorkspaceReviewQuery,
  AgentWorkspaceReviewQueryVariables
>;
export const AcceptAgentWorkspaceReviewDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "AcceptAgentWorkspaceReview" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "runId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "input" },
          },
          type: {
            kind: "NamedType",
            name: { kind: "Name", value: "AgentWorkspaceReviewDecisionInput" },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "acceptAgentWorkspaceReview" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "runId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "runId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "input" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "input" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "status" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "currentWakeupRequestId" },
                },
                { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  AcceptAgentWorkspaceReviewMutation,
  AcceptAgentWorkspaceReviewMutationVariables
>;
export const CancelAgentWorkspaceReviewDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "CancelAgentWorkspaceReview" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "runId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "input" },
          },
          type: {
            kind: "NamedType",
            name: { kind: "Name", value: "AgentWorkspaceReviewDecisionInput" },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "cancelAgentWorkspaceReview" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "runId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "runId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "input" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "input" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "status" } },
                { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  CancelAgentWorkspaceReviewMutation,
  CancelAgentWorkspaceReviewMutationVariables
>;
export const ResumeAgentWorkspaceRunDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "ResumeAgentWorkspaceRun" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "runId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "input" },
          },
          type: {
            kind: "NamedType",
            name: { kind: "Name", value: "AgentWorkspaceReviewDecisionInput" },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "resumeAgentWorkspaceRun" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "runId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "runId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "input" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "input" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "status" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "currentWakeupRequestId" },
                },
                { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  ResumeAgentWorkspaceRunMutation,
  ResumeAgentWorkspaceRunMutationVariables
>;
export const RegisterPushTokenDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "RegisterPushToken" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "input" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "RegisterPushTokenInput" },
            },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "registerPushToken" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "input" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "input" },
                },
              },
            ],
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  RegisterPushTokenMutation,
  RegisterPushTokenMutationVariables
>;
export const UnregisterPushTokenDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "UnregisterPushToken" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "token" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "String" },
            },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "unregisterPushToken" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "token" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "token" },
                },
              },
            ],
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  UnregisterPushTokenMutation,
  UnregisterPushTokenMutationVariables
>;
export const AgentWorkspacesDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "AgentWorkspaces" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "tenantId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "tenantAgent" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "tenantId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "tenantId" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "subAgents" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      { kind: "Field", name: { kind: "Name", value: "id" } },
                      { kind: "Field", name: { kind: "Name", value: "slug" } },
                      { kind: "Field", name: { kind: "Name", value: "name" } },
                      { kind: "Field", name: { kind: "Name", value: "role" } },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  AgentWorkspacesQuery,
  AgentWorkspacesQueryVariables
>;
export const UserQuickActionsDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "UserQuickActions" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "tenantId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "userQuickActions" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "tenantId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "tenantId" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "userId" } },
                { kind: "Field", name: { kind: "Name", value: "tenantId" } },
                { kind: "Field", name: { kind: "Name", value: "title" } },
                { kind: "Field", name: { kind: "Name", value: "prompt" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "workspaceAgentId" },
                },
                { kind: "Field", name: { kind: "Name", value: "sortOrder" } },
                { kind: "Field", name: { kind: "Name", value: "createdAt" } },
                { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  UserQuickActionsQuery,
  UserQuickActionsQueryVariables
>;
export const CreateQuickActionDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "CreateQuickAction" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "input" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "CreateQuickActionInput" },
            },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "createQuickAction" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "input" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "input" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "userId" } },
                { kind: "Field", name: { kind: "Name", value: "tenantId" } },
                { kind: "Field", name: { kind: "Name", value: "title" } },
                { kind: "Field", name: { kind: "Name", value: "prompt" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "workspaceAgentId" },
                },
                { kind: "Field", name: { kind: "Name", value: "sortOrder" } },
                { kind: "Field", name: { kind: "Name", value: "createdAt" } },
                { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  CreateQuickActionMutation,
  CreateQuickActionMutationVariables
>;
export const UpdateQuickActionDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "UpdateQuickAction" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "id" } },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "input" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "UpdateQuickActionInput" },
            },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "updateQuickAction" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "id" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "id" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "input" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "input" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "userId" } },
                { kind: "Field", name: { kind: "Name", value: "tenantId" } },
                { kind: "Field", name: { kind: "Name", value: "title" } },
                { kind: "Field", name: { kind: "Name", value: "prompt" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "workspaceAgentId" },
                },
                { kind: "Field", name: { kind: "Name", value: "sortOrder" } },
                { kind: "Field", name: { kind: "Name", value: "createdAt" } },
                { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  UpdateQuickActionMutation,
  UpdateQuickActionMutationVariables
>;
export const DeleteQuickActionDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "DeleteQuickAction" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "id" } },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "deleteQuickAction" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "id" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "id" },
                },
              },
            ],
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  DeleteQuickActionMutation,
  DeleteQuickActionMutationVariables
>;
export const ReorderQuickActionsDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "ReorderQuickActions" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "input" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "ReorderQuickActionsInput" },
            },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "reorderQuickActions" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "input" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "input" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "sortOrder" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  ReorderQuickActionsMutation,
  ReorderQuickActionsMutationVariables
>;
export const RefreshGenUiDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "RefreshGenUI" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "messageId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "toolIndex" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "refreshGenUI" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "messageId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "messageId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "toolIndex" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "toolIndex" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "toolResults" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  RefreshGenUiMutation,
  RefreshGenUiMutationVariables
>;
export const CreateRecipeDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "CreateRecipe" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "input" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "CreateRecipeInput" },
            },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "createRecipe" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "input" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "input" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "title" } },
                { kind: "Field", name: { kind: "Name", value: "genuiType" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  CreateRecipeMutation,
  CreateRecipeMutationVariables
>;
