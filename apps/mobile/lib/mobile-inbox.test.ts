import { describe, expect, it } from "vitest";

import {
  COMPUTER_APPROVAL_INBOX_TYPE,
  visibleMobileInboxItems,
} from "./mobile-inbox";

describe("visibleMobileInboxItems", () => {
  it("filters computer approvals out of the mobile inbox feed", () => {
    const items = [
      { id: "routine-1", type: "routine_approval" },
      { id: "computer-1", type: COMPUTER_APPROVAL_INBOX_TYPE },
      {
        id: "email-approval-1",
        type: COMPUTER_APPROVAL_INBOX_TYPE,
        config: { actionType: "email_send" },
      },
      {
        id: "email-approval-2",
        type: COMPUTER_APPROVAL_INBOX_TYPE,
        config: JSON.stringify({ emailDraft: { subject: "Hello" } }),
      },
      { id: "review-1", type: "workspace_review" },
    ];

    expect(visibleMobileInboxItems(items).map((item) => item.id)).toEqual([
      "routine-1",
      "email-approval-1",
      "email-approval-2",
      "review-1",
    ]);
  });
});
