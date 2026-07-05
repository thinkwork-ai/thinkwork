import { describe, expect, it } from "vitest";

import {
  approvalQuestion,
  buildApprovalDecisionVariables,
  isAlreadyResolvedInboxError,
  isApprovalExpired,
  visibleApprovalItems,
} from "./inbox-approvals";

describe("approval inbox helpers", () => {
  it("keeps pending email-send computer approvals visible", () => {
    const visible = visibleApprovalItems([
      {
        id: "email-approval",
        type: "computer_approval",
        status: "PENDING",
        config: { actionType: "email_send", question: "Send this email?" },
      },
    ]);

    expect(visible).toHaveLength(1);
    expect(approvalQuestion(visible[0])).toBe("Send this email?");
  });

  it("hides non-email-send computer approvals", () => {
    expect(
      visibleApprovalItems([
        {
          id: "browser-approval",
          type: "computer_approval",
          status: "PENDING",
          config: { actionType: "browser_click" },
        },
      ]),
    ).toEqual([]);
  });

  it("builds reject variables with trimmed review notes", () => {
    expect(
      buildApprovalDecisionVariables("approval-1", "  Not the right draft  "),
    ).toEqual({
      id: "approval-1",
      input: { reviewNotes: "Not the right draft" },
    });
  });

  it("omits empty review notes from mutation variables", () => {
    expect(buildApprovalDecisionVariables("approval-1", "   ")).toEqual({
      id: "approval-1",
      input: {},
    });
  });

  it("maps server transition errors to already-resolved state", () => {
    expect(
      isAlreadyResolvedInboxError({
        graphQLErrors: [
          { message: "Invalid inbox item transition: approved -> rejected" },
        ],
      }),
    ).toBe(true);
    expect(isAlreadyResolvedInboxError(new Error("network down"))).toBe(false);
  });

  it("detects expired approvals distinctly", () => {
    expect(
      isApprovalExpired({
        id: "approval-1",
        status: "EXPIRED",
      }),
    ).toBe(true);
    expect(
      isApprovalExpired({
        id: "approval-2",
        status: "PENDING",
        expiresAt: "2000-01-01T00:00:00.000Z",
      }),
    ).toBe(true);
  });
});
