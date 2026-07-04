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
    targetKind: "agent_thread",
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

  it("carries webhook delivery metadata + run-as actor into the wakeup payload for webhook triggers (R16, KTD4)", async () => {
    const ledger = fakeLedger();
    ledger.loadUserTenantId = async () => "tenant-1";

    await dispatchAgentLoop(
      baseInput({
        trigger: {
          family: "webhook",
          source: "webhook:lastmile",
          actorType: "user",
          actorId: "operator-9",
          runAsUserId: "run-as-user-1",
          idempotencyKey: "webhook:evt-1",
          webhookDelivery: {
            source: "lastmile",
            eventId: "evt-1",
            payloadPointer: "s3://deliveries/evt-1.json",
          },
        },
      }),
      ledger,
    );

    // Single seam: the delivery block rides the agentLoop payload built by
    // buildAgentLoopWakeupPayload (shared by start + deferred continuation +
    // repair), and the run-as actor is threaded onto the enqueue request.
    expect(ledger.wakeups[0]).toMatchObject({
      requestedByActorType: "user",
      requestedByActorId: "run-as-user-1",
      payload: {
        agentLoop: {
          triggerFamily: "webhook",
          triggerSource: "webhook:lastmile",
          webhookDelivery: {
            source: "lastmile",
            eventId: "evt-1",
            payloadPointer: "s3://deliveries/evt-1.json",
          },
        },
      },
    });
  });

  it("leaves webhookDelivery null on the wakeup payload for non-webhook triggers (inert)", async () => {
    const ledger = fakeLedger();
    await dispatchAgentLoop(baseInput(), ledger);
    expect(ledger.wakeups[0].payload.agentLoop.webhookDelivery).toBeNull();
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
// R11 run guards + headless-failure inbox (THINK-137 U4)
// ---------------------------------------------------------------------------

import { dispatchNeedsThread, isHeadlessTarget } from "./run-ledger";

function headlessRoutineVersion() {
  return resolveDispatchableVersion({
    id: "version-1",
    version_status: "active",
    goal_spec: { objective: "", completionCriteria: [] },
    worker_spec: { type: "agent", id: "agent-1", toolHints: [], config: {} },
    judge_spec: { mode: "self_check", criteria: [], config: {} },
    loop_policy: {
      maxIterations: 1,
      failBehavior: "return_blocker",
      escalateOnFailure: false,
    },
    target_spec: {
      kind: "routine",
      routine: { routineId: ROUTINE_ID, label: "LastMile check" },
    },
  });
}

describe("dispatchNeedsThread (shared no-Space ⇒ no-thread seam)", () => {
  const agentThread = baseInput().version!;
  const routine = headlessRoutineVersion();

  it("agent_thread WITH a resolved Space needs a thread", () => {
    expect(dispatchNeedsThread(agentThread, "space-1")).toBe(true);
  });
  it("agent_thread WITHOUT a resolved Space does not (headless)", () => {
    expect(dispatchNeedsThread(agentThread, null)).toBe(false);
  });
  it("routine/workflow target never needs a thread, even with a Space", () => {
    expect(dispatchNeedsThread(routine, "space-1")).toBe(false);
    expect(dispatchNeedsThread(routine, null)).toBe(false);
  });
  it("isHeadlessTarget is true only for routine/workflow", () => {
    expect(isHeadlessTarget(routine)).toBe(true);
    expect(isHeadlessTarget(agentThread)).toBe(false);
  });
});

describe("R11 run guards at the start gate", () => {
  it("skips with max_concurrent_runs when the active-run count is at the cap", async () => {
    const ledger = fakeLedger();
    const countActiveRuns = vi.fn(async () => 3);
    Object.assign(ledger, { countActiveRuns });
    const version = { ...baseInput().version!, guards: { maxConcurrentRuns: 3 } };

    const result = await dispatchAgentLoop(baseInput({ version }), ledger);

    expect(result).toMatchObject({ status: "skipped" });
    expect(ledger.runs[0]).toMatchObject({
      status: "skipped",
      errorCode: "max_concurrent_runs",
    });
    expect(ledger.iterations[0]).toMatchObject({
      status: "skipped",
      errorCode: "max_concurrent_runs",
    });
    expect(ledger.enqueueWakeup).not.toHaveBeenCalled();
    expect(ledger.updateLoopAfterDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ status: "skipped" }),
    );
  });

  it("dispatches normally when the active-run count is under the cap", async () => {
    const ledger = fakeLedger();
    const countActiveRuns = vi.fn(async () => 1);
    Object.assign(ledger, { countActiveRuns });
    const version = { ...baseInput().version!, guards: { maxConcurrentRuns: 3 } };

    const result = await dispatchAgentLoop(baseInput({ version }), ledger);

    expect(result.status).toBe("queued");
  });

  it("skips with monthly_cost_cap when the month sum is at or over the cap", async () => {
    const ledger = fakeLedger();
    // Cap $10 → 1000 cents; ledger reports 1200 cents already spent.
    const sumMonthlyCostCents = vi.fn(async () => 1200);
    Object.assign(ledger, { sumMonthlyCostCents });
    const version = {
      ...baseInput().version!,
      guards: { monthlyCostCapUsd: 10 },
    };

    const result = await dispatchAgentLoop(baseInput({ version }), ledger);

    expect(result).toMatchObject({ status: "skipped" });
    expect(ledger.runs[0]).toMatchObject({ errorCode: "monthly_cost_cap" });
    expect(sumMonthlyCostCents).toHaveBeenCalledWith(
      expect.objectContaining({ agentLoopId: "loop-1" }),
    );
  });

  it("is inert when guards are absent or the ledger lacks the reads", async () => {
    const ledger = fakeLedger();
    // No countActiveRuns/sumMonthlyCostCents on the ledger, but guards present.
    const version = {
      ...baseInput().version!,
      guards: { maxConcurrentRuns: 1, monthlyCostCapUsd: 1 },
    };
    const result = await dispatchAgentLoop(baseInput({ version }), ledger);
    expect(result.status).toBe("queued");
  });
});

