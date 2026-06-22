import {
  type AgentLoopCreateRunInput,
  type AgentLoopDispatchInput,
  type AgentLoopDispatchLedger,
  type AgentLoopDispatchResult,
  type AgentLoopRunStatus,
  buildAgentLoopWakeupPayload,
  workerAgentId,
} from "./run-ledger";

const MAX_ERROR_LENGTH = 1_000;

export async function dispatchAgentLoop(
  input: AgentLoopDispatchInput,
  ledger: AgentLoopDispatchLedger,
): Promise<AgentLoopDispatchResult> {
  const now = input.now ?? new Date();
  const idempotencyKey = input.trigger.idempotencyKey?.trim() || null;
  if (idempotencyKey) {
    const existing = await ledger.findRunByIdempotencyKey({
      tenantId: input.tenantId,
      idempotencyKey,
    });
    if (existing) {
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

  try {
    const payload = buildAgentLoopWakeupPayload({
      loop: input.loop,
      version: input.version,
      trigger: input.trigger,
      runId: run.id,
      iterationId: iteration.id,
    });
    const wakeup = await ledger.enqueueWakeup({
      tenantId: input.tenantId,
      agentId: startGate.workerAgentId,
      source: "agent_loop",
      triggerDetail: `agent_loop:${input.loop.id}:${input.trigger.source}`,
      reason: input.version.goalSpec.objective,
      payload,
      idempotencyKey: `agent-loop:${run.id}:iteration:1`,
      requestedByActorType: input.trigger.actorType ?? null,
      requestedByActorId: input.trigger.actorId ?? null,
      now,
    });
    await ledger.markIterationWakeup({
      tenantId: input.tenantId,
      iterationId: iteration.id,
      wakeupId: wakeup.id,
      now,
    });
    await ledger.updateLoopAfterDispatch({
      tenantId: input.tenantId,
      loopId: input.loop.id,
      runId: run.id,
      status: "queued",
      triggerFamily: input.trigger.family,
      currentIteration: 1,
      summary: {
        triggerSource: input.trigger.source,
        wakeupId: wakeup.id,
      },
      now,
    });
    return {
      status: "queued",
      runId: run.id,
      iterationId: iteration.id,
      wakeupId: wakeup.id,
    };
  } catch (error) {
    const message = boundedError(error);
    await ledger.markDispatchFailed({
      tenantId: input.tenantId,
      runId: run.id,
      iterationId: iteration.id,
      errorCode: "wakeup_enqueue_failed",
      errorMessage: message,
      now: new Date(),
    });
    await ledger.updateLoopAfterDispatch({
      tenantId: input.tenantId,
      loopId: input.loop.id,
      runId: run.id,
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
      runId: run.id,
      iterationId: iteration.id,
      error: message,
    };
  }
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
