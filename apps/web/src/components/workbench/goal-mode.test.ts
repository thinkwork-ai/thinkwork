import { describe, expect, it } from "vitest";
import {
  appendGoalModeMetadata,
  createStartGoalModeIntent,
  isGoalModeShorthand,
  resolveStartGoalModeSubmission,
} from "./goal-mode";

describe("composer goal mode metadata", () => {
  it("builds start intent from submitted text", () => {
    expect(createStartGoalModeIntent("  reconcile invoices  ")).toEqual({
      enabled: true,
      action: "start",
      objective: "reconcile invoices",
    });
    expect(createStartGoalModeIntent("   ")).toBeNull();
  });

  it("merges goal intent with existing metadata without budget fields", () => {
    expect(
      appendGoalModeMetadata(
        {
          attachments: [{ attachmentId: "att-1" }],
          requestedModelId: "anthropic.claude-haiku",
        },
        {
          enabled: true,
          action: "start",
          objective: "finish the analysis",
        },
      ),
    ).toEqual({
      attachments: [{ attachmentId: "att-1" }],
      requestedModelId: "anthropic.claude-haiku",
      goalMode: {
        enabled: true,
        action: "start",
        objective: "finish the analysis",
      },
    });
  });

  it("normalizes /goal shorthand without exposing budget fields", () => {
    expect(isGoalModeShorthand("/goal reconcile the customer list")).toBe(true);

    expect(
      resolveStartGoalModeSubmission(
        "/goal reconcile the customer list",
        false,
      ),
    ).toEqual({
      content: "reconcile the customer list",
      requested: true,
      goalMode: {
        enabled: true,
        action: "start",
        objective: "reconcile the customer list",
      },
    });
  });

  it("marks empty goal shorthand as requested without creating an intent", () => {
    expect(resolveStartGoalModeSubmission("/goal", false)).toEqual({
      content: "",
      goalMode: null,
      requested: true,
    });
  });

  it("creates a normal start intent when the icon toggle is enabled", () => {
    expect(resolveStartGoalModeSubmission("Finish the rollout", true)).toEqual({
      content: "Finish the rollout",
      requested: true,
      goalMode: {
        enabled: true,
        action: "start",
        objective: "Finish the rollout",
      },
    });
  });
});
