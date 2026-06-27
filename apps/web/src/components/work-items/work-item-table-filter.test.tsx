import { describe, expect, it } from "vitest";
import type { WorkItemSummary } from "./work-item-display";
import {
  WORK_ITEM_FILTER_COLUMN_VISIBILITY,
  WORK_ITEM_FILTER_COLUMNS,
  WORK_ITEM_UNASSIGNED_FILTER_VALUE,
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
      filterLabel: false,
    });
  });

  it("builds token filter columns that match hidden TanStack columns", () => {
    const tokenColumnIds = buildWorkItemTokenFilterColumns([
      { id: "space-1", name: "Engineering" },
    ]).map((column) => column.id);
    const tableColumnIds = buildWorkItemFilterColumnDefs().map(
      (column) => column.id,
    );

    expect(new Set(tokenColumnIds)).toEqual(
      new Set(Object.values(WORK_ITEM_FILTER_COLUMNS)),
    );
    expect(tableColumnIds).toEqual(Object.values(WORK_ITEM_FILTER_COLUMNS));
  });

  it("builds assignee option filters from stable user ids", () => {
    const tokenColumns = buildWorkItemTokenFilterColumns(
      [],
      [{ id: "user-1", name: "Eric Odom", email: "eric@example.com" }],
    );
    const assigneeTokenColumn = tokenColumns.find(
      (column) => column.id === WORK_ITEM_FILTER_COLUMNS.owner,
    );
    expect(assigneeTokenColumn?.type).toBe("option");
    expect(
      assigneeTokenColumn?.options?.map((option) => [
        option.value,
        option.label,
      ]),
    ).toEqual([
      [WORK_ITEM_UNASSIGNED_FILTER_VALUE, "Unassigned"],
      ["user-1", "Eric Odom"],
    ]);

    const ownerColumn = buildWorkItemFilterColumnDefs().find(
      (column) => column.id === WORK_ITEM_FILTER_COLUMNS.owner,
    );
    const accessor = (
      ownerColumn as
        | { accessorFn?: (row: WorkItemSummary, index: number) => unknown }
        | undefined
    )?.accessorFn;
    expect(accessor?.(item({ ownerUserId: "user-1" }), 0)).toBe("user-1");
    expect(accessor?.(item({ ownerUserId: null }), 0)).toBe(
      WORK_ITEM_UNASSIGNED_FILTER_VALUE,
    );
  });

  it("filters items by any assigned label slug", () => {
    const labelColumn = buildWorkItemFilterColumnDefs().find(
      (column) => column.id === WORK_ITEM_FILTER_COLUMNS.label,
    );
    const accessor = (
      labelColumn as
        | { accessorFn?: (row: WorkItemSummary, index: number) => unknown }
        | undefined
    )?.accessorFn;
    const filterFn = (
      labelColumn as
        | {
            filterFn?: (
              row: { getValue: (columnId: string) => unknown },
              columnId: string,
              filterValue: unknown,
            ) => boolean;
          }
        | undefined
    )?.filterFn;
    const rowValue = accessor?.(
      item({
        labels: [
          {
            id: "label-1",
            name: "Needs Human",
            slug: "needs-human",
          },
        ],
      }),
      0,
    );

    expect(rowValue).toEqual(["needs-human"]);
    expect(
      filterFn?.({ getValue: () => rowValue }, WORK_ITEM_FILTER_COLUMNS.label, {
        operator: "is_any_of",
        value: ["needs-human"],
      }),
    ).toBe(true);
    expect(
      filterFn?.({ getValue: () => rowValue }, WORK_ITEM_FILTER_COLUMNS.label, {
        operator: "is_any_of",
        value: ["openengine"],
      }),
    ).toBe(false);
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
