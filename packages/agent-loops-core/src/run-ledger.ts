import type {
  GoalSpec,
  JudgeSpec,
  LoopPolicy,
  RoutineActionResult,
  RoutineActionSpec,
  RoutineActionsSpec,
  WorkerSpec,
} from "./contracts";
import {
  normalizeRoutineActionsSpec,
  normalizeTargetSpec,
  targetSpecFromLegacy,
} from "./contracts";

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
  /** Deterministic routine actions (plan 2026-07-03-004 U5). Null on
   * versions without routine actions. */
  routineActionsSpec?: RoutineActionsSpec | null;
}

/**
 * Webhook delivery provenance carried on a webhook-triggered run (THINK-137
 * U9 R16, KTD4 — the SINGLE seam). Populated by U6 only when
 * `trigger.family === 'webhook'`; passed verbatim into the wakeup payload's
 * `agentLoop` block so the agent turn can attribute the delivered event.
 * Absent/null for every other trigger family (inert).
 */
export interface AgentLoopWebhookDelivery {
  /** Delivery source identifier (e.g. the webhook integration slug). */
  source: string;
  /** Provider/delivery event id, when the source supplies one. */
  eventId?: string | null;
  /** Pointer (e.g. S3 key / delivery-row id) to the retained raw payload. */
  payloadPointer?: string | null;
}

export interface AgentLoopTriggerContext {
  family: AgentLoopDispatchTriggerFamily;
  source: string;
  actorType?: string | null;
  actorId?: string | null;
  threadId?: string | null;
  spaceId?: string | null;
  scheduledJobId?: string | null;
  idempotencyKey?: string | null;
  correlationId?: string | null;
  inputSummary?: Record<string, unknown> | null;
  /** Webhook delivery provenance (R16). Enters here for webhook triggers and
   * flows through buildAgentLoopWakeupPayload — the only seam that carries it
   * onto the wire. U6 populates it; inert (undefined/null) otherwise. */
  webhookDelivery?: AgentLoopWebhookDelivery | null;
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

/**
 * Side-effect completeness of a run found by idempotency key, used to
 * decide reuse-vs-repair (THINK-137 U2). `hasWakeup` is true once the
 * first iteration recorded its `agent_wakeup_request_id`; a `queued` run
 * whose iteration has no wakeup is a half-built start.
 */
export interface AgentLoopRunRepairState {
  status: AgentLoopRunStatus;
  iterationId: string | null;
  hasWakeup: boolean;
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
  threadId?: string | null;
  spaceId?: string | null;
  inputSummary?: Record<string, unknown> | null;
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
    /** Outcomes of routine actions executed before this agent turn (mixed
     * Automations). Present on the initial AND resume payloads so the
     * agent always sees what the deterministic steps produced. */
    routineActionResults?: RoutineActionResult[] | null;
    /** Webhook delivery provenance for webhook-triggered runs (R16, KTD4).
     * Carried from the trigger context on both the start and resume payloads;
     * null for non-webhook triggers. */
    webhookDelivery?: AgentLoopWebhookDelivery | null;
  };
}

export interface AgentLoopDispatchLedger {
  findRunByIdempotencyKey(input: {
    tenantId: string;
    idempotencyKey: string;
  }): Promise<AgentLoopRunRef | null>;
  /** Loads the side-effect completeness of an existing run so dispatch can
   * decide reuse-vs-repair (THINK-137 U2). Optional: ledgers without it
   * fall back to today's behavior (any matching run is `reused`). */
  loadRunRepairState?(input: {
    tenantId: string;
    runId: string;
  }): Promise<AgentLoopRunRepairState | null>;
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
  /** Executes one routine action (RequestResponse invoke of the
   * routine-exec-git Lambda) and returns its outcome. Optional: ledgers
   * that cannot run routines (e.g. inside graphql-http, KTD-3) omit it
   * and defer continuation to job-trigger instead. */
  runRoutineAction?(input: {
    tenantId: string;
    runId: string;
    iterationId: string;
    action: RoutineActionSpec;
    now: Date;
  }): Promise<RoutineActionResult>;
  /** Persists per-action outcomes on the iteration record so the resume
   * payload path can re-inject them (payload parity). */
  recordRoutineActionResults?(input: {
    tenantId: string;
    runId: string;
    iterationId: string;
    results: RoutineActionResult[];
    now: Date;
  }): Promise<void>;
  /** Completes a routine-only run (agentTurn: false) without a wakeup. */
  completeRoutineOnlyRun?(input: {
    tenantId: string;
    runId: string;
    iterationId: string;
    status: "completed" | "failed";
    results: RoutineActionResult[];
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
      status: "deferred";
      runId: string;
      iterationId: string;
    }
  | {
      status: "completed_routine_only";
      runId: string;
      iterationId: string;
      routineActionResults: RoutineActionResult[];
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
  routineActionResults?: RoutineActionResult[] | null;
}): AgentLoopWakeupPayload {
  const tokenBudget =
    input.version.loopPolicy.maxTokens ?? DEFAULT_AGENT_LOOP_GOAL_TOKEN_BUDGET;
  return {
    message: input.version.goalSpec.objective,
    threadId: input.trigger.threadId ?? null,
    spaceId: input.trigger.spaceId ?? null,
    inputSummary: input.trigger.inputSummary ?? null,
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
      routineActionResults: input.routineActionResults ?? null,
      webhookDelivery: input.trigger.webhookDelivery ?? null,
    },
  };
}

