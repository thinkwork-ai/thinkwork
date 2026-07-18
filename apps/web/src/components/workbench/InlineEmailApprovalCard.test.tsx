import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#">{children}</a>,
}));

vi.mock("urql", () => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(),
}));

import { useMutation, useQuery } from "urql";
import { InlineEmailApprovalCard } from "@/components/workbench/InlineEmailApprovalCard";

const approve = vi.fn();
const reject = vi.fn();

beforeEach(() => {
  vi.mocked(useQuery).mockReturnValue([
    {
      data: {
        inboxItem: {
          id: "approval-1",
          type: "computer_approval",
          status: "PENDING",
          config: JSON.stringify({
            actionType: "email_send",
            emailDraft: {
              to: "buyer@example.com",
              subject: "Follow up",
              body: "Hello",
            },
          }),
        },
      },
      fetching: false,
      error: undefined,
    } as never,
  ] as never);
  vi.mocked(useMutation)
    .mockReturnValueOnce([{ fetching: false } as never, approve] as never)
    .mockReturnValueOnce([{ fetching: false } as never, reject] as never);
  approve.mockResolvedValue({
    data: {
      approveInboxItem: {
        id: "approval-1",
        type: "computer_approval",
        status: "APPROVED",
      },
    },
  });
  reject.mockResolvedValue({ data: {} });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("InlineEmailApprovalCard", () => {
  it("renders the durable draft and approves it from the originating thread", async () => {
    render(<InlineEmailApprovalCard approvalId="approval-1" />);

    expect(screen.getByText("Email awaiting approval")).toBeTruthy();
    expect(screen.getByText(/buyer@example.com/)).toBeTruthy();
    expect(screen.getByText(/Follow up/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Approve & send" }));

    expect(approve).toHaveBeenCalledWith({ id: "approval-1", input: {} });
  });
});
