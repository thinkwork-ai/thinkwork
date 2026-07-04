import { beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchAgentLoop, isRepairableHalfBuiltStart } from "./dispatcher";
import type {
  AgentLoopCreateIterationInput,
  AgentLoopCreateRunInput,
  AgentLoopDispatchInput,
  AgentLoopDispatchLedger,
  AgentLoopEnqueueWakeupInput,
} from "./run-ledger";

const baseInput = (
  overrides: Partial<AgentLoopDispatchInput> = {},
): AgentLoopDispatchInput => ({
  tenantId: "tenant-1",
  loop: {
    id: "loop-1",
    tenantId: "tenant-1",
    name: "Daily research",
    enabled: true,
    lifecycleStatus: "active",
  },
  version: {
    id: "version-1",
    versionStatus: "active",
    goalSpec: {
      objective: "Prepare the daily research brief.",
      completionCriteria: ["A useful brief exists."],
    },
    workerSpec: {
      type: "agent",
      id: "agent-1",
      toolHints: [],
      config: {},
    },
    judgeSpec: {
      mode: "self_check",
      criteria: ["Useful enough to send."],
      config: {},
    },
    loopPolicy: {
      maxIterations: 2,
      maxTokens: 12_000,
      failBehavior: "return_blocker",
      escalateOnFailure: false,
    },
  },
  trigger: {
    family: "manual",
    source: "manual_run",
    actorType: "user",
    actorId: "user-1",
    idempotencyKey: "manual:1",
    inputSummary: { reason: "operator-test" },
  },
  now: new Date("2026-06-22T12:00:00Z"),
  ...overrides,
});

function fakeLedger(): AgentLoopDispatchLedger & {
  runs: AgentLoopCreateRunInput[];
  iterations: AgentLoopCreateIterationInput[];
  wakeups: AgentLoopEnqueueWakeupInput[];
} {
  const ledger = {
    runs: [] as AgentLoopCreateRunInput[],
    iterations: [] as AgentLoopCreateIterationInput[],
    wakeups: [] as AgentLoopEnqueueWakeupInput[],
    findRunByIdempotencyKey: vi.fn().mockResolvedValue(null),
    createRun: vi.fn(async (input: AgentLoopCreateRunInput) => {
      ledger.runs.push(input);
      return { id: "run-1", status: input.status };
    }),
    createIteration: vi.fn(async (input: AgentLoopCreateIterationInput) => {
      ledger.iterations.push(input);
      return { id: "iteration-1" };
    }),
    enqueueWakeup: vi.fn(async (input: AgentLoopEnqueueWakeupInput) => {
      ledger.wakeups.push(input);
      return { id: "wakeup-1" };
    }),
    markIterationWakeup: vi.fn(),
    markDispatchFailed: vi.fn(),
    updateLoopAfterDispatch: vi.fn(),
  };
  return ledger;
}

