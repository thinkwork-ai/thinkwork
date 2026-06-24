import { describe, expect, it } from "vitest";

import {
  categoryStatuses,
  isWorkItemOpen,
  isWorkItemDueSoon,
  sortWorkItemStatuses,
  workItemDueLabel,
  workItemOwnerLabel,
  workItemSourceLabel,
  workItemStatusCategory,
  workItemStatusCategoryLabel,
  type WorkItemSummary,
} from "./work-item-display";

const baseItem: WorkItemSummary = {
  id: "work-1",
  spaceId: "space-1",
  title: "Send DocuSign",
  priority: "NORMAL",
  required: true,
  applicable: true,
  blocked: false,
  status: {
    id: "status-1",
    name: "Todo",
    category: "TODO",
    displayOrder: 0,
  },
};

describe("work item display helpers", () => {
  it("normalizes broad status categories for cross-Space boards", () => {
    expect(workItemStatusCategoryLabel("ACTIVE")).toBe("In progress");
    expect(workItemStatusCategory({ ...baseItem, blocked: true })).toBe(
      "BLOCKED",
    );
    expect(workItemStatusCategory({ ...baseItem, applicable: false })).toBe(
      "SKIPPED",
    );
    expect(categoryStatuses().map((status) => status.category)).toEqual([
      "TODO",
      "ACTIVE",
      "BLOCKED",
      "DONE",
      "SKIPPED",
    ]);
  });

  it("sorts Space statuses by normalized category and display order", () => {
    expect(
      sortWorkItemStatuses([
        { id: "done", name: "Done", category: "DONE", displayOrder: 30 },
        { id: "doing", name: "Doing", category: "ACTIVE", displayOrder: 10 },
        { id: "todo", name: "Todo", category: "TODO", displayOrder: 0 },
      ]).map((status) => status.id),
    ).toEqual(["todo", "doing", "done"]);
  });

  it("extracts owner and source labels from onboarding metadata", () => {
    const item = {
      ...baseItem,
      metadata: {
        workflow: "customer_onboarding",
        assignee: { displayName: "Sales" },
      },
    };

    expect(workItemOwnerLabel(item)).toBe("Sales");
    expect(workItemSourceLabel(item)).toBe("Customer onboarding");
  });

  it("formats due state without viewport-dependent text", () => {
    const now = new Date("2026-06-24T12:00:00.000Z");
    expect(workItemDueLabel("2026-06-23T20:00:00.000Z", now)).toContain(
      "overdue",
    );
    expect(workItemDueLabel("2026-06-24T20:00:00.000Z", now)).toContain(
      "today",
    );
    expect(isWorkItemDueSoon("2026-06-30T20:00:00.000Z", now)).toBe(true);
  });

  it("treats completed and skipped work as closed", () => {
    expect(isWorkItemOpen(baseItem)).toBe(true);
    expect(
      isWorkItemOpen({
        ...baseItem,
        status: { id: "done", name: "Done", category: "DONE" },
      }),
    ).toBe(false);
  });
});
