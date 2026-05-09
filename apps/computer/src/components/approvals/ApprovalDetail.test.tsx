import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApprovalDetail } from "@/components/approvals/ApprovalDetail";

afterEach(cleanup);

describe("ApprovalDetail", () => {
  it("renders payload details and approve/deny actions", () => {
    const onApprove = vi.fn();
    const onDeny = vi.fn();
    render(
      <ApprovalDetail
        approval={{
          id: "approval-1",
          type: "computer_approval",
          status: "PENDING",
          title: "Approve source read?",
          config: {
            question: "Use CRM pipeline records?",
            actionType: "crm_read",
            actionDescription: "Read opportunity metadata.",
            evidence: ["LastMile pipeline"],
          },
          createdAt: "2026-05-08T12:00:00.000Z",
        }}
        onApprove={onApprove}
        onDeny={onDeny}
      />,
    );

    expect(screen.getByText("Use CRM pipeline records?")).toBeTruthy();
    expect(screen.getByText("LastMile pipeline")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));
    fireEvent.click(screen.getByRole("button", { name: /deny/i }));

    expect(onApprove).toHaveBeenCalledWith();
    expect(onDeny).toHaveBeenCalledTimes(1);
  });

  it("submits edited email drafts through decision values", () => {
    const onApprove = vi.fn();
    render(
      <ApprovalDetail
        approval={{
          id: "approval-1",
          type: "computer_approval",
          status: "PENDING",
          config: {
            question: "Send this email?",
            actionType: "email_send",
            emailDraft: {
              to: "buyer@example.com",
              subject: "Pipeline follow-up",
              body: "Original draft",
            },
          },
        }}
        onApprove={onApprove}
        onDeny={() => {}}
      />,
    );

    fireEvent.change(screen.getByLabelText("Draft"), {
      target: { value: "Edited draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: /edit and approve/i }));

    expect(onApprove).toHaveBeenCalledWith({
      editedDraft: {
        to: "buyer@example.com",
        subject: "Pipeline follow-up",
        body: "Edited draft",
      },
    });
  });
});