describe("dispatchAgentLoop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a queued run, first iteration, and worker wakeup with goal mode", async () => {
    const ledger = fakeLedger();

    const result = await dispatchAgentLoop(baseInput(), ledger);

    expect(result).toEqual({
      status: "queued",
      runId: "run-1",
      iterationId: "iteration-1",
      wakeupId: "wakeup-1",
    });
    expect(ledger.runs[0]).toMatchObject({
      tenantId: "tenant-1",
      agentLoopId: "loop-1",
      agentLoopVersionId: "version-1",
      status: "queued",
      triggerFamily: "manual",
      triggerSource: "manual_run",
      actorType: "user",
      actorId: "user-1",
      idempotencyKey: "manual:1",
      currentIteration: 1,
      inputSummary: { reason: "operator-test" },
    });
    expect(ledger.iterations[0]).toMatchObject({
      tenantId: "tenant-1",
      runId: "run-1",
      iterationNumber: 1,
      status: "queued",
      goalModeAction: "start",
    });
    expect(ledger.wakeups[0]).toMatchObject({
      tenantId: "tenant-1",
      agentId: "agent-1",
      source: "agent_loop",
      idempotencyKey: "agent-loop:run-1:iteration:1",
      payload: {
        message: "Prepare the daily research brief.",
        inputSummary: { reason: "operator-test" },
        goalMode: {
          enabled: true,
          action: "start",
          objective: "Prepare the daily research brief.",
          goalRunId: "run-1",
          resolvedBudget: { tokenBudget: 12_000 },
        },
        agentLoop: {
          loopId: "loop-1",
          runId: "run-1",
          iterationId: "iteration-1",
          versionId: "version-1",
          completionCriteria: ["A useful brief exists."],
          judgeMode: "self_check",
        },
      },
    });
    expect(ledger.markIterationWakeup).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      iterationId: "iteration-1",
      wakeupId: "wakeup-1",
      now: new Date("2026-06-22T12:00:00Z"),
    });
  });

  it("carries resolved Thread and Space context into the wakeup payload", async () => {
    const ledger = fakeLedger();

    await dispatchAgentLoop(
      baseInput({
        trigger: {
          ...baseInput().trigger,
          threadId: "thread-1",
          spaceId: "space-1",
        },
      }),
      ledger,
    );

    expect(ledger.wakeups[0]?.payload).toMatchObject({
      threadId: "thread-1",
      spaceId: "space-1",
    });
  });

  it("reuses an existing run for duplicate idempotency keys", async () => {
    const ledger = fakeLedger();
    vi.mocked(ledger.findRunByIdempotencyKey).mockResolvedValueOnce({
      id: "run-existing",
      status: "queued",
    });

    await expect(dispatchAgentLoop(baseInput(), ledger)).resolves.toEqual({
      status: "reused",
      runId: "run-existing",
      runStatus: "queued",
    });
    expect(ledger.createRun).not.toHaveBeenCalled();
    expect(ledger.enqueueWakeup).not.toHaveBeenCalled();
  });

  it("records a skipped run when a scheduled loop is budget paused", async () => {
    const ledger = fakeLedger();
    const input = baseInput();
    input.trigger = {
      ...input.trigger,
      family: "schedule",
      source: "agent_loop_schedule",
      scheduledJobId: "job-1",
    };
    input.scheduleGate = {
      enabled: true,
      budgetPaused: true,
      reason: "User budget exceeded.",
    };

    const result = await dispatchAgentLoop(input, ledger);

    expect(result).toEqual({
      status: "skipped",
      runId: "run-1",
      iterationId: "iteration-1",
      reason: "User budget exceeded.",
    });
    expect(ledger.runs[0]).toMatchObject({
      status: "skipped",
      triggerFamily: "schedule",
      scheduledJobId: "job-1",
      errorCode: "schedule_budget_paused",
      errorMessage: "User budget exceeded.",
    });
    expect(ledger.iterations[0]).toMatchObject({
      status: "skipped",
      errorCode: "schedule_budget_paused",
    });
    expect(ledger.enqueueWakeup).not.toHaveBeenCalled();
  });

  it("marks the run failed when wakeup enqueue fails", async () => {
    const ledger = fakeLedger();
    vi.mocked(ledger.enqueueWakeup).mockRejectedValueOnce(new Error("boom"));

    const result = await dispatchAgentLoop(baseInput(), ledger);

    expect(result).toEqual({
      status: "failed",
      runId: "run-1",
      iterationId: "iteration-1",
      error: "boom",
    });
    expect(ledger.markDispatchFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        runId: "run-1",
        iterationId: "iteration-1",
        errorCode: "wakeup_enqueue_failed",
        errorMessage: "boom",
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Deterministic routine actions (plan 2026-07-03-004 U5)
// ---------------------------------------------------------------------------

import { continueAgentLoopDispatch } from "./dispatcher";
import type { RoutineActionResult } from "./contracts";

function routineVersion(overrides: Record<string, unknown> = {}) {
  const base = baseInput().version!;
  return {
    ...base,
    routineActionsSpec: {
      actions: [
        {
          routineId: "33333333-3333-4333-8333-333333333333",
          label: "LastMile check",
        },
      ],
      agentTurn: true,
      ...overrides,
    },
  };
}

function okRoutineResult(): RoutineActionResult {
  return {
    routineId: "33333333-3333-4333-8333-333333333333",
    label: "LastMile check",
    status: "succeeded",
    executionId: "exec-1",
    commitSha: "abc123",
    outputJson: { late: 2 },
  };
}

describe("dispatchAgentLoop routine actions", () => {
  it("executes routine actions before the agent turn and injects results into the wakeup payload", async () => {
    const ledger = fakeLedger();
    const runRoutineAction = vi.fn(async () => okRoutineResult());
    const recordRoutineActionResults = vi.fn();
    Object.assign(ledger, { runRoutineAction, recordRoutineActionResults });

    const result = await dispatchAgentLoop(
      baseInput({ version: routineVersion() }),
      ledger,
    );

    expect(result.status).toBe("queued");
    expect(runRoutineAction).toHaveBeenCalledTimes(1);
    expect(recordRoutineActionResults).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        iterationId: "iteration-1",
        results: [okRoutineResult()],
      }),
    );
    expect(ledger.wakeups[0].payload.agentLoop.routineActionResults).toEqual([
      okRoutineResult(),
    ]);
  });

  it("completes a routine-only run with zero wakeups (AE1)", async () => {
    const ledger = fakeLedger();
    const runRoutineAction = vi.fn(async () => okRoutineResult());
    const completeRoutineOnlyRun = vi.fn();
    Object.assign(ledger, { runRoutineAction, completeRoutineOnlyRun });

    const result = await dispatchAgentLoop(
      baseInput({ version: routineVersion({ agentTurn: false }) }),
      ledger,
    );

    expect(result.status).toBe("completed_routine_only");
    expect(ledger.wakeups).toHaveLength(0);
    expect(completeRoutineOnlyRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed" }),
    );
    expect(ledger.updateLoopAfterDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed" }),
    );
  });

  it("marks a routine-only run failed when an action fails — no wakeup, repair is the executor's move", async () => {
    const ledger = fakeLedger();
    const runRoutineAction = vi.fn(async () => ({
      ...okRoutineResult(),
      status: "failed" as const,
      errorClass: "code_run_failed",
    }));
    const completeRoutineOnlyRun = vi.fn();
    Object.assign(ledger, { runRoutineAction, completeRoutineOnlyRun });

    const result = await dispatchAgentLoop(
      baseInput({ version: routineVersion({ agentTurn: false }) }),
      ledger,
    );

    expect(result.status).toBe("failed");
    expect(ledger.wakeups).toHaveLength(0);
    expect(completeRoutineOnlyRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("converts a runner throw into a failed action result instead of losing the run", async () => {
    const ledger = fakeLedger();
    const runRoutineAction = vi.fn(async () => {
      throw new Error("lambda timed out");
    });
    Object.assign(ledger, { runRoutineAction });

    const result = await dispatchAgentLoop(
      baseInput({ version: routineVersion() }),
      ledger,
    );

    expect(result.status).toBe("queued");
    const injected = ledger.wakeups[0].payload.agentLoop.routineActionResults;
    expect(injected?.[0]).toMatchObject({
      status: "failed",
      errorClass: "routine_invoke_failed",
    });
  });

  it("fails the dispatch when actions exist but the ledger has no runner (KTD-3 misconfiguration)", async () => {
    const ledger = fakeLedger();

    const result = await dispatchAgentLoop(
      baseInput({ version: routineVersion() }),
      ledger,
    );

    expect(result.status).toBe("failed");
    expect(ledger.markDispatchFailed).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "routine_runner_unavailable" }),
    );
    expect(ledger.wakeups).toHaveLength(0);
  });

  it("defers the continuation when requested and continues later through the same code path", async () => {
    const ledger = fakeLedger();
    const runRoutineAction = vi.fn(async () => okRoutineResult());
    Object.assign(ledger, { runRoutineAction });

    const deferred = await dispatchAgentLoop(
      baseInput({ version: routineVersion() }),
      ledger,
      { deferContinuation: true },
    );
    expect(deferred).toEqual({
      status: "deferred",
      runId: "run-1",
      iterationId: "iteration-1",
    });
    expect(runRoutineAction).not.toHaveBeenCalled();
    expect(ledger.wakeups).toHaveLength(0);

    const continued = await continueAgentLoopDispatch(
      baseInput({ version: routineVersion() }),
      { runId: "run-1", iterationId: "iteration-1" },
      ledger,
    );
    expect(continued.status).toBe("queued");
    expect(runRoutineAction).toHaveBeenCalledTimes(1);
    expect(ledger.wakeups[0].payload.agentLoop.routineActionResults).toEqual([
      okRoutineResult(),
    ]);
  });

  it("leaves Automations without routine actions untouched (runtime preserved)", async () => {
    const ledger = fakeLedger();
    const result = await dispatchAgentLoop(baseInput(), ledger);
    expect(result.status).toBe("queued");
    expect(ledger.wakeups[0].payload.agentLoop.routineActionResults).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Recoverable idempotency repair (THINK-137 U2)
// ---------------------------------------------------------------------------

describe("isRepairableHalfBuiltStart", () => {
  const version = baseInput().version!;

  it("repairs a queued agent-turn start whose iteration has no wakeup", () => {
    expect(
      isRepairableHalfBuiltStart(
        { status: "queued", iterationId: "iter-1", hasWakeup: false },
        version,
      ),
    ).toBe(true);
  });

  it("does not repair once the iteration recorded a wakeup (reused)", () => {
    expect(
      isRepairableHalfBuiltStart(
        { status: "queued", iterationId: "iter-1", hasWakeup: true },
        version,
      ),
    ).toBe(false);
  });

  it("does not repair a terminal run", () => {
    expect(
      isRepairableHalfBuiltStart(
        { status: "completed", iterationId: "iter-1", hasWakeup: false },
        version,
      ),
    ).toBe(false);
  });

  it("does not repair a routine-only version — a queued+no-wakeup routine-only run is ambiguous, not half-built", () => {
    const routineOnly = {
      ...version,
      routineActionsSpec: {
        actions: [{ routineId: "33333333-3333-4333-8333-333333333333" }],
        agentTurn: false,
      },
    };
    expect(
      isRepairableHalfBuiltStart(
        { status: "queued", iterationId: "iter-1", hasWakeup: false },
        routineOnly,
      ),
    ).toBe(false);
  });

  it("repairs a mixed (agentTurn:true) version and a null repair-state is never repaired", () => {
    const mixed = {
      ...version,
      routineActionsSpec: {
        actions: [{ routineId: "33333333-3333-4333-8333-333333333333" }],
        agentTurn: true,
      },
    };
    expect(
      isRepairableHalfBuiltStart(
        { status: "queued", iterationId: "iter-1", hasWakeup: false },
        mixed,
      ),
    ).toBe(true);
    expect(isRepairableHalfBuiltStart(null, version)).toBe(false);
    expect(
      isRepairableHalfBuiltStart(
        { status: "queued", iterationId: null, hasWakeup: false },
        version,
      ),
    ).toBe(false);
  });
});

describe("dispatchAgentLoop idempotency repair", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the existing run as reused when its wakeup was already recorded (scenario 2)", async () => {
    const ledger = fakeLedger();
    vi.mocked(ledger.findRunByIdempotencyKey).mockResolvedValueOnce({
      id: "run-existing",
      status: "queued",
    });
    const loadRunRepairState = vi.fn().mockResolvedValue({
      status: "queued",
      iterationId: "iter-existing",
      hasWakeup: true,
    });
    Object.assign(ledger, { loadRunRepairState });

    const result = await dispatchAgentLoop(baseInput(), ledger);

    expect(result).toEqual({
      status: "reused",
      runId: "run-existing",
      runStatus: "queued",
    });
    expect(ledger.createRun).not.toHaveBeenCalled();
    expect(ledger.enqueueWakeup).not.toHaveBeenCalled();
  });

  it("repairs a half-built start on retry instead of reusing it (scenario 3)", async () => {
    const ledger = fakeLedger();
    vi.mocked(ledger.findRunByIdempotencyKey).mockResolvedValueOnce({
      id: "run-existing",
      status: "queued",
    });
    const loadRunRepairState = vi.fn().mockResolvedValue({
      status: "queued",
      iterationId: "iter-existing",
      hasWakeup: false,
    });
    Object.assign(ledger, { loadRunRepairState });

    const result = await dispatchAgentLoop(baseInput(), ledger);

    // Re-enters the continuation on the EXISTING run/iteration — no new run.
    expect(ledger.createRun).not.toHaveBeenCalled();
    expect(ledger.createIteration).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: "queued",
      runId: "run-existing",
      iterationId: "iter-existing",
      wakeupId: "wakeup-1",
    });
    expect(ledger.enqueueWakeup).toHaveBeenCalledTimes(1);
    expect(ledger.enqueueWakeup).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "agent-loop:run-existing:iteration:1",
      }),
    );
    expect(ledger.markIterationWakeup).toHaveBeenCalledWith(
      expect.objectContaining({
        iterationId: "iter-existing",
        wakeupId: "wakeup-1",
      }),
    );
  });

  it("records the pre-existing wakeup on the iteration without a second enqueue when the ledger returns it (scenario 4)", async () => {
    // The ledger's enqueueWakeup does lookup-or-insert on the per-run key, so
    // on repair it returns the ALREADY-inserted wakeup row. The dispatcher
    // still records it on the iteration — exactly one enqueue call, no double
    // dispatch.
    const ledger = fakeLedger();
    vi.mocked(ledger.findRunByIdempotencyKey).mockResolvedValueOnce({
      id: "run-existing",
      status: "queued",
    });
    Object.assign(ledger, {
      loadRunRepairState: vi.fn().mockResolvedValue({
        status: "queued",
        iterationId: "iter-existing",
        hasWakeup: false,
      }),
      // Simulate lookup-or-insert returning the pre-existing wakeup row.
      enqueueWakeup: vi.fn(async () => ({ id: "wakeup-preexisting" })),
    });

    const result = await dispatchAgentLoop(baseInput(), ledger);

    expect(result).toMatchObject({
      status: "queued",
      wakeupId: "wakeup-preexisting",
    });
    expect(ledger.enqueueWakeup).toHaveBeenCalledTimes(1);
    expect(ledger.markIterationWakeup).toHaveBeenCalledWith(
      expect.objectContaining({
        iterationId: "iter-existing",
        wakeupId: "wakeup-preexisting",
      }),
    );
  });

  it("still reuses (no repair) when the ledger lacks loadRunRepairState — legacy fake ledgers unaffected", async () => {
    const ledger = fakeLedger();
    vi.mocked(ledger.findRunByIdempotencyKey).mockResolvedValueOnce({
      id: "run-existing",
      status: "queued",
    });

    const result = await dispatchAgentLoop(baseInput(), ledger);

    expect(result).toEqual({
      status: "reused",
      runId: "run-existing",
      runStatus: "queued",
    });
    expect(ledger.enqueueWakeup).not.toHaveBeenCalled();
  });
});
