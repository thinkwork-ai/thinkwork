import { describe, expect, it, vi } from "vitest";
import { DEFAULT_LOOP_POLICY } from "@thinkwork/agent-loops-core";
import type {
  AgentLoopFinalizeLedger,
  AgentLoopFinalizeLoadedContext,
} from "./finalize-projection.js";
import {
  agentLoopContextFromSnapshot,
  createDrizzleAgentLoopFinalizeLedger,
  projectAgentLoopFinalize,
} from "./finalize-projection.js";

// THINK-159: the real Drizzle loadContext derives goalSpec/workerSpec/loopPolicy
// from target_spec (via resolveDispatchableVersion), never from the inert legacy
// columns. A tiny getDb mock feeds the four sequential selects (iteration, run,
// loop, version) so we can assert that derivation end-to-end.
const dbMock = vi.hoisted(() => {
  const queue: unknown[][] = [];
  const selectChain = (rows: unknown[]) => {
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => chain,
      limit: async () => rows,
    };
    return chain;
  };
  return {
    queue,
    getDb: () => ({ select: () => selectChain(queue.shift() ?? []) }),
  };
});

vi.mock("@thinkwork/database-pg", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@thinkwork/database-pg")>();
  return { ...actual, getDb: dbMock.getDb };
});

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

describe("createDrizzleAgentLoopFinalizeLedger.loadContext (THINK-159)", () => {
  it("builds goalSpec/workerSpec/loopPolicy from target_spec, not the legacy columns", async () => {
    dbMock.queue.length = 0;
    dbMock.queue.push(
      [{ id: "iteration-1", iteration_number: 1, status: "running" }],
      [
        {
          id: "run-1",
          agent_loop_id: "loop-1",
          agent_loop_version_id: "version-1",
          status: "running",
          current_iteration: 1,
          started_at: null,
        },
      ],
      [
        {
          id: "loop-1",
          tenant_id: "tenant-1",
          name: "Weekly check-in",
          enabled: true,
          lifecycle_status: "active",
        },
      ],
      // Version row: ONLY target_spec (goal/worker/loop columns unselected).
      [
        {
          id: "version-1",
          version_status: "active",
          routine_actions_spec: null,
          target_spec: {
            kind: "agent_thread",
            agentThread: {
              instructions: "Prepare the weekly check-in.",
              completionCriteria: ["Useful for operator review."],
              workerId: "agent-7",
              workerType: "agent",
              threadMode: "new_per_run",
            },
          },
        },
      ],
    );

    const ledger = createDrizzleAgentLoopFinalizeLedger();
    const loaded = await ledger.loadContext({
      tenantId: "tenant-1",
      runId: "run-1",
      iterationId: "iteration-1",
      threadTurnId: "turn-1",
    });

    expect(loaded).not.toBeNull();
    expect(loaded?.version.goalSpec.objective).toBe(
      "Prepare the weekly check-in.",
    );
    expect(loaded?.version.goalSpec.completionCriteria).toEqual([
      "Useful for operator review.",
    ]);
    expect(loaded?.version.workerSpec.id).toBe("agent-7");
    expect(loaded?.version.loopPolicy).toEqual(DEFAULT_LOOP_POLICY);
    expect(loaded?.version.targetKind).toBe("agent_thread");
  });
});
