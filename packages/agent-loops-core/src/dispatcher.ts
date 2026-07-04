import {
  type AgentLoopCreateRunInput,
  type AgentLoopDispatchInput,
  type AgentLoopDispatchLedger,
  type AgentLoopDispatchResult,
  type AgentLoopRunRepairState,
  type AgentLoopRunStatus,
  type DispatchableAgentLoopVersion,
  buildAgentLoopWakeupPayload,
  workerAgentId,
} from "./run-ledger";
import type { RoutineActionResult } from "./contracts";

const MAX_ERROR_LENGTH = 1_000;

export interface DispatchAgentLoopOptions {
  /** When true, stop after the run + iteration rows exist and return
   * status "deferred" — routine actions and the wakeup are executed later
   * by continueAgentLoopDispatch (job-trigger). Used by the manual
   * GraphQL trigger for routine-bearing Automations so graphql-http never
   * invokes the executor inline (KTD-3). */
  deferContinuation?: boolean;
}

export async function dispatchAgentLoop(
  input: AgentLoopDispatchInput,
  ledger: AgentLoopDispatchLedger,
  options?: DispatchAgentLoopOptions,
): Promise<AgentLoopDispatchResult> {
  const now = input.now ?? new Date();
  const idempotencyKey = input.trigger.idempotencyKey?.trim() || null;
  if (idempotencyKey) {
    const existing = await ledger.findRunByIdempotencyKey({
      tenantId: input.tenantId,
      idempotencyKey,
    });
    if (existing) {
      // Recoverable idempotency repair (THINK-137 U2): a matching run whose
      // side-effect set is incomplete — a half-built agent-turn start whose
      // wakeup was never recorded — re-enters the continuation instead of
      // being returned as final. enqueueWakeup does a lookup-or-insert on the
      // per-run idempotency key, so a repair after a crash between the wakeup
      // insert and markIterationWakeup finds the existing wakeup row rather
      // than double-dispatching.
      const repairState = ledger.loadRunRepairState
        ? await ledger.loadRunRepairState({
            tenantId: input.tenantId,
            runId: existing.id,
          })
        : null;
      if (isRepairableHalfBuiltStart(repairState, input.version)) {
        return continueAgentLoopDispatch(
          input,
          {
            runId: existing.id,
            iterationId: repairState!.iterationId!,
            workerAgentId:
              workerAgentId(input.version?.workerSpec) ?? undefined,
          },
          ledger,
        );
      }
      return {
        status: "reused",
        runId: existing.id,
        runStatus: existing.status,
      };
    }
  }

  const startGate = evaluateStartGate(input);
  const run = await ledger.createRun(
    buildRunInput({
      input,
      status: startGate.ok ? "queued" : "skipped",
      currentIteration: 1,
      errorCode: startGate.ok ? null : startGate.code,
      errorMessage: startGate.ok ? null : startGate.reason,
      now,
    }),
  );
  const iteration = await ledger.createIteration({
    tenantId: input.tenantId,
    runId: run.id,
    iterationNumber: 1,
    status: startGate.ok ? "queued" : "skipped",
    goalModeAction: "start",
    inputSummary: input.trigger.inputSummary ?? null,
    errorCode: startGate.ok ? null : startGate.code,
    errorMessage: startGate.ok ? null : startGate.reason,
    now,
  });

  if (startGate.ok === false || !input.version) {
    const reason =
      startGate.ok === false ? startGate.reason : "AgentLoop has no version.";
    await ledger.updateLoopAfterDispatch({
      tenantId: input.tenantId,
      loopId: input.loop.id,
      runId: run.id,
      status: "skipped",
      triggerFamily: input.trigger.family,
      currentIteration: 1,
      summary: {
        reason,
        triggerSource: input.trigger.source,
      },
      now,
    });
    return {
      status: "skipped",
      runId: run.id,
      iterationId: iteration.id,
      reason,
    };
  }

  if (options?.deferContinuation) {
    return { status: "deferred", runId: run.id, iterationId: iteration.id };
  }

  return continueAgentLoopDispatch(
    input,
    {
      runId: run.id,
      iterationId: iteration.id,
      workerAgentId: startGate.workerAgentId,
    },
    ledger,
  );
}