export function workerAgentId(workerSpec: WorkerSpec | null | undefined) {
  return workerSpec?.type === "agent" ? workerSpec.id : null;
}

/**
 * Raw agent_loop_versions row (snake_case columns) as both dispatch call
 * sites already select it. `target_spec` is the authoritative target after
 * THINK-137 U3; the legacy blobs are the read-fallback for pre-U3 rows.
 */
export interface RawAgentLoopVersionRow {
  id: string;
  version_status: string;
  goal_spec: unknown;
  worker_spec: unknown;
  judge_spec: unknown;
  loop_policy: unknown;
  routine_actions_spec?: unknown;
  target_spec?: unknown;
}

/**
 * Single-sourced dispatch resolution (THINK-137 U3). Turns a raw version row
 * into the `DispatchableAgentLoopVersion` the dispatcher consumes, resolving
 * the target from `target_spec` when present, else `targetSpecFromLegacy`.
 * Both call sites (job-trigger's handleAgentLoopSchedule and the
 * triggerAgentLoopRun mutation) call this so the target→dispatch translation
 * is never duplicated.
 *
 * Behavior-preserving: a `routine`/`workflow` target reconstructs the
 * token-free `agentTurn:false` routineActionsSpec so it dispatches exactly
 * like today's routine-only path; an `agent_thread` target reconstructs the
 * goal/worker shapes so it dispatches exactly like today's goal/worker wakeup
 * path. Judge + loop-policy always come from the (still-written) legacy
 * columns — they are off the product surface (R11) and not carried by
 * target_spec.
 */
export function resolveDispatchableVersion(
  row: RawAgentLoopVersionRow,
): DispatchableAgentLoopVersion {
  const targetSpec =
    row.target_spec !== undefined && row.target_spec !== null
      ? normalizeTargetSpec(row.target_spec)
      : targetSpecFromLegacy({
          goalSpec: row.goal_spec,
          workerSpec: row.worker_spec,
          routineActionsSpec: row.routine_actions_spec,
        });

  const legacyGoal = (row.goal_spec ?? {}) as GoalSpec;
  const legacyWorker = (row.worker_spec ?? {
    type: "agent",
    id: "",
    toolHints: [],
    config: {},
  }) as WorkerSpec;

  let goalSpec = legacyGoal;
  let workerSpec = legacyWorker;
  let routineActionsSpec: RoutineActionsSpec | null;

  if (targetSpec.kind === "routine" || targetSpec.kind === "workflow") {
    // Token-free target: dispatch exactly like the agentTurn:false path.
    const ref =
      targetSpec.kind === "routine" ? targetSpec.routine : targetSpec.workflow;
    const actions: RoutineActionSpec[] = ref
      ? [
          {
            routineId: ref.routineId,
            ...(ref.input != null ? { input: ref.input } : {}),
            ...(ref.label != null ? { label: ref.label } : {}),
          },
          ...(ref.additionalActions ?? []),
        ]
      : [];
    routineActionsSpec = { actions, agentTurn: false };
  } else {
    // agent_thread — target_spec is authoritative for objective + worker
    // identity; its orthogonal bolt-on routine actions stay in the legacy
    // routine_actions_spec column (mixed Automations).
    const at = targetSpec.agentThread;
    if (at) {
      goalSpec = {
        ...legacyGoal,
        objective: at.instructions,
        completionCriteria:
          at.completionCriteria ?? legacyGoal.completionCriteria ?? [],
      };
      if (at.workerId) {
        workerSpec = {
          ...legacyWorker,
          type: at.workerType ?? legacyWorker.type ?? "agent",
          id: at.workerId,
        };
      }
    }
    routineActionsSpec = normalizeRoutineActionsSpec(row.routine_actions_spec);
  }

  return {
    id: row.id,
    versionStatus: row.version_status,
    goalSpec,
    workerSpec,
    judgeSpec: row.judge_spec as JudgeSpec,
    loopPolicy: row.loop_policy as LoopPolicy,
    routineActionsSpec,
  };
}
