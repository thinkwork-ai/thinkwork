import { describe, expect, it } from "vitest";
import {
  buildHarnessGoalEvidence,
  goalStatusAfterStep,
  parseGoalCompleteInput,
  parseHarnessGoalMode,
  resolveHarnessGoalExecution,
} from "./goal-mode.js";

const NOW = Date.parse("2026-07-18T12:00:00.000Z");

describe("AgentCore Harness Goal mode", () => {
  it("starts a persisted ThinkWork-managed goal with a deterministic id", () => {
    const mode = parseHarnessGoalMode({
      enabled: true,
      action: "start",
      objective: "Ship AgentCore parity",
      resolved_budget: { token_budget: 100_000 },
    })!;
    expect(
      resolveHarnessGoalExecution({
        mode,
        turnId: "turn-1",
        previous: null,
        now: NOW,
      }),
    ).toMatchObject({
      goalId: "agentcore:turn-1",
      objective: "Ship AgentCore parity",
      tokenBudget: 100_000,
      iteration: 1,
    });
  });

  it("resumes only canonical same-id state and accumulates budget/progress", () => {
    const mode = parseHarnessGoalMode({
      enabled: true,
      action: "resume",
      objective: "Ship AgentCore parity",
      goal_run_id: "agentcore:turn-1",
      resolved_budget: { token_budget: 150_000 },
    })!;
    const execution = resolveHarnessGoalExecution({
      mode,
      turnId: "turn-2",
      now: NOW,
      previous: {
        goal_id: "agentcore:turn-1",
        objective: "Ship AgentCore parity",
        status: "paused",
        token_budget: 100_000,
        tokens_used: 12_000,
        iteration: 1,
        time_used_seconds: 8,
        started_at: "2026-07-18T11:00:00.000Z",
      },
    });
    expect(execution).toMatchObject({
      goalId: "agentcore:turn-1",
      tokenBudget: 150_000,
      previousTokensUsed: 12_000,
      iteration: 2,
    });
    expect(
      buildHarnessGoalEvidence({
        execution,
        status: "complete",
        currentTokensUsed: 2_000,
        currentTimeUsedSeconds: 3,
        now: NOW,
        summary: "Parity shipped.",
        verificationNotes: ["E2E green"],
      }),
    ).toMatchObject({
      status: "complete",
      tokens_used: 14_000,
      time_used_seconds: 11,
      completion_summary: "Parity shipped.",
      verification_notes: ["E2E green"],
      resume_eligible: false,
    });
  });

  it("rejects cross-goal and terminal resumes", () => {
    const mode = parseHarnessGoalMode({
      enabled: true,
      action: "resume",
      goal_run_id: "goal-2",
      resolved_budget: { token_budget: 1_000 },
    })!;
    expect(() =>
      resolveHarnessGoalExecution({
        mode,
        turnId: "turn-2",
        now: NOW,
        previous: { goal_id: "goal-1", objective: "A", status: "paused" },
      }),
    ).toThrow(/canonical prior goal state/);
    expect(() =>
      resolveHarnessGoalExecution({
        mode,
        turnId: "turn-2",
        now: NOW,
        previous: {
          goal_id: "goal-2",
          objective: "A",
          status: "complete",
        },
      }),
    ).toThrow(/terminal goal/);
  });

  it("uses the persisted budget to mark a bounded step budget-limited", () => {
    const execution = {
      action: "resume" as const,
      goalId: "goal-1",
      objective: "Finish",
      tokenBudget: 100,
      previousTokensUsed: 90,
      previousTimeUsedSeconds: 0,
      iteration: 2,
      startedAt: "2026-07-18T11:00:00.000Z",
    };
    expect(goalStatusAfterStep(execution, 10)).toBe("budget_limited");
    expect(goalStatusAfterStep(execution, 9)).toBe("paused");
  });

  it("validates bounded goal_complete evidence", () => {
    expect(parseGoalCompleteInput({})).toEqual({
      ok: false,
      error: "goal_complete requires a non-empty summary",
    });
    expect(
      parseGoalCompleteInput({
        summary: "Done",
        completion_notes: "All requested work completed.",
        verification_notes: ["Tests green"],
      }),
    ).toEqual({
      ok: true,
      summary: "Done",
      completionNotes: "All requested work completed.",
      verificationNotes: ["Tests green"],
    });
  });
});
