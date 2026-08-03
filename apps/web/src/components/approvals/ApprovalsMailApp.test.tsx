import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApprovalsMailApp } from "@/components/approvals/ApprovalsMailApp";
import type { ComputerApproval } from "@/components/approvals/approval-types";

afterEach(cleanup);

const emailApproval: ComputerApproval = {
  id: "approval-1",
  type: "computer_approval",
  status: "pending",
  title: "Review email to buyer@example.com",
  createdAt: "2026-08-03T14:32:55Z",
  config: {
    question: "Send this email?",
    actionType: "email_send",
    emailDraft: {
      to: "buyer@example.com",
      subject: "Order export",
      body: "Line one\nLine two",
    },
    emailChannel: { from: "default@tenant.thinkwork.ai" },
  },
};

const otherApproval: ComputerApproval = {
  id: "approval-2",
  type: "computer_approval",
  status: "pending",
  title: "Run this task?",
  createdAt: "2026-08-03T15:00:00Z",
  config: {
    question: "Run this task?",
    actionType: "task_run",
    actionDescription: "Review the requested task.",
  },
};

function renderApp(
  overrides: Partial<Parameters<typeof ApprovalsMailApp>[0]> = {},
) {
  const props = {
    approvals: [emailApproval, otherApproval],
    selectedId: "approval-1",
    onSelect: vi.fn(),
    onApprove: vi.fn(),
    onDeny: vi.fn(),
    ...overrides,
  };
  render(<ApprovalsMailApp {...props} />);
  return props;
}

describe("ApprovalsMailApp", () => {
  it("renders the list and the selected email in the reading pane", () => {
    renderApp();
    expect(
      screen.getByRole("heading", { name: "Order export" }),
    ).toBeTruthy();
    expect(screen.getByText("From: default@tenant.thinkwork.ai")).toBeTruthy();
    expect(screen.getAllByText(/Line one/).length).toBeGreaterThan(0);
  });

  it("selects another approval from the list", () => {
    const props = renderApp();
    fireEvent.click(screen.getByRole("button", { name: /Run this task\?/ }));
    expect(props.onSelect).toHaveBeenCalledWith("approval-2");
  });

  it("approves and denies the selected approval", () => {
    const props = renderApp();
    fireEvent.click(screen.getByRole("button", { name: /approve & send/i }));
    expect(props.onApprove).toHaveBeenCalledWith("approval-1", undefined);
    fireEvent.click(screen.getByRole("button", { name: /deny/i }));
    expect(props.onDeny).toHaveBeenCalledWith("approval-1");
  });

  it("shows the empty state when nothing is pending", () => {
    renderApp({ approvals: [], selectedId: null });
    expect(screen.getAllByText("No pending approvals").length).toBeGreaterThan(
      0,
    );
  });
});
