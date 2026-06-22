import { describe, expect, it } from "vitest";
import type { JudgeSpec, LoopPolicy } from "@thinkwork/agent-loops-core";
import type { FinalizeGoalRunProjection } from "../chat-finalize/types.js";
import { judgeAgentLoopIteration } from "./judgment.js";

const policy = (overrides: Partial<LoopPolicy> = {}): LoopPolicy => ({
  maxIterations: 2,
  failBehavior: "return_blocker",
  escalateOnFailure: false,
  ...overrides,
});

const judge = (mode: JudgeSpec["mode"] = "self_check"): JudgeSpec => ({
  mode,
  criteria: ["Done is useful."],
  config: {},
});

const goalRun = (
  overrides: Partial<FinalizeGoalRunProjection> = {},
): FinalizeGoalRunProjection => ({
  source: "pi_goal",
  status: "active",
  objective: "Prepare the weekly check-in.",
  summary: "Still working.",
  resume_eligible: false,
  ...overrides,
});

describe("judgeAgentLoopIteration", () => {
  it("marks completed goal evidence as a completed judgment and run", () => {
    const decision = judgeAgentLoopIteration({
      judgeSpec: judge(),
      loopPolicy: policy(),
      iterationNumber: 1,
      goalRun: goalRun({
        status: "completed",
        completion_summary: "All criteria passed.",
      }),
      responseText: "Here is the finished report.",
    });

    expect(decision).toMatchObject({
      runStatus: "completed",
      iterationStatus: "completed",
      terminal: true,
      enqueueNextIteration: false,
      judgment: {
        outcome: "complete",
        terminalReason: "goal_completed",
        shouldContinue: false,
      },
    });
    expect(decision.evidenceSummary).toMatchObject({
      completionSummary: "All criteria passed.",
      responsePreview: "Here is the finished report.",
    });
  });

  it("continues active goals when policy allows another iteration", () => {
    const decision = judgeAgentLoopIteration({
      judgeSpec: judge(),
      loopPolicy: policy({ maxIterations: 3 }),
      iterationNumber: 1,
      goalRun: goalRun({ status: "active", summary: "Need one more pass." }),
      responseText: "Draft is not good enough yet.",
    });

    expect(decision).toMatchObject({
      runStatus: "running",
      iterationStatus: "completed",
      terminal: false,
      enqueueNextIteration: true,
      judgment: {
        outcome: "continue",
        shouldContinue: true,
      },
      evidenceSummary: {
        nextIteration: 2,
      },
    });
  });

  it("stops active goals at max iterations", () => {
    const decision = judgeAgentLoopIteration({
      judgeSpec: judge(),
      loopPolicy: policy({ maxIterations: 1 }),
      iterationNumber: 1,
      goalRun: goalRun({ status: "active" }),
      responseText: "Still not finished.",
    });

    expect(decision).toMatchObject({
      runStatus: "failed",
      iterationStatus: "failed",
      terminal: true,
      enqueueNextIteration: false,
      errorCode: "max_iterations_reached",
      judgment: {
        outcome: "failed",
        terminalReason: "max_iterations_reached",
      },
    });
  });

  it("records budget-limited evidence as budget stopped", () => {
    const decision = judgeAgentLoopIteration({
      judgeSpec: judge(),
      loopPolicy: policy(),
      iterationNumber: 1,
      goalRun: goalRun({
        status: "budget_limited",
        budget_limited_reason: "token budget exhausted",
      }),
      responseText: "Budget stopped.",
    });

    expect(decision).toMatchObject({
      runStatus: "budget_stopped",
      iterationStatus: "budget_stopped",
      terminal: true,
      errorCode: "budget_stopped",
      judgment: {
        outcome: "budget_stopped",
        terminalReason: "budget_stopped",
      },
    });
  });

  it("records human approval as a waiting state without auto-continuing", () => {
    const decision = judgeAgentLoopIteration({
      judgeSpec: judge("human_approval"),
      loopPolicy: policy({ maxIterations: 3 }),
      iterationNumber: 1,
      goalRun: goalRun({ status: "completed" }),
      responseText: "Ready for human review.",
    });

    expect(decision).toMatchObject({
      runStatus: "waiting_for_human",
      iterationStatus: "waiting_for_human",
      terminal: true,
      enqueueNextIteration: false,
      judgment: {
        outcome: "needs_human_approval",
        terminalReason: "human_approval_required",
      },
    });
  });

  it("keeps model_judge reserved for Phase 2", () => {
    const decision = judgeAgentLoopIteration({
      judgeSpec: judge("model_judge"),
      loopPolicy: policy(),
      iterationNumber: 1,
      goalRun: goalRun({ status: "completed" }),
      responseText: "A result.",
    });

    expect(decision).toMatchObject({
      runStatus: "failed",
      iterationStatus: "failed",
      errorCode: "model_judge_unsupported_phase1",
      judgment: {
        outcome: "failed",
        terminalReason: "model_judge_unsupported_phase1",
      },
    });
  });

  it("does not stringify arbitrary raw evidence into summaries", () => {
    const decision = judgeAgentLoopIteration({
      judgeSpec: judge(),
      loopPolicy: policy(),
      iterationNumber: 1,
      goalRun: goalRun({
        status: "unknown",
        summary: undefined,
        debug: {
          error: "malformed_goal_run",
          preview: '{"secret":"do-not-leak"}',
        },
      }),
      responseText: "safe text",
    });

    expect(JSON.stringify(decision.evidenceSummary)).not.toContain(
      "do-not-leak",
    );
    expect(JSON.stringify(decision.judgment.structuredOutput)).not.toContain(
      "do-not-leak",
    );
  });
});
