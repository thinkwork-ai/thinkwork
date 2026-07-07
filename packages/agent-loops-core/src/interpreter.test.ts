import { describe, expect, it } from "vitest";

import {
  advanceCursor,
  decideWorkflowContinuation,
  type InterpreterCursor,
  MAX_ROLLOVERS,
  planNextStep,
  planRollover,
} from "./interpreter.js";
import type { WorkflowDefinition } from "./workflow-definition.js";

const definition: WorkflowDefinition = {
  version: 1,
  steps: [{ id: "work", kind: "agent", objective: "do the thing" }],
  continuationPolicy: { exitSignal: "thing exists", maxIterations: 5 },
};

const cursor: InterpreterCursor = {
  workflowRunId: "run-1",
  tenantId: "tenant-1",
  stepPointer: 0,
  iteration: 1,
  loopCycleCount: 0,
  rolloverCount: 0,
};

describe("planNextStep", () => {
  it("dispatches the agent step at the pointer", () => {
    const directive = planNextStep(definition, cursor);
    expect(directive).toMatchObject({
      type: "dispatch_agent",
      step: { id: "work" },
    });
  });

  it("resolves a relative wait to an absolute timestamp", () => {
    const withWait: WorkflowDefinition = {
      version: 1,
      steps: [{ id: "pause", kind: "wait", durationSeconds: 60 }],
    };
    const now = new Date("2026-07-07T10:00:00Z");
    const directive = planNextStep(withWait, cursor, now);
    expect(directive).toMatchObject({
      type: "wait_until",
      until: "2026-07-07T10:01:00.000Z",
    });
  });

  it("signals iteration end past the last step", () => {
    expect(planNextStep(definition, { ...cursor, stepPointer: 1 })).toEqual({
      type: "iteration_end",
    });
  });

  it("returns unsupported_step (never a misrouted wait) for kinds without dispatch", () => {
    const kinds: WorkflowDefinition["steps"] = [
      { id: "r", kind: "routine", routineId: "r-1" },
      { id: "t", kind: "tool", tool: "emit_document" },
      { id: "a", kind: "approval", prompt: "ok?" },
      { id: "h", kind: "http", method: "GET", url: "https://x.dev" },
      { id: "e", kind: "emit_event", eventType: "x.y" },
    ];
    for (const step of kinds) {
      const directive = planNextStep({ version: 1, steps: [step] }, cursor);
      expect(directive).toEqual({ type: "unsupported_step", step });
    }
  });
});

describe("decideWorkflowContinuation", () => {
  const policy = definition.continuationPolicy;

  it("completes when the exit signal is satisfied (AE1 iteration 3)", () => {
    const result = decideWorkflowContinuation({
      policy,
      iteration: 3,
      turnStatus: "completed",
      evidence: { status: "complete", completionSummary: "done" },
    });
    expect(result.decision).toBe("complete");
    expect(result.terminal).toBe(true);
  });

  it("continues below the iteration budget when the goal is unmet", () => {
    const result = decideWorkflowContinuation({
      policy,
      iteration: 2,
      turnStatus: "completed",
      evidence: { status: "active" },
    });
    expect(result.decision).toBe("continue");
    expect(result.summary.nextIteration).toBe(3);
  });

  it("terminates with budget reason at max iterations (AE1 budget arm)", () => {
    const result = decideWorkflowContinuation({
      policy,
      iteration: 5,
      turnStatus: "completed",
      evidence: { status: "active" },
    });
    expect(result.decision).toBe("budget_stopped");
    expect(result.reason).toBe("max_iterations_reached");
    expect(result.terminal).toBe(true);
  });

  it("suspends on an explicit needs-human marker", () => {
    const result = decideWorkflowContinuation({
      policy,
      iteration: 1,
      turnStatus: "completed",
      evidence: { status: "active", needsHuman: true },
    });
    expect(result.decision).toBe("human_needed");
    expect(result.terminal).toBe(false);
  });

  it("fails on a failed turn", () => {
    const result = decideWorkflowContinuation({
      policy,
      iteration: 1,
      turnStatus: "failed",
      evidence: null,
    });
    expect(result.decision).toBe("failed");
    expect(result.reason).toBe("agent_turn_failed");
  });

  it("treats a policy-less workflow as single-pass complete", () => {
    const result = decideWorkflowContinuation({
      policy: undefined,
      iteration: 1,
      turnStatus: "completed",
      evidence: { status: "active" },
    });
    expect(result.decision).toBe("complete");
    expect(result.reason).toBe("single_pass_complete");
  });

  it("never leaks evidence objects into the summary", () => {
    const result = decideWorkflowContinuation({
      policy,
      iteration: 1,
      turnStatus: "completed",
      evidence: {
        status: "active",
        summary: "x".repeat(2000),
      },
    });
    for (const value of Object.values(result.summary)) {
      expect(["string", "number", "boolean"]).toContain(typeof value);
    }
    expect((result.summary.summaryPreview as string).length).toBe(500);
  });
});

describe("planRollover", () => {
  it("does not roll over below the threshold", () => {
    expect(planRollover({ ...cursor, loopCycleCount: 249 }).rollOver).toBe(
      false,
    );
  });

  it("rolls over at the threshold with a reset cycle count", () => {
    const plan = planRollover({ ...cursor, loopCycleCount: 250 });
    expect(plan.rollOver).toBe(true);
    expect(plan.nextCursor).toMatchObject({
      loopCycleCount: 0,
      rolloverCount: 1,
    });
  });

  it("refuses to roll over past the infinite-restart guard", () => {
    const plan = planRollover({
      ...cursor,
      loopCycleCount: 250,
      rolloverCount: MAX_ROLLOVERS,
    });
    expect(plan.rollOver).toBe(false);
    expect(plan.blocked).toBe("max_rollovers");
  });
});

describe("advanceCursor", () => {
  it("resets the pointer and bumps the iteration on continue", () => {
    const next = advanceCursor(
      definition,
      { ...cursor, stepPointer: 0, iteration: 2 },
      "continue",
    );
    expect(next).toMatchObject({
      stepPointer: 0,
      iteration: 3,
      loopCycleCount: 1,
    });
  });

  it("moves to the next step otherwise", () => {
    const next = advanceCursor(definition, cursor);
    expect(next).toMatchObject({ stepPointer: 1, iteration: 1 });
  });
});
