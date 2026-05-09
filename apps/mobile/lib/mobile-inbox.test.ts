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
      { id: "review-1", type: "workspace_review" },
    ];

    expect(visibleMobileInboxItems(items).map((item) => item.id)).toEqual([
      "routine-1",
      "review-1",
    ]);
  });
});
