import { describe, expect, it } from "vitest";
import {
  evaluate,
  goalRunEvidence,
  hasGoalEvidence,
  promptFor,
  type Message,
  type ThreadTurn,
} from "../../scripts/pi-runtime-capability-smoke.js";

const assistant = (content = "done PI-GOAL-SMOKE"): Message => ({
  id: "msg-1",
  role: "ASSISTANT",
  content,
  createdAt: "2026-06-21T00:00:00.000Z",
});

const turn = (overrides: Partial<ThreadTurn>): ThreadTurn => ({
  id: "turn-1",
  status: "succeeded",
  threadId: "thread-1",
  createdAt: "2026-06-21T00:00:00.000Z",
  ...overrides,
});

describe("pi-runtime-capability-smoke goal evidence", () => {
  it("builds a goal-mode prompt that instructs the model to call goal_complete", () => {
    expect(promptFor("goal", "PI-GOAL-SMOKE")).toContain("goal_complete");
  });

  it("accepts completed persisted goal_run evidence with a goal_complete invocation", () => {
    const completedTurn = turn({
      usageJson: {
        goal_run: {
          source: "pi_goal",
          status: "complete",
          completion_summary: "Goal completed.",
        },
        tool_invocations: [
          {
            tool_name: "goal_complete",
            is_error: false,
            result: {
              details: {
                goal: "Finish smoke",
                summary: "Goal completed.",
              },
            },
          },
        ],
      },
    });

    expect(goalRunEvidence(completedTurn)).toMatchObject({
      source: "pi_goal",
      status: "complete",
    });
    expect(hasGoalEvidence(completedTurn)).toBe(true);
    expect(
      evaluate("goal", "PI-GOAL-SMOKE", completedTurn, assistant()),
    ).toMatchObject({
      status: "PASS",
      reason: "goal_run_evidence_present",
    });
  });

  it("accepts budget-limited persisted goal_run evidence", () => {
    const budgetLimitedTurn = turn({
      usageJson: {
        goal_run: {
          source: "pi_goal",
          status: "budget_limited",
          token_budget: 1200,
          tokens_used: 1200,
          budget_limited_reason: "token_budget_reached",
        },
      },
    });

    expect(hasGoalEvidence(budgetLimitedTurn)).toBe(true);
    expect(
      evaluate("goal", "PI-GOAL-SMOKE", budgetLimitedTurn, assistant()),
    ).toMatchObject({
      status: "PASS",
      reason: "goal_run_evidence_present",
    });
  });

  it("fails goal smoke when only assistant prose is present", () => {
    const proseOnlyTurn = turn({
      usageJson: {
        tool_invocations: [],
      },
      resultJson: {
        response: "I completed the goal.",
      },
    });

    expect(hasGoalEvidence(proseOnlyTurn)).toBe(false);
    expect(
      evaluate("goal", "PI-GOAL-SMOKE", proseOnlyTurn, assistant()),
    ).toMatchObject({
      status: "FAIL",
      reason: "no_goal_run_evidence_in_thread_turn_usage_json_or_result_json",
    });
  });

  it("falls back to result_json goal_run evidence", () => {
    const resultJsonTurn = turn({
      resultJson: {
        goal_run: {
          source: "pi_goal",
          status: "completed",
          completion_summary: "Completed from result_json.",
        },
      },
    });

    expect(hasGoalEvidence(resultJsonTurn)).toBe(true);
  });
});