/**
 * The post-creation half of a dispatch: execute routine actions (plan
 * 2026-07-03-004 U5), complete routine-only runs without a wakeup, or
 * enqueue the agent-turn wakeup with the action results injected. One
 * code path for inline dispatch AND the deferred manual-trigger
 * continuation, so the two can never drift.
 */
export async function continueAgentLoopDispatch(
  input: AgentLoopDispatchInput,
  refs: { runId: string; iterationId: string; workerAgentId?: string },
  ledger: AgentLoopDispatchLedger,
): Promise<AgentLoopDispatchResult> {
  const now = input.now ?? new Date();
  if (!input.version) {
    throw new Error("continueAgentLoopDispatch requires a version");
  }
  const agentId =
    refs.workerAgentId ?? workerAgentId(input.version.workerSpec) ?? null;

  // ---- Routine actions run first, serially, at zero token cost ----------
  const actions = input.version.routineActionsSpec?.actions ?? [];
  const agentTurn = input.version.routineActionsSpec?.agentTurn !== false;
  let routineResults: RoutineActionResult[] | null = null;
  if (actions.length > 0) {
    if (!ledger.runRoutineAction) {
      const message =
        "This dispatch path cannot execute routine actions (no runner wired).";
      await ledger.markDispatchFailed({
        tenantId: input.tenantId,
        runId: refs.runId,
        iterationId: refs.iterationId,
        errorCode: "routine_runner_unavailable",
        errorMessage: message,
        now: new Date(),
      });
      await ledger.updateLoopAfterDispatch({
        tenantId: input.tenantId,
        loopId: input.loop.id,
        runId: refs.runId,
        status: "failed",
        triggerFamily: input.trigger.family,
        currentIteration: 1,
        summary: { reason: "routine_runner_unavailable" },
        now: new Date(),
      });
      return {
        status: "failed",
        runId: refs.runId,
        iterationId: refs.iterationId,
        error: message,
      };
    }
    routineResults = [];
    for (const action of actions) {
      try {
        routineResults.push(
          await ledger.runRoutineAction({
            tenantId: input.tenantId,
            runId: refs.runId,
            iterationId: refs.iterationId,
            action,
            now,
          }),
        );
      } catch (error) {
        routineResults.push({
          routineId: action.routineId,
          label: action.label ?? null,
          status: "failed",
          errorClass: "routine_invoke_failed",
          errorMessage: boundedError(error),
        });
      }
    }
    // Persist outcomes on the iteration so the resume-turn payload path
    // re-injects them (payload parity is a known failure mode).
    await ledger.recordRoutineActionResults?.({
      tenantId: input.tenantId,
      runId: refs.runId,
      iterationId: refs.iterationId,
      results: routineResults,
      now,
    });
  }

  // ---- Routine-only Automations complete without a wakeup ----------------
  if (actions.length > 0 && !agentTurn) {
    const results = routineResults ?? [];
    const anyFailed = results.some((r) => r.status !== "succeeded");
    const status: "completed" | "failed" = anyFailed ? "failed" : "completed";
    if (ledger.completeRoutineOnlyRun) {
      await ledger.completeRoutineOnlyRun({
        tenantId: input.tenantId,
        runId: refs.runId,
        iterationId: refs.iterationId,
        status,
        results,
        now,
      });
    } else {
      await ledger.markDispatchFailed({
        tenantId: input.tenantId,
        runId: refs.runId,
        iterationId: refs.iterationId,
        errorCode: "routine_only_completion_unavailable",
        errorMessage:
          "Ledger cannot complete a routine-only run (no completion wired).",
        now: new Date(),
      });
    }
    await ledger.updateLoopAfterDispatch({
      tenantId: input.tenantId,
      loopId: input.loop.id,
      runId: refs.runId,
      status,
      triggerFamily: input.trigger.family,
      currentIteration: 1,
      summary: {
        triggerSource: input.trigger.source,
        routineActions: {
          total: results.length,
          failed: results.filter((r) => r.status !== "succeeded").length,
        },
      },
      now,
    });
    return {
      status: anyFailed ? "failed" : "completed_routine_only",
      runId: refs.runId,
      iterationId: refs.iterationId,
      ...(anyFailed
        ? { error: "one or more routine actions failed" }
        : { routineActionResults: results }),
    } as AgentLoopDispatchResult;
  }

  if (!agentId) {
    const message = "AgentLoop v1 requires a worker agent.";
    await ledger.markDispatchFailed({
      tenantId: input.tenantId,
      runId: refs.runId,
      iterationId: refs.iterationId,
      errorCode: "worker_agent_missing",
      errorMessage: message,
      now: new Date(),
    });
    return {
      status: "failed",
      runId: refs.runId,
      iterationId: refs.iterationId,
      error: message,
    };
  }

  try {
    const payload = buildAgentLoopWakeupPayload({
      loop: input.loop,
      version: input.version,
      trigger: input.trigger,
      runId: refs.runId,
      iterationId: refs.iterationId,
      routineActionResults: routineResults,
    });
    const wakeup = await ledger.enqueueWakeup({
      tenantId: input.tenantId,
      agentId,
      source: "agent_loop",
      triggerDetail: `agent_loop:${input.loop.id}:${input.trigger.source}`,
      reason: input.version.goalSpec.objective,
      payload,
      idempotencyKey: `agent-loop:${refs.runId}:iteration:1`,
      requestedByActorType: input.trigger.actorType ?? null,
      requestedByActorId: input.trigger.actorId ?? null,
      now,
    });
    await ledger.markIterationWakeup({
      tenantId: input.tenantId,
      iterationId: refs.iterationId,
      wakeupId: wakeup.id,
      now,
    });
    await ledger.updateLoopAfterDispatch({
      tenantId: input.tenantId,
      loopId: input.loop.id,
      runId: refs.runId,
      status: "queued",
      triggerFamily: input.trigger.family,
      currentIteration: 1,
      summary: {
        triggerSource: input.trigger.source,
        wakeupId: wakeup.id,
        ...(routineResults
          ? {
              routineActions: {
                total: routineResults.length,
                failed: routineResults.filter((r) => r.status !== "succeeded")
                  .length,
              },
            }
          : {}),
      },
      now,
    });
    return {
      status: "queued",
      runId: refs.runId,
      iterationId: refs.iterationId,
      wakeupId: wakeup.id,
    };
  } catch (error) {
    const message = boundedError(error);
    await ledger.markDispatchFailed({
      tenantId: input.tenantId,
      runId: refs.runId,
      iterationId: refs.iterationId,
      errorCode: "wakeup_enqueue_failed",
      errorMessage: message,
      now: new Date(),
    });
    await ledger.updateLoopAfterDispatch({
      tenantId: input.tenantId,
      loopId: input.loop.id,
      runId: refs.runId,
      status: "failed",
      triggerFamily: input.trigger.family,
      currentIteration: 1,
      summary: {
        reason: "wakeup_enqueue_failed",
        error: message,
      },
      now: new Date(),
    });
    return {
      status: "failed",
      runId: refs.runId,
      iterationId: refs.iterationId,
      error: message,
    };
  }
}

