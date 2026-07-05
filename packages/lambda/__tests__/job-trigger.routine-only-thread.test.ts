/**
 * No Space ⇒ no thread, on every dispatch path (THINK-137 U4, R4). The
 * job-trigger and triggerAgentLoopRun call sites both gate execution-thread
 * creation on the shared `dispatchNeedsThread` seam over the resolved
 * TargetSpec: an agent_thread target with a resolved Space needs a thread;
 * routine/workflow targets are headless and never do. This replaces the
 * retired `isRoutineOnlyVersion` special-case (#3302).
 */

import { describe, expect, it } from "vitest";
import {
  dispatchNeedsThread,
  resolveDispatchableVersion,
} from "@thinkwork/agent-loops-core";

const ROUTINE_ID = "33333333-3333-4333-8333-333333333333";

const baseRow = {
  id: "version-1",
  version_status: "active",
  goal_spec: { objective: "Do it", completionCriteria: ["done"] },
  worker_spec: { type: "agent", id: "agent-1", toolHints: [], config: {} },
  loop_policy: {
    maxIterations: 1,
    failBehavior: "return_blocker",
    escalateOnFailure: false,
  },
};

describe("dispatchNeedsThread gating over the resolved target", () => {
  it("a routine target is headless — no thread, with or without a Space", () => {
    const version = resolveDispatchableVersion({
      ...baseRow,
      target_spec: {
        kind: "routine",
        routine: { routineId: ROUTINE_ID, label: "Nightly" },
      },
    });
    expect(version.targetKind).toBe("routine");
    expect(dispatchNeedsThread(version, "space-1")).toBe(false);
    expect(dispatchNeedsThread(version, null)).toBe(false);
  });

  it("an agent_thread target creates a thread only when a Space is resolved", () => {
    const version = resolveDispatchableVersion({
      ...baseRow,
      target_spec: {
        kind: "agent_thread",
        agentThread: {
          instructions: "Do it",
          workerId: "agent-1",
          workerType: "agent",
          threadMode: "new_per_run",
        },
      },
    });
    expect(version.targetKind).toBe("agent_thread");
    expect(dispatchNeedsThread(version, "space-1")).toBe(true);
    expect(dispatchNeedsThread(version, null)).toBe(false);
  });

  it("carries R11 guards from target_spec onto the dispatchable version", () => {
    const version = resolveDispatchableVersion({
      ...baseRow,
      target_spec: {
        kind: "routine",
        routine: { routineId: ROUTINE_ID },
        guards: { maxConcurrentRuns: 2, monthlyCostCapUsd: 10 },
      },
    });
    expect(version.guards).toEqual({
      maxConcurrentRuns: 2,
      monthlyCostCapUsd: 10,
    });
  });
});
