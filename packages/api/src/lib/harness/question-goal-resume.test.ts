import { describe, expect, it } from "vitest";
import { goalModeFromQuestionSourceTurn } from "./question-goal-resume.js";

describe("question-card Goal mode continuation", () => {
  it("projects only canonical resumable goal evidence", () => {
    expect(
      goalModeFromQuestionSourceTurn({
        resultJson: {
          goal_run: {
            status: "paused",
            goal_id: "agentcore:turn-1",
            objective: "Ship the report",
            token_budget: 100_000,
          },
        },
        usageJson: null,
      }),
    ).toEqual({
      enabled: true,
      action: "resume",
      objective: "Ship the report",
      goalRunId: "agentcore:turn-1",
      resolvedBudget: { tokenBudget: 100_000 },
    });
  });

  it("rejects terminal and malformed source evidence", () => {
    expect(
      goalModeFromQuestionSourceTurn({
        resultJson: {
          goal_run: {
            status: "complete",
            goal_id: "goal-1",
            objective: "Done",
            token_budget: 100,
          },
        },
        usageJson: null,
      }),
    ).toBeNull();
    expect(
      goalModeFromQuestionSourceTurn({
        resultJson: null,
        usageJson: {
          goal_run: { status: "paused", objective: "Missing id" },
        },
      }),
    ).toBeNull();
  });
});
