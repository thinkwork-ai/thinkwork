import { describe, expect, it } from "vitest";
import {
  assertEmailApprovalRecipient,
  canReadEmailApproval,
} from "./email-approval-auth.js";

const assignedEmailApproval = {
  type: "computer_approval",
  recipient_id: "alice",
  config: { actionType: "email_send" },
};

describe("email approval recipient authorization", () => {
  it("allows the exact requesting user", () => {
    expect(() =>
      assertEmailApprovalRecipient(assignedEmailApproval, "alice"),
    ).not.toThrow();
    expect(canReadEmailApproval(assignedEmailApproval, "alice")).toBe(true);
  });

  it("rejects another member of the same tenant", () => {
    expect(() =>
      assertEmailApprovalRecipient(assignedEmailApproval, "bob"),
    ).toThrow("assigned to a different user");
    expect(canReadEmailApproval(assignedEmailApproval, "bob")).toBe(false);
  });

  it("keeps legacy unassigned and non-email approvals on the shared path", () => {
    expect(
      canReadEmailApproval(
        { ...assignedEmailApproval, recipient_id: null },
        "bob",
      ),
    ).toBe(true);
    expect(
      canReadEmailApproval(
        {
          type: "computer_approval",
          recipient_id: "alice",
          config: { actionType: "computer_task" },
        },
        "bob",
      ),
    ).toBe(true);
  });
});
