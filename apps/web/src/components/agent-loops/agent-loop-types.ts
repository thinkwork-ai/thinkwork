export type AgentLoopLifecycleStatus =
  "draft" | "active" | "paused" | "archived";

export type AgentLoopTriggerFamily = "manual" | "schedule";
export type AgentLoopJudgeMode = "self_check" | "human_approval";
export type AgentLoopCreationMode = "advanced" | "builder" | "chat" | "easy";

export type JsonRecord = Record<string, unknown>;

export interface AgentLoopTriggerSpec {
  family: AgentLoopTriggerFamily;
  enabled: boolean;
  source?: string;
  config: {
    scheduleType?: string;
    scheduleExpression?: string;
    timezone?: string;
    [key: string]: unknown;
  };
}

export interface AgentLoopGoalSpec {
  objective: string;
  completionCriteria: string[];
  context?: JsonRecord;
}

export interface AgentLoopWorkerSpec {
  type: "agent" | "agent_profile";
  id: string;
  label?: string;
  toolHints: string[];
  config: JsonRecord;
}

export interface AgentLoopJudgeSpec {
  mode: AgentLoopJudgeMode;
  criteria: string[];
  config: JsonRecord;
}

export interface AgentLoopPolicy {
  maxIterations: number;
  maxRuntimeMs?: number;
  maxTokens?: number;
  costBudgetUsd?: number;
  retryBackoffMs?: number;
  failBehavior: "return_blocker" | "best_effort_with_warning" | "escalate";
  escalateOnFailure: boolean;
}

export interface AgentLoopEvidencePolicy {
  redactionState: "summary_only" | "redacted" | "offloaded" | "raw_allowed";
  retainRawEvidence: boolean;
  retentionDays?: number;
}

export interface AgentLoopVersionSummary {
  id: string;
  versionNumber: number;
  versionStatus?: string;
  triggerSpec: unknown;
  goalSpec: unknown;
  workerSpec: unknown;
  judgeSpec: unknown;
  loopPolicy: unknown;
  evidencePolicy: unknown;
  sourceMetadata?: unknown;
  publishedAt?: string | null;
  createdAt?: string | null;
}

export interface AgentLoopRunSummary {
  id: string;
  status: string;
  threadId?: string | null;
  triggerFamily: string;
  triggerSource?: string | null;
  scheduledJobId?: string | null;
  actorType?: string | null;
  actorId?: string | null;
  correlationId?: string | null;
  currentIteration: number;
  terminalReason?: string | null;
  inputSummary?: unknown;
  outputSummary?: unknown;
  startedAt?: string | null;
  finishedAt?: string | null;
  lastEventAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  totalCostUsdCents?: number | null;
  createdAt: string;
}

export interface AgentLoopRow {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  description?: string | null;
  lifecycleStatus: string;
  enabled: boolean;
  ownerUserId?: string | null;
  ownerAgentId?: string | null;
  spaceId?: string | null;
  primaryTriggerFamily: string;
  currentVersionId?: string | null;
  currentVersionNumber?: number | null;
  currentVersion?: AgentLoopVersionSummary | null;
  lastRunId?: string | null;
  lastRunStatus?: string | null;
  lastRunAt?: string | null;
  lastRunSummary?: unknown;
  acceptedRunCount: number;
  rejectedRunCount: number;
  escalatedRunCount: number;
  totalCostUsdCents: number;
  costPerAcceptedRunUsdCents?: number | null;
  runs?: AgentLoopRunSummary[];
  createdAt: string;
  updatedAt: string;
}

export interface AgentLoopEvidenceItem {
  id: string;
  agentLoopIterationId?: string | null;
  agentLoopJudgmentId?: string | null;
  evidenceType: string;
  sourceSystem: string;
  sourceId?: string | null;
  uri?: string | null;
  summary: unknown;
  redactionState: string;
  sensitivity?: string | null;
  retentionExpiresAt?: string | null;
  createdAt: string;
}

