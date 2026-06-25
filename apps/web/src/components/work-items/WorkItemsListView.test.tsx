import type React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkItemsListView } from "./WorkItemsListView";
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

describe("WorkItemsListView", () => {
  it("hides unselected metadata while preserving title and status controls", () => {
    render(
      <WorkItemsListView
        items={[item({ id: "work-1", dueAt: "2026-06-30T00:00:00Z" })]}
        spaces={spaces}
        statuses={statuses}
        display={{
          ...DEFAULT_WORK_ITEM_SEARCH.list,
          properties: ["status", "priority"],
        }}
        includeSpace
        onStatusChange={vi.fn()}
      />,
    );

    expect(screen.getByText("work-1")).toBeTruthy();
    expect(screen.getByText("Normal")).toBeTruthy();
    expect(screen.queryByText(/Jun 30/)).toBeNull();
  });

  it("groups rows by selected Work Item display fields", () => {
    render(
      <WorkItemsListView
        items={[
          item({ id: "urgent", priority: "URGENT" }),
          item({ id: "normal", priority: "NORMAL" }),
        ]}
        spaces={spaces}
        statuses={statuses}
        display={{
          ...DEFAULT_WORK_ITEM_SEARCH.list,
          group: "priority",
          properties: ["priority"],
        }}
        includeSpace
        onStatusChange={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Urgent").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Normal").length).toBeGreaterThan(0);
    expect(screen.getByText("urgent")).toBeTruthy();
    expect(screen.getByText("normal")).toBeTruthy();
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
