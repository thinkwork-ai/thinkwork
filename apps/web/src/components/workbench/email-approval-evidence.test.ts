import { describe, expect, it } from "vitest";
import { emailApprovalIdsForTurn } from "@/components/workbench/TaskThreadView";

describe("emailApprovalIdsForTurn", () => {
  it("extracts the durable approval id from governed email evidence", () => {
    expect(
      emailApprovalIdsForTurn({
        tool_invocations: [
          {
            operation: "email.send",
            status: "completed",
            output_preview: JSON.stringify({
              status: "pending_review",
              inboxItemId: "approval-1",
              approvalUrl: "/approvals/approval-1",
            }),
          },
        ],
      }),
    ).toEqual(["approval-1"]);
  });

  it("does not invent a card from model prose or sent evidence", () => {
    expect(
      emailApprovalIdsForTurn({
        tools_called: [],
        tool_invocations: [
          {
            operation: "email.send",
            output_preview: JSON.stringify({ status: "sent" }),
          },
        ],
      }),
    ).toEqual([]);
  });
});
