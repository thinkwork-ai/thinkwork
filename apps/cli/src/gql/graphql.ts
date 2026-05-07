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
  GoogleCliSmoke = 'GOOGLE_CLI_SMOKE',
  HealthCheck = 'HEALTH_CHECK',
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

export type ConnectorRunNowResult = {
  __typename?: 'ConnectorRunNowResult';
  connectorId: Scalars['ID']['output'];
  results: Array<ConnectorDispatchResult>;
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
  compositionFeedbackSummary: Array<CompositionFeedbackSummary>;
  computer?: Maybe<Computer>;
  computerTasks: Array<ComputerTask>;
  computers: Array<Computer>;
  concurrencySnapshot: ConcurrencySnapshot;
  connector?: Maybe<Connector>;
  connectorExecution?: Maybe<ConnectorExecution>;
  connectorExecutions: Array<ConnectorExecution>;
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


export type QueryCompositionFeedbackSummaryArgs = {
  skillId?: InputMaybe<Scalars['String']['input']>;
  tenantId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryComputerArgs = {
  id: Scalars['ID']['input'];
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
  connectorId: Scalars['ID']['input'];
  cursor?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  status?: InputMaybe<ConnectorExecutionState>;
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

export type CliEvalRunsQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
  agentId?: InputMaybe<Scalars['ID']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
}>;


export type CliEvalRunsQuery = { __typename?: 'Query', evalRuns: { __typename?: 'EvalRunsPage', totalCount: number, items: Array<{ __typename?: 'EvalRun', id: string, status: string, model?: string | null, categories: Array<string>, agentId?: string | null, agentName?: string | null, agentTemplateId?: string | null, agentTemplateName?: string | null, totalTests: number, passed: number, failed: number, passRate?: number | null, regression: boolean, costUsd?: number | null, errorMessage?: string | null, startedAt?: any | null, completedAt?: any | null, createdAt: any }> } };

export type CliEvalRunQueryVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type CliEvalRunQuery = { __typename?: 'Query', evalRun?: { __typename?: 'EvalRun', id: string, status: string, model?: string | null, categories: Array<string>, agentId?: string | null, agentName?: string | null, agentTemplateId?: string | null, agentTemplateName?: string | null, totalTests: number, passed: number, failed: number, passRate?: number | null, regression: boolean, costUsd?: number | null, errorMessage?: string | null, startedAt?: any | null, completedAt?: any | null, createdAt: any } | null };

export type CliEvalRunResultsQueryVariables = Exact<{
  runId: Scalars['ID']['input'];
}>;


export type CliEvalRunResultsQuery = { __typename?: 'Query', evalRunResults: Array<{ __typename?: 'EvalResult', id: string, testCaseId?: string | null, testCaseName?: string | null, category?: string | null, status: string, score?: number | null, durationMs?: number | null, agentSessionId?: string | null, input?: string | null, expected?: string | null, actualOutput?: string | null, evaluatorResults: any, assertions: any, errorMessage?: string | null, createdAt: any }> };

export type CliEvalTestCasesQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
  category?: InputMaybe<Scalars['String']['input']>;
  search?: InputMaybe<Scalars['String']['input']>;
}>;


export type CliEvalTestCasesQuery = { __typename?: 'Query', evalTestCases: Array<{ __typename?: 'EvalTestCase', id: string, name: string, category: string, query: string, systemPrompt?: string | null, agentTemplateId?: string | null, agentTemplateName?: string | null, agentcoreEvaluatorIds: Array<string>, tags: Array<string>, enabled: boolean, source: string, createdAt: any, updatedAt: any }> };

export type CliEvalTestCaseQueryVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type CliEvalTestCaseQuery = { __typename?: 'Query', evalTestCase?: { __typename?: 'EvalTestCase', id: string, tenantId: string, name: string, category: string, query: string, systemPrompt?: string | null, agentTemplateId?: string | null, agentTemplateName?: string | null, assertions: any, agentcoreEvaluatorIds: Array<string>, tags: Array<string>, enabled: boolean, source: string, createdAt: any, updatedAt: any } | null };

export type CliAgentTemplatesForEvalQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
}>;