export interface AgentLoopJudgment {
  id: string;
  agentLoopIterationId?: string | null;
  judgeMode: string;
  outcome: string;
  confidence?: number | null;
  rationale?: string | null;
  terminalReason?: string | null;
  structuredOutput: unknown;
  createdAt: string;
}

export interface AgentLoopIteration {
  id: string;
  iterationNumber: number;
  status: string;
  goalModeAction?: string | null;
  agentWakeupRequestId?: string | null;
  threadTurnId?: string | null;
  threadId?: string | null;
  inputSummary?: unknown;
  outputSummary?: unknown;
  startedAt?: string | null;
  finishedAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  totalCostUsdCents?: number | null;
  judgments: AgentLoopJudgment[];
  evidence: AgentLoopEvidenceItem[];
  createdAt: string;
  updatedAt: string;
}

export interface AgentLoopRunDetail {
  id: string;
  tenantId: string;
  agentLoopId: string;
  agentLoop?: Pick<AgentLoopRow, "id" | "name" | "slug"> | null;
  agentLoopVersionId?: string | null;
  threadId?: string | null;
  agentLoopVersion?: AgentLoopVersionSummary | null;
  status: string;
  triggerFamily: string;
  triggerSource?: string | null;
  scheduledJobId?: string | null;
  actorType?: string | null;
  actorId?: string | null;
  idempotencyKey?: string | null;
  correlationId?: string | null;
  currentIteration: number;
  terminalReason?: string | null;
  policySnapshot: unknown;
  inputSummary?: unknown;
  outputSummary?: unknown;
  startedAt?: string | null;
  finishedAt?: string | null;
  lastEventAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  totalCostUsdCents?: number | null;
  iterations: AgentLoopIteration[];
  judgments: AgentLoopJudgment[];
  evidence: AgentLoopEvidenceItem[];
  createdAt: string;
  updatedAt: string;
}

export interface AgentLoopWorkerOption {
  id: string;
  type: "agent" | "agent_profile";
  label: string;
  description?: string | null;
}

export interface AgentLoopSpaceOption {
  id: string;
  name: string;
  slug?: string | null;
}

export interface AgentLoopDraft {
  creationMode: AgentLoopCreationMode;
  name: string;
  description: string;
  lifecycleStatus: AgentLoopLifecycleStatus;
  enabled: boolean;
  triggerFamily: AgentLoopTriggerFamily;
  scheduleType: string;
  scheduleExpression: string;
  timezone: string;
  spaceId: string;
  objective: string;
  completionCriteriaText: string;
  workerId: string;
  judgeMode: AgentLoopJudgeMode;
  judgeCriteriaText: string;
  maxIterations: string;
  maxRuntimeMinutes: string;
  maxTokens: string;
  costBudgetUsd: string;
  retryBackoffMinutes: string;
  failBehavior: "return_blocker" | "best_effort_with_warning" | "escalate";
  escalateOnFailure: boolean;
  redactionState: AgentLoopEvidencePolicy["redactionState"];
  retainRawEvidence: boolean;
  retentionDays: string;
  suitabilityGoalStable: boolean;
  suitabilityEvidenceAvailable: boolean;
  suitabilityBudgeted: boolean;
  builderThreadId?: string | null;
  builderThreadTitle?: string | null;
  builderSetupPrompt?: string | null;
}

export interface SaveAgentLoopPayload {
  id?: string;
  tenantId: string;
  name: string;
  description?: string | null;
  lifecycleStatus: AgentLoopLifecycleStatus;
  enabled: boolean;
  spaceId?: string | null;
  triggerSpec: AgentLoopTriggerSpec;
  goalSpec: AgentLoopGoalSpec;
  workerSpec: AgentLoopWorkerSpec;
  judgeSpec: AgentLoopJudgeSpec;
  loopPolicy: AgentLoopPolicy;
  evidencePolicy: AgentLoopEvidencePolicy;
  sourceMetadata: JsonRecord;
}
