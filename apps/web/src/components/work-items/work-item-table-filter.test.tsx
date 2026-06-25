import { describe, expect, it } from "vitest";
import type { WorkItemSummary } from "./work-item-display";
import {
  WORK_ITEM_FILTER_COLUMN_VISIBILITY,
  WORK_ITEM_FILTER_COLUMNS,
  buildWorkItemFilterColumnDefs,
  buildWorkItemTokenFilterColumns,
  workItemDueFilterValue,
  workItemSearchFilterValue,
} from "./work-item-table-filter";

describe("work item table filter adapter", () => {
  it("hides every filter-only column by default", () => {
    expect(WORK_ITEM_FILTER_COLUMN_VISIBILITY).toEqual({
      filterSearch: false,
      filterStatus: false,
      filterPriority: false,
      filterDue: false,
      filterRequired: false,
      filterBlocked: false,
      filterApplicable: false,
      filterSpace: false,
      filterOwner: false,
    });
  });

  it("builds token filter columns that match hidden TanStack columns", () => {
    const tokenColumnIds = buildWorkItemTokenFilterColumns([
      { id: "space-1", name: "Engineering" },
    ]).map((column) => column.id);
    const tableColumnIds = buildWorkItemFilterColumnDefs().map(
      (column) => column.id,
    );

    expect(tokenColumnIds).toEqual(Object.values(WORK_ITEM_FILTER_COLUMNS));
    expect(tableColumnIds).toEqual(Object.values(WORK_ITEM_FILTER_COLUMNS));
  });

  it("classifies due dates for option filters", () => {
    const now = new Date("2026-06-25T12:00:00.000Z");

    expect(
      workItemDueFilterValue(item({ dueAt: "2026-06-24T12:00:00.000Z" }), now),
    ).toBe("overdue");
    expect(
      workItemDueFilterValue(item({ dueAt: "2026-06-28T12:00:00.000Z" }), now),
    ).toBe("due_soon");
    expect(
      workItemDueFilterValue(item({ dueAt: "2026-07-10T12:00:00.000Z" }), now),
    ).toBe("later");
    expect(workItemDueFilterValue(item({ dueAt: null }), now)).toBe("none");
  });

  it("combines human-readable fields into the search filter value", () => {
    expect(
      workItemSearchFilterValue(
        item({
          title: "Ship onboarding",
          notes: "Docusign blocker",
          priority: "HIGH",
          metadata: { ownerDisplay: "Alex" },
          status: { id: "active", name: "Doing", category: "ACTIVE" },
        }),
      ),
    ).toContain("Ship onboarding Docusign blocker Doing In progress High Alex");
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
