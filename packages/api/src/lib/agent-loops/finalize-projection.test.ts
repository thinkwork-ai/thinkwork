import { describe, expect, it, vi } from "vitest";
import type {
  AgentLoopFinalizeLedger,
  AgentLoopFinalizeLoadedContext,
} from "./finalize-projection.js";
import {
  agentLoopContextFromSnapshot,
  projectAgentLoopFinalize,
} from "./finalize-projection.js";

const loadedContext = (
  overrides: Partial<AgentLoopFinalizeLoadedContext> = {},
): AgentLoopFinalizeLoadedContext => ({
  loop: {
    id: "loop-1",
    tenantId: "tenant-1",
    name: "Weekly Agent Check-In",
    enabled: true,
    lifecycleStatus: "active",
  },
  version: {
    id: "version-1",
    versionStatus: "active",
    goalSpec: {
      objective: "Prepare the weekly check-in.",
      completionCriteria: ["Useful enough for operator review."],
    },
    workerSpec: {
      type: "agent",
      id: "agent-1",
      toolHints: [],
      config: {},
    },
    loopPolicy: {
      maxIterations: 2,
      failBehavior: "return_blocker",
      escalateOnFailure: false,
    },
    targetKind: "agent_thread",
  },
  run: {
    id: "run-1",
    status: "running",
    currentIteration: 1,
  },
  iteration: {
    id: "iteration-1",
    iterationNumber: 1,
    status: "running",
  },
  ...overrides,
});

function fakeLedger(
  loaded: AgentLoopFinalizeLoadedContext | null = loadedContext(),
): AgentLoopFinalizeLedger & {
  iterationUpdates: unknown[];
  runUpdates: unknown[];
  nextIterations: unknown[];
  wakeups: unknown[];
  projectionFailures: unknown[];
} {
  const ledger = {
    iterationUpdates: [] as unknown[],
    runUpdates: [] as unknown[],
    nextIterations: [] as unknown[],
    wakeups: [] as unknown[],
    projectionFailures: [] as unknown[],
    loadContext: vi.fn().mockResolvedValue(loaded),
    updateIteration: vi.fn(async (input: unknown) => {
      ledger.iterationUpdates.push(input);
    }),
    updateRun: vi.fn(async (input: unknown) => {
      ledger.runUpdates.push(input);
    }),
    createNextIteration: vi.fn(async (input: unknown) => {
      ledger.nextIterations.push(input);
      return { id: "iteration-2" };
    }),
    enqueueNextWakeup: vi.fn(async (input: unknown) => {
      ledger.wakeups.push(input);
      return { id: "wakeup-2" };
    }),
    markIterationWakeup: vi.fn(),
    recordProjectionFailure: vi.fn(async (input: unknown) => {
      ledger.projectionFailures.push(input);
    }),
  };
  return ledger;
}

const baseInput = () => ({
  tenantId: "tenant-1",
  threadTurnId: "turn-1",
  contextSnapshot: {
    agentLoop: {
      runId: "run-1",
      iterationId: "iteration-1",
    },
  },
  goalRun: {
    source: "pi_goal" as const,
    status: "completed" as const,
    completion_summary: "Done.",
    resume_eligible: false,
  },
  responseText: "The check-in is ready.",
  turnStatus: "completed" as const,
  now: new Date("2026-06-22T12:00:00Z"),
});

describe("agentLoopContextFromSnapshot", () => {
  it("extracts run and iteration ids from wakeup context snapshots", () => {
    expect(
      agentLoopContextFromSnapshot({
        agentLoop: { runId: "run-1", iterationId: "iteration-1" },
      }),
    ).toEqual({ runId: "run-1", iterationId: "iteration-1" });
    expect(agentLoopContextFromSnapshot({})).toBeNull();
  });
});

