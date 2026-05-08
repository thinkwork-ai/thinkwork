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
  runtime: AgentRuntime;
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

export enum AgentRuntime {
  Flue = 'FLUE',
  Strands = 'STRANDS'
}

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
  /**
   * Context Engine opt-in metadata for the query_context built-in tool.
   * Shape validated at create/update time by
   * packages/api/src/lib/templates/context-engine-config.ts:
   *   { enabled: true }
   * Null means the template does not inject Context Engine.
   */
  contextEngine?: Maybe<Scalars['AWSJSON']['output']>;
  createdAt: Scalars['AWSDateTime']['output'];
  description?: Maybe<Scalars['String']['output']>;
  guardrailId?: Maybe<Scalars['ID']['output']>;
  icon?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  isPublished: Scalars['Boolean']['output'];
  knowledgeBaseIds?: Maybe<Scalars['AWSJSON']['output']>;
  model?: Maybe<Scalars['String']['output']>;
  name: Scalars['String']['output'];
  runtime: AgentRuntime;
  /**
   * Sandbox opt-in metadata for the AgentCore Code Interpreter sandbox
   * (plan Unit 3). Shape validated at create/update time by
   * packages/api/src/lib/templates/sandbox-config.ts:
   *   { environment: "default-public" | "internal-only" }
   * Null means the template does not use the sandbox.
   */
  sandbox?: Maybe<Scalars['AWSJSON']['output']>;
  /**
   * Send Email opt-in metadata for the platform email-sending built-in tool.
   * Shape validated at create/update time by
   * packages/api/src/lib/templates/send-email-config.ts:
   *   { enabled: true }
   * Null means the template does not inject Send Email.
   */
  sendEmail?: Maybe<Scalars['AWSJSON']['output']>;
  skills?: Maybe<Scalars['AWSJSON']['output']>;
  slug: Scalars['String']['output'];
  source: Scalars['String']['output'];
  templateKind: TemplateKind;
  tenantId?: Maybe<Scalars['ID']['output']>;
  updatedAt: Scalars['AWSDateTime']['output'];
  /**
   * Web Search opt-in metadata for the tenant-configured web-search built-in
   * tool. Shape validated at create/update time by
   * packages/api/src/lib/templates/web-search-config.ts:
   *   { enabled: true }
   * Null means the template does not inject Web Search.
   */
  webSearch?: Maybe<Scalars['AWSJSON']['output']>;
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

export type AgentWorkspaceEvent = {
  __typename?: 'AgentWorkspaceEvent';
  actorId?: Maybe<Scalars['String']['output']>;
  actorType?: Maybe<Scalars['String']['output']>;
  agentId?: Maybe<Scalars['ID']['output']>;
  auditObjectKey?: Maybe<Scalars['String']['output']>;
  bucket: Scalars['String']['output'];
  createdAt: Scalars['AWSDateTime']['output'];
  eventType: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  mirrorStatus: Scalars['String']['output'];
  objectEtag?: Maybe<Scalars['String']['output']>;
  objectVersionId?: Maybe<Scalars['String']['output']>;
  parentEventId?: Maybe<Scalars['ID']['output']>;
  payload?: Maybe<Scalars['AWSJSON']['output']>;
  reason?: Maybe<Scalars['String']['output']>;
  runId?: Maybe<Scalars['ID']['output']>;
  sequencer: Scalars['String']['output'];
  sourceObjectKey: Scalars['String']['output'];
  tenantId: Scalars['ID']['output'];
};

export enum AgentWorkspaceEventType {
  EventRejected = 'EVENT_REJECTED',
  MemoryChanged = 'MEMORY_CHANGED',
  ReviewRequested = 'REVIEW_REQUESTED',
  ReviewResponded = 'REVIEW_RESPONDED',
  RunBlocked = 'RUN_BLOCKED',
  RunCompleted = 'RUN_COMPLETED',
  RunFailed = 'RUN_FAILED',
  RunStarted = 'RUN_STARTED',
  WorkRequested = 'WORK_REQUESTED'
}

export type AgentWorkspaceProposedChange = {
  __typename?: 'AgentWorkspaceProposedChange';
  after?: Maybe<Scalars['String']['output']>;
  before?: Maybe<Scalars['String']['output']>;
  diff?: Maybe<Scalars['String']['output']>;
  kind: Scalars['String']['output'];
  path?: Maybe<Scalars['String']['output']>;
  summary: Scalars['String']['output'];
};

export type AgentWorkspaceReview = {
  __typename?: 'AgentWorkspaceReview';
  decisionEvents: Array<AgentWorkspaceEvent>;
  events: Array<AgentWorkspaceEvent>;
  kind: WorkspaceReviewKind;
  latestEvent?: Maybe<AgentWorkspaceEvent>;
  payload?: Maybe<Scalars['AWSJSON']['output']>;
  proposedChanges: Array<AgentWorkspaceProposedChange>;
  reason?: Maybe<Scalars['String']['output']>;
  requestedAt: Scalars['AWSDateTime']['output'];
  responsibleUserId?: Maybe<Scalars['ID']['output']>;
  reviewBody?: Maybe<Scalars['String']['output']>;
  reviewEtag?: Maybe<Scalars['String']['output']>;
  reviewMissing?: Maybe<Scalars['Boolean']['output']>;
  reviewObjectKey?: Maybe<Scalars['String']['output']>;
  run: AgentWorkspaceRun;
  targetPath: Scalars['String']['output'];
  threadId?: Maybe<Scalars['ID']['output']>;
};

export type AgentWorkspaceReviewDecisionInput = {
  expectedReviewEtag?: InputMaybe<Scalars['String']['input']>;
  idempotencyKey?: InputMaybe<Scalars['String']['input']>;
  notes?: InputMaybe<Scalars['String']['input']>;
  responseMarkdown?: InputMaybe<Scalars['String']['input']>;
};

export type AgentWorkspaceRun = {
  __typename?: 'AgentWorkspaceRun';
  agentId: Scalars['ID']['output'];
  completedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  createdAt: Scalars['AWSDateTime']['output'];
  currentThreadTurnId?: Maybe<Scalars['ID']['output']>;
  currentWakeupRequestId?: Maybe<Scalars['ID']['output']>;
  depth: Scalars['Int']['output'];
  id: Scalars['ID']['output'];
  inboxWriteCount: Scalars['Int']['output'];
  lastEventAt: Scalars['AWSDateTime']['output'];
  parentRunId?: Maybe<Scalars['ID']['output']>;
  requestObjectKey?: Maybe<Scalars['String']['output']>;
  sourceObjectKey?: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
  targetPath: Scalars['String']['output'];
  tenantId: Scalars['ID']['output'];
  updatedAt: Scalars['AWSDateTime']['output'];
  wakeupRetryCount: Scalars['Int']['output'];
};

export enum AgentWorkspaceRunStatus {
  AwaitingReview = 'AWAITING_REVIEW',
  AwaitingSubrun = 'AWAITING_SUBRUN',
  Cancelled = 'CANCELLED',
  Claimed = 'CLAIMED',
  Completed = 'COMPLETED',
  Expired = 'EXPIRED',
  Failed = 'FAILED',
  Pending = 'PENDING',
  Processing = 'PROCESSING'
}

export type AgentWorkspaceWait = {
  __typename?: 'AgentWorkspaceWait';
  createdAt: Scalars['AWSDateTime']['output'];
  id: Scalars['ID']['output'];
  satisfiedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  status: Scalars['String']['output'];
  tenantId: Scalars['ID']['output'];
  waitForRunId?: Maybe<Scalars['ID']['output']>;
  waitForTargetPath?: Maybe<Scalars['String']['output']>;
  waitingRunId: Scalars['ID']['output'];
};