export type CliAgentTemplatesForEvalQuery = { __typename?: 'Query', agentTemplates: Array<{ __typename?: 'AgentTemplate', id: string, name: string, slug: string, model?: string | null, isPublished: boolean }> };

export type CliTenantBySlugQueryVariables = Exact<{
  slug: Scalars['String']['input'];
}>;


export type CliTenantBySlugQuery = { __typename?: 'Query', tenantBySlug?: { __typename?: 'Tenant', id: string, slug: string, name: string } | null };

export type CliStartEvalRunMutationVariables = Exact<{
  tenantId: Scalars['ID']['input'];
  input: StartEvalRunInput;
}>;


export type CliStartEvalRunMutation = { __typename?: 'Mutation', startEvalRun: { __typename?: 'EvalRun', id: string, status: string, model?: string | null, categories: Array<string>, agentTemplateId?: string | null, agentTemplateName?: string | null, totalTests: number, createdAt: any } };

export type CliCancelEvalRunMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type CliCancelEvalRunMutation = { __typename?: 'Mutation', cancelEvalRun: { __typename?: 'EvalRun', id: string, status: string, completedAt?: any | null } };

export type CliDeleteEvalRunMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type CliDeleteEvalRunMutation = { __typename?: 'Mutation', deleteEvalRun: boolean };

export type CliCreateEvalTestCaseMutationVariables = Exact<{
  tenantId: Scalars['ID']['input'];
  input: CreateEvalTestCaseInput;
}>;


export type CliCreateEvalTestCaseMutation = { __typename?: 'Mutation', createEvalTestCase: { __typename?: 'EvalTestCase', id: string, name: string, category: string } };

export type CliUpdateEvalTestCaseMutationVariables = Exact<{
  id: Scalars['ID']['input'];
  input: UpdateEvalTestCaseInput;
}>;


export type CliUpdateEvalTestCaseMutation = { __typename?: 'Mutation', updateEvalTestCase: { __typename?: 'EvalTestCase', id: string, name: string, category: string, enabled: boolean } };

export type CliDeleteEvalTestCaseMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type CliDeleteEvalTestCaseMutation = { __typename?: 'Mutation', deleteEvalTestCase: boolean };

export type CliSeedEvalTestCasesMutationVariables = Exact<{
  tenantId: Scalars['ID']['input'];
  categories?: InputMaybe<Array<Scalars['String']['input']> | Scalars['String']['input']>;
}>;


export type CliSeedEvalTestCasesMutation = { __typename?: 'Mutation', seedEvalTestCases: number };

export type CliMeQueryVariables = Exact<{ [key: string]: never; }>;


export type CliMeQuery = { __typename?: 'Query', me?: { __typename?: 'User', id: string, email: string, name?: string | null, tenantId: string } | null };

export type CliWikiTenantBySlugQueryVariables = Exact<{
  slug: Scalars['String']['input'];
}>;


export type CliWikiTenantBySlugQuery = { __typename?: 'Query', tenantBySlug?: { __typename?: 'Tenant', id: string, slug: string, name: string } | null };

export type CliAllTenantAgentsForWikiQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
}>;


export type CliAllTenantAgentsForWikiQuery = { __typename?: 'Query', allTenantAgents: Array<{ __typename?: 'Agent', id: string, name: string, slug?: string | null, type: AgentType, status: AgentStatus }> };

export type CliCompileWikiNowMutationVariables = Exact<{
  tenantId: Scalars['ID']['input'];
  ownerId: Scalars['ID']['input'];
  modelId?: InputMaybe<Scalars['String']['input']>;
}>;


export type CliCompileWikiNowMutation = { __typename?: 'Mutation', compileWikiNow: { __typename?: 'WikiCompileJob', id: string, tenantId: string, ownerId: string, status: string, trigger: string, dedupeKey: string, attempt: number, createdAt: any } };

