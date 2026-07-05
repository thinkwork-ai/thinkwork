import { describe, expect, it } from "vitest";

import { pushNavigationTarget } from "./push-navigation";

describe("pushNavigationTarget", () => {
  it("routes computer approval notifications to a native approval target", () => {
    expect(
      pushNavigationTarget(
        {
          type: "computer_approval",
          approvalId: "approval-1",
          deepLinkUrl: "https://computer.thinkwork.ai/approvals/approval-1",
        },
        null,
      ),
    ).toEqual({
      kind: "computer_approval",
      approvalId: "approval-1",
    });
    expect(
      pushNavigationTarget(
        {
          type: "computer_approval",
          approvalId: "approval-1",
          deepLinkUrl: "https://computer.thinkwork.ai/approvals/approval-1",
        },
        null,
      ),
    ).not.toHaveProperty("url");
  });

  it("keeps existing thread notification navigation", () => {
    expect(pushNavigationTarget({ threadId: "thread-1" }, null)).toEqual({
      kind: "thread",
      threadId: "thread-1",
    });
  });

  it("lets Expo content data override raw trigger payload data", () => {
    expect(
      pushNavigationTarget(
        {
          type: "computer_approval",
          approvalId: "approval-2",
        },
        { threadId: "thread-1" },
      ),
    ).toEqual({
      kind: "computer_approval",
      approvalId: "approval-2",
    });
  });

  it("ignores unrecognized payloads", () => {
    expect(pushNavigationTarget({ type: "unknown" }, null)).toBeNull();
  });
});