export type ApproveInboxItemInput = {
  decisionValues?: InputMaybe<Scalars['AWSJSON']['input']>;
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

export type BrainEnrichmentCandidate = {
  __typename?: 'BrainEnrichmentCandidate';
  citation?: Maybe<BrainEnrichmentCitation>;
  id: Scalars['ID']['output'];
  providerId: Scalars['String']['output'];
  score?: Maybe<Scalars['Float']['output']>;
  sourceFamily: BrainEnrichmentSourceFamily;
  summary: Scalars['String']['output'];
  title: Scalars['String']['output'];
};

export type BrainEnrichmentCitation = {
  __typename?: 'BrainEnrichmentCitation';
  label?: Maybe<Scalars['String']['output']>;
  metadata?: Maybe<Scalars['AWSJSON']['output']>;
  sourceId?: Maybe<Scalars['String']['output']>;
  uri?: Maybe<Scalars['String']['output']>;
};

/**
 * The structured payload behind a `brain_enrichment_draft_review` workspace
 * review. `proposedBodyMd` renders as the in-place review surface; `snapshotMd`
 * is the pinned current body at draft-creation time so per-region rejection
 * reverts deterministically.
 */
export type BrainEnrichmentDraftPage = {
  __typename?: 'BrainEnrichmentDraftPage';
  pageTitle: Scalars['String']['output'];
  proposedBodyMd: Scalars['String']['output'];
  regions: Array<BrainEnrichmentDraftRegion>;
  snapshotMd: Scalars['String']['output'];
  targetPageId: Scalars['ID']['output'];
  targetPageTable: Scalars['String']['output'];
};

/**
 * One section-grain change region in a draft-page review. The mobile review
 * surface tap-targets the section in the in-place render, and the "show changes"
 * toggle uses beforeMd/afterMd to render a stacked diff.
 */
export type BrainEnrichmentDraftRegion = {
  __typename?: 'BrainEnrichmentDraftRegion';
  afterMd: Scalars['String']['output'];
  beforeMd: Scalars['String']['output'];
  citation?: Maybe<BrainEnrichmentCitation>;
  contributingCandidateIds: Array<Scalars['ID']['output']>;
  id: Scalars['ID']['output'];
  sectionHeading: Scalars['String']['output'];
  sectionSlug: Scalars['String']['output'];
  sourceFamily: BrainEnrichmentDraftRegionFamily;
};

/**
 * Source family aggregation for a single proposed-body region. MIXED is set when
 * multiple candidates from different families contributed to the same section.
 */
export enum BrainEnrichmentDraftRegionFamily {
  Brain = 'BRAIN',
  KnowledgeBase = 'KNOWLEDGE_BASE',
  Mixed = 'MIXED',
  Web = 'WEB'
}

export type BrainEnrichmentProposal = {
  __typename?: 'BrainEnrichmentProposal';
  candidates: Array<BrainEnrichmentCandidate>;
  createdAt: Scalars['AWSDateTime']['output'];
  id: Scalars['ID']['output'];
  providerStatuses: Array<BrainEnrichmentProviderStatus>;
  reviewObjectKey?: Maybe<Scalars['String']['output']>;
  reviewRunId?: Maybe<Scalars['ID']['output']>;
  status: Scalars['String']['output'];
  targetPageId: Scalars['ID']['output'];
  targetPageTable: Scalars['String']['output'];
  tenantId: Scalars['ID']['output'];
  threadId?: Maybe<Scalars['ID']['output']>;
  title: Scalars['String']['output'];
  updatedAt: Scalars['AWSDateTime']['output'];
};

export type BrainEnrichmentProviderStatus = {
  __typename?: 'BrainEnrichmentProviderStatus';
  displayName: Scalars['String']['output'];
  durationMs?: Maybe<Scalars['Int']['output']>;
  error?: Maybe<Scalars['String']['output']>;
  family: Scalars['String']['output'];
  hitCount?: Maybe<Scalars['Int']['output']>;
  providerId: Scalars['String']['output'];
  reason?: Maybe<Scalars['String']['output']>;
  sourceFamily?: Maybe<Scalars['String']['output']>;
  state: Scalars['String']['output'];
};

export type BrainEnrichmentSourceAvailability = {
  __typename?: 'BrainEnrichmentSourceAvailability';
  available: Scalars['Boolean']['output'];
  family: BrainEnrichmentSourceFamily;
  label: Scalars['String']['output'];
  reason?: Maybe<Scalars['String']['output']>;
  selectedByDefault: Scalars['Boolean']['output'];
};

export enum BrainEnrichmentSourceFamily {
  Brain = 'BRAIN',
  KnowledgeBase = 'KNOWLEDGE_BASE',
  Web = 'WEB'
}

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

export enum ComplianceActorType {
  Agent = 'AGENT',
  System = 'SYSTEM',
  User = 'USER'
}

export enum ComplianceAnchorState {
  Anchored = 'ANCHORED',
  Pending = 'PENDING'
}

export type ComplianceAnchorStatus = {
  __typename?: 'ComplianceAnchorStatus';
  anchoredRecordedAt?: Maybe<Scalars['String']['output']>;
  cadenceId?: Maybe<Scalars['ID']['output']>;
  nextCadenceWithinMinutes?: Maybe<Scalars['Int']['output']>;
  state: ComplianceAnchorState;
};

export type ComplianceEvent = {
  __typename?: 'ComplianceEvent';
  actor: Scalars['String']['output'];
  actorType: ComplianceActorType;
  anchorStatus: ComplianceAnchorStatus;
  eventHash: Scalars['String']['output'];
  eventId: Scalars['ID']['output'];
  eventType: ComplianceEventType;
  occurredAt: Scalars['String']['output'];
  payload: Scalars['AWSJSON']['output'];
  prevHash?: Maybe<Scalars['String']['output']>;
  recordedAt: Scalars['String']['output'];
  source: Scalars['String']['output'];
  tenantId: Scalars['ID']['output'];
};

export type ComplianceEventConnection = {
  __typename?: 'ComplianceEventConnection';
  edges: Array<ComplianceEventEdge>;
  pageInfo: ComplianceEventPageInfo;
};

export type ComplianceEventEdge = {
  __typename?: 'ComplianceEventEdge';
  cursor: Scalars['String']['output'];
  node: ComplianceEvent;
};

export type ComplianceEventFilter = {
  actorType?: InputMaybe<ComplianceActorType>;
  eventType?: InputMaybe<ComplianceEventType>;
  since?: InputMaybe<Scalars['String']['input']>;
  tenantId?: InputMaybe<Scalars['ID']['input']>;
  until?: InputMaybe<Scalars['String']['input']>;
};

export type ComplianceEventPageInfo = {
  __typename?: 'ComplianceEventPageInfo';
  endCursor?: Maybe<Scalars['String']['output']>;
  hasNextPage: Scalars['Boolean']['output'];
};

export enum ComplianceEventType {
  AgentCreated = 'AGENT_CREATED',
  AgentDeleted = 'AGENT_DELETED',
  AgentSkillsChanged = 'AGENT_SKILLS_CHANGED',
  ApprovalRecorded = 'APPROVAL_RECORDED',
  AuthSigninFailure = 'AUTH_SIGNIN_FAILURE',
  AuthSigninSuccess = 'AUTH_SIGNIN_SUCCESS',
  AuthSignout = 'AUTH_SIGNOUT',
  DataExportInitiated = 'DATA_EXPORT_INITIATED',
  McpAdded = 'MCP_ADDED',
  McpRemoved = 'MCP_REMOVED',
  PolicyAllowed = 'POLICY_ALLOWED',
  PolicyBlocked = 'POLICY_BLOCKED',
  PolicyBypassed = 'POLICY_BYPASSED',
  PolicyEvaluated = 'POLICY_EVALUATED',
  UserCreated = 'USER_CREATED',
  UserDeleted = 'USER_DELETED',
  UserDisabled = 'USER_DISABLED',
  UserInvited = 'USER_INVITED',
  WorkspaceGovernanceFileEdited = 'WORKSPACE_GOVERNANCE_FILE_EDITED'
}

export type ComplianceExport = {
  __typename?: 'ComplianceExport';
  completedAt?: Maybe<Scalars['String']['output']>;
  filter: Scalars['AWSJSON']['output'];
  format: ComplianceExportFormat;
  jobError?: Maybe<Scalars['String']['output']>;
  jobId: Scalars['ID']['output'];
  presignedUrl?: Maybe<Scalars['String']['output']>;
  presignedUrlExpiresAt?: Maybe<Scalars['String']['output']>;
  requestedAt: Scalars['String']['output'];
  requestedByActorId: Scalars['ID']['output'];
  s3Key?: Maybe<Scalars['String']['output']>;
  startedAt?: Maybe<Scalars['String']['output']>;
  status: ComplianceExportStatus;
  tenantId: Scalars['ID']['output'];
};

export enum ComplianceExportFormat {
  Csv = 'CSV',
  Json = 'JSON'
}

export enum ComplianceExportStatus {
  Complete = 'COMPLETE',
  Failed = 'FAILED',
  Queued = 'QUEUED',
  Running = 'RUNNING'
}

export type ComplianceOperatorCheckResult = {
  __typename?: 'ComplianceOperatorCheckResult';
  /**
   * True when the env var is non-empty. False means the dev/staging
   * environment hasn't configured the allowlist; admin UI surfaces a
   * distinct "allowlist not configured" message rather than silently
   * flipping to non-operator UI.
   */
  allowlistConfigured: Scalars['Boolean']['output'];
  /** True when the caller's email matches THINKWORK_PLATFORM_OPERATOR_EMAILS. */
  isOperator: Scalars['Boolean']['output'];
};

export type CompositionFeedbackSummary = {
  __typename?: 'CompositionFeedbackSummary';
  negative: Scalars['Int']['output'];
  positive: Scalars['Int']['output'];
  skillId: Scalars['String']['output'];
  total: Scalars['Int']['output'];
};

export type Computer = {
  __typename?: 'Computer';
  budgetMonthlyCents?: Maybe<Scalars['Int']['output']>;
  budgetPausedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  budgetPausedReason?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['AWSDateTime']['output'];
  createdBy?: Maybe<Scalars['ID']['output']>;
  desiredRuntimeStatus: ComputerDesiredRuntimeStatus;
  ecsServiceName?: Maybe<Scalars['String']['output']>;
  efsAccessPointId?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  lastActiveAt?: Maybe<Scalars['AWSDateTime']['output']>;
  lastHeartbeatAt?: Maybe<Scalars['AWSDateTime']['output']>;
  liveWorkspaceRoot?: Maybe<Scalars['String']['output']>;
  migratedFromAgentId?: Maybe<Scalars['ID']['output']>;
  migrationMetadata?: Maybe<Scalars['AWSJSON']['output']>;
  name: Scalars['String']['output'];
  owner?: Maybe<User>;
  ownerUserId: Scalars['ID']['output'];
  runtimeConfig?: Maybe<Scalars['AWSJSON']['output']>;
  runtimeStatus: ComputerRuntimeStatus;
  slug: Scalars['String']['output'];
  sourceAgent?: Maybe<Agent>;
  spentMonthlyCents?: Maybe<Scalars['Int']['output']>;
  status: ComputerStatus;
  template?: Maybe<AgentTemplate>;
  templateId: Scalars['ID']['output'];
  tenantId: Scalars['ID']['output'];
  updatedAt: Scalars['AWSDateTime']['output'];
};

export enum ComputerDesiredRuntimeStatus {
  Running = 'RUNNING',
  Stopped = 'STOPPED'
}

export type ComputerEvent = {
  __typename?: 'ComputerEvent';
  computerId: Scalars['ID']['output'];
  createdAt: Scalars['AWSDateTime']['output'];
  eventType: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  level: ComputerEventLevel;
  payload?: Maybe<Scalars['AWSJSON']['output']>;
  taskId?: Maybe<Scalars['ID']['output']>;
  tenantId: Scalars['ID']['output'];
};

export enum ComputerEventLevel {
  Debug = 'DEBUG',
  Error = 'ERROR',
  Info = 'INFO',
  Warn = 'WARN'
}

export enum ComputerRuntimeStatus {
  Failed = 'FAILED',
  Pending = 'PENDING',
  Running = 'RUNNING',
  Starting = 'STARTING',
  Stopped = 'STOPPED',
  Unknown = 'UNKNOWN'
}

export enum ComputerStatus {
  Active = 'ACTIVE',
  Archived = 'ARCHIVED',
  Failed = 'FAILED',
  Provisioning = 'PROVISIONING'
}

export type ComputerTask = {
  __typename?: 'ComputerTask';
  claimedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  completedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  computerId: Scalars['ID']['output'];
  createdAt: Scalars['AWSDateTime']['output'];
  createdByUserId?: Maybe<Scalars['ID']['output']>;
  error?: Maybe<Scalars['AWSJSON']['output']>;
  id: Scalars['ID']['output'];
  idempotencyKey?: Maybe<Scalars['String']['output']>;
  input?: Maybe<Scalars['AWSJSON']['output']>;
  output?: Maybe<Scalars['AWSJSON']['output']>;
  status: ComputerTaskStatus;
  taskType: ComputerTaskType;
  tenantId: Scalars['ID']['output'];
  updatedAt: Scalars['AWSDateTime']['output'];
};

export enum ComputerTaskStatus {
  Cancelled = 'CANCELLED',
  Completed = 'COMPLETED',
  Failed = 'FAILED',
  Pending = 'PENDING',
  Running = 'RUNNING'
}

export enum ComputerTaskType {
  ConnectorWork = 'CONNECTOR_WORK',
  GoogleCalendarUpcoming = 'GOOGLE_CALENDAR_UPCOMING',
  GoogleCliSmoke = 'GOOGLE_CLI_SMOKE',
  GoogleWorkspaceAuthCheck = 'GOOGLE_WORKSPACE_AUTH_CHECK',
  HealthCheck = 'HEALTH_CHECK',
  ThreadTurn = 'THREAD_TURN',
  WorkspaceFileDelete = 'WORKSPACE_FILE_DELETE',
  WorkspaceFileList = 'WORKSPACE_FILE_LIST',
  WorkspaceFileRead = 'WORKSPACE_FILE_READ',
  WorkspaceFileWrite = 'WORKSPACE_FILE_WRITE'
}

export type ConcurrencySnapshot = {
  __typename?: 'ConcurrencySnapshot';
  byAgent: Array<AgentCount>;
  byStatus: Array<StatusCount>;
  totalActive: Scalars['Int']['output'];
};

export type Connector = {
  __typename?: 'Connector';
  config?: Maybe<Scalars['AWSJSON']['output']>;
  connectionId?: Maybe<Scalars['ID']['output']>;
  createdAt: Scalars['AWSDateTime']['output'];
  createdById?: Maybe<Scalars['String']['output']>;
  createdByType?: Maybe<Scalars['String']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  dispatchTargetId: Scalars['ID']['output'];
  dispatchTargetType: DispatchTargetType;
  ebScheduleName?: Maybe<Scalars['String']['output']>;
  enabled: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  lastPollAt?: Maybe<Scalars['AWSDateTime']['output']>;
  lastPollCursor?: Maybe<Scalars['String']['output']>;
  name: Scalars['String']['output'];
  nextPollAt?: Maybe<Scalars['AWSDateTime']['output']>;
  status: ConnectorStatus;
  tenantId: Scalars['ID']['output'];
  type: Scalars['String']['output'];
  updatedAt: Scalars['AWSDateTime']['output'];
};

export type ConnectorDispatchResult = {
  __typename?: 'ConnectorDispatchResult';
  computerId?: Maybe<Scalars['ID']['output']>;
  computerTaskId?: Maybe<Scalars['ID']['output']>;
  connectorId: Scalars['ID']['output'];
  error?: Maybe<Scalars['String']['output']>;
  executionId?: Maybe<Scalars['ID']['output']>;
  externalRef?: Maybe<Scalars['String']['output']>;
  messageId?: Maybe<Scalars['ID']['output']>;
  reason?: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
  targetType?: Maybe<DispatchTargetType>;
  threadId?: Maybe<Scalars['ID']['output']>;
};

export type ConnectorExecution = {
  __typename?: 'ConnectorExecution';
  connectorId: Scalars['ID']['output'];
  costFinalizedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  createdAt: Scalars['AWSDateTime']['output'];
  currentState: ConnectorExecutionState;
  errorClass?: Maybe<Scalars['String']['output']>;
  externalRef: Scalars['String']['output'];
  finishedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  id: Scalars['ID']['output'];
  killTarget?: Maybe<Scalars['String']['output']>;
  killTargetAt?: Maybe<Scalars['AWSDateTime']['output']>;
  lastUsageEventAt?: Maybe<Scalars['AWSDateTime']['output']>;
  outcomePayload?: Maybe<Scalars['AWSJSON']['output']>;
  retryAttempt: Scalars['Int']['output'];
  spendEnvelopeUsdCents?: Maybe<Scalars['Int']['output']>;
  startedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  stateMachineArn?: Maybe<Scalars['String']['output']>;
  tenantId: Scalars['ID']['output'];
};

export enum ConnectorExecutionState {
  Cancelled = 'cancelled',
  Dispatching = 'dispatching',
  Failed = 'failed',
  Invoking = 'invoking',
  Pending = 'pending',
  RecordingResult = 'recording_result',
  Terminal = 'terminal'
}

export type ConnectorFilter = {
  includeArchived?: InputMaybe<Scalars['Boolean']['input']>;
  status?: InputMaybe<ConnectorStatus>;
  type?: InputMaybe<Scalars['String']['input']>;
};

export type ConnectorRunComputerTask = {
  __typename?: 'ConnectorRunComputerTask';
  completedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  createdAt: Scalars['AWSDateTime']['output'];
  error?: Maybe<Scalars['AWSJSON']['output']>;
  id: Scalars['ID']['output'];
  input?: Maybe<Scalars['AWSJSON']['output']>;
  output?: Maybe<Scalars['AWSJSON']['output']>;
  status: Scalars['String']['output'];
};

export type ConnectorRunDelegation = {
  __typename?: 'ConnectorRunDelegation';
  agentId: Scalars['ID']['output'];
  completedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  createdAt: Scalars['AWSDateTime']['output'];
  error?: Maybe<Scalars['AWSJSON']['output']>;
  id: Scalars['ID']['output'];
  inputArtifacts?: Maybe<Scalars['AWSJSON']['output']>;
  outputArtifacts?: Maybe<Scalars['AWSJSON']['output']>;
  result?: Maybe<Scalars['AWSJSON']['output']>;
  status: Scalars['String']['output'];
};

export type ConnectorRunLifecycle = {
  __typename?: 'ConnectorRunLifecycle';
  computerId?: Maybe<Scalars['ID']['output']>;
  computerTask?: Maybe<ConnectorRunComputerTask>;
  connector: Connector;
  delegation?: Maybe<ConnectorRunDelegation>;
  execution: ConnectorExecution;
  messageId?: Maybe<Scalars['ID']['output']>;
  threadId?: Maybe<Scalars['ID']['output']>;
  threadTurn?: Maybe<ConnectorRunThreadTurn>;
};

export type ConnectorRunNowResult = {
  __typename?: 'ConnectorRunNowResult';
  connectorId: Scalars['ID']['output'];
  results: Array<ConnectorDispatchResult>;
};

export type ConnectorRunThreadTurn = {
  __typename?: 'ConnectorRunThreadTurn';
  agentId?: Maybe<Scalars['ID']['output']>;
  createdAt: Scalars['AWSDateTime']['output'];
  error?: Maybe<Scalars['String']['output']>;
  errorCode?: Maybe<Scalars['String']['output']>;
  finishedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  id: Scalars['ID']['output'];
  resultJson?: Maybe<Scalars['AWSJSON']['output']>;
  startedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  status: Scalars['String']['output'];
  threadId?: Maybe<Scalars['ID']['output']>;
};

export enum ConnectorStatus {
  Active = 'active',
  Archived = 'archived',
  Paused = 'paused',
  Unhealthy = 'unhealthy'
}

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
  runtime?: InputMaybe<AgentRuntime>;
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
  /**
   * Context Engine opt-in metadata; see AgentTemplate.contextEngine. Omit
   * (or pass null) for templates that do not opt into query_context.
   */
  contextEngine?: InputMaybe<Scalars['AWSJSON']['input']>;
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
  runtime?: InputMaybe<AgentRuntime>;
  /**
   * Sandbox opt-in metadata; see AgentTemplate.sandbox. Validated at
   * resolver boundary. Omit (or pass null) for templates that do not
   * opt into the sandbox.
   */
  sandbox?: InputMaybe<Scalars['AWSJSON']['input']>;
  /**
   * Send Email opt-in metadata; see AgentTemplate.sendEmail. Omit
   * (or pass null) for templates that do not opt into Send Email.
   */
  sendEmail?: InputMaybe<Scalars['AWSJSON']['input']>;
  skills?: InputMaybe<Scalars['AWSJSON']['input']>;
  slug: Scalars['String']['input'];
  templateKind?: InputMaybe<TemplateKind>;
  tenantId: Scalars['ID']['input'];
  /**
   * Web Search opt-in metadata; see AgentTemplate.webSearch. Omit
   * (or pass null) for templates that do not opt into Web Search.
   */
  webSearch?: InputMaybe<Scalars['AWSJSON']['input']>;
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

export type CreateComputerInput = {
  budgetMonthlyCents?: InputMaybe<Scalars['Int']['input']>;
  migratedFromAgentId?: InputMaybe<Scalars['ID']['input']>;
  migrationMetadata?: InputMaybe<Scalars['AWSJSON']['input']>;
  name: Scalars['String']['input'];
  ownerUserId: Scalars['ID']['input'];
  runtimeConfig?: InputMaybe<Scalars['AWSJSON']['input']>;
  slug?: InputMaybe<Scalars['String']['input']>;
  templateId: Scalars['ID']['input'];
  tenantId: Scalars['ID']['input'];
};

export type CreateConnectorInput = {
  config?: InputMaybe<Scalars['AWSJSON']['input']>;
  connectionId?: InputMaybe<Scalars['ID']['input']>;
  createdById?: InputMaybe<Scalars['String']['input']>;
  createdByType?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  dispatchTargetId: Scalars['ID']['input'];
  dispatchTargetType: DispatchTargetType;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  name: Scalars['String']['input'];
  tenantId: Scalars['ID']['input'];
  type: Scalars['String']['input'];
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
  asl?: InputMaybe<Scalars['AWSJSON']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  markdownSummary?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  owningAgentId?: InputMaybe<Scalars['ID']['input']>;
  stepManifest?: InputMaybe<Scalars['AWSJSON']['input']>;
  teamId?: InputMaybe<Scalars['ID']['input']>;
  tenantId: Scalars['ID']['input'];
  visibility?: InputMaybe<RoutineVisibility>;
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

export type CreateTenantCredentialInput = {
  displayName: Scalars['String']['input'];
  kind: TenantCredentialKind;
  metadataJson?: InputMaybe<Scalars['AWSJSON']['input']>;
  secretJson: Scalars['AWSJSON']['input'];
  slug?: InputMaybe<Scalars['String']['input']>;
  tenantId: Scalars['ID']['input'];
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
  computerId?: InputMaybe<Scalars['ID']['input']>;
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

export type DecideRoutineApprovalInput = {
  decision: Scalars['AWSJSON']['input'];
  inboxItemId: Scalars['ID']['input'];
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

export enum DispatchTargetType {
  Agent = 'agent',
  Computer = 'computer',
  HybridRoutine = 'hybrid_routine',
  Routine = 'routine'
}

export type EnqueueComputerTaskInput = {
  computerId: Scalars['ID']['input'];
  idempotencyKey?: InputMaybe<Scalars['String']['input']>;
  input?: InputMaybe<Scalars['AWSJSON']['input']>;
  taskType: ComputerTaskType;
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

export type ImportN8nRoutineInput = {
  description?: InputMaybe<Scalars['String']['input']>;
  n8nCredentialSlug?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  pdiCredentialSlug?: InputMaybe<Scalars['String']['input']>;
  tenantId: Scalars['ID']['input'];
  workflowUrl: Scalars['String']['input'];
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
  decisionValues?: InputMaybe<Scalars['AWSJSON']['input']>;
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
  /** @deprecated Use userSlug */
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
  userSlug?: Maybe<Scalars['String']['output']>;
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
  /** @deprecated Use userId */
  agentId?: Maybe<Scalars['ID']['output']>;
  capturedAt: Scalars['AWSDateTime']['output'];
  content: Scalars['String']['output'];
  factType: MobileCaptureFactType;
  id: Scalars['ID']['output'];
  metadata?: Maybe<Scalars['AWSJSON']['output']>;
  syncedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  tenantId: Scalars['ID']['output'];
  userId: Scalars['ID']['output'];
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
  acceptAgentWorkspaceReview: AgentWorkspaceRun;
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
  archiveConnector: Connector;
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
  claimVanityEmailAddress: AgentCapability;
  /**
   * Admin-only: enqueue an ad-hoc compile job for a specific (tenant, user).
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
  createComputer: Computer;
  createConnector: Connector;
  createEvalTestCase: EvalTestCase;
  createInboxItem: InboxItem;
  createKnowledgeBase: KnowledgeBase;
  createQuickAction: UserQuickAction;
  createRecipe: Recipe;
  createRoutine: Routine;
  createScheduledJob: ScheduledJob;
  createTeam: Team;
  createTenant: Tenant;
  createTenantCredential: TenantCredential;
  createThread: Thread;
  createThreadLabel: ThreadLabel;
  createWakeupRequest: AgentWakeupRequest;
  createWebhook: Webhook;
  decideInboxItem: InboxItem;
  decideRoutineApproval: InboxItem;
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
  deleteTenantCredential: Scalars['Boolean']['output'];
  deleteThread: Scalars['Boolean']['output'];
  deleteThreadLabel: Scalars['Boolean']['output'];
  deleteWebhook: Scalars['Boolean']['output'];
  editTenantEntityFact: TenantEntitySection;
  enqueueComputerTask: ComputerTask;
  escalateThread: Thread;
  importN8nRoutine: Routine;
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
  pauseConnector: Connector;
  planRoutineDraft: RoutineDraft;
  publishRoutineVersion: RoutineAslVersion;
  rebuildRoutineVersion: RoutineAslVersion;
  refreshGenUI?: Maybe<Message>;
  regenerateWebhookToken?: Maybe<Webhook>;
  registerPushToken: Scalars['Boolean']['output'];
  rejectInboxItem: InboxItem;
  rejectTenantEntityFact: TenantEntitySection;
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
   * Admin-only replay: clear the compile cursor for (tenant, user). If
   * `force` is true, also archives every active page in the scope so the
   * next compile rebuilds from scratch. Destructive when force=true.
   */
  resetWikiCursor: WikiResetCursorResult;
  resubmitInboxItem: InboxItem;
  resumeAgentWorkspaceRun: AgentWorkspaceRun;
  resumeConnector: Connector;
  revokeAgentApiKey: AgentApiKey;
  rollbackAgentVersion: Agent;
  rotateTenantCredential: TenantCredential;
  runBrainPageEnrichment: BrainEnrichmentProposal;
  runConnectorNow: ConnectorRunNowResult;
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
  triggerRoutineRun: RoutineExecution;
  unpauseAgent: Agent;
  unregisterPushToken: Scalars['Boolean']['output'];
  updateAgent: Agent;
  updateAgentEmailAllowlist: AgentCapability;
  updateAgentRuntime: Agent;
  updateAgentStatus: Agent;
  updateAgentTemplate: AgentTemplate;
  updateArtifact: Artifact;
  updateComputer: Computer;
  updateConnector: Connector;
  updateEvalTestCase: EvalTestCase;
  updateKnowledgeBase: KnowledgeBase;
  updateMemoryRecord: Scalars['Boolean']['output'];
  updateQuickAction: UserQuickAction;
  updateRecipe: Recipe;
  updateRoutine: Routine;
  updateRoutineDefinition: RoutineDefinition;
  updateTeam: Team;
  updateTenant: Tenant;
  updateTenantCredential: TenantCredential;
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


export type MutationAcceptAgentWorkspaceReviewArgs = {
  input?: InputMaybe<AgentWorkspaceReviewDecisionInput>;
  runId: Scalars['ID']['input'];
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


export type MutationArchiveConnectorArgs = {
  id: Scalars['ID']['input'];
};


export type MutationAssignThreadLabelArgs = {
  labelId: Scalars['ID']['input'];
  threadId: Scalars['ID']['input'];
};


export type MutationBootstrapJournalImportArgs = {
  accountId: Scalars['ID']['input'];
  agentId?: InputMaybe<Scalars['ID']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  tenantId: Scalars['ID']['input'];
  userId?: InputMaybe<Scalars['ID']['input']>;
};


export type MutationCancelAgentWorkspaceReviewArgs = {
  input?: InputMaybe<AgentWorkspaceReviewDecisionInput>;
  runId: Scalars['ID']['input'];
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
  agentId?: InputMaybe<Scalars['ID']['input']>;
  clientCaptureId?: InputMaybe<Scalars['ID']['input']>;
  content: Scalars['String']['input'];
  factType?: InputMaybe<MobileCaptureFactType>;
  metadata?: InputMaybe<Scalars['AWSJSON']['input']>;
  tenantId?: InputMaybe<Scalars['ID']['input']>;
  userId?: InputMaybe<Scalars['ID']['input']>;
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
  ownerId?: InputMaybe<Scalars['ID']['input']>;
  tenantId: Scalars['ID']['input'];
  userId?: InputMaybe<Scalars['ID']['input']>;
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


export type MutationCreateComplianceExportArgs = {
  filter: ComplianceEventFilter;
  format: ComplianceExportFormat;
};


export type MutationCreateComputerArgs = {
  input: CreateComputerInput;
};


export type MutationCreateConnectorArgs = {
  input: CreateConnectorInput;
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


export type MutationDecideInboxItemArgs = {
  id: Scalars['ID']['input'];
  input: InboxItemDecisionInput;
};


export type MutationDecideRoutineApprovalArgs = {
  input: DecideRoutineApprovalInput;
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
  assistantId?: InputMaybe<Scalars['ID']['input']>;
  memoryRecordId: Scalars['ID']['input'];
  tenantId?: InputMaybe<Scalars['ID']['input']>;
  userId?: InputMaybe<Scalars['ID']['input']>;
};


export type MutationDeleteMessageArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteMobileMemoryCaptureArgs = {
  agentId?: InputMaybe<Scalars['ID']['input']>;
  captureId: Scalars['ID']['input'];
  tenantId?: InputMaybe<Scalars['ID']['input']>;
  userId?: InputMaybe<Scalars['ID']['input']>;
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


export type MutationDeleteTenantCredentialArgs = {
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


export type MutationEditTenantEntityFactArgs = {
  content: Scalars['String']['input'];
  factId: Scalars['ID']['input'];
};


export type MutationEnqueueComputerTaskArgs = {
  input: EnqueueComputerTaskInput;
};


export type MutationEscalateThreadArgs = {
  input: EscalateThreadInput;
};


export type MutationImportN8nRoutineArgs = {
  input: ImportN8nRoutineInput;
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


export type MutationPauseConnectorArgs = {
  id: Scalars['ID']['input'];
};


export type MutationPlanRoutineDraftArgs = {
  input: PlanRoutineDraftInput;
};


export type MutationPublishRoutineVersionArgs = {
  input: PublishRoutineVersionInput;
};


export type MutationRebuildRoutineVersionArgs = {
  input: RebuildRoutineVersionInput;
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


export type MutationRejectTenantEntityFactArgs = {
  factId: Scalars['ID']['input'];
  reason?: InputMaybe<Scalars['String']['input']>;
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
  ownerId?: InputMaybe<Scalars['ID']['input']>;
  tenantId: Scalars['ID']['input'];
  userId?: InputMaybe<Scalars['ID']['input']>;
};


export type MutationResubmitInboxItemArgs = {
  id: Scalars['ID']['input'];
  input?: InputMaybe<ResubmitInboxItemInput>;
};


export type MutationResumeAgentWorkspaceRunArgs = {
  input?: InputMaybe<AgentWorkspaceReviewDecisionInput>;
  runId: Scalars['ID']['input'];
};


export type MutationResumeConnectorArgs = {
  id: Scalars['ID']['input'];
};


export type MutationRevokeAgentApiKeyArgs = {
  id: Scalars['ID']['input'];
};


export type MutationRollbackAgentVersionArgs = {
  agentId: Scalars['ID']['input'];
  versionId: Scalars['ID']['input'];
};


export type MutationRotateTenantCredentialArgs = {
  input: RotateTenantCredentialInput;
};


export type MutationRunBrainPageEnrichmentArgs = {
  input: RunBrainPageEnrichmentInput;
};


export type MutationRunConnectorNowArgs = {
  id: Scalars['ID']['input'];
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
  input?: InputMaybe<Scalars['AWSJSON']['input']>;
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


export type MutationUpdateAgentRuntimeArgs = {
  id: Scalars['ID']['input'];
  runtime: AgentRuntime;
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


export type MutationUpdateComputerArgs = {
  id: Scalars['ID']['input'];
  input: UpdateComputerInput;
};


export type MutationUpdateConnectorArgs = {
  id: Scalars['ID']['input'];
  input: UpdateConnectorInput;
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
  assistantId?: InputMaybe<Scalars['ID']['input']>;
  content: Scalars['String']['input'];
  memoryRecordId: Scalars['ID']['input'];
  tenantId?: InputMaybe<Scalars['ID']['input']>;
  userId?: InputMaybe<Scalars['ID']['input']>;
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


export type MutationUpdateRoutineDefinitionArgs = {
  input: UpdateRoutineDefinitionInput;
};


export type MutationUpdateTeamArgs = {
  id: Scalars['ID']['input'];
  input: UpdateTeamInput;
};


export type MutationUpdateTenantArgs = {
  id: Scalars['ID']['input'];
  input: UpdateTenantInput;
};


export type MutationUpdateTenantCredentialArgs = {
  id: Scalars['ID']['input'];
  input: UpdateTenantCredentialInput;
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

export type PlanRoutineDraftInput = {
  description?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  steps?: InputMaybe<Array<RoutineDefinitionStepConfigInput>>;
  tenantId: Scalars['ID']['input'];
};

export type PublishRoutineVersionInput = {
  asl: Scalars['AWSJSON']['input'];
  markdownSummary: Scalars['String']['input'];
  routineId: Scalars['ID']['input'];
  stepManifest: Scalars['AWSJSON']['input'];
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
  agentWorkspaceEvents: Array<AgentWorkspaceEvent>;
  agentWorkspaceReview?: Maybe<AgentWorkspaceReview>;
  agentWorkspaceReviews: Array<AgentWorkspaceReview>;
  agentWorkspaceRuns: Array<AgentWorkspaceRun>;
  agentWorkspaces: Array<AgentWorkspace>;
  agents: Array<Agent>;
  allTenantAgents: Array<Agent>;
  artifact?: Maybe<Artifact>;
  artifacts: Array<Artifact>;
  brainEnrichmentSources: Array<BrainEnrichmentSourceAvailability>;
  budgetPolicies: Array<BudgetPolicy>;
  budgetStatus: Array<BudgetStatus>;
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
  complianceTenants: Array<Scalars['ID']['output']>;
  compositionFeedbackSummary: Array<CompositionFeedbackSummary>;
  computer?: Maybe<Computer>;
  computerEvents: Array<ComputerEvent>;
  computerTasks: Array<ComputerTask>;
  computers: Array<Computer>;
  concurrencySnapshot: ConcurrencySnapshot;
  connector?: Maybe<Connector>;
  connectorExecution?: Maybe<ConnectorExecution>;
  connectorExecutions: Array<ConnectorExecution>;
  connectorRunLifecycles: Array<ConnectorRunLifecycle>;
  connectors: Array<Connector>;
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
   * body_md), scoped to one (tenant, user) pair. Returns results in
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
  myComputer?: Maybe<Computer>;
  pendingSystemReviewsCount: Scalars['Int']['output'];
  performanceTimeSeries: Array<PerformanceTimeSeries>;
  queuedWakeups: Array<AgentWakeupRequest>;
  /**
   * Newest compiled wiki pages for the given user, ordered by
   * last_compiled_at DESC (falling back to updated_at when the page hasn't
   * been recompiled yet). Intended as the default Memories-tab feed so
   * the user sees fresh pages before they type a search query.
   */
  recentWikiPages: Array<WikiPage>;
  recipe?: Maybe<Recipe>;
  recipes: Array<Recipe>;
  routine?: Maybe<Routine>;
  routineAslVersion?: Maybe<RoutineAslVersion>;
  routineDefinition?: Maybe<RoutineDefinition>;
  routineExecution?: Maybe<RoutineExecution>;
  routineExecutions: Array<RoutineExecution>;
  routineRecipeCatalog: Array<RoutineRecipe>;
  routineStepEvents: Array<RoutineStepEvent>;
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
  tenantCredentials: Array<TenantCredential>;
  tenantEntityFacets: TenantEntityFacetConnection;
  tenantEntityPage?: Maybe<TenantEntityPage>;
  tenantMembers: Array<TenantMember>;
  tenantToolInventory: TenantToolInventory;
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
   * Admin-only: list recent compile jobs for a tenant. When `userId` is
   * provided, restricts to that user's jobs; when null/absent, returns
   * jobs across every user in the tenant. Ordered newest-first.
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
   * User-scoped force-graph: every active wiki page + every page-to-page
   * link whose endpoints are both active in the same `(tenant, user)`
   * scope. Links that reference archived pages are excluded. One round-trip.
   */
  wikiGraph: WikiGraph;
  /** Read one compiled page by slug. `userId` is required. */
  wikiPage?: Maybe<WikiPage>;
  /**
   * Postgres full-text search over compiled pages in a single (tenant, user)
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


export type QueryAgentWorkspaceEventsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  runId: Scalars['ID']['input'];
};


export type QueryAgentWorkspaceReviewArgs = {
  runId: Scalars['ID']['input'];
};


export type QueryAgentWorkspaceReviewsArgs = {
  agentId?: InputMaybe<Scalars['ID']['input']>;
  kind?: InputMaybe<WorkspaceReviewKind>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  responsibleUserId?: InputMaybe<Scalars['ID']['input']>;
  status?: InputMaybe<Scalars['String']['input']>;
  tenantId: Scalars['ID']['input'];
};


export type QueryAgentWorkspaceRunsArgs = {
  agentId?: InputMaybe<Scalars['ID']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  status?: InputMaybe<Scalars['String']['input']>;
  targetPath?: InputMaybe<Scalars['String']['input']>;
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


export type QueryBrainEnrichmentSourcesArgs = {
  pageId: Scalars['ID']['input'];
  pageTable: Scalars['String']['input'];
  tenantId: Scalars['ID']['input'];
};


export type QueryBudgetPoliciesArgs = {
  tenantId: Scalars['ID']['input'];
};


export type QueryBudgetStatusArgs = {
  tenantId: Scalars['ID']['input'];
};


export type QueryComplianceEventArgs = {
  eventId: Scalars['ID']['input'];
};


export type QueryComplianceEventByHashArgs = {
  eventHash: Scalars['String']['input'];
};


export type QueryComplianceEventsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  filter?: InputMaybe<ComplianceEventFilter>;
  first?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryCompositionFeedbackSummaryArgs = {
  skillId?: InputMaybe<Scalars['String']['input']>;
  tenantId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryComputerArgs = {
  id: Scalars['ID']['input'];
};


export type QueryComputerEventsArgs = {
  computerId: Scalars['ID']['input'];
  limit?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryComputerTasksArgs = {
  computerId: Scalars['ID']['input'];
  limit?: InputMaybe<Scalars['Int']['input']>;
  status?: InputMaybe<ComputerTaskStatus>;
};


export type QueryComputersArgs = {
  status?: InputMaybe<ComputerStatus>;
  tenantId: Scalars['ID']['input'];
};


export type QueryConcurrencySnapshotArgs = {
  tenantId: Scalars['ID']['input'];
};


export type QueryConnectorArgs = {
  id: Scalars['ID']['input'];
};


export type QueryConnectorExecutionArgs = {
  id: Scalars['ID']['input'];
};


export type QueryConnectorExecutionsArgs = {
  connectorId?: InputMaybe<Scalars['ID']['input']>;
  cursor?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  status?: InputMaybe<ConnectorExecutionState>;
};


export type QueryConnectorRunLifecyclesArgs = {
  connectorId?: InputMaybe<Scalars['ID']['input']>;
  cursor?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryConnectorsArgs = {
  cursor?: InputMaybe<Scalars['String']['input']>;
  filter?: InputMaybe<ConnectorFilter>;
  limit?: InputMaybe<Scalars['Int']['input']>;
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
  assistantId?: InputMaybe<Scalars['ID']['input']>;
  tenantId?: InputMaybe<Scalars['ID']['input']>;
  userId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryMemoryRecordsArgs = {
  assistantId?: InputMaybe<Scalars['ID']['input']>;
  namespace: Scalars['String']['input'];
  tenantId?: InputMaybe<Scalars['ID']['input']>;
  userId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryMemorySearchArgs = {
  assistantId?: InputMaybe<Scalars['ID']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  query: Scalars['String']['input'];
  strategy?: InputMaybe<MemoryStrategy>;
  tenantId?: InputMaybe<Scalars['ID']['input']>;
  userId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryMessagesArgs = {
  cursor?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  threadId: Scalars['ID']['input'];
};


export type QueryMobileMemoryCapturesArgs = {
  agentId?: InputMaybe<Scalars['ID']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  tenantId?: InputMaybe<Scalars['ID']['input']>;
  userId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryMobileMemorySearchArgs = {
  agentId?: InputMaybe<Scalars['ID']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  query: Scalars['String']['input'];
  tenantId?: InputMaybe<Scalars['ID']['input']>;
  userId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryMobileWikiSearchArgs = {
  agentId?: InputMaybe<Scalars['ID']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  query: Scalars['String']['input'];
  tenantId?: InputMaybe<Scalars['ID']['input']>;
  userId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryPendingSystemReviewsCountArgs = {
  tenantId: Scalars['ID']['input'];
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
  agentId?: InputMaybe<Scalars['ID']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  tenantId?: InputMaybe<Scalars['ID']['input']>;
  userId?: InputMaybe<Scalars['ID']['input']>;
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


export type QueryRoutineAslVersionArgs = {
  id: Scalars['ID']['input'];
};


export type QueryRoutineDefinitionArgs = {
  routineId: Scalars['ID']['input'];
};


export type QueryRoutineExecutionArgs = {
  id: Scalars['ID']['input'];
};


export type QueryRoutineExecutionsArgs = {
  cursor?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  routineId: Scalars['ID']['input'];
  status?: InputMaybe<RoutineExecutionStatus>;
};


export type QueryRoutineRecipeCatalogArgs = {
  tenantId: Scalars['ID']['input'];
};


export type QueryRoutineStepEventsArgs = {
  executionId: Scalars['ID']['input'];
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


export type QueryTenantCredentialsArgs = {
  status?: InputMaybe<TenantCredentialStatus>;
  tenantId: Scalars['ID']['input'];
};


export type QueryTenantEntityFacetsArgs = {
  cursor?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  pageId: Scalars['ID']['input'];
};


export type QueryTenantEntityPageArgs = {
  pageId: Scalars['ID']['input'];
  tenantId: Scalars['ID']['input'];
};


export type QueryTenantMembersArgs = {
  tenantId: Scalars['ID']['input'];
};


export type QueryTenantToolInventoryArgs = {
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
  computerId?: InputMaybe<Scalars['ID']['input']>;
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
  userId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryWikiConnectedPagesArgs = {
  pageId: Scalars['ID']['input'];
};


export type QueryWikiGraphArgs = {
  ownerId?: InputMaybe<Scalars['ID']['input']>;
  tenantId: Scalars['ID']['input'];
  userId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryWikiPageArgs = {
  ownerId?: InputMaybe<Scalars['ID']['input']>;
  slug: Scalars['String']['input'];
  tenantId: Scalars['ID']['input'];
  type: WikiPageType;
  userId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryWikiSearchArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  ownerId?: InputMaybe<Scalars['ID']['input']>;
  query: Scalars['String']['input'];
  tenantId: Scalars['ID']['input'];
  userId?: InputMaybe<Scalars['ID']['input']>;
};

export enum QuickActionScope {
  Task = 'task',
  Thread = 'thread'
}

export type RebuildRoutineVersionInput = {
  routineId: Scalars['ID']['input'];
};

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

export type RotateTenantCredentialInput = {
  id: Scalars['ID']['input'];
  secretJson: Scalars['AWSJSON']['input'];
};

export type Routine = {
  __typename?: 'Routine';
  agent?: Maybe<Agent>;
  agentId?: Maybe<Scalars['ID']['output']>;
  config?: Maybe<Scalars['AWSJSON']['output']>;
  createdAt: Scalars['AWSDateTime']['output'];
  currentVersion?: Maybe<Scalars['Int']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  documentationMd?: Maybe<Scalars['String']['output']>;
  engine: Scalars['String']['output'];
  executions?: Maybe<Array<RoutineExecution>>;
  id: Scalars['ID']['output'];
  lastRunAt?: Maybe<Scalars['AWSDateTime']['output']>;
  name: Scalars['String']['output'];
  nextRunAt?: Maybe<Scalars['AWSDateTime']['output']>;
  owningAgentId?: Maybe<Scalars['ID']['output']>;
  schedule?: Maybe<Scalars['String']['output']>;
  stateMachineAliasArn?: Maybe<Scalars['String']['output']>;
  stateMachineArn?: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
  team?: Maybe<Team>;
  teamId?: Maybe<Scalars['ID']['output']>;
  tenantId: Scalars['ID']['output'];
  triggers: Array<RoutineTrigger>;
  type: Scalars['String']['output'];
  updatedAt: Scalars['AWSDateTime']['output'];
  visibility: RoutineVisibility;
};

export type RoutineAslVersion = {
  __typename?: 'RoutineAslVersion';
  aliasWasPointing?: Maybe<Scalars['String']['output']>;
  aslJson: Scalars['AWSJSON']['output'];
  createdAt: Scalars['AWSDateTime']['output'];
  id: Scalars['ID']['output'];
  markdownSummary: Scalars['String']['output'];
  publishedByActorId?: Maybe<Scalars['ID']['output']>;
  publishedByActorType?: Maybe<Scalars['String']['output']>;
  routineId: Scalars['ID']['output'];
  stateMachineArn: Scalars['String']['output'];
  stepManifestJson: Scalars['AWSJSON']['output'];
  tenantId: Scalars['ID']['output'];
  validationWarningsJson?: Maybe<Scalars['AWSJSON']['output']>;
  versionArn: Scalars['String']['output'];
  versionNumber: Scalars['Int']['output'];
};

export type RoutineDefinition = {
  __typename?: 'RoutineDefinition';
  aslJson?: Maybe<Scalars['AWSJSON']['output']>;
  currentVersion?: Maybe<Scalars['Int']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  kind: Scalars['String']['output'];
  markdownSummary?: Maybe<Scalars['String']['output']>;
  routineId: Scalars['ID']['output'];
  stepManifestJson?: Maybe<Scalars['AWSJSON']['output']>;
  steps: Array<RoutineDefinitionStep>;
  title: Scalars['String']['output'];
  versionId?: Maybe<Scalars['ID']['output']>;
};

export type RoutineDefinitionConfigField = {
  __typename?: 'RoutineDefinitionConfigField';
  control?: Maybe<Scalars['String']['output']>;
  editable: Scalars['Boolean']['output'];
  helpText?: Maybe<Scalars['String']['output']>;
  inputType: Scalars['String']['output'];
  key: Scalars['String']['output'];
  label: Scalars['String']['output'];
  max?: Maybe<Scalars['Float']['output']>;
  min?: Maybe<Scalars['Float']['output']>;
  options?: Maybe<Array<Scalars['String']['output']>>;
  pattern?: Maybe<Scalars['String']['output']>;
  placeholder?: Maybe<Scalars['String']['output']>;
  required: Scalars['Boolean']['output'];
  value?: Maybe<Scalars['AWSJSON']['output']>;
};

export type RoutineDefinitionGraphEdgeInput = {
  condition?: InputMaybe<Scalars['AWSJSON']['input']>;
  kind: Scalars['String']['input'];
  label?: InputMaybe<Scalars['String']['input']>;
  source: Scalars['String']['input'];
  target: Scalars['String']['input'];
};

export type RoutineDefinitionGraphInput = {
  edges: Array<RoutineDefinitionGraphEdgeInput>;
  nodes: Array<RoutineDefinitionGraphNodeInput>;
  startNodeId?: InputMaybe<Scalars['String']['input']>;
};

export type RoutineDefinitionGraphNodeInput = {
  args?: InputMaybe<Scalars['AWSJSON']['input']>;
  kind?: InputMaybe<Scalars['String']['input']>;
  label?: InputMaybe<Scalars['String']['input']>;
  nodeId: Scalars['String']['input'];
  recipeId?: InputMaybe<Scalars['String']['input']>;
};

export type RoutineDefinitionStep = {
  __typename?: 'RoutineDefinitionStep';
  args: Scalars['AWSJSON']['output'];
  configFields: Array<RoutineDefinitionConfigField>;
  label: Scalars['String']['output'];
  nodeId: Scalars['String']['output'];
  recipeId: Scalars['String']['output'];
  recipeName: Scalars['String']['output'];
};

export type RoutineDefinitionStepConfigInput = {
  args: Scalars['AWSJSON']['input'];
  label?: InputMaybe<Scalars['String']['input']>;
  nodeId: Scalars['String']['input'];
  recipeId?: InputMaybe<Scalars['String']['input']>;
};

export type RoutineDraft = {
  __typename?: 'RoutineDraft';
  asl: Scalars['AWSJSON']['output'];
  description?: Maybe<Scalars['String']['output']>;
  kind: Scalars['String']['output'];
  markdownSummary: Scalars['String']['output'];
  stepManifest: Scalars['AWSJSON']['output'];
  steps: Array<RoutineDefinitionStep>;
  title: Scalars['String']['output'];
};

export enum RoutineEngine {
  LegacyPython = 'LEGACY_PYTHON',
  StepFunctions = 'STEP_FUNCTIONS'
}

export type RoutineExecution = {
  __typename?: 'RoutineExecution';
  aliasArn?: Maybe<Scalars['String']['output']>;
  aslVersion?: Maybe<RoutineAslVersion>;
  createdAt: Scalars['AWSDateTime']['output'];
  errorCode?: Maybe<Scalars['String']['output']>;
  errorMessage?: Maybe<Scalars['String']['output']>;
  finishedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  id: Scalars['ID']['output'];
  inputJson?: Maybe<Scalars['AWSJSON']['output']>;
  outputJson?: Maybe<Scalars['AWSJSON']['output']>;
  routine?: Maybe<Routine>;
  routineId: Scalars['ID']['output'];
  sfnExecutionArn: Scalars['String']['output'];
  startedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  stateMachineArn: Scalars['String']['output'];
  status: Scalars['String']['output'];
  stepEvents: Array<RoutineStepEvent>;
  tenantId: Scalars['ID']['output'];
  totalLlmCostUsdCents?: Maybe<Scalars['Int']['output']>;
  trigger?: Maybe<RoutineTrigger>;
  triggerId?: Maybe<Scalars['ID']['output']>;
  triggerSource: Scalars['String']['output'];
  versionArn?: Maybe<Scalars['String']['output']>;
};

export enum RoutineExecutionStatus {
  AwaitingApproval = 'AWAITING_APPROVAL',
  Cancelled = 'CANCELLED',
  Failed = 'FAILED',
  Running = 'RUNNING',
  Succeeded = 'SUCCEEDED',
  TimedOut = 'TIMED_OUT'
}

export type RoutineRecipe = {
  __typename?: 'RoutineRecipe';
  category: Scalars['String']['output'];
  configFields: Array<RoutineRecipeConfigField>;
  defaultArgs: Scalars['AWSJSON']['output'];
  description: Scalars['String']['output'];
  displayName: Scalars['String']['output'];
  hitlCapable: Scalars['Boolean']['output'];
  id: Scalars['String']['output'];
};

export type RoutineRecipeConfigField = {
  __typename?: 'RoutineRecipeConfigField';
  control?: Maybe<Scalars['String']['output']>;
  editable: Scalars['Boolean']['output'];
  helpText?: Maybe<Scalars['String']['output']>;
  inputType: Scalars['String']['output'];
  key: Scalars['String']['output'];
  label: Scalars['String']['output'];
  max?: Maybe<Scalars['Float']['output']>;
  min?: Maybe<Scalars['Float']['output']>;
  options?: Maybe<Array<Scalars['String']['output']>>;
  pattern?: Maybe<Scalars['String']['output']>;
  placeholder?: Maybe<Scalars['String']['output']>;
  required: Scalars['Boolean']['output'];
  value?: Maybe<Scalars['AWSJSON']['output']>;
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

export type RoutineStepEvent = {
  __typename?: 'RoutineStepEvent';
  createdAt: Scalars['AWSDateTime']['output'];
  errorJson?: Maybe<Scalars['AWSJSON']['output']>;
  executionId: Scalars['ID']['output'];
  finishedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  id: Scalars['ID']['output'];
  inputJson?: Maybe<Scalars['AWSJSON']['output']>;
  llmCostUsdCents?: Maybe<Scalars['Int']['output']>;
  nodeId: Scalars['String']['output'];
  outputJson?: Maybe<Scalars['AWSJSON']['output']>;
  recipeType: Scalars['String']['output'];
  retryCount: Scalars['Int']['output'];
  startedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  status: Scalars['String']['output'];
  stderrS3Uri?: Maybe<Scalars['String']['output']>;
  stdoutPreview?: Maybe<Scalars['String']['output']>;
  stdoutS3Uri?: Maybe<Scalars['String']['output']>;
  tenantId: Scalars['ID']['output'];
  truncated: Scalars['Boolean']['output'];
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

export enum RoutineVisibility {
  AgentPrivate = 'agent_private',
  TenantShared = 'tenant_shared'
}

export type RunBrainPageEnrichmentInput = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  pageId: Scalars['ID']['input'];
  pageTable: Scalars['String']['input'];
  query?: InputMaybe<Scalars['String']['input']>;
  sourceFamilies?: InputMaybe<Array<BrainEnrichmentSourceFamily>>;
  tenantId: Scalars['ID']['input'];
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

export enum TemplateKind {
  Agent = 'AGENT',
  Computer = 'COMPUTER'
}

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

export type TenantCredential = {
  __typename?: 'TenantCredential';
  createdAt: Scalars['AWSDateTime']['output'];
  createdByUserId?: Maybe<Scalars['ID']['output']>;
  deletedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  displayName: Scalars['String']['output'];
  eventbridgeConnectionArn?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  kind: TenantCredentialKind;
  lastUsedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  lastValidatedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  metadataJson: Scalars['AWSJSON']['output'];
  schemaJson: Scalars['AWSJSON']['output'];
  slug: Scalars['String']['output'];
  status: TenantCredentialStatus;
  tenantId: Scalars['ID']['output'];
  updatedAt: Scalars['AWSDateTime']['output'];
};

export enum TenantCredentialKind {
  ApiKey = 'api_key',
  BasicAuth = 'basic_auth',
  BearerToken = 'bearer_token',
  Json = 'json',
  SoapPartner = 'soap_partner',
  WebhookSigningSecret = 'webhook_signing_secret'
}

export enum TenantCredentialStatus {
  Active = 'active',
  Deleted = 'deleted',
  Disabled = 'disabled'
}

export type TenantEntityFacetConnection = {
  __typename?: 'TenantEntityFacetConnection';
  edges: Array<TenantEntityFacetEdge>;
  pageInfo: PageInfo;
};

export type TenantEntityFacetEdge = {
  __typename?: 'TenantEntityFacetEdge';
  cursor: Scalars['String']['output'];
  node: TenantEntitySection;
};

export type TenantEntityPage = {
  __typename?: 'TenantEntityPage';
  bodyMd?: Maybe<Scalars['String']['output']>;
  entitySubtype: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  sections: Array<TenantEntitySection>;
  slug: Scalars['String']['output'];
  status: Scalars['String']['output'];
  summary?: Maybe<Scalars['String']['output']>;
  tenantId: Scalars['ID']['output'];
  title: Scalars['String']['output'];
  type: Scalars['String']['output'];
  updatedAt: Scalars['AWSDateTime']['output'];
};

export type TenantEntitySection = {
  __typename?: 'TenantEntitySection';
  bodyMd: Scalars['String']['output'];
  facetType?: Maybe<Scalars['String']['output']>;
  heading: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  lastSourceAt?: Maybe<Scalars['AWSDateTime']['output']>;
  position: Scalars['Int']['output'];
  sectionSlug: Scalars['String']['output'];
  status: Scalars['String']['output'];
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

export type TenantToolInventory = {
  __typename?: 'TenantToolInventory';
  agents: Array<TenantToolInventoryAgent>;
  routines: Array<TenantToolInventoryRoutine>;
  skills: Array<TenantToolInventorySkill>;
  tools: Array<TenantToolInventoryTool>;
};

export type TenantToolInventoryAgent = {
  __typename?: 'TenantToolInventoryAgent';
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
};

export type TenantToolInventoryRoutine = {
  __typename?: 'TenantToolInventoryRoutine';
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  visibility?: Maybe<Scalars['String']['output']>;
};

export type TenantToolInventorySkill = {
  __typename?: 'TenantToolInventorySkill';
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  slug: Scalars['String']['output'];
};

export type TenantToolInventoryTool = {
  __typename?: 'TenantToolInventoryTool';
  argSchemaJson?: Maybe<Scalars['AWSJSON']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  source: Scalars['String']['output'];
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
  computerId?: Maybe<Scalars['ID']['output']>;
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
  Connector = 'CONNECTOR',
  Email = 'EMAIL',
  Manual = 'MANUAL',
  Schedule = 'SCHEDULE',
  Task = 'TASK',
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
  /**
   * Context Engine opt-in metadata; see AgentTemplate.contextEngine. Pass
   * null to clear; omit to leave unchanged.
   */
  contextEngine?: InputMaybe<Scalars['AWSJSON']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  guardrailId?: InputMaybe<Scalars['ID']['input']>;
  icon?: InputMaybe<Scalars['String']['input']>;
  isPublished?: InputMaybe<Scalars['Boolean']['input']>;
  knowledgeBaseIds?: InputMaybe<Scalars['AWSJSON']['input']>;
  model?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  runtime?: InputMaybe<AgentRuntime>;
  /**
   * Sandbox opt-in metadata; see AgentTemplate.sandbox. Pass null to
   * clear; omit to leave unchanged.
   */
  sandbox?: InputMaybe<Scalars['AWSJSON']['input']>;
  /**
   * Send Email opt-in metadata; see AgentTemplate.sendEmail. Pass
   * null to clear; omit to leave unchanged.
   */
  sendEmail?: InputMaybe<Scalars['AWSJSON']['input']>;
  skills?: InputMaybe<Scalars['AWSJSON']['input']>;
  slug?: InputMaybe<Scalars['String']['input']>;
  templateKind?: InputMaybe<TemplateKind>;
  /**
   * Web Search opt-in metadata; see AgentTemplate.webSearch. Pass
   * null to clear; omit to leave unchanged.
   */
  webSearch?: InputMaybe<Scalars['AWSJSON']['input']>;
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

export type UpdateComputerInput = {
  budgetMonthlyCents?: InputMaybe<Scalars['Int']['input']>;
  budgetPausedReason?: InputMaybe<Scalars['String']['input']>;
  desiredRuntimeStatus?: InputMaybe<ComputerDesiredRuntimeStatus>;
  ecsServiceName?: InputMaybe<Scalars['String']['input']>;
  efsAccessPointId?: InputMaybe<Scalars['String']['input']>;
  lastActiveAt?: InputMaybe<Scalars['AWSDateTime']['input']>;
  lastHeartbeatAt?: InputMaybe<Scalars['AWSDateTime']['input']>;
  liveWorkspaceRoot?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  runtimeConfig?: InputMaybe<Scalars['AWSJSON']['input']>;
  runtimeStatus?: InputMaybe<ComputerRuntimeStatus>;
  slug?: InputMaybe<Scalars['String']['input']>;
  spentMonthlyCents?: InputMaybe<Scalars['Int']['input']>;
  status?: InputMaybe<ComputerStatus>;
  templateId?: InputMaybe<Scalars['ID']['input']>;
};

export type UpdateConnectorInput = {
  config?: InputMaybe<Scalars['AWSJSON']['input']>;
  connectionId?: InputMaybe<Scalars['ID']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  dispatchTargetId?: InputMaybe<Scalars['ID']['input']>;
  dispatchTargetType?: InputMaybe<DispatchTargetType>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  type?: InputMaybe<Scalars['String']['input']>;
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

export type UpdateRoutineDefinitionInput = {
  graph?: InputMaybe<RoutineDefinitionGraphInput>;
  routineId: Scalars['ID']['input'];
  steps: Array<RoutineDefinitionStepConfigInput>;
};

export type UpdateRoutineInput = {
  agentId?: InputMaybe<Scalars['ID']['input']>;
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

export type UpdateTenantCredentialInput = {
  displayName?: InputMaybe<Scalars['String']['input']>;
  metadataJson?: InputMaybe<Scalars['AWSJSON']['input']>;
  slug?: InputMaybe<Scalars['String']['input']>;
  status?: InputMaybe<TenantCredentialStatus>;
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
  operatingModel?: InputMaybe<Scalars['AWSJSON']['input']>;
  operatingModelHistory?: InputMaybe<Array<Scalars['AWSJSON']['input']>>;
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
  operatingModel?: Maybe<Scalars['AWSJSON']['output']>;
  operatingModelHistory: Array<Scalars['AWSJSON']['output']>;
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
  /** @deprecated Use userId */
  ownerId: Scalars['ID']['output'];
  startedAt?: Maybe<Scalars['AWSDateTime']['output']>;
  status: Scalars['String']['output'];
  tenantId: Scalars['ID']['output'];
  trigger: Scalars['String']['output'];
  userId: Scalars['ID']['output'];
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
 * User-scoped force-graph payload: all active pages and their [[...]] links
 *   for one `(tenant, user)` scope. Shaped to match the legacy `memoryGraph`
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
  /** @deprecated Use userId */
  agentId?: Maybe<Scalars['ID']['output']>;
  dispatched: Scalars['Boolean']['output'];
  dispatchedAt: Scalars['AWSDateTime']['output'];
  error?: Maybe<Scalars['String']['output']>;
  tenantId: Scalars['ID']['output'];
  userId: Scalars['ID']['output'];
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
  /** @deprecated Use userId */
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
  userId: Scalars['ID']['output'];
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
 * v1 is strictly user-scoped: every read requires both `tenantId` and
 * `userId`. See .prds/compounding-memory-scoping.md.
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
  /** @deprecated Use userId */
  ownerId: Scalars['ID']['output'];
  pagesArchived: Scalars['Int']['output'];
  tenantId: Scalars['ID']['output'];
  userId: Scalars['ID']['output'];
};

export type WikiSearchResult = {
  __typename?: 'WikiSearchResult';
  matchedAlias?: Maybe<Scalars['String']['output']>;
  page: WikiPage;
  score: Scalars['Float']['output'];
};

export enum WorkspaceReviewKind {
  Paired = 'PAIRED',
  System = 'SYSTEM',
  Unrouted = 'UNROUTED'
}

export type AcceptTemplateUpdateMutationVariables = Exact<{
  agentId: Scalars['ID']['input'];
  filename: Scalars['String']['input'];
}>;


export type AcceptTemplateUpdateMutation = { __typename?: 'Mutation', acceptTemplateUpdate: { __typename?: 'Agent', id: string, name: string, slug?: string | null } };

export type AgentDetailQueryVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type AgentDetailQuery = { __typename?: 'Query', agent?: { __typename?: 'Agent', id: string, name: string, slug?: string | null } | null };

export type AgentPinStatusQueryVariables = Exact<{
  agentId: Scalars['ID']['input'];
}>;


export type AgentPinStatusQuery = { __typename?: 'Query', agentPinStatus: Array<{ __typename?: 'PinStatusFile', path: string, folderPath?: string | null, filename: string, pinnedSha?: string | null, latestSha?: string | null, updateAvailable: boolean, pinnedContent?: string | null, latestContent?: string | null }> };

export type CreateSubAgentMutationVariables = Exact<{
  input: CreateAgentInput;
}>;


export type CreateSubAgentMutation = { __typename?: 'Mutation', createAgent: { __typename?: 'Agent', id: string, name: string, slug?: string | null } };

export type DeleteSubAgentMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type DeleteSubAgentMutation = { __typename?: 'Mutation', deleteAgent: boolean };

export type CreateThreadMutationVariables = Exact<{
  input: CreateThreadInput;
}>;


export type CreateThreadMutation = { __typename?: 'Mutation', createThread: { __typename?: 'Thread', id: string, number: number, title: string, status: ThreadStatus, createdAt: any } };

export type TenantLabelsQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
}>;


export type TenantLabelsQuery = { __typename?: 'Query', threadLabels: Array<{ __typename?: 'ThreadLabel', id: string, name: string, color?: string | null }> };

export type CreateThreadLabelMutationVariables = Exact<{
  input: CreateThreadLabelInput;
}>;


export type CreateThreadLabelMutation = { __typename?: 'Mutation', createThreadLabel: { __typename?: 'ThreadLabel', id: string, name: string, color?: string | null } };

export type AssignThreadLabelMutationVariables = Exact<{
  threadId: Scalars['ID']['input'];
  labelId: Scalars['ID']['input'];
}>;


export type AssignThreadLabelMutation = { __typename?: 'Mutation', assignThreadLabel: { __typename?: 'ThreadLabelAssignment', id: string, labelId: string } };

export type RemoveThreadLabelMutationVariables = Exact<{
  threadId: Scalars['ID']['input'];
  labelId: Scalars['ID']['input'];
}>;


export type RemoveThreadLabelMutation = { __typename?: 'Mutation', removeThreadLabel: boolean };

export type CreateComplianceExportMutationVariables = Exact<{
  filter: ComplianceEventFilter;
  format: ComplianceExportFormat;
}>;


export type CreateComplianceExportMutation = { __typename?: 'Mutation', createComplianceExport: { __typename?: 'ComplianceExport', jobId: string, tenantId: string, requestedByActorId: string, requestedAt: string, status: ComplianceExportStatus, format: ComplianceExportFormat, filter: any, s3Key?: string | null, presignedUrl?: string | null, presignedUrlExpiresAt?: string | null, jobError?: string | null, startedAt?: string | null, completedAt?: string | null } };

export type ComplianceExportsQueryVariables = Exact<{ [key: string]: never; }>;


export type ComplianceExportsQuery = { __typename?: 'Query', complianceExports: Array<{ __typename?: 'ComplianceExport', jobId: string, tenantId: string, requestedByActorId: string, requestedAt: string, status: ComplianceExportStatus, format: ComplianceExportFormat, filter: any, s3Key?: string | null, presignedUrl?: string | null, presignedUrlExpiresAt?: string | null, jobError?: string | null, startedAt?: string | null, completedAt?: string | null }> };

export type ComplianceEventsListQueryVariables = Exact<{
  filter?: InputMaybe<ComplianceEventFilter>;
  after?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
}>;


export type ComplianceEventsListQuery = { __typename?: 'Query', complianceEvents: { __typename?: 'ComplianceEventConnection', edges: Array<{ __typename?: 'ComplianceEventEdge', cursor: string, node: { __typename?: 'ComplianceEvent', eventId: string, tenantId: string, occurredAt: string, recordedAt: string, actor: string, actorType: ComplianceActorType, source: string, eventType: ComplianceEventType, eventHash: string, prevHash?: string | null, anchorStatus: { __typename?: 'ComplianceAnchorStatus', state: ComplianceAnchorState, cadenceId?: string | null, anchoredRecordedAt?: string | null, nextCadenceWithinMinutes?: number | null } } }>, pageInfo: { __typename?: 'ComplianceEventPageInfo', hasNextPage: boolean, endCursor?: string | null } } };

export type ComplianceEventDetailQueryVariables = Exact<{
  eventId: Scalars['ID']['input'];
}>;


export type ComplianceEventDetailQuery = { __typename?: 'Query', complianceEvent?: { __typename?: 'ComplianceEvent', eventId: string, tenantId: string, occurredAt: string, recordedAt: string, actor: string, actorType: ComplianceActorType, source: string, eventType: ComplianceEventType, eventHash: string, prevHash?: string | null, payload: any, anchorStatus: { __typename?: 'ComplianceAnchorStatus', state: ComplianceAnchorState, cadenceId?: string | null, anchoredRecordedAt?: string | null, nextCadenceWithinMinutes?: number | null } } | null };

export type ComplianceEventByHashQueryVariables = Exact<{
  eventHash: Scalars['String']['input'];
}>;


export type ComplianceEventByHashQuery = { __typename?: 'Query', complianceEventByHash?: { __typename?: 'ComplianceEvent', eventId: string, tenantId: string, occurredAt: string, recordedAt: string, actor: string, actorType: ComplianceActorType, source: string, eventType: ComplianceEventType, eventHash: string, prevHash?: string | null, anchorStatus: { __typename?: 'ComplianceAnchorStatus', state: ComplianceAnchorState, cadenceId?: string | null, anchoredRecordedAt?: string | null, nextCadenceWithinMinutes?: number | null } } | null };

export type ComplianceTenantsQueryVariables = Exact<{ [key: string]: never; }>;


export type ComplianceTenantsQuery = { __typename?: 'Query', complianceTenants: Array<string> };

export type ComplianceOperatorCheckQueryVariables = Exact<{ [key: string]: never; }>;


export type ComplianceOperatorCheckQuery = { __typename?: 'Query', complianceOperatorCheck: { __typename?: 'ComplianceOperatorCheckResult', isOperator: boolean, allowlistConfigured: boolean } };

export type AgentsListQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
}>;


export type AgentsListQuery = { __typename?: 'Query', agents: Array<{ __typename?: 'Agent', id: string, name: string, slug?: string | null, role?: string | null, type: AgentType, status: AgentStatus, runtime: AgentRuntime, templateId: string, avatarUrl?: string | null, lastHeartbeatAt?: any | null, adapterType?: string | null, humanPairId?: string | null, createdAt: any, agentTemplate?: { __typename?: 'AgentTemplate', id: string, name: string, slug: string, model?: string | null } | null, humanPair?: { __typename?: 'User', id: string, name?: string | null, email: string } | null, budgetPolicy?: { __typename?: 'AgentBudgetPolicy', id: string, limitUsd: number, actionOnExceed: string } | null }>, modelCatalog: Array<{ __typename?: 'ModelCatalogEntry', modelId: string, displayName: string }> };

export type AgentProfileDetailQueryVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type AgentProfileDetailQuery = { __typename?: 'Query', agent?: { __typename?: 'Agent', id: string, tenantId: string, name: string, slug?: string | null, role?: string | null, type: AgentType, status: AgentStatus, runtime: AgentRuntime, templateId: string, systemPrompt?: string | null, avatarUrl?: string | null, lastHeartbeatAt?: any | null, runtimeConfig?: any | null, adapterType?: string | null, adapterConfig?: any | null, humanPairId?: string | null, version: number, parentAgentId?: string | null, createdAt: any, updatedAt: any, agentTemplate?: { __typename?: 'AgentTemplate', id: string, name: string, slug: string, model?: string | null, runtime: AgentRuntime, guardrailId?: string | null, blockedTools?: any | null, skills?: any | null, browser?: any | null } | null, humanPair?: { __typename?: 'User', id: string, name?: string | null, email: string } | null, capabilities: Array<{ __typename?: 'AgentCapability', id: string, capability: string, config?: any | null, enabled: boolean }>, skills: Array<{ __typename?: 'AgentSkill', id: string, skillId: string, enabled: boolean, config?: any | null, permissions?: any | null }>, budgetPolicy?: { __typename?: 'AgentBudgetPolicy', id: string, limitUsd: number, actionOnExceed: string, enabled: boolean } | null, subAgents?: Array<{ __typename?: 'Agent', id: string, name: string, slug?: string | null, role?: string | null, status: AgentStatus }> | null } | null };

export type CreateAgentMutationVariables = Exact<{
  input: CreateAgentInput;
}>;


export type CreateAgentMutation = { __typename?: 'Mutation', createAgent: { __typename?: 'Agent', id: string, name: string, role?: string | null, type: AgentType, status: AgentStatus, runtime: AgentRuntime, templateId: string, createdAt: any } };

export type AgentKnowledgeBasesQueryVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type AgentKnowledgeBasesQuery = { __typename?: 'Query', agent?: { __typename?: 'Agent', knowledgeBases: Array<{ __typename?: 'AgentKnowledgeBase', id: string, knowledgeBaseId: string, enabled: boolean, knowledgeBase?: { __typename?: 'KnowledgeBase', id: string, name: string, description?: string | null, status: string } | null }> } | null };

export type UpdateAgentMutationVariables = Exact<{
  id: Scalars['ID']['input'];
  input: UpdateAgentInput;
}>;


export type UpdateAgentMutation = { __typename?: 'Mutation', updateAgent: { __typename?: 'Agent', id: string, name: string, role?: string | null, type: AgentType, templateId: string, runtime: AgentRuntime, systemPrompt?: string | null, adapterType?: string | null, updatedAt: any } };

export type UpdateAgentRuntimeMutationVariables = Exact<{
  id: Scalars['ID']['input'];
  runtime: AgentRuntime;
}>;


export type UpdateAgentRuntimeMutation = { __typename?: 'Mutation', updateAgentRuntime: { __typename?: 'Agent', id: string, runtime: AgentRuntime, updatedAt: any } };

export type DeleteAgentMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type DeleteAgentMutation = { __typename?: 'Mutation', deleteAgent: boolean };

export type UpdateAgentStatusMutationVariables = Exact<{
  id: Scalars['ID']['input'];
  status: AgentStatus;
}>;


export type UpdateAgentStatusMutation = { __typename?: 'Mutation', updateAgentStatus: { __typename?: 'Agent', id: string, status: AgentStatus, updatedAt: any } };

export type SetAgentCapabilitiesMutationVariables = Exact<{
  agentId: Scalars['ID']['input'];
  capabilities: Array<AgentCapabilityInput> | AgentCapabilityInput;
}>;


export type SetAgentCapabilitiesMutation = { __typename?: 'Mutation', setAgentCapabilities: Array<{ __typename?: 'AgentCapability', id: string, capability: string, enabled: boolean }> };

export type SetAgentBudgetPolicyMutationVariables = Exact<{
  agentId: Scalars['ID']['input'];
  input: AgentBudgetPolicyInput;
}>;


export type SetAgentBudgetPolicyMutation = { __typename?: 'Mutation', setAgentBudgetPolicy: { __typename?: 'AgentBudgetPolicy', id: string, limitUsd: number, actionOnExceed: string, enabled: boolean } };

export type DeleteAgentBudgetPolicyMutationVariables = Exact<{
  agentId: Scalars['ID']['input'];
}>;


export type DeleteAgentBudgetPolicyMutation = { __typename?: 'Mutation', deleteAgentBudgetPolicy: boolean };

export type ComputersListQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
}>;


export type ComputersListQuery = { __typename?: 'Query', computers: Array<{ __typename?: 'Computer', id: string, tenantId: string, ownerUserId: string, templateId: string, name: string, slug: string, status: ComputerStatus, desiredRuntimeStatus: ComputerDesiredRuntimeStatus, runtimeStatus: ComputerRuntimeStatus, liveWorkspaceRoot?: string | null, efsAccessPointId?: string | null, ecsServiceName?: string | null, lastHeartbeatAt?: any | null, lastActiveAt?: any | null, budgetMonthlyCents?: number | null, spentMonthlyCents?: number | null, budgetPausedAt?: any | null, budgetPausedReason?: string | null, migratedFromAgentId?: string | null, migrationMetadata?: any | null, createdAt: any, updatedAt: any, owner?: { __typename?: 'User', id: string, name?: string | null, email: string } | null, template?: { __typename?: 'AgentTemplate', id: string, name: string, slug: string, templateKind: TemplateKind, model?: string | null } | null, sourceAgent?: { __typename?: 'Agent', id: string, name: string, slug?: string | null } | null }> };

export type ComputerDetailQueryVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type ComputerDetailQuery = { __typename?: 'Query', computer?: { __typename?: 'Computer', id: string, tenantId: string, ownerUserId: string, templateId: string, name: string, slug: string, status: ComputerStatus, desiredRuntimeStatus: ComputerDesiredRuntimeStatus, runtimeStatus: ComputerRuntimeStatus, runtimeConfig?: any | null, liveWorkspaceRoot?: string | null, efsAccessPointId?: string | null, ecsServiceName?: string | null, lastHeartbeatAt?: any | null, lastActiveAt?: any | null, budgetMonthlyCents?: number | null, spentMonthlyCents?: number | null, budgetPausedAt?: any | null, budgetPausedReason?: string | null, migratedFromAgentId?: string | null, migrationMetadata?: any | null, createdBy?: string | null, createdAt: any, updatedAt: any, owner?: { __typename?: 'User', id: string, name?: string | null, email: string } | null, template?: { __typename?: 'AgentTemplate', id: string, name: string, slug: string, templateKind: TemplateKind, model?: string | null } | null, sourceAgent?: { __typename?: 'Agent', id: string, name: string, slug?: string | null } | null } | null };

export type MyComputerQueryVariables = Exact<{ [key: string]: never; }>;


export type MyComputerQuery = { __typename?: 'Query', myComputer?: { __typename?: 'Computer', id: string, name: string, slug: string, status: ComputerStatus, desiredRuntimeStatus: ComputerDesiredRuntimeStatus, runtimeStatus: ComputerRuntimeStatus, liveWorkspaceRoot?: string | null, lastHeartbeatAt?: any | null, lastActiveAt?: any | null } | null };

export type UpdateComputerMutationVariables = Exact<{
  id: Scalars['ID']['input'];
  input: UpdateComputerInput;
}>;


export type UpdateComputerMutation = { __typename?: 'Mutation', updateComputer: { __typename?: 'Computer', id: string, name: string, status: ComputerStatus, desiredRuntimeStatus: ComputerDesiredRuntimeStatus, runtimeStatus: ComputerRuntimeStatus, liveWorkspaceRoot?: string | null, efsAccessPointId?: string | null, ecsServiceName?: string | null, lastHeartbeatAt?: any | null, lastActiveAt?: any | null, budgetMonthlyCents?: number | null, spentMonthlyCents?: number | null, budgetPausedReason?: string | null, updatedAt: any } };

export type ComputerTasksQueryVariables = Exact<{
  computerId: Scalars['ID']['input'];
  limit?: InputMaybe<Scalars['Int']['input']>;
}>;


export type ComputerTasksQuery = { __typename?: 'Query', computerTasks: Array<{ __typename?: 'ComputerTask', id: string, taskType: ComputerTaskType, status: ComputerTaskStatus, input?: any | null, output?: any | null, error?: any | null, idempotencyKey?: string | null, claimedAt?: any | null, completedAt?: any | null, createdAt: any, updatedAt: any }> };

export type ComputerThreadsQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
  computerId: Scalars['ID']['input'];
  limit?: InputMaybe<Scalars['Int']['input']>;
}>;


export type ComputerThreadsQuery = { __typename?: 'Query', threads: Array<{ __typename?: 'Thread', id: string, identifier?: string | null, title: string, status: ThreadStatus, lastResponsePreview?: string | null, updatedAt: any }> };

export type ComputerEventsQueryVariables = Exact<{
  computerId: Scalars['ID']['input'];
  limit?: InputMaybe<Scalars['Int']['input']>;
}>;


export type ComputerEventsQuery = { __typename?: 'Query', computerEvents: Array<{ __typename?: 'ComputerEvent', id: string, taskId?: string | null, eventType: string, level: ComputerEventLevel, payload?: any | null, createdAt: any }> };

export type EnqueueComputerTaskMutationVariables = Exact<{
  input: EnqueueComputerTaskInput;
}>;


export type EnqueueComputerTaskMutation = { __typename?: 'Mutation', enqueueComputerTask: { __typename?: 'ComputerTask', id: string, taskType: ComputerTaskType, status: ComputerTaskStatus, input?: any | null, output?: any | null, error?: any | null, idempotencyKey?: string | null, claimedAt?: any | null, completedAt?: any | null, createdAt: any, updatedAt: any } };

export type ModelCatalogQueryVariables = Exact<{ [key: string]: never; }>;


export type ModelCatalogQuery = { __typename?: 'Query', modelCatalog: Array<{ __typename?: 'ModelCatalogEntry', id: string, modelId: string, displayName: string, provider: string, inputCostPerMillion?: number | null, outputCostPerMillion?: number | null }> };

export type ConnectorsListQueryVariables = Exact<{
  filter?: InputMaybe<ConnectorFilter>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  cursor?: InputMaybe<Scalars['String']['input']>;
}>;


export type ConnectorsListQuery = { __typename?: 'Query', connectors: Array<{ __typename?: 'Connector', id: string, tenantId: string, type: string, name: string, description?: string | null, status: ConnectorStatus, connectionId?: string | null, config?: any | null, dispatchTargetType: DispatchTargetType, dispatchTargetId: string, lastPollAt?: any | null, nextPollAt?: any | null, enabled: boolean, createdByType?: string | null, createdById?: string | null, createdAt: any, updatedAt: any }> };

export type CreateConnectorMutationVariables = Exact<{
  input: CreateConnectorInput;
}>;


export type CreateConnectorMutation = { __typename?: 'Mutation', createConnector: { __typename?: 'Connector', id: string, status: ConnectorStatus, updatedAt: any } };

export type UpdateConnectorMutationVariables = Exact<{
  id: Scalars['ID']['input'];
  input: UpdateConnectorInput;
}>;


export type UpdateConnectorMutation = { __typename?: 'Mutation', updateConnector: { __typename?: 'Connector', id: string, status: ConnectorStatus, updatedAt: any } };

export type PauseConnectorMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type PauseConnectorMutation = { __typename?: 'Mutation', pauseConnector: { __typename?: 'Connector', id: string, status: ConnectorStatus, updatedAt: any } };

export type ResumeConnectorMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type ResumeConnectorMutation = { __typename?: 'Mutation', resumeConnector: { __typename?: 'Connector', id: string, status: ConnectorStatus, updatedAt: any } };

export type ArchiveConnectorMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type ArchiveConnectorMutation = { __typename?: 'Mutation', archiveConnector: { __typename?: 'Connector', id: string, status: ConnectorStatus, updatedAt: any } };

export type RunConnectorNowMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type RunConnectorNowMutation = { __typename?: 'Mutation', runConnectorNow: { __typename?: 'ConnectorRunNowResult', connectorId: string, results: Array<{ __typename?: 'ConnectorDispatchResult', status: string, connectorId: string, executionId?: string | null, externalRef?: string | null, threadId?: string | null, messageId?: string | null, computerId?: string | null, computerTaskId?: string | null, targetType?: DispatchTargetType | null, reason?: string | null, error?: string | null }> } };

export type ConnectorExecutionsListQueryVariables = Exact<{
  connectorId?: InputMaybe<Scalars['ID']['input']>;
  status?: InputMaybe<ConnectorExecutionState>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  cursor?: InputMaybe<Scalars['String']['input']>;
}>;


export type ConnectorExecutionsListQuery = { __typename?: 'Query', connectorExecutions: Array<{ __typename?: 'ConnectorExecution', id: string, tenantId: string, connectorId: string, externalRef: string, currentState: ConnectorExecutionState, startedAt?: any | null, finishedAt?: any | null, errorClass?: string | null, outcomePayload?: any | null, retryAttempt: number, createdAt: any }> };

export type ConnectorRunLifecyclesQueryVariables = Exact<{
  connectorId?: InputMaybe<Scalars['ID']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  cursor?: InputMaybe<Scalars['String']['input']>;
}>;


export type ConnectorRunLifecyclesQuery = { __typename?: 'Query', connectorRunLifecycles: Array<{ __typename?: 'ConnectorRunLifecycle', threadId?: string | null, messageId?: string | null, computerId?: string | null, execution: { __typename?: 'ConnectorExecution', id: string, tenantId: string, connectorId: string, externalRef: string, currentState: ConnectorExecutionState, startedAt?: any | null, finishedAt?: any | null, errorClass?: string | null, outcomePayload?: any | null, retryAttempt: number, createdAt: any }, connector: { __typename?: 'Connector', id: string, type: string, name: string, status: ConnectorStatus }, computerTask?: { __typename?: 'ConnectorRunComputerTask', id: string, status: string, output?: any | null, error?: any | null, completedAt?: any | null, createdAt: any } | null, delegation?: { __typename?: 'ConnectorRunDelegation', id: string, status: string, agentId: string, outputArtifacts?: any | null, result?: any | null, error?: any | null, completedAt?: any | null, createdAt: any } | null, threadTurn?: { __typename?: 'ConnectorRunThreadTurn', id: string, threadId?: string | null, agentId?: string | null, status: string, resultJson?: any | null, error?: string | null, errorCode?: string | null, startedAt?: any | null, finishedAt?: any | null, createdAt: any } | null }> };

export type AgentEmailCapabilityQueryVariables = Exact<{
  agentId: Scalars['ID']['input'];
}>;


export type AgentEmailCapabilityQuery = { __typename?: 'Query', agentEmailCapability?: { __typename?: 'AgentEmailCapability', id: string, agentId: string, enabled: boolean, emailAddress?: string | null, vanityAddress?: string | null, allowedSenders: Array<string> } | null };

export type UpdateAgentEmailAllowlistMutationVariables = Exact<{
  agentId: Scalars['ID']['input'];
  allowedSenders: Array<Scalars['String']['input']> | Scalars['String']['input'];
}>;


export type UpdateAgentEmailAllowlistMutation = { __typename?: 'Mutation', updateAgentEmailAllowlist: { __typename?: 'AgentCapability', id: string, config?: any | null, enabled: boolean } };

export type ToggleAgentEmailChannelMutationVariables = Exact<{
  agentId: Scalars['ID']['input'];
  enabled: Scalars['Boolean']['input'];
}>;


export type ToggleAgentEmailChannelMutation = { __typename?: 'Mutation', toggleAgentEmailChannel: { __typename?: 'AgentCapability', id: string, enabled: boolean } };

export type ClaimVanityEmailAddressMutationVariables = Exact<{
  agentId: Scalars['ID']['input'];
  localPart: Scalars['String']['input'];
}>;


export type ClaimVanityEmailAddressMutation = { __typename?: 'Mutation', claimVanityEmailAddress: { __typename?: 'AgentCapability', id: string, config?: any | null } };

export type ReleaseVanityEmailAddressMutationVariables = Exact<{
  agentId: Scalars['ID']['input'];
}>;


export type ReleaseVanityEmailAddressMutation = { __typename?: 'Mutation', releaseVanityEmailAddress: { __typename?: 'AgentCapability', id: string, config?: any | null } };

export type KnowledgeBasesListQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
}>;


export type KnowledgeBasesListQuery = { __typename?: 'Query', knowledgeBases: Array<{ __typename?: 'KnowledgeBase', id: string, tenantId: string, name: string, slug: string, description?: string | null, status: string, documentCount?: number | null, lastSyncAt?: any | null, lastSyncStatus?: string | null, errorMessage?: string | null, createdAt: any, updatedAt: any }> };

export type KnowledgeBaseDetailQueryVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type KnowledgeBaseDetailQuery = { __typename?: 'Query', knowledgeBase?: { __typename?: 'KnowledgeBase', id: string, tenantId: string, name: string, slug: string, description?: string | null, embeddingModel: string, chunkingStrategy: string, chunkSizeTokens?: number | null, chunkOverlapPercent?: number | null, status: string, awsKbId?: string | null, lastSyncAt?: any | null, lastSyncStatus?: string | null, documentCount?: number | null, errorMessage?: string | null, createdAt: any, updatedAt: any } | null };

export type CreateKnowledgeBaseMutationVariables = Exact<{
  input: CreateKnowledgeBaseInput;
}>;


export type CreateKnowledgeBaseMutation = { __typename?: 'Mutation', createKnowledgeBase: { __typename?: 'KnowledgeBase', id: string, name: string, slug: string, status: string, createdAt: any } };

export type UpdateKnowledgeBaseMutationVariables = Exact<{
  id: Scalars['ID']['input'];
  input: UpdateKnowledgeBaseInput;
}>;


export type UpdateKnowledgeBaseMutation = { __typename?: 'Mutation', updateKnowledgeBase: { __typename?: 'KnowledgeBase', id: string, name: string, description?: string | null, updatedAt: any } };

export type DeleteKnowledgeBaseMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type DeleteKnowledgeBaseMutation = { __typename?: 'Mutation', deleteKnowledgeBase: boolean };

export type SyncKnowledgeBaseMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type SyncKnowledgeBaseMutation = { __typename?: 'Mutation', syncKnowledgeBase: { __typename?: 'KnowledgeBase', id: string, status: string, lastSyncStatus?: string | null, updatedAt: any } };

export type SetAgentKnowledgeBasesMutationVariables = Exact<{
  agentId: Scalars['ID']['input'];
  knowledgeBases: Array<AgentKnowledgeBaseInput> | AgentKnowledgeBaseInput;
}>;


export type SetAgentKnowledgeBasesMutation = { __typename?: 'Mutation', setAgentKnowledgeBases: Array<{ __typename?: 'AgentKnowledgeBase', id: string, knowledgeBaseId: string, enabled: boolean, knowledgeBase?: { __typename?: 'KnowledgeBase', id: string, name: string, description?: string | null, status: string } | null }> };

export type ThreadsListQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
  status?: InputMaybe<ThreadStatus>;
  search?: InputMaybe<Scalars['String']['input']>;
}>;


export type ThreadsListQuery = { __typename?: 'Query', threads: Array<{ __typename?: 'Thread', id: string, number: number, identifier?: string | null, title: string, status: ThreadStatus, assigneeType?: string | null, assigneeId?: string | null, agentId?: string | null, computerId?: string | null, checkoutRunId?: string | null, channel: ThreadChannel, costSummary?: number | null, lastActivityAt?: any | null, lastTurnCompletedAt?: any | null, lastReadAt?: any | null, archivedAt?: any | null, createdAt: any, updatedAt: any, agent?: { __typename?: 'Agent', id: string, name: string, avatarUrl?: string | null } | null }> };

export type ThreadsPagedQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
  search?: InputMaybe<Scalars['String']['input']>;
  showArchived?: InputMaybe<Scalars['Boolean']['input']>;
  sortField?: InputMaybe<Scalars['String']['input']>;
  sortDir?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
}>;


export type ThreadsPagedQuery = { __typename?: 'Query', threadsPaged: { __typename?: 'ThreadsPage', totalCount: number, items: Array<{ __typename?: 'Thread', id: string, number: number, identifier?: string | null, title: string, status: ThreadStatus, assigneeType?: string | null, assigneeId?: string | null, agentId?: string | null, checkoutRunId?: string | null, channel: ThreadChannel, costSummary?: number | null, lastActivityAt?: any | null, lastTurnCompletedAt?: any | null, lastReadAt?: any | null, archivedAt?: any | null, createdAt: any, updatedAt: any, agent?: { __typename?: 'Agent', id: string, name: string, avatarUrl?: string | null } | null }> } };

export type ThreadDetailQueryVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type ThreadDetailQuery = { __typename?: 'Query', thread?: { __typename?: 'Thread', id: string, tenantId: string, number: number, identifier?: string | null, title: string, status: ThreadStatus, lifecycleStatus?: ThreadLifecycleStatus | null, assigneeType?: string | null, assigneeId?: string | null, agentId?: string | null, computerId?: string | null, channel: ThreadChannel, costSummary?: number | null, checkoutRunId?: string | null, checkoutVersion: number, billingCode?: string | null, labels?: any | null, metadata?: any | null, dueAt?: any | null, startedAt?: any | null, completedAt?: any | null, cancelledAt?: any | null, closedAt?: any | null, createdByType?: string | null, createdById?: string | null, createdAt: any, updatedAt: any, agent?: { __typename?: 'Agent', id: string, name: string, avatarUrl?: string | null } | null, messages: { __typename?: 'MessageConnection', edges: Array<{ __typename?: 'MessageEdge', node: { __typename?: 'Message', id: string, threadId: string, tenantId: string, role: MessageRole, content?: string | null, senderType?: string | null, senderId?: string | null, toolCalls?: any | null, toolResults?: any | null, metadata?: any | null, tokenCount?: number | null, createdAt: any, durableArtifact?: { __typename?: 'Artifact', id: string, title: string, type: ArtifactType, status: ArtifactStatus } | null } }> }, attachments: Array<{ __typename?: 'ThreadAttachment', id: string, threadId: string, name?: string | null, s3Key?: string | null, mimeType?: string | null, sizeBytes?: number | null, uploadedBy?: string | null, createdAt: any }> } | null };

export type UpdateThreadMutationVariables = Exact<{
  id: Scalars['ID']['input'];
  input: UpdateThreadInput;
}>;


export type UpdateThreadMutation = { __typename?: 'Mutation', updateThread: { __typename?: 'Thread', id: string, status: ThreadStatus, title: string, assigneeType?: string | null, assigneeId?: string | null, billingCode?: string | null, dueAt?: any | null, updatedAt: any } };

export type DeleteThreadMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type DeleteThreadMutation = { __typename?: 'Mutation', deleteThread: boolean };

export type CheckoutThreadMutationVariables = Exact<{
  id: Scalars['ID']['input'];
  input: CheckoutThreadInput;
}>;


export type CheckoutThreadMutation = { __typename?: 'Mutation', checkoutThread: { __typename?: 'Thread', id: string, checkoutRunId?: string | null, checkoutVersion: number } };

export type ReleaseThreadMutationVariables = Exact<{
  id: Scalars['ID']['input'];
  input: ReleaseThreadInput;
}>;


export type ReleaseThreadMutation = { __typename?: 'Mutation', releaseThread: { __typename?: 'Thread', id: string, checkoutRunId?: string | null, status: ThreadStatus } };

export type TeamsListQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
}>;


export type TeamsListQuery = { __typename?: 'Query', teams: Array<{ __typename?: 'Team', id: string, name: string, description?: string | null, type: string, status: string, budgetMonthlyCents?: number | null, createdAt: any, agents: Array<{ __typename?: 'TeamAgent', id: string, agentId: string, role: string, agent?: { __typename?: 'Agent', id: string, name: string, status: AgentStatus, avatarUrl?: string | null } | null }>, users: Array<{ __typename?: 'TeamUser', id: string, userId: string, role: string }> }> };

export type TeamDetailQueryVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type TeamDetailQuery = { __typename?: 'Query', team?: { __typename?: 'Team', id: string, tenantId: string, name: string, description?: string | null, type: string, status: string, budgetMonthlyCents?: number | null, metadata?: any | null, createdAt: any, updatedAt: any, agents: Array<{ __typename?: 'TeamAgent', id: string, agentId: string, role: string, createdAt: any, agent?: { __typename?: 'Agent', id: string, name: string, role?: string | null, status: AgentStatus, avatarUrl?: string | null } | null }>, users: Array<{ __typename?: 'TeamUser', id: string, userId: string, role: string, createdAt: any, user?: { __typename?: 'User', id: string, name?: string | null, email: string } | null }> } | null };

export type RoutinesListQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
}>;


export type RoutinesListQuery = { __typename?: 'Query', routines: Array<{ __typename?: 'Routine', id: string, name: string, description?: string | null, status: string, lastRunAt?: any | null, engine: string, createdAt: any }> };

export type RoutineDetailQueryVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type RoutineDetailQuery = { __typename?: 'Query', routine?: { __typename?: 'Routine', id: string, tenantId: string, name: string, description?: string | null, type: string, status: string, schedule?: string | null, engine: string, currentVersion?: number | null, config?: any | null, lastRunAt?: any | null, nextRunAt?: any | null, agentId?: string | null, teamId?: string | null, createdAt: any, updatedAt: any, agent?: { __typename?: 'Agent', id: string, name: string, avatarUrl?: string | null } | null, team?: { __typename?: 'Team', id: string, name: string } | null, triggers: Array<{ __typename?: 'RoutineTrigger', id: string, triggerType: string, config?: any | null, enabled: boolean }> } | null };

export type CreateRoutineMutationVariables = Exact<{
  input: CreateRoutineInput;
}>;


export type CreateRoutineMutation = { __typename?: 'Mutation', createRoutine: { __typename?: 'Routine', id: string, name: string, currentVersion?: number | null } };

export type PlanRoutineDraftMutationVariables = Exact<{
  input: PlanRoutineDraftInput;
}>;


export type PlanRoutineDraftMutation = { __typename?: 'Mutation', planRoutineDraft: { __typename?: 'RoutineDraft', title: string, description?: string | null, kind: string, asl: any, markdownSummary: string, stepManifest: any, steps: Array<{ __typename?: 'RoutineDefinitionStep', nodeId: string, recipeId: string, recipeName: string, label: string, args: any, configFields: Array<{ __typename?: 'RoutineDefinitionConfigField', key: string, label: string, value?: any | null, inputType: string, control?: string | null, required: boolean, editable: boolean, options?: Array<string> | null, placeholder?: string | null, helpText?: string | null, min?: number | null, max?: number | null, pattern?: string | null }> }> } };

export type RoutineRecipeCatalogQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
}>;


export type RoutineRecipeCatalogQuery = { __typename?: 'Query', routineRecipeCatalog: Array<{ __typename?: 'RoutineRecipe', id: string, displayName: string, description: string, category: string, hitlCapable: boolean, defaultArgs: any, configFields: Array<{ __typename?: 'RoutineRecipeConfigField', key: string, label: string, value?: any | null, inputType: string, control?: string | null, required: boolean, editable: boolean, options?: Array<string> | null, placeholder?: string | null, helpText?: string | null, min?: number | null, max?: number | null, pattern?: string | null }> }> };

export type TenantCredentialsQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
  status?: InputMaybe<TenantCredentialStatus>;
}>;


export type TenantCredentialsQuery = { __typename?: 'Query', tenantCredentials: Array<{ __typename?: 'TenantCredential', id: string, tenantId: string, displayName: string, slug: string, kind: TenantCredentialKind, status: TenantCredentialStatus, metadataJson: any, schemaJson: any, eventbridgeConnectionArn?: string | null, lastUsedAt?: any | null, lastValidatedAt?: any | null, createdAt: any, updatedAt: any, deletedAt?: any | null }> };

export type CredentialRoutineUsageQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
}>;


export type CredentialRoutineUsageQuery = { __typename?: 'Query', routines: Array<{ __typename?: 'Routine', id: string, name: string, status: string, config?: any | null, engine: string, updatedAt: any }> };

export type CreateTenantCredentialMutationVariables = Exact<{
  input: CreateTenantCredentialInput;
}>;


export type CreateTenantCredentialMutation = { __typename?: 'Mutation', createTenantCredential: { __typename?: 'TenantCredential', id: string, displayName: string, slug: string, kind: TenantCredentialKind, status: TenantCredentialStatus, metadataJson: any, eventbridgeConnectionArn?: string | null, lastValidatedAt?: any | null, createdAt: any, updatedAt: any } };

export type UpdateTenantCredentialMutationVariables = Exact<{
  id: Scalars['ID']['input'];
  input: UpdateTenantCredentialInput;
}>;


export type UpdateTenantCredentialMutation = { __typename?: 'Mutation', updateTenantCredential: { __typename?: 'TenantCredential', id: string, displayName: string, slug: string, status: TenantCredentialStatus, metadataJson: any, updatedAt: any } };

export type RotateTenantCredentialMutationVariables = Exact<{
  input: RotateTenantCredentialInput;
}>;


export type RotateTenantCredentialMutation = { __typename?: 'Mutation', rotateTenantCredential: { __typename?: 'TenantCredential', id: string, status: TenantCredentialStatus, lastValidatedAt?: any | null, updatedAt: any } };

export type DeleteTenantCredentialMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type DeleteTenantCredentialMutation = { __typename?: 'Mutation', deleteTenantCredential: boolean };

export type TriggerRoutineRunMutationVariables = Exact<{
  routineId: Scalars['ID']['input'];
  input?: InputMaybe<Scalars['AWSJSON']['input']>;
}>;


export type TriggerRoutineRunMutation = { __typename?: 'Mutation', triggerRoutineRun: { __typename?: 'RoutineExecution', id: string, status: string, triggerSource: string, startedAt?: any | null } };

export type RebuildRoutineVersionMutationVariables = Exact<{
  input: RebuildRoutineVersionInput;
}>;


export type RebuildRoutineVersionMutation = { __typename?: 'Mutation', rebuildRoutineVersion: { __typename?: 'RoutineAslVersion', id: string, versionNumber: number } };

export type RoutineDefinitionQueryVariables = Exact<{
  routineId: Scalars['ID']['input'];
}>;


export type RoutineDefinitionQuery = { __typename?: 'Query', routineDefinition?: { __typename?: 'RoutineDefinition', routineId: string, currentVersion?: number | null, versionId?: string | null, title: string, description?: string | null, kind: string, steps: Array<{ __typename?: 'RoutineDefinitionStep', nodeId: string, recipeId: string, recipeName: string, label: string, args: any, configFields: Array<{ __typename?: 'RoutineDefinitionConfigField', key: string, label: string, value?: any | null, inputType: string, control?: string | null, required: boolean, editable: boolean, options?: Array<string> | null, placeholder?: string | null, helpText?: string | null, min?: number | null, max?: number | null, pattern?: string | null }> }> } | null };

export type RoutineDefinitionArtifactsQueryVariables = Exact<{
  routineId: Scalars['ID']['input'];
}>;


export type RoutineDefinitionArtifactsQuery = { __typename?: 'Query', routineDefinition?: { __typename?: 'RoutineDefinition', routineId: string, versionId?: string | null, aslJson?: any | null, markdownSummary?: string | null, stepManifestJson?: any | null } | null };

export type UpdateRoutineDefinitionMutationVariables = Exact<{
  input: UpdateRoutineDefinitionInput;
}>;


export type UpdateRoutineDefinitionMutation = { __typename?: 'Mutation', updateRoutineDefinition: { __typename?: 'RoutineDefinition', routineId: string, currentVersion?: number | null, versionId?: string | null, description?: string | null, steps: Array<{ __typename?: 'RoutineDefinitionStep', nodeId: string, args: any, configFields: Array<{ __typename?: 'RoutineDefinitionConfigField', key: string, value?: any | null, editable: boolean }> }> } };

export type RoutineExecutionsListQueryVariables = Exact<{
  routineId: Scalars['ID']['input'];
  status?: InputMaybe<RoutineExecutionStatus>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  cursor?: InputMaybe<Scalars['String']['input']>;
}>;


export type RoutineExecutionsListQuery = { __typename?: 'Query', routineExecutions: Array<{ __typename?: 'RoutineExecution', id: string, status: string, triggerSource: string, startedAt?: any | null, finishedAt?: any | null, totalLlmCostUsdCents?: number | null, errorCode?: string | null, createdAt: any }> };

export type RoutineExecutionDetailQueryVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type RoutineExecutionDetailQuery = { __typename?: 'Query', routineExecution?: { __typename?: 'RoutineExecution', id: string, tenantId: string, routineId: string, stateMachineArn: string, aliasArn?: string | null, versionArn?: string | null, sfnExecutionArn: string, triggerSource: string, inputJson?: any | null, outputJson?: any | null, status: string, startedAt?: any | null, finishedAt?: any | null, errorCode?: string | null, errorMessage?: string | null, totalLlmCostUsdCents?: number | null, createdAt: any, stepEvents: Array<{ __typename?: 'RoutineStepEvent', id: string, nodeId: string, recipeType: string, status: string, startedAt?: any | null, finishedAt?: any | null, inputJson?: any | null, outputJson?: any | null, errorJson?: any | null, llmCostUsdCents?: number | null, retryCount: number, stdoutS3Uri?: string | null, stderrS3Uri?: string | null, stdoutPreview?: string | null, truncated: boolean, createdAt: any }>, routine?: { __typename?: 'Routine', id: string, name: string, description?: string | null, currentVersion?: number | null, documentationMd?: string | null } | null, aslVersion?: { __typename?: 'RoutineAslVersion', id: string, versionNumber: number, aslJson: any, markdownSummary: string, stepManifestJson: any } | null } | null };

export type RoutineAslVersionDetailQueryVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type RoutineAslVersionDetailQuery = { __typename?: 'Query', routineAslVersion?: { __typename?: 'RoutineAslVersion', id: string, versionNumber: number, aslJson: any, markdownSummary: string, stepManifestJson: any, createdAt: any } | null };

export type InboxItemsListQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
  status?: InputMaybe<InboxItemStatus>;
}>;


export type InboxItemsListQuery = { __typename?: 'Query', inboxItems: Array<{ __typename?: 'InboxItem', id: string, type: string, status: InboxItemStatus, title?: string | null, description?: string | null, requesterType?: string | null, requesterId?: string | null, entityType?: string | null, entityId?: string | null, revision: number, expiresAt?: any | null, createdAt: any, updatedAt: any }> };

export type InboxItemDetailQueryVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type InboxItemDetailQuery = { __typename?: 'Query', inboxItem?: { __typename?: 'InboxItem', id: string, tenantId: string, type: string, status: InboxItemStatus, title?: string | null, description?: string | null, requesterType?: string | null, requesterId?: string | null, entityType?: string | null, entityId?: string | null, config?: any | null, revision: number, reviewNotes?: string | null, decidedBy?: string | null, decidedAt?: any | null, expiresAt?: any | null, createdAt: any, updatedAt: any, comments: Array<{ __typename?: 'InboxItemComment', id: string, authorType?: string | null, authorId?: string | null, content: string, createdAt: any }>, links: Array<{ __typename?: 'InboxItemLink', id: string, linkedType?: string | null, linkedId?: string | null }>, linkedThreads: Array<{ __typename?: 'LinkedThread', id: string, number: number, identifier?: string | null, title: string, status: string }> } | null };

export type ApproveInboxItemMutationVariables = Exact<{
  id: Scalars['ID']['input'];
  input?: InputMaybe<ApproveInboxItemInput>;
}>;


export type ApproveInboxItemMutation = { __typename?: 'Mutation', approveInboxItem: { __typename?: 'InboxItem', id: string, status: InboxItemStatus, reviewNotes?: string | null, decidedAt?: any | null, updatedAt: any } };

export type RejectInboxItemMutationVariables = Exact<{
  id: Scalars['ID']['input'];
  input?: InputMaybe<RejectInboxItemInput>;
}>;


export type RejectInboxItemMutation = { __typename?: 'Mutation', rejectInboxItem: { __typename?: 'InboxItem', id: string, status: InboxItemStatus, reviewNotes?: string | null, decidedAt?: any | null, updatedAt: any } };

export type RequestRevisionMutationVariables = Exact<{
  id: Scalars['ID']['input'];
  input: RequestRevisionInput;
}>;


export type RequestRevisionMutation = { __typename?: 'Mutation', requestRevision: { __typename?: 'InboxItem', id: string, status: InboxItemStatus, reviewNotes?: string | null, updatedAt: any } };

export type ResubmitInboxItemMutationVariables = Exact<{
  id: Scalars['ID']['input'];
  input?: InputMaybe<ResubmitInboxItemInput>;
}>;


export type ResubmitInboxItemMutation = { __typename?: 'Mutation', resubmitInboxItem: { __typename?: 'InboxItem', id: string, status: InboxItemStatus, revision: number, updatedAt: any } };

export type AddInboxItemCommentMutationVariables = Exact<{
  input: AddInboxItemCommentInput;
}>;


export type AddInboxItemCommentMutation = { __typename?: 'Mutation', addInboxItemComment: { __typename?: 'InboxItemComment', id: string, authorType?: string | null, authorId?: string | null, content: string, createdAt: any } };

export type ActivityLogQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
  entityType?: InputMaybe<Scalars['String']['input']>;
  entityId?: InputMaybe<Scalars['ID']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
}>;


export type ActivityLogQuery = { __typename?: 'Query', activityLog: Array<{ __typename?: 'ActivityLogEntry', id: string, actorType: string, actorId: string, action: string, entityType?: string | null, entityId?: string | null, changes?: any | null, createdAt: any }> };

export type TenantDetailQueryVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type TenantDetailQuery = { __typename?: 'Query', tenant?: { __typename?: 'Tenant', id: string, name: string, slug: string, plan: string, issuePrefix?: string | null, issueCounter: number, createdAt: any, updatedAt: any, settings?: { __typename?: 'TenantSettings', id: string, defaultModel?: string | null, budgetMonthlyCents?: number | null, autoCloseThreadMinutes?: number | null, maxAgents?: number | null, features?: any | null } | null } | null };

export type DeploymentStatusQueryVariables = Exact<{ [key: string]: never; }>;


export type DeploymentStatusQuery = { __typename?: 'Query', deploymentStatus: { __typename?: 'DeploymentStatus', stage: string, source: string, region: string, accountId?: string | null, bucketName?: string | null, databaseEndpoint?: string | null, ecrUrl?: string | null, adminUrl?: string | null, docsUrl?: string | null, apiEndpoint?: string | null, appsyncUrl?: string | null, appsyncRealtimeUrl?: string | null, hindsightEndpoint?: string | null, agentcoreStatus?: string | null, hindsightEnabled: boolean, managedMemoryEnabled: boolean } };

export type TenantMembersListQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
}>;


export type TenantMembersListQuery = { __typename?: 'Query', tenantMembers: Array<{ __typename?: 'TenantMember', id: string, tenantId: string, principalType: string, principalId: string, role: string, status: string, createdAt: any, updatedAt: any, user?: { __typename?: 'User', id: string, name?: string | null, email: string, image?: string | null } | null, agent?: { __typename?: 'Agent', id: string, name: string, status: AgentStatus, avatarUrl?: string | null } | null }> };

export type InviteMemberMutationVariables = Exact<{
  tenantId: Scalars['ID']['input'];
  input: InviteMemberInput;
}>;


export type InviteMemberMutation = { __typename?: 'Mutation', inviteMember: { __typename?: 'TenantMember', id: string, tenantId: string, principalType: string, principalId: string, role: string, status: string, createdAt: any, user?: { __typename?: 'User', id: string, name?: string | null, email: string } | null } };

export type UpdateUserMutationVariables = Exact<{
  id: Scalars['ID']['input'];
  input: UpdateUserInput;
}>;


export type UpdateUserMutation = { __typename?: 'Mutation', updateUser: { __typename?: 'User', id: string, tenantId: string, email: string, name?: string | null, image?: string | null, phone?: string | null, updatedAt: any } };

export type UpdateTenantMemberMutationVariables = Exact<{
  id: Scalars['ID']['input'];
  input: UpdateTenantMemberInput;
}>;


export type UpdateTenantMemberMutation = { __typename?: 'Mutation', updateTenantMember: { __typename?: 'TenantMember', id: string, tenantId: string, principalType: string, principalId: string, role: string, status: string, updatedAt: any } };

export type RemoveTenantMemberMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type RemoveTenantMemberMutation = { __typename?: 'Mutation', removeTenantMember: boolean };

export type AgentApiKeysQueryVariables = Exact<{
  agentId: Scalars['ID']['input'];
}>;


export type AgentApiKeysQuery = { __typename?: 'Query', agentApiKeys: Array<{ __typename?: 'AgentApiKey', id: string, tenantId: string, agentId: string, name?: string | null, keyPrefix: string, lastUsedAt?: any | null, revokedAt?: any | null, createdAt: any }> };

export type CreateAgentApiKeyMutationVariables = Exact<{
  input: CreateAgentApiKeyInput;
}>;


export type CreateAgentApiKeyMutation = { __typename?: 'Mutation', createAgentApiKey: { __typename?: 'CreateAgentApiKeyResult', plainTextKey: string, apiKey: { __typename?: 'AgentApiKey', id: string, agentId: string, name?: string | null, keyPrefix: string, createdAt: any } } };

export type RevokeAgentApiKeyMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type RevokeAgentApiKeyMutation = { __typename?: 'Mutation', revokeAgentApiKey: { __typename?: 'AgentApiKey', id: string, revokedAt?: any | null } };

export type CostSummaryQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
  from?: InputMaybe<Scalars['AWSDateTime']['input']>;
  to?: InputMaybe<Scalars['AWSDateTime']['input']>;
}>;


export type CostSummaryQuery = { __typename?: 'Query', costSummary: { __typename?: 'CostSummary', totalUsd: number, llmUsd: number, computeUsd: number, toolsUsd: number, evalUsd?: number | null, totalInputTokens: number, totalOutputTokens: number, eventCount: number, periodStart: any, periodEnd: any } };

export type CostByAgentQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
  from?: InputMaybe<Scalars['AWSDateTime']['input']>;
  to?: InputMaybe<Scalars['AWSDateTime']['input']>;
}>;


export type CostByAgentQuery = { __typename?: 'Query', costByAgent: Array<{ __typename?: 'AgentCostSummary', agentId?: string | null, agentName: string, totalUsd: number, eventCount: number }> };

export type CostByModelQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
  from?: InputMaybe<Scalars['AWSDateTime']['input']>;
  to?: InputMaybe<Scalars['AWSDateTime']['input']>;
}>;


export type CostByModelQuery = { __typename?: 'Query', costByModel: Array<{ __typename?: 'ModelCostSummary', model: string, totalUsd: number, inputTokens: number, outputTokens: number }> };

export type CostTimeSeriesQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
  days?: InputMaybe<Scalars['Int']['input']>;
}>;


