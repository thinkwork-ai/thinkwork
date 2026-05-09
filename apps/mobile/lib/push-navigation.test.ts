import { describe, expect, it } from "vitest";

import { pushNavigationTarget } from "./push-navigation";

describe("pushNavigationTarget", () => {
  it("opens computer approval notifications at the apps/computer approval URL", () => {
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
      url: "https://computer.thinkwork.ai/approvals/approval-1",
    });
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
          deepLinkUrl: "https://computer.thinkwork.ai/approvals/approval-2",
        },
        { threadId: "thread-1" },
      ),
    ).toEqual({
      kind: "computer_approval",
      url: "https://computer.thinkwork.ai/approvals/approval-2",
    });
  });
});
