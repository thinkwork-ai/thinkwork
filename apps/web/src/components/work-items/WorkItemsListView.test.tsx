import type React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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

    expect(screen.getByText("WI-1")).toBeTruthy();
    expect(screen.getByText("work-1")).toBeTruthy();
    expect(screen.getByLabelText("Priority: Normal")).toBeTruthy();
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
    expect(
      screen.getByRole("button", { name: "Search work items" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Filter" })).toBeTruthy();
    expect(screen.getByText("urgent")).toBeTruthy();
    expect(screen.getByText("normal")).toBeTruthy();
  });

  it("expands the toolbar search, focuses it, filters rows, and clears search", () => {
    render(
      <WorkItemsListView
        items={[
          item({ id: "customer-onboarding", title: "Customer onboarding" }),
          item({ id: "billing-cleanup", title: "Billing cleanup" }),
        ]}
        spaces={spaces}
        statuses={statuses}
        display={{
          ...DEFAULT_WORK_ITEM_SEARCH.list,
          group: "none",
          subgroup: "none",
          properties: ["status", "priority"],
        }}
        includeSpace
        onStatusChange={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("textbox", { name: "Search work items" }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Search work items" }));

    const searchInput = screen.getByRole("textbox", {
      name: "Search work items",
    });
    expect(document.activeElement).toBe(searchInput);

    fireEvent.change(searchInput, { target: { value: "billing" } });

    expect(screen.queryByText("Customer onboarding")).toBeNull();
    expect(screen.getByText("Billing cleanup")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Clear work item search" }),
    );

    expect(
      screen.queryByRole("textbox", { name: "Search work items" }),
    ).toBeNull();
    expect(screen.getByText("Customer onboarding")).toBeTruthy();
    expect(screen.getByText("Billing cleanup")).toBeTruthy();
  });

  it("defaults to filtering work items assigned to the current user", async () => {
    render(
      <WorkItemsListView
        items={[
          item({
            id: "mine",
            title: "My assigned work",
            ownerUserId: "user-1",
          }),
          item({
            id: "theirs",
            title: "Someone else's work",
            ownerUserId: "user-2",
          }),
          item({
            id: "unassigned",
            title: "Unassigned work",
            ownerUserId: null,
          }),
        ]}
        spaces={spaces}
        statuses={statuses}
        assignees={[
          { id: "user-1", name: "Eric Odom" },
          { id: "user-2", name: "Becky Moon" },
        ]}
        currentUserId="user-1"
        display={{
          ...DEFAULT_WORK_ITEM_SEARCH.list,
          group: "none",
          subgroup: "none",
          properties: ["status", "priority"],
        }}
        includeSpace
        onStatusChange={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("My assigned work")).toBeTruthy();
      expect(screen.queryByText("Someone else's work")).toBeNull();
      expect(screen.queryByText("Unassigned work")).toBeNull();
    });
  });

  it("centers the empty state without a message row divider", () => {
    render(
      <WorkItemsListView
        items={[]}
        spaces={spaces}
        statuses={statuses}
        display={{
          ...DEFAULT_WORK_ITEM_SEARCH.list,
          group: "none",
          subgroup: "none",
          properties: ["status", "priority"],
        }}
        includeSpace
        onStatusChange={vi.fn()}
      />,
    );

    const emptyState = screen.getByTestId("work-items-list-empty");
    const container = emptyState.parentElement;

    expect(emptyState.className).toContain("items-center");
    expect(emptyState.className).toContain("justify-center");
    expect(container?.className).toContain("border");
    expect(container?.className).toContain("items-center");
    expect(container?.className).toContain("justify-center");
    expect(screen.getByText("No work items in this view")).toBeTruthy();
    expect(screen.getByText("Rows per page")).toBeTruthy();
    expect(document.querySelector("table")).toBeNull();
  });

  it("opens detail from the row and updates assignee from the assignee control", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const onItemOpen = vi.fn();
    const onItemUpdate = vi.fn();
    const assigned = item({
      id: "assigned",
      title: "Assigned task",
      ownerUserId: "user-1",
    });

    render(
      <WorkItemsListView
        items={[assigned]}
        spaces={spaces}
        statuses={statuses}
        assignees={[
          { id: "user-1", name: "Becky Moon" },
          { id: "user-2", name: "Eric Odom" },
        ]}
        display={{
          ...DEFAULT_WORK_ITEM_SEARCH.list,
          group: "none",
          subgroup: "none",
          properties: ["status", "priority", "owner"],
        }}
        includeSpace
        onStatusChange={vi.fn()}
        onItemOpen={onItemOpen}
        onItemUpdate={onItemUpdate}
      />,
    );

    fireEvent.click(screen.getByText("Assigned task"));
    expect(onItemOpen).toHaveBeenCalledWith(assigned);

    onItemOpen.mockClear();
    fireEvent.click(
      screen.getByRole("button", { name: "Assignee: Becky Moon" }),
    );
    expect(onItemOpen).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByText("Eric Odom"));

    await waitFor(() =>
      expect(onItemUpdate).toHaveBeenCalledWith(assigned, {
        ownerUserId: "user-2",
      }),
    );
    expect(onItemOpen).not.toHaveBeenCalled();
  });

  it("renders the created date at the row end", () => {
    render(
      <WorkItemsListView
        items={[
          item({
            id: "created-date",
            title: "Created date task",
            createdAt: "2026-06-12T12:00:00Z",
          }),
        ]}
        spaces={spaces}
        statuses={statuses}
        display={{
          ...DEFAULT_WORK_ITEM_SEARCH.list,
          group: "none",
          subgroup: "none",
          properties: ["status", "priority"],
        }}
        includeSpace
        onStatusChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Jun 12")).toBeTruthy();
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