export type CliResetWikiCursorMutationVariables = Exact<{
  tenantId: Scalars['ID']['input'];
  ownerId: Scalars['ID']['input'];
  force?: InputMaybe<Scalars['Boolean']['input']>;
}>;


export type CliResetWikiCursorMutation = { __typename?: 'Mutation', resetWikiCursor: { __typename?: 'WikiResetCursorResult', tenantId: string, ownerId: string, cursorCleared: boolean, pagesArchived: number } };

export type CliWikiCompileJobsQueryVariables = Exact<{
  tenantId: Scalars['ID']['input'];
  ownerId?: InputMaybe<Scalars['ID']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
}>;


export type CliWikiCompileJobsQuery = { __typename?: 'Query', wikiCompileJobs: Array<{ __typename?: 'WikiCompileJob', id: string, tenantId: string, ownerId: string, status: string, trigger: string, dedupeKey: string, attempt: number, claimedAt?: any | null, startedAt?: any | null, finishedAt?: any | null, error?: string | null, metrics?: any | null, createdAt: any }> };


export const CliEvalRunsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"CliEvalRuns"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"limit"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"offset"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"evalRuns"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"agentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"agentId"}}},{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"Variable","name":{"kind":"Name","value":"limit"}}},{"kind":"Argument","name":{"kind":"Name","value":"offset"},"value":{"kind":"Variable","name":{"kind":"Name","value":"offset"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"totalCount"}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"model"}},{"kind":"Field","name":{"kind":"Name","value":"categories"}},{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"agentName"}},{"kind":"Field","name":{"kind":"Name","value":"agentTemplateId"}},{"kind":"Field","name":{"kind":"Name","value":"agentTemplateName"}},{"kind":"Field","name":{"kind":"Name","value":"totalTests"}},{"kind":"Field","name":{"kind":"Name","value":"passed"}},{"kind":"Field","name":{"kind":"Name","value":"failed"}},{"kind":"Field","name":{"kind":"Name","value":"passRate"}},{"kind":"Field","name":{"kind":"Name","value":"regression"}},{"kind":"Field","name":{"kind":"Name","value":"costUsd"}},{"kind":"Field","name":{"kind":"Name","value":"errorMessage"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]}}]} as unknown as DocumentNode<CliEvalRunsQuery, CliEvalRunsQueryVariables>;
export const CliEvalRunDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"CliEvalRun"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"evalRun"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"model"}},{"kind":"Field","name":{"kind":"Name","value":"categories"}},{"kind":"Field","name":{"kind":"Name","value":"agentId"}},{"kind":"Field","name":{"kind":"Name","value":"agentName"}},{"kind":"Field","name":{"kind":"Name","value":"agentTemplateId"}},{"kind":"Field","name":{"kind":"Name","value":"agentTemplateName"}},{"kind":"Field","name":{"kind":"Name","value":"totalTests"}},{"kind":"Field","name":{"kind":"Name","value":"passed"}},{"kind":"Field","name":{"kind":"Name","value":"failed"}},{"kind":"Field","name":{"kind":"Name","value":"passRate"}},{"kind":"Field","name":{"kind":"Name","value":"regression"}},{"kind":"Field","name":{"kind":"Name","value":"costUsd"}},{"kind":"Field","name":{"kind":"Name","value":"errorMessage"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<CliEvalRunQuery, CliEvalRunQueryVariables>;
export const CliEvalRunResultsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"CliEvalRunResults"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"runId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"evalRunResults"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"runId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"runId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"testCaseId"}},{"kind":"Field","name":{"kind":"Name","value":"testCaseName"}},{"kind":"Field","name":{"kind":"Name","value":"category"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"score"}},{"kind":"Field","name":{"kind":"Name","value":"durationMs"}},{"kind":"Field","name":{"kind":"Name","value":"agentSessionId"}},{"kind":"Field","name":{"kind":"Name","value":"input"}},{"kind":"Field","name":{"kind":"Name","value":"expected"}},{"kind":"Field","name":{"kind":"Name","value":"actualOutput"}},{"kind":"Field","name":{"kind":"Name","value":"evaluatorResults"}},{"kind":"Field","name":{"kind":"Name","value":"assertions"}},{"kind":"Field","name":{"kind":"Name","value":"errorMessage"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<CliEvalRunResultsQuery, CliEvalRunResultsQueryVariables>;
export const CliEvalTestCasesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"CliEvalTestCases"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"category"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"search"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"evalTestCases"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"category"},"value":{"kind":"Variable","name":{"kind":"Name","value":"category"}}},{"kind":"Argument","name":{"kind":"Name","value":"search"},"value":{"kind":"Variable","name":{"kind":"Name","value":"search"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"category"}},{"kind":"Field","name":{"kind":"Name","value":"query"}},{"kind":"Field","name":{"kind":"Name","value":"systemPrompt"}},{"kind":"Field","name":{"kind":"Name","value":"agentTemplateId"}},{"kind":"Field","name":{"kind":"Name","value":"agentTemplateName"}},{"kind":"Field","name":{"kind":"Name","value":"agentcoreEvaluatorIds"}},{"kind":"Field","name":{"kind":"Name","value":"tags"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}},{"kind":"Field","name":{"kind":"Name","value":"source"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<CliEvalTestCasesQuery, CliEvalTestCasesQueryVariables>;
export const CliEvalTestCaseDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"CliEvalTestCase"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"evalTestCase"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"category"}},{"kind":"Field","name":{"kind":"Name","value":"query"}},{"kind":"Field","name":{"kind":"Name","value":"systemPrompt"}},{"kind":"Field","name":{"kind":"Name","value":"agentTemplateId"}},{"kind":"Field","name":{"kind":"Name","value":"agentTemplateName"}},{"kind":"Field","name":{"kind":"Name","value":"assertions"}},{"kind":"Field","name":{"kind":"Name","value":"agentcoreEvaluatorIds"}},{"kind":"Field","name":{"kind":"Name","value":"tags"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}},{"kind":"Field","name":{"kind":"Name","value":"source"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<CliEvalTestCaseQuery, CliEvalTestCaseQueryVariables>;
export const CliAgentTemplatesForEvalDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"CliAgentTemplatesForEval"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"agentTemplates"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"model"}},{"kind":"Field","name":{"kind":"Name","value":"isPublished"}}]}}]}}]} as unknown as DocumentNode<CliAgentTemplatesForEvalQuery, CliAgentTemplatesForEvalQueryVariables>;
export const CliTenantBySlugDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"CliTenantBySlug"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"slug"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"tenantBySlug"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"slug"},"value":{"kind":"Variable","name":{"kind":"Name","value":"slug"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]}}]} as unknown as DocumentNode<CliTenantBySlugQuery, CliTenantBySlugQueryVariables>;
export const CliStartEvalRunDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CliStartEvalRun"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"StartEvalRunInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"startEvalRun"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"model"}},{"kind":"Field","name":{"kind":"Name","value":"categories"}},{"kind":"Field","name":{"kind":"Name","value":"agentTemplateId"}},{"kind":"Field","name":{"kind":"Name","value":"agentTemplateName"}},{"kind":"Field","name":{"kind":"Name","value":"totalTests"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<CliStartEvalRunMutation, CliStartEvalRunMutationVariables>;
export const CliCancelEvalRunDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CliCancelEvalRun"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cancelEvalRun"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}}]}}]}}]} as unknown as DocumentNode<CliCancelEvalRunMutation, CliCancelEvalRunMutationVariables>;
export const CliDeleteEvalRunDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CliDeleteEvalRun"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteEvalRun"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}]}]}}]} as unknown as DocumentNode<CliDeleteEvalRunMutation, CliDeleteEvalRunMutationVariables>;
export const CliCreateEvalTestCaseDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CliCreateEvalTestCase"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateEvalTestCaseInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createEvalTestCase"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"category"}}]}}]}}]} as unknown as DocumentNode<CliCreateEvalTestCaseMutation, CliCreateEvalTestCaseMutationVariables>;
export const CliUpdateEvalTestCaseDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CliUpdateEvalTestCase"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateEvalTestCaseInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateEvalTestCase"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"category"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}}]}}]}}]} as unknown as DocumentNode<CliUpdateEvalTestCaseMutation, CliUpdateEvalTestCaseMutationVariables>;
export const CliDeleteEvalTestCaseDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CliDeleteEvalTestCase"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteEvalTestCase"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}]}]}}]} as unknown as DocumentNode<CliDeleteEvalTestCaseMutation, CliDeleteEvalTestCaseMutationVariables>;
export const CliSeedEvalTestCasesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CliSeedEvalTestCases"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"categories"}},"type":{"kind":"ListType","type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"seedEvalTestCases"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"categories"},"value":{"kind":"Variable","name":{"kind":"Name","value":"categories"}}}]}]}}]} as unknown as DocumentNode<CliSeedEvalTestCasesMutation, CliSeedEvalTestCasesMutationVariables>;
export const CliMeDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"CliMe"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"me"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}}]}}]}}]} as unknown as DocumentNode<CliMeQuery, CliMeQueryVariables>;
export const CliWikiTenantBySlugDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"CliWikiTenantBySlug"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"slug"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"tenantBySlug"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"slug"},"value":{"kind":"Variable","name":{"kind":"Name","value":"slug"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]}}]} as unknown as DocumentNode<CliWikiTenantBySlugQuery, CliWikiTenantBySlugQueryVariables>;
export const CliAllTenantAgentsForWikiDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"CliAllTenantAgentsForWiki"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"allTenantAgents"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"includeSystem"},"value":{"kind":"BooleanValue","value":false}},{"kind":"Argument","name":{"kind":"Name","value":"includeSubAgents"},"value":{"kind":"BooleanValue","value":false}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]}}]} as unknown as DocumentNode<CliAllTenantAgentsForWikiQuery, CliAllTenantAgentsForWikiQueryVariables>;
export const CliCompileWikiNowDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CliCompileWikiNow"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"ownerId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"modelId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"compileWikiNow"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"ownerId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"ownerId"}}},{"kind":"Argument","name":{"kind":"Name","value":"modelId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"modelId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"ownerId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"trigger"}},{"kind":"Field","name":{"kind":"Name","value":"dedupeKey"}},{"kind":"Field","name":{"kind":"Name","value":"attempt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<CliCompileWikiNowMutation, CliCompileWikiNowMutationVariables>;
export const CliResetWikiCursorDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CliResetWikiCursor"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"ownerId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"force"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"resetWikiCursor"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"ownerId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"ownerId"}}},{"kind":"Argument","name":{"kind":"Name","value":"force"},"value":{"kind":"Variable","name":{"kind":"Name","value":"force"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"ownerId"}},{"kind":"Field","name":{"kind":"Name","value":"cursorCleared"}},{"kind":"Field","name":{"kind":"Name","value":"pagesArchived"}}]}}]}}]} as unknown as DocumentNode<CliResetWikiCursorMutation, CliResetWikiCursorMutationVariables>;
export const CliWikiCompileJobsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"CliWikiCompileJobs"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"ownerId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"limit"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"wikiCompileJobs"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"tenantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tenantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"ownerId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"ownerId"}}},{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"Variable","name":{"kind":"Name","value":"limit"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"ownerId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"trigger"}},{"kind":"Field","name":{"kind":"Name","value":"dedupeKey"}},{"kind":"Field","name":{"kind":"Name","value":"attempt"}},{"kind":"Field","name":{"kind":"Name","value":"claimedAt"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"finishedAt"}},{"kind":"Field","name":{"kind":"Name","value":"error"}},{"kind":"Field","name":{"kind":"Name","value":"metrics"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<CliWikiCompileJobsQuery, CliWikiCompileJobsQueryVariables>;