describe("projectAgentLoopFinalize", () => {
  it("completes the iteration and run when the goal is done", async () => {
    const ledger = fakeLedger();

    const result = await projectAgentLoopFinalize(baseInput(), ledger);

    expect(result).toMatchObject({
      status: "projected",
      outcome: "complete",
      runStatus: "completed",
    });
    expect(ledger.updateIteration).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: expect.objectContaining({ iterationStatus: "completed" }),
      }),
    );
    expect(ledger.updateRun).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: expect.objectContaining({ runStatus: "completed" }),
        currentIteration: 1,
        outputSummary: expect.objectContaining({
          completionSummary: "Done.",
          responsePreview: "The check-in is ready.",
        }),
      }),
    );
    expect(ledger.createNextIteration).not.toHaveBeenCalled();
  });

  it("creates and enqueues the next iteration when the goal is still active", async () => {
    const ledger = fakeLedger(
      loadedContext({
        version: {
          ...loadedContext().version,
          loopPolicy: {
            maxIterations: 3,
            failBehavior: "return_blocker",
            escalateOnFailure: false,
          },
        },
      }),
    );

    const result = await projectAgentLoopFinalize(
      {
        ...baseInput(),
        goalRun: {
          source: "pi_goal",
          status: "active",
          summary: "Need another pass.",
          resume_eligible: false,
        },
      },
      ledger,
    );

    expect(result).toMatchObject({
      status: "projected",
      outcome: "continue",
      runStatus: "running",
      nextIterationId: "iteration-2",
      nextWakeupId: "wakeup-2",
    });
    expect(ledger.createNextIteration).toHaveBeenCalledWith(
      expect.objectContaining({
        iterationNumber: 2,
        previousIterationId: "iteration-1",
      }),
    );
    expect(ledger.enqueueNextWakeup).toHaveBeenCalledWith(
      expect.objectContaining({
        iterationId: "iteration-2",
        iterationNumber: 2,
      }),
    );
    expect(ledger.markIterationWakeup).toHaveBeenCalledWith(
      expect.objectContaining({
        iterationId: "iteration-2",
        wakeupId: "wakeup-2",
      }),
    );
  });

  it("fails the run without another iteration when the worker turn failed", async () => {
    const ledger = fakeLedger();

    const result = await projectAgentLoopFinalize(
      {
        ...baseInput(),
        goalRun: null,
        responseText: "Something broke.",
        turnStatus: "failed",
        errorMessage: "boom",
      },
      ledger,
    );

    expect(result).toMatchObject({
      status: "projected",
      outcome: "failed",
      runStatus: "failed",
    });
    expect(ledger.createNextIteration).not.toHaveBeenCalled();
    expect(ledger.enqueueNextWakeup).not.toHaveBeenCalled();
  });

  it("is idempotent when the iteration already reached a terminal status", async () => {
    const ledger = fakeLedger(
      loadedContext({
        iteration: {
          id: "iteration-1",
          iterationNumber: 1,
          status: "completed",
        },
      }),
    );

    await expect(
      projectAgentLoopFinalize(baseInput(), ledger),
    ).resolves.toEqual({
      status: "already_projected",
      runId: "run-1",
      iterationId: "iteration-1",
    });
    expect(ledger.updateIteration).not.toHaveBeenCalled();
    expect(ledger.updateRun).not.toHaveBeenCalled();
  });

  it("skips non-AgentLoop turns", async () => {
    const ledger = fakeLedger();

    await expect(
      projectAgentLoopFinalize(
        { ...baseInput(), contextSnapshot: { source: "chat" } },
        ledger,
      ),
    ).resolves.toEqual({
      status: "skipped",
      reason: "not_agent_loop_turn",
    });
    expect(ledger.loadContext).not.toHaveBeenCalled();
  });

  it("records a bounded AgentLoop failure when projection side effects fail", async () => {
    const ledger = fakeLedger(
      loadedContext({
        version: {
          ...loadedContext().version,
          loopPolicy: {
            maxIterations: 3,
            failBehavior: "return_blocker",
            escalateOnFailure: false,
          },
        },
      }),
    );
    vi.mocked(ledger.enqueueNextWakeup).mockRejectedValueOnce(
      new Error(`${"x".repeat(1200)} secret-token-value`),
    );

    const result = await projectAgentLoopFinalize(
      {
        ...baseInput(),
        goalRun: {
          source: "pi_goal",
          status: "active",
          summary: "Need another pass.",
          resume_eligible: false,
        },
      },
      ledger,
    );

    expect(result).toEqual({
      status: "projection_failed",
      runId: "run-1",
      iterationId: "iteration-1",
      errorCode: "agent_loop_projection_failed",
    });
    expect(ledger.recordProjectionFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        iterationId: "iteration-1",
        message: "x".repeat(1000),
      }),
    );
  });
});
