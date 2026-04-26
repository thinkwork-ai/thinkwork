import { describe, expect, it } from "vitest";
import {
  formatWorkspaceReviewTime,
  parseWorkspaceReviewPayload,
  shortWorkspaceId,
  workspaceReviewActionsForStatus,
  workspaceReviewDecisionLabel,
  workspaceReviewErrorMessage,
} from "../../../../mobile/lib/workspace-review-state";

describe("mobile workspace review state helpers", () => {
  it("enables all decisions for awaiting review runs", () => {
    expect(workspaceReviewActionsForStatus("awaiting_review")).toEqual({
      accept: true,
      cancel: true,
      resume: true,
    });
  });

  it("only allows continue for pending runs", () => {
    expect(workspaceReviewActionsForStatus("pending")).toEqual({
      accept: false,
      cancel: false,
      resume: true,
    });
  });

  it("uses concise user-facing labels", () => {
    expect(workspaceReviewDecisionLabel("accept")).toBe("Approve");
    expect(workspaceReviewDecisionLabel("resume")).toBe("Continue");
    expect(workspaceReviewDecisionLabel("cancel")).toBe("Reject");
  });

  it("parses payload JSON safely", () => {
    expect(parseWorkspaceReviewPayload('{"fileName":"review.md"}')).toEqual({
      fileName: "review.md",
    });
    expect(parseWorkspaceReviewPayload("nope")).toEqual({});
  });

  it("normalizes stale review errors", () => {
    expect(
      workspaceReviewErrorMessage(
        "[GraphQL] Review changed since you opened it",
      ),
    ).toBe("This review changed. Refresh before deciding.");
  });

  it("formats compact identifiers and times", () => {
    expect(shortWorkspaceId("123456789")).toBe("12345678");
    expect(formatWorkspaceReviewTime(new Date().toISOString())).toBe(
      "just now",
    );
  });
});
