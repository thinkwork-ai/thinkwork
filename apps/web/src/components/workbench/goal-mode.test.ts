import { describe, expect, it } from "vitest";
import { appendGoalModeMetadata, createStartGoalModeIntent } from "./goal-mode";

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
});
