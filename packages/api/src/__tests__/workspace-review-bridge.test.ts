import { describe, expect, it } from "vitest";
import { isWorkspaceReviewInboxItem } from "../graphql/resolvers/inbox/workspace-review-bridge.js";

describe("isWorkspaceReviewInboxItem", () => {
  it("returns true for a workspace_review item linked to a run", () => {
    expect(
      isWorkspaceReviewInboxItem({
        type: "workspace_review",
        entity_type: "agent_workspace_run",
      }),
    ).toBe(true);
  });

  it("returns false for other inbox types (e.g., legacy task_assigned)", () => {
    expect(
      isWorkspaceReviewInboxItem({
        type: "task_assigned",
        entity_type: "thread",
      }),
    ).toBe(false);
  });

  it("returns false for workspace_review type with wrong entity_type", () => {
    expect(
      isWorkspaceReviewInboxItem({
        type: "workspace_review",
        entity_type: "thread",
      }),
    ).toBe(false);
  });

  it("returns false when entity_type is null", () => {
    expect(
      isWorkspaceReviewInboxItem({
        type: "workspace_review",
        entity_type: null,
      }),
    ).toBe(false);
  });
});
