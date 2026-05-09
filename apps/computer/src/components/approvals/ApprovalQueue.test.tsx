import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ApprovalQueue } from "@/components/approvals/ApprovalQueue";

afterEach(cleanup);

describe("ApprovalQueue", () => {
  it("renders pending Computer approvals", () => {
    render(
      <ApprovalQueue
        approvals={[
          {
            id: "approval-1",
            type: "computer_approval",
            status: "PENDING",
            title: "Read Gmail metadata?",
            description: "Computer needs recent account context.",
            config: {
              question: "Read Gmail metadata for LastMile?",
              actionType: "gmail_read",
              actionDescription: "Read sender and subject metadata only.",
            },
            createdAt: "2026-05-08T12:00:00.000Z",
          },
        ]}
      />,
    );

    expect(screen.getByText("Read Gmail metadata for LastMile?")).toBeTruthy();
    expect(screen.getByText("gmail_read")).toBeTruthy();
  });

  it("renders an empty state", () => {
    render(<ApprovalQueue approvals={[]} />);

    expect(screen.getByText("No pending approvals")).toBeTruthy();
  });
});
