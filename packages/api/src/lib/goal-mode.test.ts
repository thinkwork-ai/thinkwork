import { describe, expect, it } from "vitest";
import { toRuntimeGoalModePayload } from "./goal-mode.js";

describe("runtime goal mode payload (agent-loop dispatch contract)", () => {
  it("converts runtime goal mode to the AgentCore payload shape", () => {
    expect(
      toRuntimeGoalModePayload({
        enabled: true,
        action: "resume",
        goalRunId: "goal-1",
        resolvedBudget: { tokenBudget: 250_000 },
      }),
    ).toEqual({
      enabled: true,
      action: "resume",
      objective: undefined,
      goal_run_id: "goal-1",
      resolved_budget: {
        token_budget: 250_000,
      },
    });
  });

  it("carries the objective for a start action", () => {
    expect(
      toRuntimeGoalModePayload({
        enabled: true,
        action: "start",
        objective: "Ship it",
        goalRunId: "run-1",
        resolvedBudget: { tokenBudget: 100_000 },
      }),
    ).toEqual({
      enabled: true,
      action: "start",
      objective: "Ship it",
      goal_run_id: "run-1",
      resolved_budget: { token_budget: 100_000 },
    });
  });
});
