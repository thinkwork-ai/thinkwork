import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskDashboard } from "./TaskDashboard";

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: vi.fn(),
}));

afterEach(cleanup);

describe("TaskDashboard", () => {
  it("renders threads in the Computer table", () => {
    render(
      <TaskDashboard
        threads={[
          {
            id: "thread-1",
            number: 318,
            identifier: "CHAT-318",
            title: "Build CRM dashboard",
            status: "IN_PROGRESS",
            computerId: "computer-1",
            channel: "CHAT",
            updatedAt: "2026-05-08T16:00:00.000Z",
          },
        ]}
        totalCount={1}
        pageIndex={0}
        pageSize={50}
        search=""
        onPageChange={vi.fn()}
        onPageSizeChange={vi.fn()}
        onSearchChange={vi.fn()}
      />,
    );

    // "Computer" title and "1 thread" subtitle now live in AppTopBar via PageHeaderContext.
    expect(screen.getByText("CHAT-318")).toBeTruthy();
    expect(screen.getByText("Build CRM dashboard")).toBeTruthy();
    expect(screen.getByText("Computer-owned")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: /chat-318 build crm dashboard/i })
        .getAttribute("href"),
    ).toBe("/threads/thread-1");
  });

  it("updates the search filter", () => {
    const onSearchChange = vi.fn();
    render(
      <TaskDashboard
        threads={[]}
        totalCount={0}
        pageIndex={0}
        pageSize={50}
        search=""
        onPageChange={vi.fn()}
        onPageSizeChange={vi.fn()}
        onSearchChange={onSearchChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("Search threads"), {
      target: { value: "gas prices" },
    });

    expect(onSearchChange).toHaveBeenCalledWith("gas prices");
  });

  it("renders an empty state when there are no matching threads", () => {
    render(
      <TaskDashboard
        threads={[]}
        totalCount={0}
        pageIndex={0}
        pageSize={50}
        search=""
        onPageChange={vi.fn()}
        onPageSizeChange={vi.fn()}
        onSearchChange={vi.fn()}
      />,
    );

    expect(screen.getByText("No threads match the current search")).toBeTruthy();
  });
});