export type CostTimeSeriesQuery = { __typename?: 'Query', costTimeSeries: Array<{ __typename?: 'DailyCostPoint', day: string, totalUsd: number, llmUsd: number, computeUsd: number, toolsUsd: number, eventCount: number }> };

export type BudgetStatusQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
}>;


export type BudgetStatusQuery = { __typename?: 'Query', budgetStatus: Array<{ __typename?: 'BudgetStatus', spentUsd: number, remainingUsd: number, percentUsed: number, status: string, policy: { __typename?: 'BudgetPolicy', id: string, tenantId: string, agentId?: string | null, scope: string, period: string, limitUsd: number, actionOnExceed: string, enabled: boolean } }> };

export type UpsertBudgetPolicyMutationVariables = Exact<{
  tenantId: Scalars['ID']['input'];
  input: UpsertBudgetPolicyInput;
}>;


export type UpsertBudgetPolicyMutation = { __typename?: 'Mutation', upsertBudgetPolicy: { __typename?: 'BudgetPolicy', id: string, scope: string, limitUsd: number, actionOnExceed: string, enabled: boolean } };

export type DeleteBudgetPolicyMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type DeleteBudgetPolicyMutation = { __typename?: 'Mutation', deleteBudgetPolicy: boolean };

export type UnpauseAgentMutationVariables = Exact<{
  agentId: Scalars['ID']['input'];
}>;


