import { describe, expect, it } from "vitest";

import { DEFAULT_AGENT_LOOP_GOAL_TOKEN_BUDGET } from "./run-ledger";
import { buildWorkflowStepWakeupPayload } from "./interpreter-wakeup";

describe("buildWorkflowStepWakeupPayload", () => {
  it("embeds the iteration in goalRunId, distinct from the run id", () => {
    const payload = buildWorkflowStepWakeupPayload({
      workflowRunId: "run-1",
      workflowName: "Weekly report",
      stepId: "draft",
      iteration: 3,
      objective: "Draft and share the weekly report",
      tokenBudget: 250_000,
      exitSignal: "the report document exists and is shared",
      maxIterations: 5,
      spaceId: "space-1",
    });

    expect(payload.goalMode.goalRunId).toBe("run-1:3");
    expect(payload.goalMode.goalRunId).not.toBe(payload.workflowRun.runId);
    expect(payload.message).toBe("Draft and share the weekly report");
    expect(payload.goalMode.objective).toBe("Draft and share the weekly report");
    expect(payload.goalMode.resolvedBudget.tokenBudget).toBe(250_000);
    expect(payload.spaceId).toBe("space-1");
    expect(payload.threadId).toBeNull();
  });

  it("carries workflowRun context with the policy summary", () => {
    const payload = buildWorkflowStepWakeupPayload({
      workflowRunId: "run-2",
      workflowName: "Nightly sweep",
      stepId: "sweep",
      iteration: 1,
      objective: "Sweep the queue",
      exitSignal: "queue is empty",
      maxIterations: 10,
    });

    expect(payload.workflowRun).toEqual({
      runId: "run-2",
      workflowName: "Nightly sweep",
      stepId: "sweep",
      iteration: 1,
      policySummary: { exitSignal: "queue is empty", maxIterations: 10 },
    });
  });

  it("defaults the token budget and nullable context", () => {
    const payload = buildWorkflowStepWakeupPayload({
      workflowRunId: "run-3",
      stepId: "step",
      iteration: 1,
      objective: "Do the thing",
    });

    expect(payload.goalMode.resolvedBudget.tokenBudget).toBe(
      DEFAULT_AGENT_LOOP_GOAL_TOKEN_BUDGET,
    );
    expect(payload.workflowRun.workflowName).toBeNull();
    expect(payload.spaceId).toBeNull();
    expect(payload.workflowRun.policySummary).toEqual({
      exitSignal: null,
      maxIterations: null,
    });
  });
});
