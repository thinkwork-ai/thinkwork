import type {
  AgentLoopTargetKind,
  GoalSpec,
  LoopPolicy,
  RoutineActionResult,
  RoutineActionSpec,
  RoutineActionsSpec,
  TargetGuards,
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
  loopPolicy: LoopPolicy;
  /** Deterministic routine actions (plan 2026-07-03-004 U5). Null on
   * versions without routine actions. */
  routineActionsSpec?: RoutineActionsSpec | null;
  /** Resolved target kind (THINK-137 U3/U4). Drives the "does this dispatch
   * need a Thread?" decision (agent_thread does; routine/workflow never) and
   * whether a failure is headless (routine/workflow). */
  targetKind: AgentLoopTargetKind;
  /** R11 run guards carried on target_spec — max concurrent runs + monthly
   * cost cap. Enforced at the dispatcher start-gate (THINK-137 U4). */
  guards?: TargetGuards | null;
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
  /**
   * Per-Sender Context Injection identity (THINK-137 U5, R5). The user whose
   * workspace projection + memory bank the agent turn resolves — the
   * automation's `run_as_user_id` (defaults to the creator; U3). This is
   * DISTINCT from `actorType`/`actorId`, which record the TRIGGER actor (who
   * fired this dispatch — the scheduler=system, or the manual triggerer) and
   * stay on the run row. When null the run has no injected identity: the
   * wakeup is a system actor and no CURRENT_USER_ID is plumbed. Both dispatch
   * call sites resolve this as `loop.run_as_user_id ?? null`.
   */
  runAsUserId?: string | null;
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
  /**
   * Untrusted-data fence block appended to an agent_thread automation's turn
   * instructions (THINK-137 U6, R7). Built by `fenceWebhookPayload` from the
   * raw webhook body; `buildAgentLoopWakeupPayload` appends it to `message`.
   * The body is NEVER interpolated anywhere else. Null for non-webhook
   * triggers and for routine/workflow targets (they take `routineInputOverride`
   * instead).
   */
  appendedInstructions?: string | null;
  /**
   * Per-dispatch routine input override (THINK-137 U6, R7): the raw inbound
   * webhook body wired as the routine/workflow run input. `continueAgentLoopDispatch`
   * merges it into each routine action's `input` WITHOUT mutating the stored
   * target_spec. Null for non-webhook triggers and agent_thread targets.
   */
  routineInputOverride?: Record<string, unknown> | null;
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
    /**
     * Per-Sender Context Injection identity (THINK-137 U5, R5). The run-as
     * user carried onto the payload for both the initial AND resume turns so
     * the identity is durable/inspectable. Injection into the AgentCore
     * envelope's `scope.user_id` actually rides the wakeup row's
     * `requested_by_actor_*` columns (which wakeup-processor maps to
     * `invokerUserId` → `user_id`); this field is the parity-visible copy.
     * Null when the automation has no run-as identity (system-actor run).
     */
    runAsUserId?: string | null;
    completionCriteria: string[];
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
  /**
   * Loads the tenant a user belongs to, for the run-as tenant-membership
   * cross-check (THINK-137 U5, R5). Returns null when the user does not exist.
   * Optional: the gate is inert (no cross-check, run-as still injected) unless
   * the ledger implements it — but the shared DB ledger always does, so both
   * dispatch call sites get the hard rejection. Mirrors
   * `startSkillRunService`'s `invoker.tenant_id !== tenantId` check (KTD3), NOT
   * `resolveCaller` widening.
   */
  loadUserTenantId?(input: { userId: string }): Promise<string | null>;
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
  /**
   * Counts the loop's non-terminal (queued/running/waiting_for_human) runs,
   * for the R11 `maxConcurrentRuns` guard (THINK-137 U4). Optional: the gate
   * only enforces concurrency when the ledger provides this AND the target
   * carries the guard. The run about to be created is NOT counted.
   */
  countActiveRuns?(input: {
    tenantId: string;
    agentLoopId: string;
  }): Promise<number>;
  /**
   * Sums `agent_loop_runs.total_cost_usd_cents` for the loop in the current
   * calendar month, for the R11 `monthlyCostCapUsd` guard (THINK-137 U4).
   * Optional + WIRED-BUT-INERT: runs record no cost yet, so this returns 0
   * in practice and the cap never trips until cost accounting lands.
   */
  sumMonthlyCostCents?(input: {
    tenantId: string;
    agentLoopId: string;
    monthStart: Date;
  }): Promise<number>;
  /**
   * Raises (or updates) a deduplicated inbox item for a headless-run failure
   * (THINK-137 U4, R10). Dedup scope is one OPEN item per automation: repeat
   * failures update the existing pending item (incrementing failureCount +
   * lastFailureAt); a new item is raised only after the prior one is
   * resolved/acknowledged. Optional in the interface, always implemented by
   * the shared DB ledger so both dispatch call sites get it.
   */
  raiseHeadlessFailureItem?(input: {
    tenantId: string;
    agentLoopId: string;
    loopName?: string | null;
    runId: string;
    errorCode: string;
    errorMessage: string;
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
  /** Per-Sender Context Injection identity (THINK-137 U5, R5). Carried
   * IDENTICALLY on the initial ("start") and resume payloads. */
  runAsUserId?: string | null;
}): AgentLoopWakeupPayload {
  const tokenBudget =
    input.version.loopPolicy.maxTokens ?? DEFAULT_AGENT_LOOP_GOAL_TOKEN_BUDGET;
  // Untrusted webhook payload (agent_thread targets, R7) is appended to the
  // turn instructions inside the fence. The objective in `goalMode.objective`
  // stays clean — only the message the agent reads carries the fenced block.
  const message = input.trigger.appendedInstructions
    ? `${input.version.goalSpec.objective}\n\n${input.trigger.appendedInstructions}`
    : input.version.goalSpec.objective;
  return {
    message,
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
      runAsUserId: input.runAsUserId ?? null,
      completionCriteria: input.version.goalSpec.completionCriteria,
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
 * path. Loop-policy always comes from the (still-written) legacy column — it is
 * off the product surface (R11) and not carried by target_spec. The judge /
 * evidence / ROI feature was removed in THINK-137 U10.
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
    loopPolicy: row.loop_policy as LoopPolicy,
    routineActionsSpec,
    targetKind: targetSpec.kind,
    guards: targetSpec.guards ?? null,
  };
}

/**
 * Shared thread-decision seam (THINK-137 U4, R4). A dispatch creates an
 * execution Thread ONLY when the target is an `agent_thread` AND a Space has
 * been resolved for it. routine/workflow targets are headless — they run
 * deterministically with no wakeup and no thread. Both dispatch call sites
 * (job-trigger's handleAgentLoopSchedule and the triggerAgentLoopRun mutation)
 * consume this one predicate so the "no Space ⇒ no thread" rule can never
 * drift between them.
 *
 * The caller is responsible for resolving `spaceId` with the correct fallback:
 * agent_thread targets inherit the worker's default Space when no explicit
 * Space is set (they need a home); routine/workflow targets must NOT — a
 * routine/workflow automation with no explicit Space is headless.
 */
export function dispatchNeedsThread(
  version: DispatchableAgentLoopVersion | null | undefined,
  spaceId: string | null | undefined,
): boolean {
  if (!version) return false;
  if (version.targetKind !== "agent_thread") return false;
  return spaceId != null;
}

/**
 * A headless target (routine/workflow) never opens a Thread, so its failures
 * are invisible unless surfaced elsewhere — they become a deduplicated inbox
 * item (THINK-137 U4, R10).
 */
export function isHeadlessTarget(
  version: DispatchableAgentLoopVersion | null | undefined,
): boolean {
  return (
    version?.targetKind === "routine" || version?.targetKind === "workflow"
  );
}