export type UnpauseAgentMutation = { __typename?: 'Mutation', unpauseAgent: { __typename?: 'Agent', id: string, name: string } };

export type NotifyAgentStatusMutationVariables = Exact<{
  agentId: Scalars['ID']['input'];
  tenantId: Scalars['ID']['input'];
  status: Scalars['String']['input'];
  name: Scalars['String']['input'];
}>;


export type NotifyAgentStatusMutation = { __typename?: 'Mutation', notifyAgentStatus?: { __typename?: 'AgentStatusEvent', agentId: string, tenantId: string, status: string, name: string, updatedAt: any } | null };

export type OnAgentStatusChangedSubscriptionVariables = Exact<{
  tenantId: Scalars['ID']['input'];
}>;


export type OnAgentStatusChangedSubscription = { __typename?: 'Subscription', onAgentStatusChanged?: { __typename?: 'AgentStatusEvent', agentId: string, tenantId: string, status: string, name: string, updatedAt: any } | null };

export type OnThreadUpdatedSubscriptionVariables = Exact<{
  tenantId: Scalars['ID']['input'];
}>;


export type OnThreadUpdatedSubscription = { __typename?: 'Subscription', onThreadUpdated?: { __typename?: 'ThreadUpdateEvent', threadId: string, tenantId: string, status: string, title: string, updatedAt: any } | null };

