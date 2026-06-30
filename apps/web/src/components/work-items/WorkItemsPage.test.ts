import { describe, expect, it } from "vitest";
import {
  shouldShowWorkItemsPageSkeleton,
  sortWorkItems,
  summarizeWorkItems,
} from "./WorkItemsPage";
import type { WorkItemSummary } from "./work-item-display";

describe("WorkItemsPage helpers", () => {
  it("summarizes open, required, blocked, and due-soon work", () => {
    const today = new Date().toISOString();

    expect(
      summarizeWorkItems([
        item({ id: "open-required", required: true, dueAt: today }),
        item({ id: "blocked", blocked: true, priority: "HIGH" }),
        item({
          id: "done",
          required: true,
          completedAt: today,
          status: { id: "done", name: "Done", category: "DONE" },
        }),
      ]),
    ).toEqual({
      open: 2,
      requiredOpen: 1,
      blocked: 1,
      dueSoon: 1,
    });
  });

  it("sorts by priority and title", () => {
    const rows = [
      item({ id: "normal", title: "Bravo", priority: "NORMAL" }),
      item({ id: "urgent", title: "Charlie", priority: "URGENT" }),
      item({ id: "low", title: "Alpha", priority: "LOW" }),
    ];

    expect(sortWorkItems(rows, "priority").map((row) => row.id)).toEqual([
      "urgent",
      "normal",
      "low",
    ]);
    expect(sortWorkItems(rows, "title").map((row) => row.id)).toEqual([
      "low",
      "normal",
      "urgent",
    ]);
  });

  it("keeps the page skeleton visible until work items and assignees are both loaded", () => {
    const loadedWorkItems = { workItems: [] };
    const loadedMembers = { tenantMembers: [] };

    expect(
      shouldShowWorkItemsPageSkeleton({
        tenantId: "tenant-1",
        workItemsData: loadedWorkItems,
        membersData: undefined,
      }),
    ).toBe(true);
    expect(
      shouldShowWorkItemsPageSkeleton({
        tenantId: "tenant-1",
        workItemsData: undefined,
        membersData: loadedMembers,
      }),
    ).toBe(true);
    expect(
      shouldShowWorkItemsPageSkeleton({
        tenantId: "tenant-1",
        workItemsData: loadedWorkItems,
        membersData: loadedMembers,
      }),
    ).toBe(false);
  });
});

function item(overrides: Partial<WorkItemSummary>): WorkItemSummary {
  return {
    id: "work-item",
    spaceId: "space-1",
    title: "Work Item",
    priority: "NORMAL",
    required: false,
    applicable: true,
    blocked: false,
    ...overrides,
  };
}
