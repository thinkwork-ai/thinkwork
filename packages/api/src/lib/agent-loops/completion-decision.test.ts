import type { LoopPolicy } from "@thinkwork/agent-loops-core";
import { describe, expect, it } from "vitest";
import { decideAgentLoopCompletion } from "./completion-decision.js";

const loopPolicy = (overrides: Partial<LoopPolicy> = {}): LoopPolicy => ({
  maxIterations: 3,
  failBehavior: "return_blocker",
  escalateOnFailure: false,
  ...overrides,
});

describe("decideAgentLoopCompletion", () => {
  it("completes when the goal run reports completion", () => {
    const decision = decideAgentLoopCompletion({
      loopPolicy: loopPolicy(),
      iterationNumber: 1,
      goalRun: {
        source: "pi_goal",
        status: "completed",
        completion_summary: "All done.",
        resume_eligible: false,
      },
      responseText: "done",
      turnStatus: "completed",
    });

    expect(decision.outcome).toBe("complete");
    expect(decision.runStatus).toBe("completed");
    expect(decision.terminal).toBe(true);
    expect(decision.enqueueNextIteration).toBe(false);
  });

  it("continues while the goal run is still active and under the iteration cap", () => {
    const decision = decideAgentLoopCompletion({
      loopPolicy: loopPolicy({ maxIterations: 3 }),
      iterationNumber: 1,
      goalRun: {
        source: "pi_goal",
        status: "active",
        summary: "Keep going.",
        resume_eligible: false,
      },
      responseText: "more",
      turnStatus: "completed",
    });

    expect(decision.outcome).toBe("continue");
    expect(decision.runStatus).toBe("running");
    expect(decision.terminal).toBe(false);
    expect(decision.enqueueNextIteration).toBe(true);
  });

  it("stops at the max-iteration cap", () => {
    const decision = decideAgentLoopCompletion({
      loopPolicy: loopPolicy({ maxIterations: 2 }),
      iterationNumber: 2,
      goalRun: {
        source: "pi_goal",
        status: "active",
        summary: "Still going.",
        resume_eligible: false,
      },
      responseText: "more",
      turnStatus: "completed",
    });

    expect(decision.terminal).toBe(true);
    expect(decision.enqueueNextIteration).toBe(false);
    expect(decision.terminalReason).toBe("max_iterations_reached");
  });

  it("fails when the worker turn failed", () => {
    const decision = decideAgentLoopCompletion({
      loopPolicy: loopPolicy(),
      iterationNumber: 1,
      goalRun: null,
      responseText: "err",
      turnStatus: "failed",
      errorMessage: "boom",
    });

    expect(decision.outcome).toBe("failed");
    expect(decision.runStatus).toBe("failed");
    expect(decision.errorCode).toBe("worker_turn_failed");
  });

  it("escalates a failure when the policy escalates on failure", () => {
    const decision = decideAgentLoopCompletion({
      loopPolicy: loopPolicy({ escalateOnFailure: true }),
      iterationNumber: 1,
      goalRun: null,
      responseText: "err",
      turnStatus: "failed",
      errorMessage: "boom",
    });

    expect(decision.runStatus).toBe("escalated");
  });

  it("marks a budget-limited goal run as budget_stopped", () => {
    const decision = decideAgentLoopCompletion({
      loopPolicy: loopPolicy(),
      iterationNumber: 1,
      goalRun: {
        source: "pi_goal",
        status: "budget_limited",
        budget_limited_reason: "Out of tokens.",
        resume_eligible: false,
      },
      responseText: "stopped",
      turnStatus: "completed",
    });

    expect(decision.outcome).toBe("budget_stopped");
    expect(decision.runStatus).toBe("budget_stopped");
  });
});
