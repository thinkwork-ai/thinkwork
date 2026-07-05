export type AgentLoopLifecycleStatus =
  | "draft"
  | "active"
  | "paused"
  | "archived";

// THINK-137 U3 (R2): the product trigger families are schedule | webhook.
// `manual` stays valid as a run source / "no automatic trigger" family and is
// read from pre-U3 rows, but the form only offers schedule | webhook.
export type AgentLoopTriggerFamily = "manual" | "schedule" | "webhook";
// THINK-137 U7: the compact dialog's Repeats row offers Manual as well, so the
// form family now spans all three. Manual writes an empty trigger config.
export type AgentLoopFormTriggerFamily = "manual" | "schedule" | "webhook";

// THINK-137 U3 (R3): the authoritative target kinds.
export type AgentLoopTargetKind = "agent_thread" | "routine" | "workflow";
export type AgentLoopThreadMode = "new_per_run" | "fixed";

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

// THINK-137 U3 (R3): the authoritative target spec written by the form.
// Mirrors packages/agent-loops-core `TargetSpec`.
export interface AgentLoopTargetAgentThread {
  instructions: string;
  completionCriteria?: string[];
  workerId?: string;
  workerType?: "agent" | "agent_profile";
  threadMode: AgentLoopThreadMode;
  fixedThreadId?: string;
}

export interface AgentLoopTargetRoutineRef {
  routineId: string;
  input?: JsonRecord | null;
  label?: string | null;
}

export interface AgentLoopTargetSpec {
  kind: AgentLoopTargetKind;
  agentThread?: AgentLoopTargetAgentThread;
  routine?: AgentLoopTargetRoutineRef;
  workflow?: AgentLoopTargetRoutineRef;
}

export interface AgentLoopVersionSummary {
  id: string;
  versionNumber: number;
  versionStatus?: string;
  triggerSpec: unknown;
  goalSpec: unknown;
  workerSpec: unknown;
  loopPolicy: unknown;
  routineActionsSpec?: unknown;
  // THINK-137 U3 (R3): authoritative target spec; null on pre-U3 rows.
  targetSpec?: unknown;
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
  // THINK-137 U3 (R1): the user identity a run acts as.
  runAsUserId?: string | null;
  spaceId?: string | null;
  primaryTriggerFamily: string;
  currentVersionId?: string | null;
  currentVersionNumber?: number | null;
  currentVersion?: AgentLoopVersionSummary | null;
  lastRunId?: string | null;
  lastRunStatus?: string | null;
  lastRunAt?: string | null;
  lastRunSummary?: unknown;
  runs?: AgentLoopRunSummary[];
  // THINK-137 U6/U8: the minted inbound webhook endpoint + metadata-only
  // delivery history, present only for webhook-trigger automations.
  webhookEndpoint?: AgentLoopWebhookEndpoint | null;
  webhookDeliveries?: AutomationWebhookDelivery[];
  createdAt: string;
  updatedAt: string;
}

export interface AgentLoopWebhookEndpoint {
  webhookId: string;
  token: string;
  path: string;
  enabled: boolean;
}

export interface AutomationWebhookDelivery {
  id: string;
  receivedAt: string;
  resolutionStatus: string;
  signatureStatus: string;
  statusCode?: number | null;
  providerName?: string | null;
  providerEventId?: string | null;
  normalizedKind?: string | null;
  threadId?: string | null;
  threadCreated?: boolean | null;
  isReplay: boolean;
  retryCount: number;
  durationMs?: number | null;
  errorMessage?: string | null;
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

// Routine / workflow target options — a git_python routine (routine kind) or a
// step_functions routine (workflow kind). `disabledReason` renders the option
// inert with a one-line explanation instead of failing at save.
export interface AgentLoopRoutineOption {
  id: string;
  name: string;
  description?: string | null;
  disabledReason?: string | null;
}

// Run-as user option — a tenant member the run can act as.
export interface AgentLoopMemberOption {
  id: string;
  label: string;
}

export interface AgentLoopDraft {
  name: string;
  description: string;
  lifecycleStatus: AgentLoopLifecycleStatus;
  enabled: boolean;
  // Trigger
  triggerFamily: AgentLoopFormTriggerFamily;
  scheduleType: string;
  scheduleExpression: string;
  timezone: string;
  // Target
  targetKind: AgentLoopTargetKind;
  instructions: string;
  workerId: string;
  threadMode: AgentLoopThreadMode;
  fixedThreadId: string;
  routineId: string;
  workflowId: string;
  // Run identity + Space
  runAsUserId: string;
  spaceId: string;
}

export interface SaveAgentLoopPayload {
  id?: string;
  tenantId: string;
  name: string;
  description?: string | null;
  lifecycleStatus: AgentLoopLifecycleStatus;
  enabled: boolean;
  runAsUserId?: string | null;
  spaceId?: string | null;
  triggerSpec: AgentLoopTriggerSpec;
  // Legacy inputs are still required by SaveAgentLoopInput; derived from the
  // target config so the API contract is satisfied (goalSpec/workerSpec are
  // non-null). judge/loop/evidence are off the product surface and omitted —
  // the server writes column defaults.
  goalSpec: AgentLoopGoalSpec;
  workerSpec: AgentLoopWorkerSpec;
  // THINK-137 U3 (R3): the authoritative target spec.
  targetSpec: AgentLoopTargetSpec;
  sourceMetadata: JsonRecord;
}
