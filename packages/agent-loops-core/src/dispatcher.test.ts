import { beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchAgentLoop } from "./dispatcher";
import type {
  AgentLoopCreateIterationInput,
  AgentLoopCreateRunInput,
  AgentLoopDispatchInput,
  AgentLoopDispatchLedger,
  AgentLoopEnqueueWakeupInput,
} from "./run-ledger";

const baseInput = (): AgentLoopDispatchInput => ({
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