describe("headless-run failure raises a deduplicated inbox item (R10)", () => {
  it("raises the item when a routine-only headless run fails", async () => {
    const ledger = fakeLedger();
    const runRoutineAction = vi.fn(async () => ({
      ...okRoutineResult(),
      status: "failed" as const,
      errorClass: "code_run_failed",
      errorMessage: "boom",
    }));
    const completeRoutineOnlyRun = vi.fn();
    const raiseHeadlessFailureItem = vi.fn();
    Object.assign(ledger, {
      runRoutineAction,
      completeRoutineOnlyRun,
      raiseHeadlessFailureItem,
    });

    const result = await dispatchAgentLoop(
      baseInput({ version: headlessRoutineVersion() }),
      ledger,
    );

    expect(result.status).toBe("failed");
    expect(raiseHeadlessFailureItem).toHaveBeenCalledTimes(1);
    expect(raiseHeadlessFailureItem).toHaveBeenCalledWith(
      expect.objectContaining({
        agentLoopId: "loop-1",
        runId: "run-1",
        errorCode: "routine_action_failed",
      }),
    );
  });

  it("does NOT raise an inbox item when the headless run succeeds", async () => {
    const ledger = fakeLedger();
    const runRoutineAction = vi.fn(async () => okRoutineResult());
    const completeRoutineOnlyRun = vi.fn();
    const raiseHeadlessFailureItem = vi.fn();
    Object.assign(ledger, {
      runRoutineAction,
      completeRoutineOnlyRun,
      raiseHeadlessFailureItem,
    });

    await dispatchAgentLoop(
      baseInput({ version: headlessRoutineVersion() }),
      ledger,
    );

    expect(raiseHeadlessFailureItem).not.toHaveBeenCalled();
  });

  it("does NOT raise an inbox item for an agent_thread (non-headless) failure", async () => {
    const ledger = fakeLedger();
    const raiseHeadlessFailureItem = vi.fn();
    Object.assign(ledger, { raiseHeadlessFailureItem });
    // Mixed agent_thread version with actions but no runner → fails, but it is
    // NOT headless (it has a thread/Space), so no inbox item.
    vi.mocked(ledger.enqueueWakeup).mockRejectedValueOnce(new Error("boom"));

    const result = await dispatchAgentLoop(baseInput(), ledger);

    expect(result.status).toBe("failed");
    expect(raiseHeadlessFailureItem).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Target-spec resolution (THINK-137 U3)
// ---------------------------------------------------------------------------

import { resolveDispatchableVersion } from "./run-ledger";

const ROUTINE_ID = "33333333-3333-4333-8333-333333333333";

describe("resolveDispatchableVersion", () => {
  it("resolves a legacy goal/worker row (no target_spec) to an agent-turn version", () => {
    const resolved = resolveDispatchableVersion({
      id: "version-1",
      version_status: "active",
      goal_spec: {
        objective: "Prepare the brief",
        completionCriteria: ["done"],
      },
      worker_spec: { type: "agent", id: "agent-1", toolHints: [], config: {} },
      judge_spec: { mode: "self_check", criteria: [], config: {} },
      loop_policy: {
        maxIterations: 1,
        failBehavior: "return_blocker",
        escalateOnFailure: false,
      },
      routine_actions_spec: null,
      target_spec: null,
    });
    expect(resolved.goalSpec.objective).toBe("Prepare the brief");
    expect(resolved.workerSpec).toMatchObject({ type: "agent", id: "agent-1" });
    expect(resolved.routineActionsSpec).toBeNull();
  });

  it("prefers an authoritative target_spec over the legacy blobs", () => {
    const resolved = resolveDispatchableVersion({
      id: "version-1",
      version_status: "active",
      goal_spec: {
        objective: "STALE legacy objective",
        completionCriteria: [],
      },
      worker_spec: {
        type: "agent",
        id: "legacy-agent",
        toolHints: [],
        config: {},
      },
      judge_spec: { mode: "self_check", criteria: [], config: {} },
      loop_policy: {
        maxIterations: 1,
        failBehavior: "return_blocker",
        escalateOnFailure: false,
      },
      target_spec: {
        kind: "agent_thread",
        agentThread: {
          instructions: "Authoritative instructions",
          workerId: "target-agent",
          workerType: "agent",
          threadMode: "new_per_run",
        },
      },
    });
    expect(resolved.goalSpec.objective).toBe("Authoritative instructions");
    expect(resolved.workerSpec.id).toBe("target-agent");
  });

  it("reconstructs a token-free routineActionsSpec for a routine-kind target", () => {
    const resolved = resolveDispatchableVersion({
      id: "version-1",
      version_status: "active",
      goal_spec: { objective: "", completionCriteria: [] },
      worker_spec: { type: "agent", id: "agent-1", toolHints: [], config: {} },
      judge_spec: { mode: "self_check", criteria: [], config: {} },
      loop_policy: {
        maxIterations: 1,
        failBehavior: "return_blocker",
        escalateOnFailure: false,
      },
      target_spec: {
        kind: "routine",
        routine: { routineId: ROUTINE_ID, label: "Check" },
      },
    });
    expect(resolved.routineActionsSpec).toEqual({
      actions: [{ routineId: ROUTINE_ID, label: "Check" }],
      agentTurn: false,
    });
  });
});

describe("dispatchAgentLoop via resolved routine-kind target", () => {
  it("dispatches a routine-kind target token-free, exactly like the agentTurn:false path (no thread, no wakeup)", async () => {
    const ledger = fakeLedger();
    const runRoutineAction = vi.fn(async () => okRoutineResult());
    const completeRoutineOnlyRun = vi.fn();
    Object.assign(ledger, { runRoutineAction, completeRoutineOnlyRun });

    // A row whose target_spec is kind routine (no legacy routine_actions_spec).
    const version = resolveDispatchableVersion({
      id: "version-1",
      version_status: "active",
      goal_spec: { objective: "", completionCriteria: [] },
      worker_spec: { type: "agent", id: "agent-1", toolHints: [], config: {} },
      judge_spec: { mode: "self_check", criteria: [], config: {} },
      loop_policy: {
        maxIterations: 1,
        failBehavior: "return_blocker",
        escalateOnFailure: false,
      },
      target_spec: {
        kind: "routine",
        routine: { routineId: ROUTINE_ID, label: "LastMile check" },
      },
    });

    const result = await dispatchAgentLoop(baseInput({ version }), ledger);

    expect(result.status).toBe("completed_routine_only");
    expect(runRoutineAction).toHaveBeenCalledTimes(1);
    expect(ledger.wakeups).toHaveLength(0);
    expect(completeRoutineOnlyRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed" }),
    );
  });

  it("resolves a legacy routine-only row (no target_spec) to the same token-free dispatch", async () => {
    const ledger = fakeLedger();
    const runRoutineAction = vi.fn(async () => okRoutineResult());
    const completeRoutineOnlyRun = vi.fn();
    Object.assign(ledger, { runRoutineAction, completeRoutineOnlyRun });

    const version = resolveDispatchableVersion({
      id: "version-1",
      version_status: "active",
      goal_spec: { objective: "", completionCriteria: [] },
      worker_spec: { type: "agent", id: "agent-1", toolHints: [], config: {} },
      judge_spec: { mode: "self_check", criteria: [], config: {} },
      loop_policy: {
        maxIterations: 1,
        failBehavior: "return_blocker",
        escalateOnFailure: false,
      },
      routine_actions_spec: {
        actions: [{ routineId: ROUTINE_ID, label: "LastMile check" }],
        agentTurn: false,
      },
      target_spec: null,
    });

    const result = await dispatchAgentLoop(baseInput({ version }), ledger);

    expect(result.status).toBe("completed_routine_only");
    expect(ledger.wakeups).toHaveLength(0);
    expect(completeRoutineOnlyRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed" }),
    );
  });
});

// ---------------------------------------------------------------------------
// Per-Sender Context Injection — run-as identity (THINK-137 U5, R5)
// ---------------------------------------------------------------------------

import { buildAgentLoopWakeupPayload } from "./run-ledger";

describe("run-as identity (Per-Sender Context Injection, R5)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("carries run-as into the wakeup as a user actor AND onto the payload, keeping the trigger actor on the run row", async () => {
    const ledger = fakeLedger();
    // A scheduled dispatch whose TRIGGER actor is the system, but whose
    // automation runs AS a specific user.
    const input = baseInput({
      trigger: {
        family: "schedule",
        source: "agent_loop_schedule",
        actorType: "system",
        actorId: null,
        runAsUserId: "run-as-user",
        scheduledJobId: "job-1",
      },
    });
    Object.assign(ledger, {
      loadUserTenantId: vi.fn(async () => "tenant-1"),
    });

    const result = await dispatchAgentLoop(input, ledger);

    expect(result.status).toBe("queued");
    // Trigger actor stays on the run row (audit) — NOT the run-as identity.
    expect(ledger.runs[0]).toMatchObject({
      actorType: "system",
      actorId: null,
    });
    // Run-as identity drives the wakeup's requested_by_actor_* (→ envelope
    // scope.user_id in wakeup-processor) and the payload copy.
    expect(ledger.wakeups[0]).toMatchObject({
      requestedByActorType: "user",
      requestedByActorId: "run-as-user",
    });
    expect(ledger.wakeups[0].payload.agentLoop.runAsUserId).toBe("run-as-user");
  });

  it("absent run-as ⇒ system actor, no identity injection (payload field null)", async () => {
    const ledger = fakeLedger();
    // baseInput has no runAsUserId.
    const result = await dispatchAgentLoop(baseInput(), ledger);

    expect(result.status).toBe("queued");
    expect(ledger.wakeups[0]).toMatchObject({
      requestedByActorType: "system",
      requestedByActorId: null,
    });
    expect(ledger.wakeups[0].payload.agentLoop.runAsUserId).toBeNull();
  });

  it("HARD-REJECTS a run-as user from a different tenant — skipped run with run_as_tenant_mismatch, NO wakeup, NO silent system downgrade", async () => {
    const ledger = fakeLedger();
    Object.assign(ledger, {
      loadUserTenantId: vi.fn(async () => "OTHER-tenant"),
    });
    const input = baseInput({
      trigger: {
        ...baseInput().trigger,
        runAsUserId: "cross-tenant-user",
      },
    });

    const result = await dispatchAgentLoop(input, ledger);

    expect(result).toMatchObject({ status: "skipped" });
    expect(ledger.runs[0]).toMatchObject({
      status: "skipped",
      errorCode: "run_as_tenant_mismatch",
    });
    expect(ledger.iterations[0]).toMatchObject({
      status: "skipped",
      errorCode: "run_as_tenant_mismatch",
    });
    expect(ledger.enqueueWakeup).not.toHaveBeenCalled();
  });

  it("HARD-REJECTS a run-as user that does not exist (run_as_tenant_mismatch)", async () => {
    const ledger = fakeLedger();
    Object.assign(ledger, { loadUserTenantId: vi.fn(async () => null) });
    const input = baseInput({
      trigger: { ...baseInput().trigger, runAsUserId: "ghost-user" },
    });

    const result = await dispatchAgentLoop(input, ledger);

    expect(result).toMatchObject({ status: "skipped" });
    expect(ledger.runs[0]).toMatchObject({
      errorCode: "run_as_tenant_mismatch",
    });
    expect(ledger.enqueueWakeup).not.toHaveBeenCalled();
  });

  it("is inert (run-as still injected) when the ledger cannot cross-check membership", async () => {
    const ledger = fakeLedger();
    // No loadUserTenantId on the ledger, but run-as present.
    const input = baseInput({
      trigger: { ...baseInput().trigger, runAsUserId: "run-as-user" },
    });

    const result = await dispatchAgentLoop(input, ledger);

    expect(result.status).toBe("queued");
    expect(ledger.wakeups[0]).toMatchObject({
      requestedByActorType: "user",
      requestedByActorId: "run-as-user",
    });
  });

  it("resume-turn payload carries the SAME run-as identity as the initial turn", () => {
    const version = baseInput().version!;
    const common = {
      loop: baseInput().loop,
      version,
      trigger: baseInput().trigger,
      runId: "run-1",
      iterationId: "iter-1",
      runAsUserId: "run-as-user",
    };
    const start = buildAgentLoopWakeupPayload({
      ...common,
      goalModeAction: "start",
    });
    const resume = buildAgentLoopWakeupPayload({
      ...common,
      goalModeAction: "resume",
    });

    expect(start.agentLoop.runAsUserId).toBe("run-as-user");
    expect(resume.agentLoop.runAsUserId).toBe(start.agentLoop.runAsUserId);
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

  it("does not repair a mixed (actions + agentTurn:true) version — routine actions are not idempotent to re-run", () => {
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
    ).toBe(false);
  });

  it("never repairs a null repair-state or a state missing its iterationId", () => {
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

  it("reuses (no repair) a half-built MIXED start — never re-runs non-idempotent routine actions or re-enqueues", async () => {
    const ledger = fakeLedger();
    const runRoutineAction = vi.fn(async () => okRoutineResult());
    Object.assign(ledger, { runRoutineAction });
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
    });
    const mixedInput = baseInput({
      version: {
        ...baseInput().version!,
        routineActionsSpec: {
          actions: [{ routineId: "33333333-3333-4333-8333-333333333333" }],
          agentTurn: true,
        },
      },
    });

    const result = await dispatchAgentLoop(mixedInput, ledger);

    expect(result).toEqual({
      status: "reused",
      runId: "run-existing",
      runStatus: "queued",
    });
    expect(runRoutineAction).not.toHaveBeenCalled();
    expect(ledger.enqueueWakeup).not.toHaveBeenCalled();
    expect(ledger.createRun).not.toHaveBeenCalled();
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