export type OnInboxItemStatusChangedSubscriptionVariables = Exact<{
  tenantId: Scalars['ID']['input'];
}>;


export type OnInboxItemStatusChangedSubscription = { __typename?: 'Subscription', onInboxItemStatusChanged?: { __typename?: 'InboxItemStatusEvent', inboxItemId: string, tenantId: string, status: string, title?: string | null, updatedAt: any } | null };

export type ThreadTurnsQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
  limit?: InputMaybe<Scalars['Int']['input']>;
}>;


export type ThreadTurnsQuery = { __typename?: 'Query', threadTurns: Array<{ __typename?: 'ThreadTurn', id: string, tenantId: string, triggerId?: string | null, threadId?: string | null, agentId?: string | null, invocationSource: string, triggerDetail?: string | null, status: string, startedAt?: any | null, finishedAt?: any | null, error?: string | null, resultJson?: any | null, usageJson?: any | null, triggerName?: string | null, totalCost?: number | null, createdAt: any }> };

export type ThreadTurnsForThreadQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
  threadId: Scalars['ID']['input'];
  limit?: InputMaybe<Scalars['Int']['input']>;
}>;


export type ThreadTurnsForThreadQuery = { __typename?: 'Query', threadTurns: Array<{ __typename?: 'ThreadTurn', id: string, tenantId: string, agentId?: string | null, invocationSource: string, triggerDetail?: string | null, triggerName?: string | null, threadId?: string | null, turnNumber?: number | null, status: string, startedAt?: any | null, finishedAt?: any | null, error?: string | null, resultJson?: any | null, usageJson?: any | null, totalCost?: number | null, retryAttempt?: number | null, originTurnId?: string | null, createdAt: any }> };

export type ThreadTurnEventsQueryVariables = Exact<{
  runId: Scalars['ID']['input'];
  limit?: InputMaybe<Scalars['Int']['input']>;
}>;


export type ThreadTurnEventsQuery = { __typename?: 'Query', threadTurnEvents: Array<{ __typename?: 'ThreadTurnEvent', id: string, runId: string, agentId?: string | null, seq: number, eventType: string, stream?: string | null, level?: string | null, message?: string | null, payload?: any | null, createdAt: any }> };

export type OnThreadTurnUpdatedSubscriptionVariables = Exact<{
  tenantId: Scalars['ID']['input'];
}>;


export type OnThreadTurnUpdatedSubscription = { __typename?: 'Subscription', onThreadTurnUpdated?: { __typename?: 'ThreadTurnUpdateEvent', runId: string, triggerId?: string | null, tenantId: string, threadId?: string | null, agentId?: string | null, status: string, triggerName?: string | null, updatedAt: any } | null };

export type ActiveTurnsQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
}>;


export type ActiveTurnsQuery = { __typename?: 'Query', running: Array<{ __typename?: 'ThreadTurn', id: string, tenantId: string, threadId?: string | null, agentId?: string | null, status: string, startedAt?: any | null }>, queued: Array<{ __typename?: 'ThreadTurn', id: string, tenantId: string, threadId?: string | null, agentId?: string | null, status: string, startedAt?: any | null }>, queuedWakeups: Array<{ __typename?: 'AgentWakeupRequest', id: string, tenantId: string, agentId: string, source: string, triggerDetail?: string | null, status: string }> };

export type OnNewMessageSubscriptionVariables = Exact<{
  threadId: Scalars['ID']['input'];
}>;


export type OnNewMessageSubscription = { __typename?: 'Subscription', onNewMessage?: { __typename?: 'NewMessageEvent', messageId: string, threadId: string, tenantId: string, role: string, content?: string | null, senderType?: string | null, senderId?: string | null, createdAt: any } | null };

export type ArtifactsListQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
  threadId?: InputMaybe<Scalars['ID']['input']>;
  agentId?: InputMaybe<Scalars['ID']['input']>;
  type?: InputMaybe<ArtifactType>;
  status?: InputMaybe<ArtifactStatus>;
  limit?: InputMaybe<Scalars['Int']['input']>;
}>;


export type ArtifactsListQuery = { __typename?: 'Query', artifacts: Array<{ __typename?: 'Artifact', id: string, tenantId: string, agentId?: string | null, threadId?: string | null, title: string, type: ArtifactType, status: ArtifactStatus, summary?: string | null, createdAt: any, updatedAt: any }> };

export type ArtifactDetailQueryVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type ArtifactDetailQuery = { __typename?: 'Query', artifact?: { __typename?: 'Artifact', id: string, title: string, type: ArtifactType, status: ArtifactStatus, content?: string | null, summary?: string | null, agentId?: string | null, threadId?: string | null, createdAt: any, updatedAt: any } | null };

export type MemoryRecordsQueryVariables = Exact<{
  userId: Scalars['ID']['input'];
  namespace: Scalars['String']['input'];
}>;


export type MemoryRecordsQuery = { __typename?: 'Query', memoryRecords: Array<{ __typename?: 'MemoryRecord', memoryRecordId: string, createdAt?: any | null, updatedAt?: any | null, namespace?: string | null, strategyId?: string | null, strategy?: string | null, userSlug?: string | null, agentSlug?: string | null, factType?: string | null, confidence?: number | null, eventDate?: any | null, occurredStart?: any | null, occurredEnd?: any | null, mentionedAt?: any | null, tags?: Array<string> | null, accessCount?: number | null, proofCount?: number | null, context?: string | null, threadId?: string | null, content?: { __typename?: 'MemoryContent', text?: string | null } | null }> };

export type DeleteMemoryRecordMutationVariables = Exact<{
  userId: Scalars['ID']['input'];
  memoryRecordId: Scalars['ID']['input'];
}>;


export type DeleteMemoryRecordMutation = { __typename?: 'Mutation', deleteMemoryRecord: boolean };

export type UpdateMemoryRecordMutationVariables = Exact<{
  userId: Scalars['ID']['input'];
  memoryRecordId: Scalars['ID']['input'];
  content: Scalars['String']['input'];
}>;


export type UpdateMemoryRecordMutation = { __typename?: 'Mutation', updateMemoryRecord: boolean };

export type MemorySearchQueryVariables = Exact<{
  userId: Scalars['ID']['input'];
  query: Scalars['String']['input'];
  strategy?: InputMaybe<MemoryStrategy>;
  limit?: InputMaybe<Scalars['Int']['input']>;
}>;


export type MemorySearchQuery = { __typename?: 'Query', memorySearch: { __typename?: 'MemorySearchResult', totalCount: number, records: Array<{ __typename?: 'MemoryRecord', memoryRecordId: string, score?: number | null, namespace?: string | null, strategy?: string | null, createdAt?: any | null, threadId?: string | null, content?: { __typename?: 'MemoryContent', text?: string | null } | null }> } };

export type MemorySystemConfigQueryVariables = Exact<{ [key: string]: never; }>;


export type MemorySystemConfigQuery = { __typename?: 'Query', memorySystemConfig: { __typename?: 'MemorySystemConfig', managedMemoryEnabled: boolean, hindsightEnabled: boolean } };

export type AgentTemplatesListQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
}>;


export type AgentTemplatesListQuery = { __typename?: 'Query', agentTemplates: Array<{ __typename?: 'AgentTemplate', id: string, tenantId?: string | null, name: string, slug: string, description?: string | null, category?: string | null, icon?: string | null, templateKind: TemplateKind, source: string, runtime: AgentRuntime, model?: string | null, guardrailId?: string | null, blockedTools?: any | null, config?: any | null, skills?: any | null, knowledgeBaseIds?: any | null, isPublished: boolean, createdAt: any, updatedAt: any }> };

export type AgentTemplateDetailQueryVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type AgentTemplateDetailQuery = { __typename?: 'Query', agentTemplate?: { __typename?: 'AgentTemplate', id: string, tenantId?: string | null, name: string, slug: string, description?: string | null, category?: string | null, icon?: string | null, templateKind: TemplateKind, source: string, runtime: AgentRuntime, model?: string | null, guardrailId?: string | null, blockedTools?: any | null, config?: any | null, skills?: any | null, sandbox?: any | null, browser?: any | null, webSearch?: any | null, sendEmail?: any | null, contextEngine?: any | null, knowledgeBaseIds?: any | null, isPublished: boolean, createdAt: any, updatedAt: any } | null };

export type CreateAgentTemplateMutationVariables = Exact<{
  input: CreateAgentTemplateInput;
}>;


export type CreateAgentTemplateMutation = { __typename?: 'Mutation', createAgentTemplate: { __typename?: 'AgentTemplate', id: string, name: string, slug: string, templateKind: TemplateKind, runtime: AgentRuntime } };

export type UpdateAgentTemplateMutationVariables = Exact<{
  id: Scalars['ID']['input'];
  input: UpdateAgentTemplateInput;
}>;


export type UpdateAgentTemplateMutation = { __typename?: 'Mutation', updateAgentTemplate: { __typename?: 'AgentTemplate', id: string, name: string, slug: string, templateKind: TemplateKind, runtime: AgentRuntime, model?: string | null, guardrailId?: string | null, blockedTools?: any | null, config?: any | null, skills?: any | null, sandbox?: any | null, browser?: any | null, webSearch?: any | null, sendEmail?: any | null, contextEngine?: any | null, knowledgeBaseIds?: any | null, updatedAt: any } };

export type DeleteAgentTemplateMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type DeleteAgentTemplateMutation = { __typename?: 'Mutation', deleteAgentTemplate: boolean };

export type TenantSandboxStatusQueryVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type TenantSandboxStatusQuery = { __typename?: 'Query', tenant?: { __typename?: 'Tenant', id: string, sandboxEnabled: boolean, complianceTier: string, sandboxInterpreterPublicId?: string | null, sandboxInterpreterInternalId?: string | null } | null };

export type CreateAgentFromTemplateMutationVariables = Exact<{
  input: CreateAgentFromTemplateInput;
}>;


export type CreateAgentFromTemplateMutation = { __typename?: 'Mutation', createAgentFromTemplate: { __typename?: 'Agent', id: string, name: string, slug?: string | null } };

export type LinkedAgentsForTemplateQueryVariables = Exact<{
  templateId: Scalars['ID']['input'];
}>;


export type LinkedAgentsForTemplateQuery = { __typename?: 'Query', linkedAgentsForTemplate: Array<{ __typename?: 'Agent', id: string, name: string, slug?: string | null, role?: string | null, status: AgentStatus, updatedAt: any }> };

export type TemplateSyncDiffQueryVariables = Exact<{
  templateId: Scalars['ID']['input'];
  agentId: Scalars['ID']['input'];
}>;


export type TemplateSyncDiffQuery = { __typename?: 'Query', templateSyncDiff: { __typename?: 'TemplateSyncDiff', skillsAdded: Array<string>, skillsRemoved: Array<string>, skillsChanged: Array<string>, kbsAdded: Array<string>, kbsRemoved: Array<string>, filesAdded: Array<string>, filesModified: Array<string>, filesSame: Array<string>, roleChange?: { __typename?: 'RoleChange', current?: string | null, target?: string | null } | null, permissionsChanges: Array<{ __typename?: 'SkillPermissionsDelta', skillId: string, added: Array<string>, removed: Array<string> }> } };

export type AgentVersionsListQueryVariables = Exact<{
  agentId: Scalars['ID']['input'];
  limit?: InputMaybe<Scalars['Int']['input']>;
}>;


export type AgentVersionsListQuery = { __typename?: 'Query', agentVersions: Array<{ __typename?: 'AgentVersion', id: string, agentId: string, versionNumber: number, label?: string | null, createdBy?: string | null, createdAt: any }> };

export type SyncTemplateToAgentMutationVariables = Exact<{
  templateId: Scalars['ID']['input'];
  agentId: Scalars['ID']['input'];
}>;


export type SyncTemplateToAgentMutation = { __typename?: 'Mutation', syncTemplateToAgent: { __typename?: 'Agent', id: string, name: string, role?: string | null, updatedAt: any } };

export type SyncTemplateToAllAgentsMutationVariables = Exact<{
  templateId: Scalars['ID']['input'];
}>;


export type SyncTemplateToAllAgentsMutation = { __typename?: 'Mutation', syncTemplateToAllAgents: { __typename?: 'SyncSummary', agentsSynced: number, agentsFailed: number, errors: Array<string> } };

export type RollbackAgentVersionMutationVariables = Exact<{
  agentId: Scalars['ID']['input'];
  versionId: Scalars['ID']['input'];
}>;


export type RollbackAgentVersionMutation = { __typename?: 'Mutation', rollbackAgentVersion: { __typename?: 'Agent', id: string, name: string, role?: string | null, updatedAt: any } };

export type MemoryGraphQueryVariables = Exact<{
  userId: Scalars['ID']['input'];
}>;


export type MemoryGraphQuery = { __typename?: 'Query', memoryGraph: { __typename?: 'MemoryGraph', nodes: Array<{ __typename?: 'MemoryGraphNode', id: string, label: string, type: string, strategy?: string | null, entityType?: string | null, edgeCount: number, latestThreadId?: string | null }>, edges: Array<{ __typename?: 'MemoryGraphEdge', source: string, target: string, type: string, label?: string | null, weight: number }> } };

export type WikiGraphQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
  userId: Scalars['ID']['input'];
}>;


export type WikiGraphQuery = { __typename?: 'Query', wikiGraph: { __typename?: 'WikiGraph', nodes: Array<{ __typename?: 'WikiGraphNode', id: string, label: string, type: string, entityType: WikiPageType, slug: string, strategy?: string | null, edgeCount: number, latestThreadId?: string | null }>, edges: Array<{ __typename?: 'WikiGraphEdge', source: string, target: string, label: string, weight: number }> } };

export type AdminWikiPageQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
  userId: Scalars['ID']['input'];
  type: WikiPageType;
  slug: Scalars['String']['input'];
}>;


export type AdminWikiPageQuery = { __typename?: 'Query', wikiPage?: { __typename?: 'WikiPage', id: string, type: WikiPageType, slug: string, title: string, summary?: string | null, bodyMd?: string | null, status: string, lastCompiledAt?: any | null, updatedAt: any, aliases: Array<string>, sections: Array<{ __typename?: 'WikiPageSection', id: string, sectionSlug: string, heading: string, bodyMd: string, position: number, lastSourceAt?: any | null }> } | null };

export type AdminWikiBacklinksQueryVariables = Exact<{
  pageId: Scalars['ID']['input'];
}>;


export type AdminWikiBacklinksQuery = { __typename?: 'Query', wikiBacklinks: Array<{ __typename?: 'WikiPage', id: string, type: WikiPageType, slug: string, title: string, summary?: string | null }> };

export type AdminRecentWikiPagesQueryVariables = Exact<{
  userId: Scalars['ID']['input'];
  limit?: InputMaybe<Scalars['Int']['input']>;
}>;


export type AdminRecentWikiPagesQuery = { __typename?: 'Query', recentWikiPages: Array<{ __typename?: 'WikiPage', id: string, type: WikiPageType, slug: string, title: string, summary?: string | null, lastCompiledAt?: any | null, updatedAt: any }> };

export type AdminWikiSearchQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
  userId: Scalars['ID']['input'];
  query: Scalars['String']['input'];
  limit?: InputMaybe<Scalars['Int']['input']>;
}>;


export type AdminWikiSearchQuery = { __typename?: 'Query', wikiSearch: Array<{ __typename?: 'WikiSearchResult', score: number, matchedAlias?: string | null, page: { __typename?: 'WikiPage', id: string, type: WikiPageType, slug: string, title: string, summary?: string | null, lastCompiledAt?: any | null, updatedAt: any } }> };

export type ThreadTracesQueryVariables = Exact<{
  threadId: Scalars['ID']['input'];
  tenantId: Scalars['ID']['input'];
}>;


export type ThreadTracesQuery = { __typename?: 'Query', threadTraces: Array<{ __typename?: 'TraceEvent', traceId: string, threadId?: string | null, agentId?: string | null, agentName?: string | null, model?: string | null, inputTokens?: number | null, outputTokens?: number | null, durationMs?: number | null, costUsd?: number | null, estimated?: boolean | null, createdAt: any }> };

export type TurnInvocationLogsQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
  turnId: Scalars['ID']['input'];
}>;


export type TurnInvocationLogsQuery = { __typename?: 'Query', turnInvocationLogs: Array<{ __typename?: 'ModelInvocation', requestId: string, modelId: string, timestamp: any, inputTokenCount: number, outputTokenCount: number, cacheReadTokenCount: number, inputPreview?: string | null, outputPreview?: string | null, toolCount?: number | null, costUsd?: number | null, toolUses?: Array<string> | null, hasToolResult?: boolean | null, branch?: string | null }> };

export type EvalSummaryQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
}>;


export type EvalSummaryQuery = { __typename?: 'Query', evalSummary: { __typename?: 'EvalSummary', totalRuns: number, latestPassRate?: number | null, avgPassRate?: number | null, regressionCount: number } };

export type EvalRunsQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  agentId?: InputMaybe<Scalars['ID']['input']>;
}>;


export type EvalRunsQuery = { __typename?: 'Query', evalRuns: { __typename?: 'EvalRunsPage', totalCount: number, items: Array<{ __typename?: 'EvalRun', id: string, status: string, model?: string | null, categories: Array<string>, totalTests: number, passed: number, failed: number, passRate?: number | null, regression: boolean, costUsd?: number | null, agentId?: string | null, agentName?: string | null, agentTemplateId?: string | null, agentTemplateName?: string | null, startedAt?: any | null, completedAt?: any | null, createdAt: any }> } };

export type EvalRunQueryVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type EvalRunQuery = { __typename?: 'Query', evalRun?: { __typename?: 'EvalRun', id: string, status: string, model?: string | null, categories: Array<string>, totalTests: number, passed: number, failed: number, passRate?: number | null, regression: boolean, costUsd?: number | null, errorMessage?: string | null, agentId?: string | null, agentName?: string | null, startedAt?: any | null, completedAt?: any | null, createdAt: any } | null };

export type EvalRunResultsQueryVariables = Exact<{
  runId: Scalars['ID']['input'];
}>;


export type EvalRunResultsQuery = { __typename?: 'Query', evalRunResults: Array<{ __typename?: 'EvalResult', id: string, testCaseId?: string | null, testCaseName?: string | null, category?: string | null, status: string, score?: number | null, durationMs?: number | null, input?: string | null, actualOutput?: string | null, evaluatorResults: any, assertions: any, errorMessage?: string | null, createdAt: any }> };

export type EvalTimeSeriesQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
  days?: InputMaybe<Scalars['Int']['input']>;
}>;


export type EvalTimeSeriesQuery = { __typename?: 'Query', evalTimeSeries: Array<{ __typename?: 'EvalTimeSeriesPoint', day: string, passRate?: number | null, runCount: number, passed: number, failed: number }> };

export type EvalTestCasesQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
  category?: InputMaybe<Scalars['String']['input']>;
  search?: InputMaybe<Scalars['String']['input']>;
}>;


export type EvalTestCasesQuery = { __typename?: 'Query', evalTestCases: Array<{ __typename?: 'EvalTestCase', id: string, name: string, category: string, query: string, systemPrompt?: string | null, assertions: any, agentcoreEvaluatorIds: Array<string>, tags: Array<string>, enabled: boolean, source: string, createdAt: any, updatedAt: any }> };

export type EvalTestCaseQueryVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type EvalTestCaseQuery = { __typename?: 'Query', evalTestCase?: { __typename?: 'EvalTestCase', id: string, name: string, category: string, query: string, systemPrompt?: string | null, assertions: any, agentcoreEvaluatorIds: Array<string>, tags: Array<string>, enabled: boolean, source: string, createdAt: any, updatedAt: any } | null };

export type StartEvalRunMutationVariables = Exact<{
  tenantId: Scalars['ID']['input'];
  input: StartEvalRunInput;
}>;


export type StartEvalRunMutation = { __typename?: 'Mutation', startEvalRun: { __typename?: 'EvalRun', id: string, status: string, categories: Array<string>, createdAt: any } };

export type CreateEvalTestCaseMutationVariables = Exact<{
  tenantId: Scalars['ID']['input'];
  input: CreateEvalTestCaseInput;
}>;


export type CreateEvalTestCaseMutation = { __typename?: 'Mutation', createEvalTestCase: { __typename?: 'EvalTestCase', id: string, name: string, category: string, query: string, systemPrompt?: string | null, agentTemplateId?: string | null, assertions: any, agentcoreEvaluatorIds: Array<string>, enabled: boolean, createdAt: any } };

export type UpdateEvalTestCaseMutationVariables = Exact<{
  id: Scalars['ID']['input'];
  input: UpdateEvalTestCaseInput;
}>;


export type UpdateEvalTestCaseMutation = { __typename?: 'Mutation', updateEvalTestCase: { __typename?: 'EvalTestCase', id: string, name: string, category: string, query: string, systemPrompt?: string | null, agentTemplateId?: string | null, assertions: any, agentcoreEvaluatorIds: Array<string>, enabled: boolean, updatedAt: any } };

export type SeedEvalTestCasesMutationVariables = Exact<{
  tenantId: Scalars['ID']['input'];
  categories?: InputMaybe<Array<Scalars['String']['input']> | Scalars['String']['input']>;
}>;


export type SeedEvalTestCasesMutation = { __typename?: 'Mutation', seedEvalTestCases: number };

export type DeleteEvalTestCaseMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type DeleteEvalTestCaseMutation = { __typename?: 'Mutation', deleteEvalTestCase: boolean };

export type DeleteEvalRunMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type DeleteEvalRunMutation = { __typename?: 'Mutation', deleteEvalRun: boolean };

export type CancelEvalRunMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type CancelEvalRunMutation = { __typename?: 'Mutation', cancelEvalRun: { __typename?: 'EvalRun', id: string, status: string, completedAt?: any | null } };

export type EvalTestCaseHistoryQueryVariables = Exact<{
  testCaseId: Scalars['ID']['input'];
  limit?: InputMaybe<Scalars['Int']['input']>;
}>;


export type EvalTestCaseHistoryQuery = { __typename?: 'Query', evalTestCaseHistory: Array<{ __typename?: 'EvalResult', id: string, runId: string, testCaseName?: string | null, category?: string | null, status: string, score?: number | null, durationMs?: number | null, input?: string | null, expected?: string | null, actualOutput?: string | null, assertions: any, evaluatorResults: any, errorMessage?: string | null, createdAt: any }> };

export type OnEvalRunUpdatedSubscriptionVariables = Exact<{
  tenantId: Scalars['ID']['input'];
}>;


export type OnEvalRunUpdatedSubscription = { __typename?: 'Subscription', onEvalRunUpdated?: { __typename?: 'EvalRunUpdateEvent', runId: string, tenantId: string, agentId?: string | null, status: string, totalTests?: number | null, passed?: number | null, failed?: number | null, passRate?: number | null, errorMessage?: string | null, updatedAt: any } | null };


export const AcceptTemplateUpdateDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AcceptTemplateUpdate"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"filename"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"acceptTemplateUpdate"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"agentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}}},{"kind":"Argument","name":{"kind":"Name","value":"filename"},"value":{"kind":"Variable","name":{"kind":"Name","value":"filename"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}}]}}]}}]} as unknown as DocumentNode<AcceptTemplateUpdateMutation, AcceptTemplateUpdateMutationVariables>;
export const AgentDetailDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AgentDetail"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"agent"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}}]}}]}}]} as unknown as DocumentNode<AgentDetailQuery, AgentDetailQueryVariables>;
export const AgentPinStatusDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AgentPinStatus"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"agentPinStatus"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"agentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}}},{"kind":"Argument","name":{"kind":"Name","value":"includeNested"},"value":{"kind":"BooleanValue","value":true}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"path"}},{"kind":"Field","name":{"kind":"Name","value":"folderPath"}},{"kind":"Field","name":{"kind":"Name","value":"filename"}},{"kind":"Field","name":{"kind":"Name","value":"pinnedSha"}},{"kind":"Field","name":{"kind":"Name","value":"latestSha"}},{"kind":"Field","name":{"kind":"Name","value":"updateAvailable"}},{"kind":"Field","name":{"kind":"Name","value":"pinnedContent"}},{"kind":"Field","name":{"kind":"Name","value":"latestContent"}}]}}]}}]} as unknown as DocumentNode<AgentPinStatusQuery, AgentPinStatusQueryVariables>;
export const CreateSubAgentDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateSubAgent"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateAgentInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createAgent"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}}]}}]}}]} as unknown as DocumentNode<CreateSubAgentMutation, CreateSubAgentMutationVariables>;
export const DeleteSubAgentDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteSubAgent"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteAgent"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}]}]}}]} as unknown as DocumentNode<DeleteSubAgentMutation, DeleteSubAgentMutationVariables>;
export const CreateThreadDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateThread"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateThreadInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createThread"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<CreateThreadMutation, CreateThreadMutationVariables>;
export const TenantLabelsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"TenantLabels"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"threadLabels"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"color"}}]}}]}}]} as unknown as DocumentNode<TenantLabelsQuery, TenantLabelsQueryVariables>;
export const CreateThreadLabelDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateThreadLabel"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateThreadLabelInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createThreadLabel"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"color"}}]}}]}}]} as unknown as DocumentNode<CreateThreadLabelMutation, CreateThreadLabelMutationVariables>;
export const AssignThreadLabelDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AssignThreadLabel"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"threadId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"labelId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"assignThreadLabel"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"threadId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"threadId"}}},{"kind":"Argument","name":{"kind":"Name","value":"labelId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"labelId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"labelId"}}]}}]}}]} as unknown as DocumentNode<AssignThreadLabelMutation, AssignThreadLabelMutationVariables>;
export const RemoveThreadLabelDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RemoveThreadLabel"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"threadId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"labelId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"removeThreadLabel"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"threadId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"threadId"}}},{"kind":"Argument","name":{"kind":"Name","value":"labelId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"labelId"}}}]}]}}]} as unknown as DocumentNode<RemoveThreadLabelMutation, RemoveThreadLabelMutationVariables>;
export const CreateComplianceExportDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateComplianceExport"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"filter"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ComplianceEventFilter"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"format"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ComplianceExportFormat"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createComplianceExport"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"filter"},"value":{"kind":"Variable","name":{"kind":"Name","value":"filter"}}},{"kind":"Argument","name":{"kind":"Name","value":"format"},"value":{"kind":"Variable","name":{"kind":"Name","value":"format"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"jobId"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"requestedByActorId"}},{"kind":"Field","name":{"kind":"Name","value":"requestedAt"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"format"}},{"kind":"Field","name":{"kind":"Name","value":"filter"}},{"kind":"Field","name":{"kind":"Name","value":"s3Key"}},{"kind":"Field","name":{"kind":"Name","value":"presignedUrl"}},{"kind":"Field","name":{"kind":"Name","value":"presignedUrlExpiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"jobError"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}}]}}]}}]} as unknown as DocumentNode<CreateComplianceExportMutation, CreateComplianceExportMutationVariables>;
export const ComplianceExportsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ComplianceExports"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"complianceExports"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"jobId"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"requestedByActorId"}},{"kind":"Field","name":{"kind":"Name","value":"requestedAt"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"format"}},{"kind":"Field","name":{"kind":"Name","value":"filter"}},{"kind":"Field","name":{"kind":"Name","value":"s3Key"}},{"kind":"Field","name":{"kind":"Name","value":"presignedUrl"}},{"kind":"Field","name":{"kind":"Name","value":"presignedUrlExpiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"jobError"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}}]}}]}}]} as unknown as DocumentNode<ComplianceExportsQuery, ComplianceExportsQueryVariables>;
export const ComplianceEventsListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ComplianceEventsList"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"filter"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"ComplianceEventFilter"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"after"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"first"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"complianceEvents"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"filter"},"value":{"kind":"Variable","name":{"kind":"Name","value":"filter"}}},{"kind":"Argument","name":{"kind":"Name","value":"after"},"value":{"kind":"Variable","name":{"kind":"Name","value":"after"}}},{"kind":"Argument","name":{"kind":"Name","value":"first"},"value":{"kind":"Variable","name":{"kind":"Name","value":"first"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"edges"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"node"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"eventId"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"occurredAt"}},{"kind":"Field","name":{"kind":"Name","value":"recordedAt"}},{"kind":"Field","name":{"kind":"Name","value":"actor"}},{"kind":"Field","name":{"kind":"Name","value":"actorType"}},{"kind":"Field","name":{"kind":"Name","value":"source"}},{"kind":"Field","name":{"kind":"Name","value":"eventType"}},{"kind":"Field","name":{"kind":"Name","value":"eventHash"}},{"kind":"Field","name":{"kind":"Name","value":"prevHash"}},{"kind":"Field","name":{"kind":"Name","value":"anchorStatus"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"state"}},{"kind":"Field","name":{"kind":"Name","value":"cadenceId"}},{"kind":"Field","name":{"kind":"Name","value":"anchoredRecordedAt"}},{"kind":"Field","name":{"kind":"Name","value":"nextCadenceWithinMinutes"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"cursor"}}]}},{"kind":"Field","name":{"kind":"Name","value":"pageInfo"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"hasNextPage"}},{"kind":"Field","name":{"kind":"Name","value":"endCursor"}}]}}]}}]}}]} as unknown as DocumentNode<ComplianceEventsListQuery, ComplianceEventsListQueryVariables>;
export const ComplianceEventDetailDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ComplianceEventDetail"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"eventId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"complianceEvent"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"eventId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"eventId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"eventId"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"occurredAt"}},{"kind":"Field","name":{"kind":"Name","value":"recordedAt"}},{"kind":"Field","name":{"kind":"Name","value":"actor"}},{"kind":"Field","name":{"kind":"Name","value":"actorType"}},{"kind":"Field","name":{"kind":"Name","value":"source"}},{"kind":"Field","name":{"kind":"Name","value":"eventType"}},{"kind":"Field","name":{"kind":"Name","value":"eventHash"}},{"kind":"Field","name":{"kind":"Name","value":"prevHash"}},{"kind":"Field","name":{"kind":"Name","value":"payload"}},{"kind":"Field","name":{"kind":"Name","value":"anchorStatus"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"state"}},{"kind":"Field","name":{"kind":"Name","value":"cadenceId"}},{"kind":"Field","name":{"kind":"Name","value":"anchoredRecordedAt"}},{"kind":"Field","name":{"kind":"Name","value":"nextCadenceWithinMinutes"}}]}}]}}]}}]} as unknown as DocumentNode<ComplianceEventDetailQuery, ComplianceEventDetailQueryVariables>;
export const ComplianceEventByHashDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ComplianceEventByHash"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"eventHash"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"complianceEventByHash"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"eventHash"},"value":{"kind":"Variable","name":{"kind":"Name","value":"eventHash"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"eventId"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"occurredAt"}},{"kind":"Field","name":{"kind":"Name","value":"recordedAt"}},{"kind":"Field","name":{"kind":"Name","value":"actor"}},{"kind":"Field","name":{"kind":"Name","value":"actorType"}},{"kind":"Field","name":{"kind":"Name","value":"source"}},{"kind":"Field","name":{"kind":"Name","value":"eventType"}},{"kind":"Field","name":{"kind":"Name","value":"eventHash"}},{"kind":"Field","name":{"kind":"Name","value":"prevHash"}},{"kind":"Field","name":{"kind":"Name","value":"anchorStatus"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"state"}},{"kind":"Field","name":{"kind":"Name","value":"cadenceId"}},{"kind":"Field","name":{"kind":"Name","value":"anchoredRecordedAt"}},{"kind":"Field","name":{"kind":"Name","value":"nextCadenceWithinMinutes"}}]}}]}}]}}]} as unknown as DocumentNode<ComplianceEventByHashQuery, ComplianceEventByHashQueryVariables>;
export const ComplianceTenantsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ComplianceTenants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"complianceTenants"}}]}}]} as unknown as DocumentNode<ComplianceTenantsQuery, ComplianceTenantsQueryVariables>;
export const ComplianceOperatorCheckDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ComplianceOperatorCheck"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"complianceOperatorCheck"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"isOperator"}},{"kind":"Field","name":{"kind":"Name","value":"allowlistConfigured"}}]}}]}}]} as unknown as DocumentNode<ComplianceOperatorCheckQuery, ComplianceOperatorCheckQueryVariables>;
export const AgentsListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AgentsList"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"agents"},"name":{"kind":"Name","value":"allTenantAgents"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"templateId"}},{"kind":"Field","name":{"kind":"Name","value":"agentTemplate"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"model"}}]}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}},{"kind":"Field","name":{"kind":"Name","value":"lastHeartbeatAt"}},{"kind":"Field","name":{"kind":"Name","value":"adapterType"}},{"kind":"Field","name":{"kind":"Name","value":"humanPairId"}},{"kind":"Field","name":{"kind":"Name","value":"humanPair"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"email"}}]}},{"kind":"Field","name":{"kind":"Name","value":"budgetPolicy"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"limitUsd"}},{"kind":"Field","name":{"kind":"Name","value":"actionOnExceed"}}]}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"modelCatalog"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"modelId"}},{"kind":"Field","name":{"kind":"Name","value":"displayName"}}]}}]}}]} as unknown as DocumentNode<AgentsListQuery, AgentsListQueryVariables>;
export const AgentProfileDetailDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AgentProfileDetail"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"agent"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"templateId"}},{"kind":"Field","name":{"kind":"Name","value":"agentTemplate"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"model"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"guardrailId"}},{"kind":"Field","name":{"kind":"Name","value":"blockedTools"}},{"kind":"Field","name":{"kind":"Name","value":"skills"}},{"kind":"Field","name":{"kind":"Name","value":"browser"}}]}},{"kind":"Field","name":{"kind":"Name","value":"systemPrompt"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}},{"kind":"Field","name":{"kind":"Name","value":"lastHeartbeatAt"}},{"kind":"Field","name":{"kind":"Name","value":"runtimeConfig"}},{"kind":"Field","name":{"kind":"Name","value":"adapterType"}},{"kind":"Field","name":{"kind":"Name","value":"adapterConfig"}},{"kind":"Field","name":{"kind":"Name","value":"humanPairId"}},{"kind":"Field","name":{"kind":"Name","value":"humanPair"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"email"}}]}},{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"capabilities"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"capability"}},{"kind":"Field","name":{"kind":"Name","value":"config"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}}]}},{"kind":"Field","name":{"kind":"Name","value":"skills"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"skillId"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}},{"kind":"Field","name":{"kind":"Name","value":"config"}},{"kind":"Field","name":{"kind":"Name","value":"permissions"}}]}},{"kind":"Field","name":{"kind":"Name","value":"budgetPolicy"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"limitUsd"}},{"kind":"Field","name":{"kind":"Name","value":"actionOnExceed"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}}]}},{"kind":"Field","name":{"kind":"Name","value":"parentAgentId"}},{"kind":"Field","name":{"kind":"Name","value":"subAgents"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<AgentProfileDetailQuery, AgentProfileDetailQueryVariables>;
export const CreateAgentDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateAgent"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateAgentInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createAgent"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"templateId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<CreateAgentMutation, CreateAgentMutationVariables>;
export const AgentKnowledgeBasesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AgentKnowledgeBases"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"agent"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"knowledgeBases"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"knowledgeBaseId"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}},{"kind":"Field","name":{"kind":"Name","value":"knowledgeBase"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]}}]}}]}}]} as unknown as DocumentNode<AgentKnowledgeBasesQuery, AgentKnowledgeBasesQueryVariables>;
export const UpdateAgentDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateAgent"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateAgentInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateAgent"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"templateId"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"systemPrompt"}},{"kind":"Field","name":{"kind":"Name","value":"adapterType"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<UpdateAgentMutation, UpdateAgentMutationVariables>;
export const UpdateAgentRuntimeDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateAgentRuntime"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"runtime"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"AgentRuntime"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateAgentRuntime"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"runtime"},"value":{"kind":"Variable","name":{"kind":"Name","value":"runtime"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<UpdateAgentRuntimeMutation, UpdateAgentRuntimeMutationVariables>;
export const DeleteAgentDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteAgent"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteAgent"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}]}]}}]} as unknown as DocumentNode<DeleteAgentMutation, DeleteAgentMutationVariables>;
export const UpdateAgentStatusDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateAgentStatus"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"status"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"AgentStatus"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateAgentStatus"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"status"},"value":{"kind":"Variable","name":{"kind":"Name","value":"status"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<UpdateAgentStatusMutation, UpdateAgentStatusMutationVariables>;
export const SetAgentCapabilitiesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SetAgentCapabilities"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"capabilities"}},"type":{"kind":"NonNullType","type":{"kind":"ListType","type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"AgentCapabilityInput"}}}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"setAgentCapabilities"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"agentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}}},{"kind":"Argument","name":{"kind":"Name","value":"capabilities"},"value":{"kind":"Variable","name":{"kind":"Name","value":"capabilities"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"capability"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}}]}}]}}]} as unknown as DocumentNode<SetAgentCapabilitiesMutation, SetAgentCapabilitiesMutationVariables>;
export const SetAgentBudgetPolicyDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SetAgentBudgetPolicy"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"AgentBudgetPolicyInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"setAgentBudgetPolicy"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"agentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"limitUsd"}},{"kind":"Field","name":{"kind":"Name","value":"actionOnExceed"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}}]}}]}}]} as unknown as DocumentNode<SetAgentBudgetPolicyMutation, SetAgentBudgetPolicyMutationVariables>;
export const DeleteAgentBudgetPolicyDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteAgentBudgetPolicy"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteAgentBudgetPolicy"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"agentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}}}]}]}}]} as unknown as DocumentNode<DeleteAgentBudgetPolicyMutation, DeleteAgentBudgetPolicyMutationVariables>;
export const ComputersListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ComputersList"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"computers"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"ownerUserId"}},{"kind":"Field","name":{"kind":"Name","value":"owner"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"email"}}]}},{"kind":"Field","name":{"kind":"Name","value":"templateId"}},{"kind":"Field","name":{"kind":"Name","value":"template"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"templateKind"}},{"kind":"Field","name":{"kind":"Name","value":"model"}}]}},{"kind":"Field","name":{"kind":"Name","value":"sourceAgent"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}}]}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"desiredRuntimeStatus"}},{"kind":"Field","name":{"kind":"Name","value":"runtimeStatus"}},{"kind":"Field","name":{"kind":"Name","value":"liveWorkspaceRoot"}},{"kind":"Field","name":{"kind":"Name","value":"efsAccessPointId"}},{"kind":"Field","name":{"kind":"Name","value":"ecsServiceName"}},{"kind":"Field","name":{"kind":"Name","value":"lastHeartbeatAt"}},{"kind":"Field","name":{"kind":"Name","value":"lastActiveAt"}},{"kind":"Field","name":{"kind":"Name","value":"budgetMonthlyCents"}},{"kind":"Field","name":{"kind":"Name","value":"spentMonthlyCents"}},{"kind":"Field","name":{"kind":"Name","value":"budgetPausedAt"}},{"kind":"Field","name":{"kind":"Name","value":"budgetPausedReason"}},{"kind":"Field","name":{"kind":"Name","value":"migratedFromAgentId"}},{"kind":"Field","name":{"kind":"Name","value":"migrationMetadata"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<ComputersListQuery, ComputersListQueryVariables>;
export const ComputerDetailDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ComputerDetail"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"computer"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"ownerUserId"}},{"kind":"Field","name":{"kind":"Name","value":"owner"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"email"}}]}},{"kind":"Field","name":{"kind":"Name","value":"templateId"}},{"kind":"Field","name":{"kind":"Name","value":"template"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"templateKind"}},{"kind":"Field","name":{"kind":"Name","value":"model"}}]}},{"kind":"Field","name":{"kind":"Name","value":"sourceAgent"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}}]}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"desiredRuntimeStatus"}},{"kind":"Field","name":{"kind":"Name","value":"runtimeStatus"}},{"kind":"Field","name":{"kind":"Name","value":"runtimeConfig"}},{"kind":"Field","name":{"kind":"Name","value":"liveWorkspaceRoot"}},{"kind":"Field","name":{"kind":"Name","value":"efsAccessPointId"}},{"kind":"Field","name":{"kind":"Name","value":"ecsServiceName"}},{"kind":"Field","name":{"kind":"Name","value":"lastHeartbeatAt"}},{"kind":"Field","name":{"kind":"Name","value":"lastActiveAt"}},{"kind":"Field","name":{"kind":"Name","value":"budgetMonthlyCents"}},{"kind":"Field","name":{"kind":"Name","value":"spentMonthlyCents"}},{"kind":"Field","name":{"kind":"Name","value":"budgetPausedAt"}},{"kind":"Field","name":{"kind":"Name","value":"budgetPausedReason"}},{"kind":"Field","name":{"kind":"Name","value":"migratedFromAgentId"}},{"kind":"Field","name":{"kind":"Name","value":"migrationMetadata"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<ComputerDetailQuery, ComputerDetailQueryVariables>;
export const MyComputerDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MyComputer"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"myComputer"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"desiredRuntimeStatus"}},{"kind":"Field","name":{"kind":"Name","value":"runtimeStatus"}},{"kind":"Field","name":{"kind":"Name","value":"liveWorkspaceRoot"}},{"kind":"Field","name":{"kind":"Name","value":"lastHeartbeatAt"}},{"kind":"Field","name":{"kind":"Name","value":"lastActiveAt"}}]}}]}}]} as unknown as DocumentNode<MyComputerQuery, MyComputerQueryVariables>;
export const UpdateComputerDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateComputer"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateComputerInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateComputer"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"desiredRuntimeStatus"}},{"kind":"Field","name":{"kind":"Name","value":"runtimeStatus"}},{"kind":"Field","name":{"kind":"Name","value":"liveWorkspaceRoot"}},{"kind":"Field","name":{"kind":"Name","value":"efsAccessPointId"}},{"kind":"Field","name":{"kind":"Name","value":"ecsServiceName"}},{"kind":"Field","name":{"kind":"Name","value":"lastHeartbeatAt"}},{"kind":"Field","name":{"kind":"Name","value":"lastActiveAt"}},{"kind":"Field","name":{"kind":"Name","value":"budgetMonthlyCents"}},{"kind":"Field","name":{"kind":"Name","value":"spentMonthlyCents"}},{"kind":"Field","name":{"kind":"Name","value":"budgetPausedReason"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<UpdateComputerMutation, UpdateComputerMutationVariables>;
export const ComputerTasksDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ComputerTasks"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"computerId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"limit"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"computerTasks"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"computerId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"computerId"}}},{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"Variable","name":{"kind":"Name","value":"limit"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"taskType"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"input"}},{"kind":"Field","name":{"kind":"Name","value":"output"}},{"kind":"Field","name":{"kind":"Name","value":"error"}},{"kind":"Field","name":{"kind":"Name","value":"idempotencyKey"}},{"kind":"Field","name":{"kind":"Name","value":"claimedAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<ComputerTasksQuery, ComputerTasksQueryVariables>;
export const ComputerThreadsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ComputerThreads"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"computerId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"limit"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"threads"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"computerId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"computerId"}}},{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"Variable","name":{"kind":"Name","value":"limit"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"lastResponsePreview"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<ComputerThreadsQuery, ComputerThreadsQueryVariables>;
export const ComputerEventsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ComputerEvents"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"computerId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"limit"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"computerEvents"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"computerId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"computerId"}}},{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"Variable","name":{"kind":"Name","value":"limit"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"taskId"}},{"kind":"Field","name":{"kind":"Name","value":"eventType"}},{"kind":"Field","name":{"kind":"Name","value":"level"}},{"kind":"Field","name":{"kind":"Name","value":"payload"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<ComputerEventsQuery, ComputerEventsQueryVariables>;
export const EnqueueComputerTaskDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"EnqueueComputerTask"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"EnqueueComputerTaskInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"enqueueComputerTask"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"taskType"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"input"}},{"kind":"Field","name":{"kind":"Name","value":"output"}},{"kind":"Field","name":{"kind":"Name","value":"error"}},{"kind":"Field","name":{"kind":"Name","value":"idempotencyKey"}},{"kind":"Field","name":{"kind":"Name","value":"claimedAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<EnqueueComputerTaskMutation, EnqueueComputerTaskMutationVariables>;
export const ModelCatalogDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ModelCatalog"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"modelCatalog"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"modelId"}},{"kind":"Field","name":{"kind":"Name","value":"displayName"}},{"kind":"Field","name":{"kind":"Name","value":"provider"}},{"kind":"Field","name":{"kind":"Name","value":"inputCostPerMillion"}},{"kind":"Field","name":{"kind":"Name","value":"outputCostPerMillion"}}]}}]}}]} as unknown as DocumentNode<ModelCatalogQuery, ModelCatalogQueryVariables>;
export const ConnectorsListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ConnectorsList"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"filter"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"ConnectorFilter"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"limit"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"cursor"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"connectors"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"filter"},"value":{"kind":"Variable","name":{"kind":"Name","value":"filter"}}},{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"Variable","name":{"kind":"Name","value":"limit"}}},{"kind":"Argument","name":{"kind":"Name","value":"cursor"},"value":{"kind":"Variable","name":{"kind":"Name","value":"cursor"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"connectionId"}},{"kind":"Field","name":{"kind":"Name","value":"config"}},{"kind":"Field","name":{"kind":"Name","value":"dispatchTargetType"}},{"kind":"Field","name":{"kind":"Name","value":"dispatchTargetId"}},{"kind":"Field","name":{"kind":"Name","value":"lastPollAt"}},{"kind":"Field","name":{"kind":"Name","value":"nextPollAt"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}},{"kind":"Field","name":{"kind":"Name","value":"createdByType"}},{"kind":"Field","name":{"kind":"Name","value":"createdById"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<ConnectorsListQuery, ConnectorsListQueryVariables>;
export const CreateConnectorDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateConnector"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateConnectorInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createConnector"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<CreateConnectorMutation, CreateConnectorMutationVariables>;
export const UpdateConnectorDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateConnector"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateConnectorInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateConnector"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<UpdateConnectorMutation, UpdateConnectorMutationVariables>;
export const PauseConnectorDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"PauseConnector"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"pauseConnector"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<PauseConnectorMutation, PauseConnectorMutationVariables>;
export const ResumeConnectorDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ResumeConnector"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"resumeConnector"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<ResumeConnectorMutation, ResumeConnectorMutationVariables>;
export const ArchiveConnectorDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ArchiveConnector"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"archiveConnector"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<ArchiveConnectorMutation, ArchiveConnectorMutationVariables>;
export const RunConnectorNowDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RunConnectorNow"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"runConnectorNow"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"connectorId"}},{"kind":"Field","name":{"kind":"Name","value":"results"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"connectorId"}},{"kind":"Field","name":{"kind":"Name","value":"executionId"}},{"kind":"Field","name":{"kind":"Name","value":"externalRef"}},{"kind":"Field","name":{"kind":"Name","value":"threadId"}},{"kind":"Field","name":{"kind":"Name","value":"messageId"}},{"kind":"Field","name":{"kind":"Name","value":"computerId"}},{"kind":"Field","name":{"kind":"Name","value":"computerTaskId"}},{"kind":"Field","name":{"kind":"Name","value":"targetType"}},{"kind":"Field","name":{"kind":"Name","value":"reason"}},{"kind":"Field","name":{"kind":"Name","value":"error"}}]}}]}}]}}]} as unknown as DocumentNode<RunConnectorNowMutation, RunConnectorNowMutationVariables>;
export const ConnectorExecutionsListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ConnectorExecutionsList"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"connectorId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"status"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"ConnectorExecutionState"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"limit"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"cursor"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"connectorExecutions"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"connectorId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"connectorId"}}},{"kind":"Argument","name":{"kind":"Name","value":"status"},"value":{"kind":"Variable","name":{"kind":"Name","value":"status"}}},{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"Variable","name":{"kind":"Name","value":"limit"}}},{"kind":"Argument","name":{"kind":"Name","value":"cursor"},"value":{"kind":"Variable","name":{"kind":"Name","value":"cursor"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"connectorId"}},{"kind":"Field","name":{"kind":"Name","value":"externalRef"}},{"kind":"Field","name":{"kind":"Name","value":"currentState"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"finishedAt"}},{"kind":"Field","name":{"kind":"Name","value":"errorClass"}},{"kind":"Field","name":{"kind":"Name","value":"outcomePayload"}},{"kind":"Field","name":{"kind":"Name","value":"retryAttempt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<ConnectorExecutionsListQuery, ConnectorExecutionsListQueryVariables>;
export const ConnectorRunLifecyclesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ConnectorRunLifecycles"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"connectorId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"limit"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"cursor"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"connectorRunLifecycles"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"connectorId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"connectorId"}}},{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"Variable","name":{"kind":"Name","value":"limit"}}},{"kind":"Argument","name":{"kind":"Name","value":"cursor"},"value":{"kind":"Variable","name":{"kind":"Name","value":"cursor"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"execution"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"connectorId"}},{"kind":"Field","name":{"kind":"Name","value":"externalRef"}},{"kind":"Field","name":{"kind":"Name","value":"currentState"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"finishedAt"}},{"kind":"Field","name":{"kind":"Name","value":"errorClass"}},{"kind":"Field","name":{"kind":"Name","value":"outcomePayload"}},{"kind":"Field","name":{"kind":"Name","value":"retryAttempt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"connector"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}},{"kind":"Field","name":{"kind":"Name","value":"computerTask"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"output"}},{"kind":"Field","name":{"kind":"Name","value":"error"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"delegation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"outputArtifacts"}},{"kind":"Field","name":{"kind":"Name","value":"result"}},{"kind":"Field","name":{"kind":"Name","value":"error"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"threadTurn"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"threadId"}},{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"resultJson"}},{"kind":"Field","name":{"kind":"Name","value":"error"}},{"kind":"Field","name":{"kind":"Name","value":"errorCode"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"finishedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"threadId"}},{"kind":"Field","name":{"kind":"Name","value":"messageId"}},{"kind":"Field","name":{"kind":"Name","value":"computerId"}}]}}]}}]} as unknown as DocumentNode<ConnectorRunLifecyclesQuery, ConnectorRunLifecyclesQueryVariables>;
export const AgentEmailCapabilityDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AgentEmailCapability"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"agentEmailCapability"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"agentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}},{"kind":"Field","name":{"kind":"Name","value":"emailAddress"}},{"kind":"Field","name":{"kind":"Name","value":"vanityAddress"}},{"kind":"Field","name":{"kind":"Name","value":"allowedSenders"}}]}}]}}]} as unknown as DocumentNode<AgentEmailCapabilityQuery, AgentEmailCapabilityQueryVariables>;
export const UpdateAgentEmailAllowlistDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateAgentEmailAllowlist"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"allowedSenders"}},"type":{"kind":"NonNullType","type":{"kind":"ListType","type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateAgentEmailAllowlist"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"agentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}}},{"kind":"Argument","name":{"kind":"Name","value":"allowedSenders"},"value":{"kind":"Variable","name":{"kind":"Name","value":"allowedSenders"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"config"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}}]}}]}}]} as unknown as DocumentNode<UpdateAgentEmailAllowlistMutation, UpdateAgentEmailAllowlistMutationVariables>;
export const ToggleAgentEmailChannelDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ToggleAgentEmailChannel"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"enabled"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"toggleAgentEmailChannel"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"agentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}}},{"kind":"Argument","name":{"kind":"Name","value":"enabled"},"value":{"kind":"Variable","name":{"kind":"Name","value":"enabled"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}}]}}]}}]} as unknown as DocumentNode<ToggleAgentEmailChannelMutation, ToggleAgentEmailChannelMutationVariables>;
export const ClaimVanityEmailAddressDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ClaimVanityEmailAddress"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"localPart"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"claimVanityEmailAddress"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"agentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}}},{"kind":"Argument","name":{"kind":"Name","value":"localPart"},"value":{"kind":"Variable","name":{"kind":"Name","value":"localPart"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"config"}}]}}]}}]} as unknown as DocumentNode<ClaimVanityEmailAddressMutation, ClaimVanityEmailAddressMutationVariables>;
export const ReleaseVanityEmailAddressDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ReleaseVanityEmailAddress"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"releaseVanityEmailAddress"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"agentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"config"}}]}}]}}]} as unknown as DocumentNode<ReleaseVanityEmailAddressMutation, ReleaseVanityEmailAddressMutationVariables>;
export const KnowledgeBasesListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"KnowledgeBasesList"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"knowledgeBases"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"documentCount"}},{"kind":"Field","name":{"kind":"Name","value":"lastSyncAt"}},{"kind":"Field","name":{"kind":"Name","value":"lastSyncStatus"}},{"kind":"Field","name":{"kind":"Name","value":"errorMessage"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<KnowledgeBasesListQuery, KnowledgeBasesListQueryVariables>;
export const KnowledgeBaseDetailDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"KnowledgeBaseDetail"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"knowledgeBase"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"embeddingModel"}},{"kind":"Field","name":{"kind":"Name","value":"chunkingStrategy"}},{"kind":"Field","name":{"kind":"Name","value":"chunkSizeTokens"}},{"kind":"Field","name":{"kind":"Name","value":"chunkOverlapPercent"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"awsKbId"}},{"kind":"Field","name":{"kind":"Name","value":"lastSyncAt"}},{"kind":"Field","name":{"kind":"Name","value":"lastSyncStatus"}},{"kind":"Field","name":{"kind":"Name","value":"documentCount"}},{"kind":"Field","name":{"kind":"Name","value":"errorMessage"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<KnowledgeBaseDetailQuery, KnowledgeBaseDetailQueryVariables>;
export const CreateKnowledgeBaseDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateKnowledgeBase"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateKnowledgeBaseInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createKnowledgeBase"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<CreateKnowledgeBaseMutation, CreateKnowledgeBaseMutationVariables>;
export const UpdateKnowledgeBaseDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateKnowledgeBase"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateKnowledgeBaseInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateKnowledgeBase"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<UpdateKnowledgeBaseMutation, UpdateKnowledgeBaseMutationVariables>;
export const DeleteKnowledgeBaseDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteKnowledgeBase"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteKnowledgeBase"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}]}]}}]} as unknown as DocumentNode<DeleteKnowledgeBaseMutation, DeleteKnowledgeBaseMutationVariables>;
export const SyncKnowledgeBaseDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SyncKnowledgeBase"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"syncKnowledgeBase"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"lastSyncStatus"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<SyncKnowledgeBaseMutation, SyncKnowledgeBaseMutationVariables>;
export const SetAgentKnowledgeBasesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SetAgentKnowledgeBases"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"knowledgeBases"}},"type":{"kind":"NonNullType","type":{"kind":"ListType","type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"AgentKnowledgeBaseInput"}}}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"setAgentKnowledgeBases"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"agentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}}},{"kind":"Argument","name":{"kind":"Name","value":"knowledgeBases"},"value":{"kind":"Variable","name":{"kind":"Name","value":"knowledgeBases"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"knowledgeBaseId"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}},{"kind":"Field","name":{"kind":"Name","value":"knowledgeBase"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]}}]}}]} as unknown as DocumentNode<SetAgentKnowledgeBasesMutation, SetAgentKnowledgeBasesMutationVariables>;
export const ThreadsListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ThreadsList"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"status"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"ThreadStatus"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"search"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"threads"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"status"},"value":{"kind":"Variable","name":{"kind":"Name","value":"status"}}},{"kind":"Argument","name":{"kind":"Name","value":"search"},"value":{"kind":"Variable","name":{"kind":"Name","value":"search"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"assigneeType"}},{"kind":"Field","name":{"kind":"Name","value":"assigneeId"}},{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"computerId"}},{"kind":"Field","name":{"kind":"Name","value":"agent"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}}]}},{"kind":"Field","name":{"kind":"Name","value":"checkoutRunId"}},{"kind":"Field","name":{"kind":"Name","value":"channel"}},{"kind":"Field","name":{"kind":"Name","value":"costSummary"}},{"kind":"Field","name":{"kind":"Name","value":"lastActivityAt"}},{"kind":"Field","name":{"kind":"Name","value":"lastTurnCompletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"lastReadAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<ThreadsListQuery, ThreadsListQueryVariables>;
export const ThreadsPagedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ThreadsPaged"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"search"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"showArchived"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"sortField"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"sortDir"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"limit"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"offset"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"threadsPaged"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"search"},"value":{"kind":"Variable","name":{"kind":"Name","value":"search"}}},{"kind":"Argument","name":{"kind":"Name","value":"showArchived"},"value":{"kind":"Variable","name":{"kind":"Name","value":"showArchived"}}},{"kind":"Argument","name":{"kind":"Name","value":"sortField"},"value":{"kind":"Variable","name":{"kind":"Name","value":"sortField"}}},{"kind":"Argument","name":{"kind":"Name","value":"sortDir"},"value":{"kind":"Variable","name":{"kind":"Name","value":"sortDir"}}},{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"Variable","name":{"kind":"Name","value":"limit"}}},{"kind":"Argument","name":{"kind":"Name","value":"offset"},"value":{"kind":"Variable","name":{"kind":"Name","value":"offset"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"assigneeType"}},{"kind":"Field","name":{"kind":"Name","value":"assigneeId"}},{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"agent"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}}]}},{"kind":"Field","name":{"kind":"Name","value":"checkoutRunId"}},{"kind":"Field","name":{"kind":"Name","value":"channel"}},{"kind":"Field","name":{"kind":"Name","value":"costSummary"}},{"kind":"Field","name":{"kind":"Name","value":"lastActivityAt"}},{"kind":"Field","name":{"kind":"Name","value":"lastTurnCompletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"lastReadAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"totalCount"}}]}}]}}]} as unknown as DocumentNode<ThreadsPagedQuery, ThreadsPagedQueryVariables>;
export const ThreadDetailDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ThreadDetail"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"thread"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"lifecycleStatus"}},{"kind":"Field","name":{"kind":"Name","value":"assigneeType"}},{"kind":"Field","name":{"kind":"Name","value":"assigneeId"}},{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"computerId"}},{"kind":"Field","name":{"kind":"Name","value":"agent"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}}]}},{"kind":"Field","name":{"kind":"Name","value":"channel"}},{"kind":"Field","name":{"kind":"Name","value":"messages"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"IntValue","value":"50"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"edges"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"node"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"threadId"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"content"}},{"kind":"Field","name":{"kind":"Name","value":"senderType"}},{"kind":"Field","name":{"kind":"Name","value":"senderId"}},{"kind":"Field","name":{"kind":"Name","value":"toolCalls"}},{"kind":"Field","name":{"kind":"Name","value":"toolResults"}},{"kind":"Field","name":{"kind":"Name","value":"metadata"}},{"kind":"Field","name":{"kind":"Name","value":"tokenCount"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"durableArtifact"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"costSummary"}},{"kind":"Field","name":{"kind":"Name","value":"checkoutRunId"}},{"kind":"Field","name":{"kind":"Name","value":"checkoutVersion"}},{"kind":"Field","name":{"kind":"Name","value":"billingCode"}},{"kind":"Field","name":{"kind":"Name","value":"labels"}},{"kind":"Field","name":{"kind":"Name","value":"metadata"}},{"kind":"Field","name":{"kind":"Name","value":"dueAt"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"cancelledAt"}},{"kind":"Field","name":{"kind":"Name","value":"closedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdByType"}},{"kind":"Field","name":{"kind":"Name","value":"createdById"}},{"kind":"Field","name":{"kind":"Name","value":"attachments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"threadId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"s3Key"}},{"kind":"Field","name":{"kind":"Name","value":"mimeType"}},{"kind":"Field","name":{"kind":"Name","value":"sizeBytes"}},{"kind":"Field","name":{"kind":"Name","value":"uploadedBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<ThreadDetailQuery, ThreadDetailQueryVariables>;
export const UpdateThreadDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateThread"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateThreadInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateThread"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"assigneeType"}},{"kind":"Field","name":{"kind":"Name","value":"assigneeId"}},{"kind":"Field","name":{"kind":"Name","value":"billingCode"}},{"kind":"Field","name":{"kind":"Name","value":"dueAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<UpdateThreadMutation, UpdateThreadMutationVariables>;
export const DeleteThreadDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteThread"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteThread"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}]}]}}]} as unknown as DocumentNode<DeleteThreadMutation, DeleteThreadMutationVariables>;
export const CheckoutThreadDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CheckoutThread"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CheckoutThreadInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"checkoutThread"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"checkoutRunId"}},{"kind":"Field","name":{"kind":"Name","value":"checkoutVersion"}}]}}]}}]} as unknown as DocumentNode<CheckoutThreadMutation, CheckoutThreadMutationVariables>;
export const ReleaseThreadDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ReleaseThread"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ReleaseThreadInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"releaseThread"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"checkoutRunId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]}}]} as unknown as DocumentNode<ReleaseThreadMutation, ReleaseThreadMutationVariables>;
export const TeamsListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"TeamsList"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"teams"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"budgetMonthlyCents"}},{"kind":"Field","name":{"kind":"Name","value":"agents"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"agent"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}}]}},{"kind":"Field","name":{"kind":"Name","value":"role"}}]}},{"kind":"Field","name":{"kind":"Name","value":"users"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"role"}}]}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<TeamsListQuery, TeamsListQueryVariables>;
export const TeamDetailDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"TeamDetail"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"team"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"budgetMonthlyCents"}},{"kind":"Field","name":{"kind":"Name","value":"metadata"}},{"kind":"Field","name":{"kind":"Name","value":"agents"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"agent"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}}]}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"users"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"email"}}]}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<TeamDetailQuery, TeamDetailQueryVariables>;
export const RoutinesListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"RoutinesList"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"routines"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"lastRunAt"}},{"kind":"Field","name":{"kind":"Name","value":"engine"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<RoutinesListQuery, RoutinesListQueryVariables>;
export const RoutineDetailDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"RoutineDetail"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"routine"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"schedule"}},{"kind":"Field","name":{"kind":"Name","value":"engine"}},{"kind":"Field","name":{"kind":"Name","value":"currentVersion"}},{"kind":"Field","name":{"kind":"Name","value":"config"}},{"kind":"Field","name":{"kind":"Name","value":"lastRunAt"}},{"kind":"Field","name":{"kind":"Name","value":"nextRunAt"}},{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"agent"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}}]}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"team"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"triggers"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"triggerType"}},{"kind":"Field","name":{"kind":"Name","value":"config"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}}]}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<RoutineDetailQuery, RoutineDetailQueryVariables>;
export const CreateRoutineDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateRoutine"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateRoutineInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createRoutine"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"currentVersion"}}]}}]}}]} as unknown as DocumentNode<CreateRoutineMutation, CreateRoutineMutationVariables>;
export const PlanRoutineDraftDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"PlanRoutineDraft"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"PlanRoutineDraftInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"planRoutineDraft"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"asl"}},{"kind":"Field","name":{"kind":"Name","value":"markdownSummary"}},{"kind":"Field","name":{"kind":"Name","value":"stepManifest"}},{"kind":"Field","name":{"kind":"Name","value":"steps"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"nodeId"}},{"kind":"Field","name":{"kind":"Name","value":"recipeId"}},{"kind":"Field","name":{"kind":"Name","value":"recipeName"}},{"kind":"Field","name":{"kind":"Name","value":"label"}},{"kind":"Field","name":{"kind":"Name","value":"args"}},{"kind":"Field","name":{"kind":"Name","value":"configFields"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"label"}},{"kind":"Field","name":{"kind":"Name","value":"value"}},{"kind":"Field","name":{"kind":"Name","value":"inputType"}},{"kind":"Field","name":{"kind":"Name","value":"control"}},{"kind":"Field","name":{"kind":"Name","value":"required"}},{"kind":"Field","name":{"kind":"Name","value":"editable"}},{"kind":"Field","name":{"kind":"Name","value":"options"}},{"kind":"Field","name":{"kind":"Name","value":"placeholder"}},{"kind":"Field","name":{"kind":"Name","value":"helpText"}},{"kind":"Field","name":{"kind":"Name","value":"min"}},{"kind":"Field","name":{"kind":"Name","value":"max"}},{"kind":"Field","name":{"kind":"Name","value":"pattern"}}]}}]}}]}}]}}]} as unknown as DocumentNode<PlanRoutineDraftMutation, PlanRoutineDraftMutationVariables>;
export const RoutineRecipeCatalogDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"RoutineRecipeCatalog"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"routineRecipeCatalog"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"displayName"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"category"}},{"kind":"Field","name":{"kind":"Name","value":"hitlCapable"}},{"kind":"Field","name":{"kind":"Name","value":"defaultArgs"}},{"kind":"Field","name":{"kind":"Name","value":"configFields"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"label"}},{"kind":"Field","name":{"kind":"Name","value":"value"}},{"kind":"Field","name":{"kind":"Name","value":"inputType"}},{"kind":"Field","name":{"kind":"Name","value":"control"}},{"kind":"Field","name":{"kind":"Name","value":"required"}},{"kind":"Field","name":{"kind":"Name","value":"editable"}},{"kind":"Field","name":{"kind":"Name","value":"options"}},{"kind":"Field","name":{"kind":"Name","value":"placeholder"}},{"kind":"Field","name":{"kind":"Name","value":"helpText"}},{"kind":"Field","name":{"kind":"Name","value":"min"}},{"kind":"Field","name":{"kind":"Name","value":"max"}},{"kind":"Field","name":{"kind":"Name","value":"pattern"}}]}}]}}]}}]} as unknown as DocumentNode<RoutineRecipeCatalogQuery, RoutineRecipeCatalogQueryVariables>;
export const TenantCredentialsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"TenantCredentials"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"status"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"TenantCredentialStatus"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"tenantCredentials"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"status"},"value":{"kind":"Variable","name":{"kind":"Name","value":"status"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"displayName"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"metadataJson"}},{"kind":"Field","name":{"kind":"Name","value":"schemaJson"}},{"kind":"Field","name":{"kind":"Name","value":"eventbridgeConnectionArn"}},{"kind":"Field","name":{"kind":"Name","value":"lastUsedAt"}},{"kind":"Field","name":{"kind":"Name","value":"lastValidatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}}]}}]}}]} as unknown as DocumentNode<TenantCredentialsQuery, TenantCredentialsQueryVariables>;
export const CredentialRoutineUsageDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"CredentialRoutineUsage"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"routines"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"config"}},{"kind":"Field","name":{"kind":"Name","value":"engine"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<CredentialRoutineUsageQuery, CredentialRoutineUsageQueryVariables>;
export const CreateTenantCredentialDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateTenantCredential"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateTenantCredentialInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createTenantCredential"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"displayName"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"metadataJson"}},{"kind":"Field","name":{"kind":"Name","value":"eventbridgeConnectionArn"}},{"kind":"Field","name":{"kind":"Name","value":"lastValidatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<CreateTenantCredentialMutation, CreateTenantCredentialMutationVariables>;
export const UpdateTenantCredentialDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateTenantCredential"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateTenantCredentialInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateTenantCredential"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"displayName"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"metadataJson"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<UpdateTenantCredentialMutation, UpdateTenantCredentialMutationVariables>;
export const RotateTenantCredentialDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RotateTenantCredential"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"RotateTenantCredentialInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"rotateTenantCredential"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"lastValidatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<RotateTenantCredentialMutation, RotateTenantCredentialMutationVariables>;
export const DeleteTenantCredentialDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteTenantCredential"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteTenantCredential"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}]}]}}]} as unknown as DocumentNode<DeleteTenantCredentialMutation, DeleteTenantCredentialMutationVariables>;
export const TriggerRoutineRunDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"TriggerRoutineRun"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"routineId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"AWSJSON"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"triggerRoutineRun"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"routineId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"routineId"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"triggerSource"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}}]}}]}}]} as unknown as DocumentNode<TriggerRoutineRunMutation, TriggerRoutineRunMutationVariables>;
export const RebuildRoutineVersionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RebuildRoutineVersion"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"RebuildRoutineVersionInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"rebuildRoutineVersion"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"versionNumber"}}]}}]}}]} as unknown as DocumentNode<RebuildRoutineVersionMutation, RebuildRoutineVersionMutationVariables>;
export const RoutineDefinitionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"RoutineDefinition"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"routineId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"routineDefinition"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"routineId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"routineId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"routineId"}},{"kind":"Field","name":{"kind":"Name","value":"currentVersion"}},{"kind":"Field","name":{"kind":"Name","value":"versionId"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"steps"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"nodeId"}},{"kind":"Field","name":{"kind":"Name","value":"recipeId"}},{"kind":"Field","name":{"kind":"Name","value":"recipeName"}},{"kind":"Field","name":{"kind":"Name","value":"label"}},{"kind":"Field","name":{"kind":"Name","value":"args"}},{"kind":"Field","name":{"kind":"Name","value":"configFields"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"label"}},{"kind":"Field","name":{"kind":"Name","value":"value"}},{"kind":"Field","name":{"kind":"Name","value":"inputType"}},{"kind":"Field","name":{"kind":"Name","value":"control"}},{"kind":"Field","name":{"kind":"Name","value":"required"}},{"kind":"Field","name":{"kind":"Name","value":"editable"}},{"kind":"Field","name":{"kind":"Name","value":"options"}},{"kind":"Field","name":{"kind":"Name","value":"placeholder"}},{"kind":"Field","name":{"kind":"Name","value":"helpText"}},{"kind":"Field","name":{"kind":"Name","value":"min"}},{"kind":"Field","name":{"kind":"Name","value":"max"}},{"kind":"Field","name":{"kind":"Name","value":"pattern"}}]}}]}}]}}]}}]} as unknown as DocumentNode<RoutineDefinitionQuery, RoutineDefinitionQueryVariables>;
export const RoutineDefinitionArtifactsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"RoutineDefinitionArtifacts"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"routineId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"routineDefinition"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"routineId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"routineId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"routineId"}},{"kind":"Field","name":{"kind":"Name","value":"versionId"}},{"kind":"Field","name":{"kind":"Name","value":"aslJson"}},{"kind":"Field","name":{"kind":"Name","value":"markdownSummary"}},{"kind":"Field","name":{"kind":"Name","value":"stepManifestJson"}}]}}]}}]} as unknown as DocumentNode<RoutineDefinitionArtifactsQuery, RoutineDefinitionArtifactsQueryVariables>;
export const UpdateRoutineDefinitionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateRoutineDefinition"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateRoutineDefinitionInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateRoutineDefinition"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"routineId"}},{"kind":"Field","name":{"kind":"Name","value":"currentVersion"}},{"kind":"Field","name":{"kind":"Name","value":"versionId"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"steps"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"nodeId"}},{"kind":"Field","name":{"kind":"Name","value":"args"}},{"kind":"Field","name":{"kind":"Name","value":"configFields"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"value"}},{"kind":"Field","name":{"kind":"Name","value":"editable"}}]}}]}}]}}]}}]} as unknown as DocumentNode<UpdateRoutineDefinitionMutation, UpdateRoutineDefinitionMutationVariables>;
export const RoutineExecutionsListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"RoutineExecutionsList"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"routineId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"status"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"RoutineExecutionStatus"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"limit"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"cursor"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"routineExecutions"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"routineId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"routineId"}}},{"kind":"Argument","name":{"kind":"Name","value":"status"},"value":{"kind":"Variable","name":{"kind":"Name","value":"status"}}},{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"Variable","name":{"kind":"Name","value":"limit"}}},{"kind":"Argument","name":{"kind":"Name","value":"cursor"},"value":{"kind":"Variable","name":{"kind":"Name","value":"cursor"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"triggerSource"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"finishedAt"}},{"kind":"Field","name":{"kind":"Name","value":"totalLlmCostUsdCents"}},{"kind":"Field","name":{"kind":"Name","value":"errorCode"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<RoutineExecutionsListQuery, RoutineExecutionsListQueryVariables>;
export const RoutineExecutionDetailDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"RoutineExecutionDetail"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"routineExecution"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"routineId"}},{"kind":"Field","name":{"kind":"Name","value":"stateMachineArn"}},{"kind":"Field","name":{"kind":"Name","value":"aliasArn"}},{"kind":"Field","name":{"kind":"Name","value":"versionArn"}},{"kind":"Field","name":{"kind":"Name","value":"sfnExecutionArn"}},{"kind":"Field","name":{"kind":"Name","value":"triggerSource"}},{"kind":"Field","name":{"kind":"Name","value":"inputJson"}},{"kind":"Field","name":{"kind":"Name","value":"outputJson"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"finishedAt"}},{"kind":"Field","name":{"kind":"Name","value":"errorCode"}},{"kind":"Field","name":{"kind":"Name","value":"errorMessage"}},{"kind":"Field","name":{"kind":"Name","value":"totalLlmCostUsdCents"}},{"kind":"Field","name":{"kind":"Name","value":"stepEvents"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"nodeId"}},{"kind":"Field","name":{"kind":"Name","value":"recipeType"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"finishedAt"}},{"kind":"Field","name":{"kind":"Name","value":"inputJson"}},{"kind":"Field","name":{"kind":"Name","value":"outputJson"}},{"kind":"Field","name":{"kind":"Name","value":"errorJson"}},{"kind":"Field","name":{"kind":"Name","value":"llmCostUsdCents"}},{"kind":"Field","name":{"kind":"Name","value":"retryCount"}},{"kind":"Field","name":{"kind":"Name","value":"stdoutS3Uri"}},{"kind":"Field","name":{"kind":"Name","value":"stderrS3Uri"}},{"kind":"Field","name":{"kind":"Name","value":"stdoutPreview"}},{"kind":"Field","name":{"kind":"Name","value":"truncated"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"routine"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"currentVersion"}},{"kind":"Field","name":{"kind":"Name","value":"documentationMd"}}]}},{"kind":"Field","name":{"kind":"Name","value":"aslVersion"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"versionNumber"}},{"kind":"Field","name":{"kind":"Name","value":"aslJson"}},{"kind":"Field","name":{"kind":"Name","value":"markdownSummary"}},{"kind":"Field","name":{"kind":"Name","value":"stepManifestJson"}}]}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<RoutineExecutionDetailQuery, RoutineExecutionDetailQueryVariables>;
export const RoutineAslVersionDetailDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"RoutineAslVersionDetail"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"routineAslVersion"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"versionNumber"}},{"kind":"Field","name":{"kind":"Name","value":"aslJson"}},{"kind":"Field","name":{"kind":"Name","value":"markdownSummary"}},{"kind":"Field","name":{"kind":"Name","value":"stepManifestJson"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<RoutineAslVersionDetailQuery, RoutineAslVersionDetailQueryVariables>;
export const InboxItemsListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"InboxItemsList"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"status"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"InboxItemStatus"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"inboxItems"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"status"},"value":{"kind":"Variable","name":{"kind":"Name","value":"status"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"requesterType"}},{"kind":"Field","name":{"kind":"Name","value":"requesterId"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}},{"kind":"Field","name":{"kind":"Name","value":"entityId"}},{"kind":"Field","name":{"kind":"Name","value":"revision"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<InboxItemsListQuery, InboxItemsListQueryVariables>;
export const InboxItemDetailDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"InboxItemDetail"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"inboxItem"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"requesterType"}},{"kind":"Field","name":{"kind":"Name","value":"requesterId"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}},{"kind":"Field","name":{"kind":"Name","value":"entityId"}},{"kind":"Field","name":{"kind":"Name","value":"config"}},{"kind":"Field","name":{"kind":"Name","value":"revision"}},{"kind":"Field","name":{"kind":"Name","value":"reviewNotes"}},{"kind":"Field","name":{"kind":"Name","value":"decidedBy"}},{"kind":"Field","name":{"kind":"Name","value":"decidedAt"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"comments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"authorType"}},{"kind":"Field","name":{"kind":"Name","value":"authorId"}},{"kind":"Field","name":{"kind":"Name","value":"content"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"links"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"linkedType"}},{"kind":"Field","name":{"kind":"Name","value":"linkedId"}}]}},{"kind":"Field","name":{"kind":"Name","value":"linkedThreads"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<InboxItemDetailQuery, InboxItemDetailQueryVariables>;
export const ApproveInboxItemDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ApproveInboxItem"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"ApproveInboxItemInput"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"approveInboxItem"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"reviewNotes"}},{"kind":"Field","name":{"kind":"Name","value":"decidedAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<ApproveInboxItemMutation, ApproveInboxItemMutationVariables>;
export const RejectInboxItemDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RejectInboxItem"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"RejectInboxItemInput"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"rejectInboxItem"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"reviewNotes"}},{"kind":"Field","name":{"kind":"Name","value":"decidedAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<RejectInboxItemMutation, RejectInboxItemMutationVariables>;
export const RequestRevisionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RequestRevision"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"RequestRevisionInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"requestRevision"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"reviewNotes"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<RequestRevisionMutation, RequestRevisionMutationVariables>;
export const ResubmitInboxItemDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ResubmitInboxItem"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"ResubmitInboxItemInput"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"resubmitInboxItem"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"revision"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<ResubmitInboxItemMutation, ResubmitInboxItemMutationVariables>;
export const AddInboxItemCommentDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AddInboxItemComment"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"AddInboxItemCommentInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"addInboxItemComment"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"authorType"}},{"kind":"Field","name":{"kind":"Name","value":"authorId"}},{"kind":"Field","name":{"kind":"Name","value":"content"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<AddInboxItemCommentMutation, AddInboxItemCommentMutationVariables>;
export const ActivityLogDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ActivityLog"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"entityType"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"entityId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"limit"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"activityLog"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"entityType"},"value":{"kind":"Variable","name":{"kind":"Name","value":"entityType"}}},{"kind":"Argument","name":{"kind":"Name","value":"entityId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"entityId"}}},{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"Variable","name":{"kind":"Name","value":"limit"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"actorType"}},{"kind":"Field","name":{"kind":"Name","value":"actorId"}},{"kind":"Field","name":{"kind":"Name","value":"action"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}},{"kind":"Field","name":{"kind":"Name","value":"entityId"}},{"kind":"Field","name":{"kind":"Name","value":"changes"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<ActivityLogQuery, ActivityLogQueryVariables>;
export const TenantDetailDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"TenantDetail"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"tenant"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"plan"}},{"kind":"Field","name":{"kind":"Name","value":"issuePrefix"}},{"kind":"Field","name":{"kind":"Name","value":"issueCounter"}},{"kind":"Field","name":{"kind":"Name","value":"settings"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"defaultModel"}},{"kind":"Field","name":{"kind":"Name","value":"budgetMonthlyCents"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseThreadMinutes"}},{"kind":"Field","name":{"kind":"Name","value":"maxAgents"}},{"kind":"Field","name":{"kind":"Name","value":"features"}}]}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<TenantDetailQuery, TenantDetailQueryVariables>;
export const DeploymentStatusDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"DeploymentStatus"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deploymentStatus"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"stage"}},{"kind":"Field","name":{"kind":"Name","value":"source"}},{"kind":"Field","name":{"kind":"Name","value":"region"}},{"kind":"Field","name":{"kind":"Name","value":"accountId"}},{"kind":"Field","name":{"kind":"Name","value":"bucketName"}},{"kind":"Field","name":{"kind":"Name","value":"databaseEndpoint"}},{"kind":"Field","name":{"kind":"Name","value":"ecrUrl"}},{"kind":"Field","name":{"kind":"Name","value":"adminUrl"}},{"kind":"Field","name":{"kind":"Name","value":"docsUrl"}},{"kind":"Field","name":{"kind":"Name","value":"apiEndpoint"}},{"kind":"Field","name":{"kind":"Name","value":"appsyncUrl"}},{"kind":"Field","name":{"kind":"Name","value":"appsyncRealtimeUrl"}},{"kind":"Field","name":{"kind":"Name","value":"hindsightEndpoint"}},{"kind":"Field","name":{"kind":"Name","value":"agentcoreStatus"}},{"kind":"Field","name":{"kind":"Name","value":"hindsightEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"managedMemoryEnabled"}}]}}]}}]} as unknown as DocumentNode<DeploymentStatusQuery, DeploymentStatusQueryVariables>;
export const TenantMembersListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"TenantMembersList"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"tenantMembers"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"principalType"}},{"kind":"Field","name":{"kind":"Name","value":"principalId"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"image"}}]}},{"kind":"Field","name":{"kind":"Name","value":"agent"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}}]}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<TenantMembersListQuery, TenantMembersListQueryVariables>;
export const InviteMemberDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"InviteMember"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"InviteMemberInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"inviteMember"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"principalType"}},{"kind":"Field","name":{"kind":"Name","value":"principalId"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"email"}}]}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<InviteMemberMutation, InviteMemberMutationVariables>;
export const UpdateUserDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateUser"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateUserInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateUser"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"image"}},{"kind":"Field","name":{"kind":"Name","value":"phone"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<UpdateUserMutation, UpdateUserMutationVariables>;
export const UpdateTenantMemberDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateTenantMember"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateTenantMemberInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateTenantMember"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"principalType"}},{"kind":"Field","name":{"kind":"Name","value":"principalId"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<UpdateTenantMemberMutation, UpdateTenantMemberMutationVariables>;
export const RemoveTenantMemberDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RemoveTenantMember"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"removeTenantMember"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}]}]}}]} as unknown as DocumentNode<RemoveTenantMemberMutation, RemoveTenantMemberMutationVariables>;
export const AgentApiKeysDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AgentApiKeys"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"agentApiKeys"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"agentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"keyPrefix"}},{"kind":"Field","name":{"kind":"Name","value":"lastUsedAt"}},{"kind":"Field","name":{"kind":"Name","value":"revokedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<AgentApiKeysQuery, AgentApiKeysQueryVariables>;
export const CreateAgentApiKeyDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateAgentApiKey"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateAgentApiKeyInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createAgentApiKey"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"apiKey"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"keyPrefix"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"plainTextKey"}}]}}]}}]} as unknown as DocumentNode<CreateAgentApiKeyMutation, CreateAgentApiKeyMutationVariables>;
export const RevokeAgentApiKeyDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RevokeAgentApiKey"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"revokeAgentApiKey"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"revokedAt"}}]}}]}}]} as unknown as DocumentNode<RevokeAgentApiKeyMutation, RevokeAgentApiKeyMutationVariables>;
export const CostSummaryDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"CostSummary"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"from"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"AWSDateTime"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"to"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"AWSDateTime"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"costSummary"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"from"},"value":{"kind":"Variable","name":{"kind":"Name","value":"from"}}},{"kind":"Argument","name":{"kind":"Name","value":"to"},"value":{"kind":"Variable","name":{"kind":"Name","value":"to"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"totalUsd"}},{"kind":"Field","name":{"kind":"Name","value":"llmUsd"}},{"kind":"Field","name":{"kind":"Name","value":"computeUsd"}},{"kind":"Field","name":{"kind":"Name","value":"toolsUsd"}},{"kind":"Field","name":{"kind":"Name","value":"evalUsd"}},{"kind":"Field","name":{"kind":"Name","value":"totalInputTokens"}},{"kind":"Field","name":{"kind":"Name","value":"totalOutputTokens"}},{"kind":"Field","name":{"kind":"Name","value":"eventCount"}},{"kind":"Field","name":{"kind":"Name","value":"periodStart"}},{"kind":"Field","name":{"kind":"Name","value":"periodEnd"}}]}}]}}]} as unknown as DocumentNode<CostSummaryQuery, CostSummaryQueryVariables>;
export const CostByAgentDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"CostByAgent"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"from"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"AWSDateTime"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"to"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"AWSDateTime"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"costByAgent"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"from"},"value":{"kind":"Variable","name":{"kind":"Name","value":"from"}}},{"kind":"Argument","name":{"kind":"Name","value":"to"},"value":{"kind":"Variable","name":{"kind":"Name","value":"to"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"agentName"}},{"kind":"Field","name":{"kind":"Name","value":"totalUsd"}},{"kind":"Field","name":{"kind":"Name","value":"eventCount"}}]}}]}}]} as unknown as DocumentNode<CostByAgentQuery, CostByAgentQueryVariables>;
export const CostByModelDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"CostByModel"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"from"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"AWSDateTime"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"to"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"AWSDateTime"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"costByModel"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"from"},"value":{"kind":"Variable","name":{"kind":"Name","value":"from"}}},{"kind":"Argument","name":{"kind":"Name","value":"to"},"value":{"kind":"Variable","name":{"kind":"Name","value":"to"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"model"}},{"kind":"Field","name":{"kind":"Name","value":"totalUsd"}},{"kind":"Field","name":{"kind":"Name","value":"inputTokens"}},{"kind":"Field","name":{"kind":"Name","value":"outputTokens"}}]}}]}}]} as unknown as DocumentNode<CostByModelQuery, CostByModelQueryVariables>;
export const CostTimeSeriesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"CostTimeSeries"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"days"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"costTimeSeries"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"days"},"value":{"kind":"Variable","name":{"kind":"Name","value":"days"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"day"}},{"kind":"Field","name":{"kind":"Name","value":"totalUsd"}},{"kind":"Field","name":{"kind":"Name","value":"llmUsd"}},{"kind":"Field","name":{"kind":"Name","value":"computeUsd"}},{"kind":"Field","name":{"kind":"Name","value":"toolsUsd"}},{"kind":"Field","name":{"kind":"Name","value":"eventCount"}}]}}]}}]} as unknown as DocumentNode<CostTimeSeriesQuery, CostTimeSeriesQueryVariables>;
export const BudgetStatusDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"BudgetStatus"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"budgetStatus"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"policy"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"scope"}},{"kind":"Field","name":{"kind":"Name","value":"period"}},{"kind":"Field","name":{"kind":"Name","value":"limitUsd"}},{"kind":"Field","name":{"kind":"Name","value":"actionOnExceed"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}}]}},{"kind":"Field","name":{"kind":"Name","value":"spentUsd"}},{"kind":"Field","name":{"kind":"Name","value":"remainingUsd"}},{"kind":"Field","name":{"kind":"Name","value":"percentUsed"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]}}]} as unknown as DocumentNode<BudgetStatusQuery, BudgetStatusQueryVariables>;
export const UpsertBudgetPolicyDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpsertBudgetPolicy"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpsertBudgetPolicyInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"upsertBudgetPolicy"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"scope"}},{"kind":"Field","name":{"kind":"Name","value":"limitUsd"}},{"kind":"Field","name":{"kind":"Name","value":"actionOnExceed"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}}]}}]}}]} as unknown as DocumentNode<UpsertBudgetPolicyMutation, UpsertBudgetPolicyMutationVariables>;
export const DeleteBudgetPolicyDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteBudgetPolicy"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteBudgetPolicy"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}]}]}}]} as unknown as DocumentNode<DeleteBudgetPolicyMutation, DeleteBudgetPolicyMutationVariables>;
export const UnpauseAgentDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UnpauseAgent"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"unpauseAgent"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"agentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]}}]} as unknown as DocumentNode<UnpauseAgentMutation, UnpauseAgentMutationVariables>;
export const NotifyAgentStatusDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"NotifyAgentStatus"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"status"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"name"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"notifyAgentStatus"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"agentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}}},{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"status"},"value":{"kind":"Variable","name":{"kind":"Name","value":"status"}}},{"kind":"Argument","name":{"kind":"Name","value":"name"},"value":{"kind":"Variable","name":{"kind":"Name","value":"name"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<NotifyAgentStatusMutation, NotifyAgentStatusMutationVariables>;
export const OnAgentStatusChangedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"OnAgentStatusChanged"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"onAgentStatusChanged"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<OnAgentStatusChangedSubscription, OnAgentStatusChangedSubscriptionVariables>;
export const OnThreadUpdatedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"OnThreadUpdated"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"onThreadUpdated"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"threadId"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<OnThreadUpdatedSubscription, OnThreadUpdatedSubscriptionVariables>;
export const OnInboxItemStatusChangedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"OnInboxItemStatusChanged"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"onInboxItemStatusChanged"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"inboxItemId"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<OnInboxItemStatusChangedSubscription, OnInboxItemStatusChangedSubscriptionVariables>;
export const ThreadTurnsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ThreadTurns"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"limit"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"threadTurns"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"Variable","name":{"kind":"Name","value":"limit"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"triggerId"}},{"kind":"Field","name":{"kind":"Name","value":"threadId"}},{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"invocationSource"}},{"kind":"Field","name":{"kind":"Name","value":"triggerDetail"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"finishedAt"}},{"kind":"Field","name":{"kind":"Name","value":"error"}},{"kind":"Field","name":{"kind":"Name","value":"resultJson"}},{"kind":"Field","name":{"kind":"Name","value":"usageJson"}},{"kind":"Field","name":{"kind":"Name","value":"triggerName"}},{"kind":"Field","name":{"kind":"Name","value":"totalCost"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<ThreadTurnsQuery, ThreadTurnsQueryVariables>;
export const ThreadTurnsForThreadDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ThreadTurnsForThread"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"threadId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"limit"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"threadTurns"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"threadId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"threadId"}}},{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"Variable","name":{"kind":"Name","value":"limit"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"invocationSource"}},{"kind":"Field","name":{"kind":"Name","value":"triggerDetail"}},{"kind":"Field","name":{"kind":"Name","value":"triggerName"}},{"kind":"Field","name":{"kind":"Name","value":"threadId"}},{"kind":"Field","name":{"kind":"Name","value":"turnNumber"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"finishedAt"}},{"kind":"Field","name":{"kind":"Name","value":"error"}},{"kind":"Field","name":{"kind":"Name","value":"resultJson"}},{"kind":"Field","name":{"kind":"Name","value":"usageJson"}},{"kind":"Field","name":{"kind":"Name","value":"totalCost"}},{"kind":"Field","name":{"kind":"Name","value":"retryAttempt"}},{"kind":"Field","name":{"kind":"Name","value":"originTurnId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<ThreadTurnsForThreadQuery, ThreadTurnsForThreadQueryVariables>;
export const ThreadTurnEventsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ThreadTurnEvents"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"runId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"limit"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"threadTurnEvents"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"runId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"runId"}}},{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"Variable","name":{"kind":"Name","value":"limit"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"runId"}},{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"seq"}},{"kind":"Field","name":{"kind":"Name","value":"eventType"}},{"kind":"Field","name":{"kind":"Name","value":"stream"}},{"kind":"Field","name":{"kind":"Name","value":"level"}},{"kind":"Field","name":{"kind":"Name","value":"message"}},{"kind":"Field","name":{"kind":"Name","value":"payload"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<ThreadTurnEventsQuery, ThreadTurnEventsQueryVariables>;
export const OnThreadTurnUpdatedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"OnThreadTurnUpdated"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"onThreadTurnUpdated"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"runId"}},{"kind":"Field","name":{"kind":"Name","value":"triggerId"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"threadId"}},{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"triggerName"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<OnThreadTurnUpdatedSubscription, OnThreadTurnUpdatedSubscriptionVariables>;
export const ActiveTurnsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ActiveTurns"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"running"},"name":{"kind":"Name","value":"threadTurns"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"status"},"value":{"kind":"StringValue","value":"running","block":false}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"threadId"}},{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}}]}},{"kind":"Field","alias":{"kind":"Name","value":"queued"},"name":{"kind":"Name","value":"threadTurns"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"status"},"value":{"kind":"StringValue","value":"queued","block":false}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"threadId"}},{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"queuedWakeups"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"source"}},{"kind":"Field","name":{"kind":"Name","value":"triggerDetail"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]}}]} as unknown as DocumentNode<ActiveTurnsQuery, ActiveTurnsQueryVariables>;
export const OnNewMessageDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"OnNewMessage"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"threadId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"onNewMessage"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"threadId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"threadId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"messageId"}},{"kind":"Field","name":{"kind":"Name","value":"threadId"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"content"}},{"kind":"Field","name":{"kind":"Name","value":"senderType"}},{"kind":"Field","name":{"kind":"Name","value":"senderId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<OnNewMessageSubscription, OnNewMessageSubscriptionVariables>;
export const ArtifactsListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ArtifactsList"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"threadId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"type"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"ArtifactType"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"status"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"ArtifactStatus"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"limit"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"artifacts"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"threadId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"threadId"}}},{"kind":"Argument","name":{"kind":"Name","value":"agentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}}},{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"Variable","name":{"kind":"Name","value":"type"}}},{"kind":"Argument","name":{"kind":"Name","value":"status"},"value":{"kind":"Variable","name":{"kind":"Name","value":"status"}}},{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"Variable","name":{"kind":"Name","value":"limit"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"threadId"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"summary"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<ArtifactsListQuery, ArtifactsListQueryVariables>;
export const ArtifactDetailDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ArtifactDetail"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"artifact"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"content"}},{"kind":"Field","name":{"kind":"Name","value":"summary"}},{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"threadId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<ArtifactDetailQuery, ArtifactDetailQueryVariables>;
export const MemoryRecordsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MemoryRecords"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"userId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"namespace"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"memoryRecords"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"userId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"userId"}}},{"kind":"Argument","name":{"kind":"Name","value":"namespace"},"value":{"kind":"Variable","name":{"kind":"Name","value":"namespace"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"memoryRecordId"}},{"kind":"Field","name":{"kind":"Name","value":"content"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"text"}}]}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"namespace"}},{"kind":"Field","name":{"kind":"Name","value":"strategyId"}},{"kind":"Field","name":{"kind":"Name","value":"strategy"}},{"kind":"Field","name":{"kind":"Name","value":"userSlug"}},{"kind":"Field","name":{"kind":"Name","value":"agentSlug"}},{"kind":"Field","name":{"kind":"Name","value":"factType"}},{"kind":"Field","name":{"kind":"Name","value":"confidence"}},{"kind":"Field","name":{"kind":"Name","value":"eventDate"}},{"kind":"Field","name":{"kind":"Name","value":"occurredStart"}},{"kind":"Field","name":{"kind":"Name","value":"occurredEnd"}},{"kind":"Field","name":{"kind":"Name","value":"mentionedAt"}},{"kind":"Field","name":{"kind":"Name","value":"tags"}},{"kind":"Field","name":{"kind":"Name","value":"accessCount"}},{"kind":"Field","name":{"kind":"Name","value":"proofCount"}},{"kind":"Field","name":{"kind":"Name","value":"context"}},{"kind":"Field","name":{"kind":"Name","value":"threadId"}}]}}]}}]} as unknown as DocumentNode<MemoryRecordsQuery, MemoryRecordsQueryVariables>;
export const DeleteMemoryRecordDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteMemoryRecord"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"userId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"memoryRecordId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteMemoryRecord"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"userId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"userId"}}},{"kind":"Argument","name":{"kind":"Name","value":"memoryRecordId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"memoryRecordId"}}}]}]}}]} as unknown as DocumentNode<DeleteMemoryRecordMutation, DeleteMemoryRecordMutationVariables>;
export const UpdateMemoryRecordDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateMemoryRecord"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"userId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"memoryRecordId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"content"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateMemoryRecord"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"userId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"userId"}}},{"kind":"Argument","name":{"kind":"Name","value":"memoryRecordId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"memoryRecordId"}}},{"kind":"Argument","name":{"kind":"Name","value":"content"},"value":{"kind":"Variable","name":{"kind":"Name","value":"content"}}}]}]}}]} as unknown as DocumentNode<UpdateMemoryRecordMutation, UpdateMemoryRecordMutationVariables>;
export const MemorySearchDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MemorySearch"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"userId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"query"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"strategy"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"MemoryStrategy"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"limit"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"memorySearch"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"userId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"userId"}}},{"kind":"Argument","name":{"kind":"Name","value":"query"},"value":{"kind":"Variable","name":{"kind":"Name","value":"query"}}},{"kind":"Argument","name":{"kind":"Name","value":"strategy"},"value":{"kind":"Variable","name":{"kind":"Name","value":"strategy"}}},{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"Variable","name":{"kind":"Name","value":"limit"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"records"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"memoryRecordId"}},{"kind":"Field","name":{"kind":"Name","value":"content"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"text"}}]}},{"kind":"Field","name":{"kind":"Name","value":"score"}},{"kind":"Field","name":{"kind":"Name","value":"namespace"}},{"kind":"Field","name":{"kind":"Name","value":"strategy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"threadId"}}]}},{"kind":"Field","name":{"kind":"Name","value":"totalCount"}}]}}]}}]} as unknown as DocumentNode<MemorySearchQuery, MemorySearchQueryVariables>;
export const MemorySystemConfigDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MemorySystemConfig"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"memorySystemConfig"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"managedMemoryEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"hindsightEnabled"}}]}}]}}]} as unknown as DocumentNode<MemorySystemConfigQuery, MemorySystemConfigQueryVariables>;
export const AgentTemplatesListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AgentTemplatesList"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"agentTemplates"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"category"}},{"kind":"Field","name":{"kind":"Name","value":"icon"}},{"kind":"Field","name":{"kind":"Name","value":"templateKind"}},{"kind":"Field","name":{"kind":"Name","value":"source"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"model"}},{"kind":"Field","name":{"kind":"Name","value":"guardrailId"}},{"kind":"Field","name":{"kind":"Name","value":"blockedTools"}},{"kind":"Field","name":{"kind":"Name","value":"config"}},{"kind":"Field","name":{"kind":"Name","value":"skills"}},{"kind":"Field","name":{"kind":"Name","value":"knowledgeBaseIds"}},{"kind":"Field","name":{"kind":"Name","value":"isPublished"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<AgentTemplatesListQuery, AgentTemplatesListQueryVariables>;
export const AgentTemplateDetailDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AgentTemplateDetail"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"agentTemplate"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"category"}},{"kind":"Field","name":{"kind":"Name","value":"icon"}},{"kind":"Field","name":{"kind":"Name","value":"templateKind"}},{"kind":"Field","name":{"kind":"Name","value":"source"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"model"}},{"kind":"Field","name":{"kind":"Name","value":"guardrailId"}},{"kind":"Field","name":{"kind":"Name","value":"blockedTools"}},{"kind":"Field","name":{"kind":"Name","value":"config"}},{"kind":"Field","name":{"kind":"Name","value":"skills"}},{"kind":"Field","name":{"kind":"Name","value":"sandbox"}},{"kind":"Field","name":{"kind":"Name","value":"browser"}},{"kind":"Field","name":{"kind":"Name","value":"webSearch"}},{"kind":"Field","name":{"kind":"Name","value":"sendEmail"}},{"kind":"Field","name":{"kind":"Name","value":"contextEngine"}},{"kind":"Field","name":{"kind":"Name","value":"knowledgeBaseIds"}},{"kind":"Field","name":{"kind":"Name","value":"isPublished"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<AgentTemplateDetailQuery, AgentTemplateDetailQueryVariables>;
export const CreateAgentTemplateDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateAgentTemplate"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateAgentTemplateInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createAgentTemplate"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"templateKind"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}}]}}]}}]} as unknown as DocumentNode<CreateAgentTemplateMutation, CreateAgentTemplateMutationVariables>;
export const UpdateAgentTemplateDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateAgentTemplate"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateAgentTemplateInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateAgentTemplate"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"templateKind"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"model"}},{"kind":"Field","name":{"kind":"Name","value":"guardrailId"}},{"kind":"Field","name":{"kind":"Name","value":"blockedTools"}},{"kind":"Field","name":{"kind":"Name","value":"config"}},{"kind":"Field","name":{"kind":"Name","value":"skills"}},{"kind":"Field","name":{"kind":"Name","value":"sandbox"}},{"kind":"Field","name":{"kind":"Name","value":"browser"}},{"kind":"Field","name":{"kind":"Name","value":"webSearch"}},{"kind":"Field","name":{"kind":"Name","value":"sendEmail"}},{"kind":"Field","name":{"kind":"Name","value":"contextEngine"}},{"kind":"Field","name":{"kind":"Name","value":"knowledgeBaseIds"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<UpdateAgentTemplateMutation, UpdateAgentTemplateMutationVariables>;
export const DeleteAgentTemplateDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteAgentTemplate"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteAgentTemplate"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}]}]}}]} as unknown as DocumentNode<DeleteAgentTemplateMutation, DeleteAgentTemplateMutationVariables>;
export const TenantSandboxStatusDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"TenantSandboxStatus"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"tenant"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"sandboxEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"complianceTier"}},{"kind":"Field","name":{"kind":"Name","value":"sandboxInterpreterPublicId"}},{"kind":"Field","name":{"kind":"Name","value":"sandboxInterpreterInternalId"}}]}}]}}]} as unknown as DocumentNode<TenantSandboxStatusQuery, TenantSandboxStatusQueryVariables>;
export const CreateAgentFromTemplateDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateAgentFromTemplate"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateAgentFromTemplateInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createAgentFromTemplate"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}}]}}]}}]} as unknown as DocumentNode<CreateAgentFromTemplateMutation, CreateAgentFromTemplateMutationVariables>;
export const LinkedAgentsForTemplateDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"LinkedAgentsForTemplate"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"templateId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"linkedAgentsForTemplate"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"templateId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"templateId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<LinkedAgentsForTemplateQuery, LinkedAgentsForTemplateQueryVariables>;
export const TemplateSyncDiffDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"TemplateSyncDiff"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"templateId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"templateSyncDiff"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"templateId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"templateId"}}},{"kind":"Argument","name":{"kind":"Name","value":"agentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"roleChange"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"current"}},{"kind":"Field","name":{"kind":"Name","value":"target"}}]}},{"kind":"Field","name":{"kind":"Name","value":"skillsAdded"}},{"kind":"Field","name":{"kind":"Name","value":"skillsRemoved"}},{"kind":"Field","name":{"kind":"Name","value":"skillsChanged"}},{"kind":"Field","name":{"kind":"Name","value":"permissionsChanges"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"skillId"}},{"kind":"Field","name":{"kind":"Name","value":"added"}},{"kind":"Field","name":{"kind":"Name","value":"removed"}}]}},{"kind":"Field","name":{"kind":"Name","value":"kbsAdded"}},{"kind":"Field","name":{"kind":"Name","value":"kbsRemoved"}},{"kind":"Field","name":{"kind":"Name","value":"filesAdded"}},{"kind":"Field","name":{"kind":"Name","value":"filesModified"}},{"kind":"Field","name":{"kind":"Name","value":"filesSame"}}]}}]}}]} as unknown as DocumentNode<TemplateSyncDiffQuery, TemplateSyncDiffQueryVariables>;
export const AgentVersionsListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AgentVersionsList"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"limit"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"agentVersions"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"agentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}}},{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"Variable","name":{"kind":"Name","value":"limit"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"versionNumber"}},{"kind":"Field","name":{"kind":"Name","value":"label"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<AgentVersionsListQuery, AgentVersionsListQueryVariables>;
export const SyncTemplateToAgentDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SyncTemplateToAgent"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"templateId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"syncTemplateToAgent"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"templateId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"templateId"}}},{"kind":"Argument","name":{"kind":"Name","value":"agentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<SyncTemplateToAgentMutation, SyncTemplateToAgentMutationVariables>;
export const SyncTemplateToAllAgentsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SyncTemplateToAllAgents"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"templateId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"syncTemplateToAllAgents"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"templateId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"templateId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"agentsSynced"}},{"kind":"Field","name":{"kind":"Name","value":"agentsFailed"}},{"kind":"Field","name":{"kind":"Name","value":"errors"}}]}}]}}]} as unknown as DocumentNode<SyncTemplateToAllAgentsMutation, SyncTemplateToAllAgentsMutationVariables>;
export const RollbackAgentVersionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RollbackAgentVersion"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"versionId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"rollbackAgentVersion"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"agentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}}},{"kind":"Argument","name":{"kind":"Name","value":"versionId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"versionId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<RollbackAgentVersionMutation, RollbackAgentVersionMutationVariables>;
export const MemoryGraphDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MemoryGraph"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"userId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"memoryGraph"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"userId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"userId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"nodes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"label"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"strategy"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}},{"kind":"Field","name":{"kind":"Name","value":"edgeCount"}},{"kind":"Field","name":{"kind":"Name","value":"latestThreadId"}}]}},{"kind":"Field","name":{"kind":"Name","value":"edges"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"source"}},{"kind":"Field","name":{"kind":"Name","value":"target"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"label"}},{"kind":"Field","name":{"kind":"Name","value":"weight"}}]}}]}}]}}]} as unknown as DocumentNode<MemoryGraphQuery, MemoryGraphQueryVariables>;
export const WikiGraphDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"WikiGraph"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"userId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"wikiGraph"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"userId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"userId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"nodes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"label"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"strategy"}},{"kind":"Field","name":{"kind":"Name","value":"edgeCount"}},{"kind":"Field","name":{"kind":"Name","value":"latestThreadId"}}]}},{"kind":"Field","name":{"kind":"Name","value":"edges"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"source"}},{"kind":"Field","name":{"kind":"Name","value":"target"}},{"kind":"Field","name":{"kind":"Name","value":"label"}},{"kind":"Field","name":{"kind":"Name","value":"weight"}}]}}]}}]}}]} as unknown as DocumentNode<WikiGraphQuery, WikiGraphQueryVariables>;
export const AdminWikiPageDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AdminWikiPage"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"userId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"type"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"WikiPageType"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"slug"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"wikiPage"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"userId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"userId"}}},{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"Variable","name":{"kind":"Name","value":"type"}}},{"kind":"Argument","name":{"kind":"Name","value":"slug"},"value":{"kind":"Variable","name":{"kind":"Name","value":"slug"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"summary"}},{"kind":"Field","name":{"kind":"Name","value":"bodyMd"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"lastCompiledAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"aliases"}},{"kind":"Field","name":{"kind":"Name","value":"sections"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"sectionSlug"}},{"kind":"Field","name":{"kind":"Name","value":"heading"}},{"kind":"Field","name":{"kind":"Name","value":"bodyMd"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"lastSourceAt"}}]}}]}}]}}]} as unknown as DocumentNode<AdminWikiPageQuery, AdminWikiPageQueryVariables>;
export const AdminWikiBacklinksDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AdminWikiBacklinks"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"pageId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"wikiBacklinks"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"pageId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"pageId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"summary"}}]}}]}}]} as unknown as DocumentNode<AdminWikiBacklinksQuery, AdminWikiBacklinksQueryVariables>;
export const AdminRecentWikiPagesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AdminRecentWikiPages"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"userId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"limit"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"recentWikiPages"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"userId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"userId"}}},{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"Variable","name":{"kind":"Name","value":"limit"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"summary"}},{"kind":"Field","name":{"kind":"Name","value":"lastCompiledAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<AdminRecentWikiPagesQuery, AdminRecentWikiPagesQueryVariables>;
export const AdminWikiSearchDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AdminWikiSearch"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"userId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"query"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"limit"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"wikiSearch"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"userId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"userId"}}},{"kind":"Argument","name":{"kind":"Name","value":"query"},"value":{"kind":"Variable","name":{"kind":"Name","value":"query"}}},{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"Variable","name":{"kind":"Name","value":"limit"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"score"}},{"kind":"Field","name":{"kind":"Name","value":"matchedAlias"}},{"kind":"Field","name":{"kind":"Name","value":"page"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"summary"}},{"kind":"Field","name":{"kind":"Name","value":"lastCompiledAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]}}]} as unknown as DocumentNode<AdminWikiSearchQuery, AdminWikiSearchQueryVariables>;
export const ThreadTracesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ThreadTraces"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"threadId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"threadTraces"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"threadId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"threadId"}}},{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"traceId"}},{"kind":"Field","name":{"kind":"Name","value":"threadId"}},{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"agentName"}},{"kind":"Field","name":{"kind":"Name","value":"model"}},{"kind":"Field","name":{"kind":"Name","value":"inputTokens"}},{"kind":"Field","name":{"kind":"Name","value":"outputTokens"}},{"kind":"Field","name":{"kind":"Name","value":"durationMs"}},{"kind":"Field","name":{"kind":"Name","value":"costUsd"}},{"kind":"Field","name":{"kind":"Name","value":"estimated"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<ThreadTracesQuery, ThreadTracesQueryVariables>;
export const TurnInvocationLogsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"TurnInvocationLogs"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"turnId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"turnInvocationLogs"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"turnId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"turnId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"requestId"}},{"kind":"Field","name":{"kind":"Name","value":"modelId"}},{"kind":"Field","name":{"kind":"Name","value":"timestamp"}},{"kind":"Field","name":{"kind":"Name","value":"inputTokenCount"}},{"kind":"Field","name":{"kind":"Name","value":"outputTokenCount"}},{"kind":"Field","name":{"kind":"Name","value":"cacheReadTokenCount"}},{"kind":"Field","name":{"kind":"Name","value":"inputPreview"}},{"kind":"Field","name":{"kind":"Name","value":"outputPreview"}},{"kind":"Field","name":{"kind":"Name","value":"toolCount"}},{"kind":"Field","name":{"kind":"Name","value":"costUsd"}},{"kind":"Field","name":{"kind":"Name","value":"toolUses"}},{"kind":"Field","name":{"kind":"Name","value":"hasToolResult"}},{"kind":"Field","name":{"kind":"Name","value":"branch"}}]}}]}}]} as unknown as DocumentNode<TurnInvocationLogsQuery, TurnInvocationLogsQueryVariables>;
export const EvalSummaryDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"EvalSummary"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"evalSummary"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"totalRuns"}},{"kind":"Field","name":{"kind":"Name","value":"latestPassRate"}},{"kind":"Field","name":{"kind":"Name","value":"avgPassRate"}},{"kind":"Field","name":{"kind":"Name","value":"regressionCount"}}]}}]}}]} as unknown as DocumentNode<EvalSummaryQuery, EvalSummaryQueryVariables>;
export const EvalRunsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"EvalRuns"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"limit"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"offset"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"evalRuns"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"Variable","name":{"kind":"Name","value":"limit"}}},{"kind":"Argument","name":{"kind":"Name","value":"offset"},"value":{"kind":"Variable","name":{"kind":"Name","value":"offset"}}},{"kind":"Argument","name":{"kind":"Name","value":"agentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"model"}},{"kind":"Field","name":{"kind":"Name","value":"categories"}},{"kind":"Field","name":{"kind":"Name","value":"totalTests"}},{"kind":"Field","name":{"kind":"Name","value":"passed"}},{"kind":"Field","name":{"kind":"Name","value":"failed"}},{"kind":"Field","name":{"kind":"Name","value":"passRate"}},{"kind":"Field","name":{"kind":"Name","value":"regression"}},{"kind":"Field","name":{"kind":"Name","value":"costUsd"}},{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"agentName"}},{"kind":"Field","name":{"kind":"Name","value":"agentTemplateId"}},{"kind":"Field","name":{"kind":"Name","value":"agentTemplateName"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"totalCount"}}]}}]}}]} as unknown as DocumentNode<EvalRunsQuery, EvalRunsQueryVariables>;
export const EvalRunDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"EvalRun"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"evalRun"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"model"}},{"kind":"Field","name":{"kind":"Name","value":"categories"}},{"kind":"Field","name":{"kind":"Name","value":"totalTests"}},{"kind":"Field","name":{"kind":"Name","value":"passed"}},{"kind":"Field","name":{"kind":"Name","value":"failed"}},{"kind":"Field","name":{"kind":"Name","value":"passRate"}},{"kind":"Field","name":{"kind":"Name","value":"regression"}},{"kind":"Field","name":{"kind":"Name","value":"costUsd"}},{"kind":"Field","name":{"kind":"Name","value":"errorMessage"}},{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"agentName"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<EvalRunQuery, EvalRunQueryVariables>;
export const EvalRunResultsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"EvalRunResults"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"runId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"evalRunResults"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"runId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"runId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"testCaseId"}},{"kind":"Field","name":{"kind":"Name","value":"testCaseName"}},{"kind":"Field","name":{"kind":"Name","value":"category"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"score"}},{"kind":"Field","name":{"kind":"Name","value":"durationMs"}},{"kind":"Field","name":{"kind":"Name","value":"input"}},{"kind":"Field","name":{"kind":"Name","value":"actualOutput"}},{"kind":"Field","name":{"kind":"Name","value":"evaluatorResults"}},{"kind":"Field","name":{"kind":"Name","value":"assertions"}},{"kind":"Field","name":{"kind":"Name","value":"errorMessage"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<EvalRunResultsQuery, EvalRunResultsQueryVariables>;
export const EvalTimeSeriesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"EvalTimeSeries"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"days"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"evalTimeSeries"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"days"},"value":{"kind":"Variable","name":{"kind":"Name","value":"days"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"day"}},{"kind":"Field","name":{"kind":"Name","value":"passRate"}},{"kind":"Field","name":{"kind":"Name","value":"runCount"}},{"kind":"Field","name":{"kind":"Name","value":"passed"}},{"kind":"Field","name":{"kind":"Name","value":"failed"}}]}}]}}]} as unknown as DocumentNode<EvalTimeSeriesQuery, EvalTimeSeriesQueryVariables>;
export const EvalTestCasesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"EvalTestCases"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"category"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"search"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"evalTestCases"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"category"},"value":{"kind":"Variable","name":{"kind":"Name","value":"category"}}},{"kind":"Argument","name":{"kind":"Name","value":"search"},"value":{"kind":"Variable","name":{"kind":"Name","value":"search"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"category"}},{"kind":"Field","name":{"kind":"Name","value":"query"}},{"kind":"Field","name":{"kind":"Name","value":"systemPrompt"}},{"kind":"Field","name":{"kind":"Name","value":"assertions"}},{"kind":"Field","name":{"kind":"Name","value":"agentcoreEvaluatorIds"}},{"kind":"Field","name":{"kind":"Name","value":"tags"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}},{"kind":"Field","name":{"kind":"Name","value":"source"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<EvalTestCasesQuery, EvalTestCasesQueryVariables>;
export const EvalTestCaseDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"EvalTestCase"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"evalTestCase"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"category"}},{"kind":"Field","name":{"kind":"Name","value":"query"}},{"kind":"Field","name":{"kind":"Name","value":"systemPrompt"}},{"kind":"Field","name":{"kind":"Name","value":"assertions"}},{"kind":"Field","name":{"kind":"Name","value":"agentcoreEvaluatorIds"}},{"kind":"Field","name":{"kind":"Name","value":"tags"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}},{"kind":"Field","name":{"kind":"Name","value":"source"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<EvalTestCaseQuery, EvalTestCaseQueryVariables>;
export const StartEvalRunDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"StartEvalRun"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"StartEvalRunInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"startEvalRun"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"categories"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<StartEvalRunMutation, StartEvalRunMutationVariables>;
export const CreateEvalTestCaseDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateEvalTestCase"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateEvalTestCaseInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createEvalTestCase"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"category"}},{"kind":"Field","name":{"kind":"Name","value":"query"}},{"kind":"Field","name":{"kind":"Name","value":"systemPrompt"}},{"kind":"Field","name":{"kind":"Name","value":"agentTemplateId"}},{"kind":"Field","name":{"kind":"Name","value":"assertions"}},{"kind":"Field","name":{"kind":"Name","value":"agentcoreEvaluatorIds"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<CreateEvalTestCaseMutation, CreateEvalTestCaseMutationVariables>;
export const UpdateEvalTestCaseDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateEvalTestCase"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateEvalTestCaseInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateEvalTestCase"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"category"}},{"kind":"Field","name":{"kind":"Name","value":"query"}},{"kind":"Field","name":{"kind":"Name","value":"systemPrompt"}},{"kind":"Field","name":{"kind":"Name","value":"agentTemplateId"}},{"kind":"Field","name":{"kind":"Name","value":"assertions"}},{"kind":"Field","name":{"kind":"Name","value":"agentcoreEvaluatorIds"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<UpdateEvalTestCaseMutation, UpdateEvalTestCaseMutationVariables>;
export const SeedEvalTestCasesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SeedEvalTestCases"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"categories"}},"type":{"kind":"ListType","type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"seedEvalTestCases"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"categories"},"value":{"kind":"Variable","name":{"kind":"Name","value":"categories"}}}]}]}}]} as unknown as DocumentNode<SeedEvalTestCasesMutation, SeedEvalTestCasesMutationVariables>;
export const DeleteEvalTestCaseDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteEvalTestCase"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteEvalTestCase"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}]}]}}]} as unknown as DocumentNode<DeleteEvalTestCaseMutation, DeleteEvalTestCaseMutationVariables>;
export const DeleteEvalRunDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteEvalRun"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteEvalRun"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}]}]}}]} as unknown as DocumentNode<DeleteEvalRunMutation, DeleteEvalRunMutationVariables>;
export const CancelEvalRunDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CancelEvalRun"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cancelEvalRun"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}}]}}]}}]} as unknown as DocumentNode<CancelEvalRunMutation, CancelEvalRunMutationVariables>;
export const EvalTestCaseHistoryDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"EvalTestCaseHistory"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"testCaseId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"limit"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"evalTestCaseHistory"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"testCaseId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"testCaseId"}}},{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"Variable","name":{"kind":"Name","value":"limit"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"runId"}},{"kind":"Field","name":{"kind":"Name","value":"testCaseName"}},{"kind":"Field","name":{"kind":"Name","value":"category"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"score"}},{"kind":"Field","name":{"kind":"Name","value":"durationMs"}},{"kind":"Field","name":{"kind":"Name","value":"input"}},{"kind":"Field","name":{"kind":"Name","value":"expected"}},{"kind":"Field","name":{"kind":"Name","value":"actualOutput"}},{"kind":"Field","name":{"kind":"Name","value":"assertions"}},{"kind":"Field","name":{"kind":"Name","value":"evaluatorResults"}},{"kind":"Field","name":{"kind":"Name","value":"errorMessage"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<EvalTestCaseHistoryQuery, EvalTestCaseHistoryQueryVariables>;
export const OnEvalRunUpdatedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"OnEvalRunUpdated"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"onEvalRunUpdated"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"runId"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"totalTests"}},{"kind":"Field","name":{"kind":"Name","value":"passed"}},{"kind":"Field","name":{"kind":"Name","value":"failed"}},{"kind":"Field","name":{"kind":"Name","value":"passRate"}},{"kind":"Field","name":{"kind":"Name","value":"errorMessage"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<OnEvalRunUpdatedSubscription, OnEvalRunUpdatedSubscriptionVariables>;