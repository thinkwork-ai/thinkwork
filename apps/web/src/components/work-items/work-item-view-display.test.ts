import { describe, expect, it } from "vitest";
import type {
  WorkItemSpaceSummary,
  WorkItemStatusSummary,
  WorkItemSummary,
} from "./work-item-display";
import {
  groupWorkItemsForDisplay,
  normalizeWorkItemDisplayState,
  sortWorkItemsForDisplay,
  workItemDisplayStateToParams,
} from "./work-item-view-display";

describe("work item display state", () => {
  it("normalizes unsupported route values back to safe defaults", () => {
    const state = normalizeWorkItemDisplayState({
      view: "map",
      listGroup: "organization",
      listSort: "estimate",
      listDir: "sideways",
      listProps: "estimate,priority,priority",
      boardColumn: "orderNumber",
      boardProps: "taskType,owner",
    });

    expect(state).toMatchObject({
      view: "list",
      list: {
        group: "none",
        sort: "updated",
        dir: "desc",
        properties: ["priority"],
      },
      board: {
        column: "status",
        properties: ["owner"],
      },
    });
  });

  it("cleans stale duplicate list and board subgroup selections", () => {
    const state = normalizeWorkItemDisplayState({
      listGroup: "priority",
      listSubgroup: "priority",
      boardColumn: "status",
      boardRow: "space",
      boardSubgroup: "space",
    });

    expect(state.list.subgroup).toBe("none");
    expect(state.board.subgroup).toBe("none");
  });

  it("round-trips non-default state into compact route params", () => {
    const state = normalizeWorkItemDisplayState({
      view: "board",
      search: "ignored",
      boardColumn: "priority",
      boardRow: "owner",
      boardSort: "due",
      boardDir: "asc",
      boardProps: "priority,owner",
    });

    expect(workItemDisplayStateToParams(state)).toEqual({
      view: "board",
      boardColumn: "priority",
      boardRow: "owner",
      boardSort: "due",
      boardDir: "asc",
      boardProps: "priority,owner",
    });
  });

  it("groups and sorts list rows by Work Item-native fields", () => {
    const groups = groupWorkItemsForDisplay({
      items: [
        item({ id: "normal", priority: "NORMAL", ownerUserId: "user-1" }),
        item({ id: "urgent", priority: "URGENT", ownerAgentId: "agent-1" }),
        item({ id: "low", priority: "LOW", ownerUserId: "user-1" }),
      ],
      spaces,
      statuses,
      group: "priority",
      subgroup: "owner",
      sort: "title",
      dir: "asc",
      showEmptyGroups: false,
      showEmptySubgroups: false,
    });

    expect(groups.map((group) => group.label)).toEqual([
      "Urgent",
      "Normal",
      "Low",
    ]);
    expect(groups[0]?.subgroups?.[0]?.label).toBe("Agent");
    expect(groups[1]?.subgroups?.[0]?.label).toBe("User");
  });

  it("sorts descending display rows without mutating input", () => {
    const rows = [
      item({ id: "old", updatedAt: "2026-06-24T10:00:00Z" }),
      item({ id: "new", updatedAt: "2026-06-25T10:00:00Z" }),
    ];

    expect(
      sortWorkItemsForDisplay(rows, "updated", "desc").map((row) => row.id),
    ).toEqual(["new", "old"]);
    expect(rows.map((row) => row.id)).toEqual(["old", "new"]);
  });
});

const spaces: WorkItemSpaceSummary[] = [
  { id: "space-1", name: "Launch" },
  { id: "space-2", name: "Support" },
];

const statuses: WorkItemStatusSummary[] = [
  { id: "todo", name: "Todo", category: "TODO" },
  { id: "active", name: "In progress", category: "ACTIVE" },
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
