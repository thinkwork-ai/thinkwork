import type { GoalSpec, JudgeSpec, LoopPolicy, WorkerSpec } from "./contracts";

export const AGENT_LOOP_WAKEUP_SOURCE = "agent_loop";
export const AGENT_LOOP_SCHEDULE_TRIGGER_TYPE = "agent_loop_schedule";
export const DEFAULT_AGENT_LOOP_GOAL_TOKEN_BUDGET = 100_000;

export type AgentLoopRunStatus =
  | "queued"
  | "running"
  | "waiting_for_human"
  | "completed"
  | "failed"
  | "budget_stopped"
  | "escalated"
  | "canceled"
  | "skipped";

export type AgentLoopIterationStatus =
  | "queued"
  | "running"
  | "waiting_for_human"
  | "completed"
  | "failed"
  | "budget_stopped"
  | "escalated"
  | "canceled"
  | "skipped";

export type AgentLoopDispatchTriggerFamily =
  | "manual"
  | "schedule"
  | "api"
  | "webhook"
  | "app_event"
  | "n8n";

export interface DispatchableAgentLoop {
  id: string;
  tenantId: string;
  name?: string | null;
  enabled: boolean;
  lifecycleStatus: string;
}

export interface DispatchableAgentLoopVersion {
  id: string;
  versionStatus: string;
  goalSpec: GoalSpec;
  workerSpec: WorkerSpec;
  judgeSpec: JudgeSpec;
  loopPolicy: LoopPolicy;
}

export interface AgentLoopTriggerContext {
  family: AgentLoopDispatchTriggerFamily;
  source: string;
  actorType?: string | null;
  actorId?: string | null;
  scheduledJobId?: string | null;
  idempotencyKey?: string | null;
  correlationId?: string | null;
  inputSummary?: Record<string, unknown> | null;
}

export interface AgentLoopScheduleGate {
  enabled: boolean;
  budgetPaused: boolean;
  reason?: string | null;
}

export interface AgentLoopDispatchInput {
  tenantId: string;
  loop: DispatchableAgentLoop;
  version: DispatchableAgentLoopVersion | null;
  trigger: AgentLoopTriggerContext;
  scheduleGate?: AgentLoopScheduleGate | null;
  now?: Date;
}

export interface AgentLoopRunRef {
  id: string;
  status: AgentLoopRunStatus;
}

export interface AgentLoopIterationRef {
  id: string;
}

export interface AgentLoopWakeupRef {
  id: string;
}

export interface AgentLoopCreateRunInput {
  tenantId: string;
  agentLoopId: string;
  agentLoopVersionId?: string | null;
  status: AgentLoopRunStatus;
  triggerFamily: AgentLoopDispatchTriggerFamily;
  triggerSource: string;
  scheduledJobId?: string | null;
  actorType?: string | null;
  actorId?: string | null;
  idempotencyKey?: string | null;
  correlationId: string;
  currentIteration: number;
  policySnapshot: LoopPolicy | Record<string, unknown>;
  inputSummary: Record<string, unknown> | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  now: Date;
}

export interface AgentLoopCreateIterationInput {
  tenantId: string;
  runId: string;
  iterationNumber: number;
  status: AgentLoopIterationStatus;
  goalModeAction: string;
  inputSummary: Record<string, unknown> | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  now: Date;
}

export interface AgentLoopEnqueueWakeupInput {
  tenantId: string;
  agentId: string;
  source: typeof AGENT_LOOP_WAKEUP_SOURCE;
  triggerDetail: string;
  reason: string;
  payload: AgentLoopWakeupPayload;
  idempotencyKey: string;
  requestedByActorType?: string | null;
  requestedByActorId?: string | null;
  now: Date;
}

export interface AgentLoopWakeupPayload {
  message: string;
  goalMode: {
    enabled: true;
    action: "start" | "resume";
    objective: string;
    goalRunId: string;
    resolvedBudget: {
      tokenBudget: number;
    };
  };
  agentLoop: {
    loopId: string;
    loopName?: string | null;
    runId: string;
    iterationId: string;
    versionId: string;
    triggerFamily: AgentLoopDispatchTriggerFamily;
    triggerSource: string;
    scheduledJobId?: string | null;
    completionCriteria: string[];
    judgeMode: string;
    loopPolicy: LoopPolicy;
  };
}

export interface AgentLoopDispatchLedger {
  findRunByIdempotencyKey(input: {
    tenantId: string;
    idempotencyKey: string;
  }): Promise<AgentLoopRunRef | null>;
  createRun(input: AgentLoopCreateRunInput): Promise<AgentLoopRunRef>;
  createIteration(
    input: AgentLoopCreateIterationInput,
  ): Promise<AgentLoopIterationRef>;
  enqueueWakeup(
    input: AgentLoopEnqueueWakeupInput,
  ): Promise<AgentLoopWakeupRef>;
  markIterationWakeup(input: {
    tenantId: string;
    iterationId: string;
    wakeupId: string;
    now: Date;
  }): Promise<void>;
  markDispatchFailed(input: {
    tenantId: string;
    runId: string;
    iterationId: string;
    errorCode: string;
    errorMessage: string;
    now: Date;
  }): Promise<void>;
  updateLoopAfterDispatch(input: {
    tenantId: string;
    loopId: string;
    runId: string;
    status: AgentLoopRunStatus;
    triggerFamily: AgentLoopDispatchTriggerFamily;
    currentIteration: number;
    summary?: Record<string, unknown>;
    now: Date;
  }): Promise<void>;
}

export type AgentLoopDispatchResult =
  | {
      status: "reused";
      runId: string;
      runStatus: AgentLoopRunStatus;
    }
  | {
      status: "queued";
      runId: string;
      iterationId: string;
      wakeupId: string;
    }
  | {
      status: "skipped";
      runId: string;
      iterationId: string;
      reason: string;
    }
  | {
      status: "failed";
      runId: string;
      iterationId: string;
      error: string;
    };

export function buildAgentLoopWakeupPayload(input: {
  loop: DispatchableAgentLoop;
  version: DispatchableAgentLoopVersion;
  trigger: AgentLoopTriggerContext;
  runId: string;
  iterationId: string;
  goalModeAction?: "start" | "resume";
}): AgentLoopWakeupPayload {
  const tokenBudget =
    input.version.loopPolicy.maxTokens ?? DEFAULT_AGENT_LOOP_GOAL_TOKEN_BUDGET;
  return {
    message: input.version.goalSpec.objective,
    goalMode: {
      enabled: true,
      action: input.goalModeAction ?? "start",
      objective: input.version.goalSpec.objective,
      goalRunId: input.runId,
      resolvedBudget: {
        tokenBudget,
      },
    },
    agentLoop: {
      loopId: input.loop.id,
      loopName: input.loop.name ?? null,
      runId: input.runId,
      iterationId: input.iterationId,
      versionId: input.version.id,
      triggerFamily: input.trigger.family,
      triggerSource: input.trigger.source,
      scheduledJobId: input.trigger.scheduledJobId ?? null,
      completionCriteria: input.version.goalSpec.completionCriteria,
      judgeMode: input.version.judgeSpec.mode,
      loopPolicy: input.version.loopPolicy,
    },
  };
}

export function workerAgentId(workerSpec: WorkerSpec | null | undefined) {
  return workerSpec?.type === "agent" ? workerSpec.id : null;
}
