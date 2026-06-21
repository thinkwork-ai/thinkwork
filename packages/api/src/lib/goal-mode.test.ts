import { describe, expect, it } from "vitest";
import {
  DEFAULT_GOAL_TOKEN_BUDGET,
  MAX_GOAL_TOKEN_BUDGET,
} from "./goal-budget.js";
import {
  normalizeComposerGoalModeIntent,
  normalizeMessageGoalModeMetadata,
  toRuntimeGoalMode,
  toRuntimeGoalModePayload,
} from "./goal-mode.js";

describe("goal mode metadata contract", () => {
  it("normalizes start intent using the submitted message as the objective", () => {
    expect(
      normalizeComposerGoalModeIntent({ enabled: true }, "  reconcile AR  "),
    ).toEqual({
      enabled: true,
      action: "start",
      objective: "reconcile AR",
    });
  });

  it("keeps composer metadata free of resolved budget fields", () => {
    expect(() =>
      normalizeComposerGoalModeIntent(
        { enabled: true, tokenBudget: 10_000 },
        "do the work",
      ),
    ).toThrow(
      "Goal mode budget is resolved from tenant Agent settings, not composer metadata.",
    );
  });

  it("rejects malformed goal intent", () => {
    expect(() => normalizeComposerGoalModeIntent([], "do the work")).toThrow(
      "Goal mode metadata must be an object.",
    );
    expect(() =>
      normalizeComposerGoalModeIntent({ enabled: true, action: "fly" }, "go"),
    ).toThrow("Goal mode action is not supported.");
    expect(() =>
      normalizeComposerGoalModeIntent({ enabled: true }, "   "),
    ).toThrow("Goal mode requires a text objective.");
  });

  it("normalizes message metadata and preserves unrelated fields", () => {
    expect(
      normalizeMessageGoalModeMetadata(
        {
          attachments: [{ attachmentId: "att-1" }],
          goalMode: { enabled: true, action: "start" },
        },
        "Ship it",
      ),
    ).toEqual({
      metadata: {
        attachments: [{ attachmentId: "att-1" }],
        goalMode: {
          enabled: true,
          action: "start",
          objective: "Ship it",
        },
      },
      goalMode: {
        enabled: true,
        action: "start",
        objective: "Ship it",
      },
    });
  });

  it("creates the runtime envelope with server-resolved budget only", () => {
    expect(
      toRuntimeGoalMode(
        { enabled: true, action: "start", objective: "Ship it" },
        DEFAULT_GOAL_TOKEN_BUDGET,
      ),
    ).toEqual({
      enabled: true,
      action: "start",
      objective: "Ship it",
      resolvedBudget: {
        tokenBudget: DEFAULT_GOAL_TOKEN_BUDGET,
      },
    });
    expect(() =>
      toRuntimeGoalMode(
        { enabled: true, action: "start", objective: "Ship it" },
        MAX_GOAL_TOKEN_BUDGET + 1,
      ),
    ).toThrow("Goal token budget must be a positive whole number");
  });

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
});
