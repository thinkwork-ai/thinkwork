import { describe, expect, it } from "vitest";
import {
  workspaceReviewActionsForStatus,
  workspaceReviewDecisionLabel,
  workspaceReviewErrorMessage,
} from "../workspace-review-state";

describe("workspace review state helpers", () => {
  it("enables decisions for awaiting review runs", () => {
    expect(workspaceReviewActionsForStatus("awaiting_review")).toEqual({
      accept: true,
      cancel: true,
      resume: true,
    });
  });

  it("limits pending runs to explicit continue", () => {
    expect(workspaceReviewActionsForStatus("pending")).toEqual({
      accept: false,
      cancel: false,
      resume: true,
    });
  });

  it("disables terminal run decisions", () => {
    expect(workspaceReviewActionsForStatus("cancelled")).toEqual({
      accept: false,
      cancel: false,
      resume: false,
    });
  });

  it("uses operator-facing action labels", () => {
    expect(workspaceReviewDecisionLabel("accept")).toBe("Accept and continue");
    expect(workspaceReviewDecisionLabel("resume")).toBe("Continue run");
    expect(workspaceReviewDecisionLabel("cancel")).toBe("Reject / cancel");
  });

  it("maps etag conflicts to a stable message", () => {
    expect(
      workspaceReviewErrorMessage(
        "[GraphQL] Review changed since you opened it",
      ),
    ).toBe("Review changed since you opened it");
  });
});
