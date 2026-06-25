import type React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkItemsBoardView } from "./WorkItemsBoardView";
import type {
  WorkItemSpaceSummary,
  WorkItemStatusSummary,
  WorkItemSummary,
} from "./work-item-display";
import { DEFAULT_WORK_ITEM_SEARCH } from "./work-item-filters";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
  }: {
    children: React.ReactNode;
    to: string;
    params?: Record<string, string>;
  }) => <a href={to}>{children}</a>,
}));

afterEach(() => {
  cleanup();
});

describe("WorkItemsBoardView", () => {
  it("renders priority columns from Board display state", () => {
    render(
      <WorkItemsBoardView
        items={[
          item({ id: "urgent", priority: "URGENT" }),
          item({ id: "normal", priority: "NORMAL" }),
        ]}
        spaces={spaces}
        statuses={statuses}
        display={{
          ...DEFAULT_WORK_ITEM_SEARCH.board,
          column: "priority",
          properties: ["priority", "owner"],
        }}
        onStatusChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Urgent" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Normal" })).toBeTruthy();
    expect(screen.getByText("urgent")).toBeTruthy();
    expect(screen.getByText("normal")).toBeTruthy();
  });

  it("hides empty finite lanes when configured", () => {
    render(
      <WorkItemsBoardView
        items={[item({ id: "urgent", priority: "URGENT" })]}
        spaces={spaces}
        statuses={statuses}
        display={{
          ...DEFAULT_WORK_ITEM_SEARCH.board,
          column: "priority",
          showEmptyColumns: false,
          properties: ["priority"],
        }}
        onStatusChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Urgent" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Low" })).toBeNull();
  });
});

const spaces: WorkItemSpaceSummary[] = [{ id: "space-1", name: "Launch" }];
const statuses: WorkItemStatusSummary[] = [
  { id: "todo", name: "Todo", category: "TODO" },
];

function item(overrides: Partial<WorkItemSummary>): WorkItemSummary {
  return {
    id: "work-item",
    spaceId: "space-1",
    title: overrides.id ?? "Work Item",
    priority: "NORMAL",
    required: false,
    applicable: true,
    blocked: false,
    updatedAt: "2026-06-25T00:00:00Z",
    ...overrides,
  };
}