/**
 * Reuse-vs-repair predicate (THINK-137 U2). A run found by idempotency key
 * is REPAIRED (its continuation re-entered) rather than reused only when it
 * is a half-built agent-turn start:
 *
 *   - the run is still `queued` (terminal/skipped runs are final), and
 *   - its first iteration never recorded a wakeup id, and
 *   - the version resolves to an agent-turn dispatch.
 *
 * Routine-only versions (`agentTurn: false`) legitimately complete without a
 * wakeup, so a `queued` + no-wakeup routine-only run is ambiguous, not
 * half-built — those are never auto-repaired here (the executor owns their
 * repair). Absence of routine actions => `agentTurn !== false` => agent turn.
 */
export function isRepairableHalfBuiltStart(
  repairState: AgentLoopRunRepairState | null,
  version: DispatchableAgentLoopVersion | null,
): boolean {
  if (!version) return false;
  if (!repairState || !repairState.iterationId) return false;
  if (repairState.status !== "queued") return false;
  if (repairState.hasWakeup) return false;
  const agentTurn = version.routineActionsSpec?.agentTurn !== false;
  return agentTurn;
}

function evaluateStartGate(
  input: AgentLoopDispatchInput,
):
  | { ok: true; workerAgentId: string }
  | { ok: false; code: string; reason: string } {
  if (!input.loop.enabled) {
    return {
      ok: false,
      code: "agent_loop_disabled",
      reason: "AgentLoop is disabled.",
    };
  }
  if (input.loop.lifecycleStatus !== "active") {
    return {
      ok: false,
      code: "agent_loop_not_active",
      reason: `AgentLoop lifecycle is ${input.loop.lifecycleStatus}.`,
    };
  }
  if (input.scheduleGate?.enabled === false) {
    return {
      ok: false,
      code: "schedule_disabled",
      reason: "AgentLoop schedule is disabled.",
    };
  }
  if (input.scheduleGate?.budgetPaused) {
    return {
      ok: false,
      code: "schedule_budget_paused",
      reason:
        input.scheduleGate.reason ??
        "AgentLoop schedule is paused because its budget is exhausted.",
    };
  }
  if (!input.version) {
    return {
      ok: false,
      code: "agent_loop_version_missing",
      reason: "AgentLoop has no active version.",
    };
  }
  if (input.version.versionStatus !== "active") {
    return {
      ok: false,
      code: "agent_loop_version_inactive",
      reason: `AgentLoop version is ${input.version.versionStatus}.`,
    };
  }
  if (input.version.loopPolicy.maxIterations < 1) {
    return {
      ok: false,
      code: "max_iterations_exhausted",
      reason: "AgentLoop policy allows no iterations.",
    };
  }
  const agentId = workerAgentId(input.version.workerSpec);
  if (!agentId) {
    return {
      ok: false,
      code: "worker_agent_missing",
      reason: "AgentLoop v1 requires a worker agent.",
    };
  }
  return { ok: true, workerAgentId: agentId };
}

function buildRunInput(args: {
  input: AgentLoopDispatchInput;
  status: AgentLoopRunStatus;
  currentIteration: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  now: Date;
}): AgentLoopCreateRunInput {
  const { input, now } = args;
  return {
    tenantId: input.tenantId,
    agentLoopId: input.loop.id,
    agentLoopVersionId: input.version?.id ?? null,
    status: args.status,
    triggerFamily: input.trigger.family,
    triggerSource: input.trigger.source,
    scheduledJobId: input.trigger.scheduledJobId ?? null,
    actorType: input.trigger.actorType ?? null,
    actorId: input.trigger.actorId ?? null,
    idempotencyKey: input.trigger.idempotencyKey ?? null,
    correlationId:
      input.trigger.correlationId ??
      input.trigger.idempotencyKey ??
      `agent-loop:${input.loop.id}:${now.getTime()}`,
    currentIteration: args.currentIteration,
    policySnapshot: input.version?.loopPolicy ?? {},
    inputSummary: input.trigger.inputSummary ?? null,
    errorCode: args.errorCode ?? null,
    errorMessage: args.errorMessage ?? null,
    now,
  };
}

function boundedError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, MAX_ERROR_LENGTH);
}
