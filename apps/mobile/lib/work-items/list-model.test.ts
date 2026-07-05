import { describe, expect, it } from "vitest";
import { WorkItemPriority, WorkItemStatusCategory } from "@/lib/gql/graphql";
import { compareWorkItems, shouldShowWorkItemByCategory } from "./list-model";

describe("work item list model", () => {
  it("excludes final statuses by default", () => {
    expect(
      shouldShowWorkItemByCategory(
        { status: { category: WorkItemStatusCategory.Done } },
        [],
      ),
    ).toBe(false);
    expect(
      shouldShowWorkItemByCategory(
        { status: { category: WorkItemStatusCategory.Skipped } },
        [],
      ),
    ).toBe(false);
    expect(
      shouldShowWorkItemByCategory(
        { status: { category: WorkItemStatusCategory.Active } },
        [],
      ),
    ).toBe(true);
  });

  it("honors explicit final status filters", () => {
    expect(
      shouldShowWorkItemByCategory(
        { status: { category: WorkItemStatusCategory.Done } },
        [WorkItemStatusCategory.Done],
      ),
    ).toBe(true);
  });

  it("sorts due dates ascending, nulls last, then priority descending", () => {
    const items = [
      {
        dueAt: null,
        priority: WorkItemPriority.Urgent,
      },
      {
        dueAt: "2026-07-05T00:00:00.000Z",
        priority: WorkItemPriority.Low,
      },
      {
        dueAt: "2026-07-04T00:00:00.000Z",
        priority: WorkItemPriority.Normal,
      },
      {
        dueAt: "2026-07-05T00:00:00.000Z",
        priority: WorkItemPriority.High,
      },
    ];

    expect([...items].sort(compareWorkItems)).toEqual([
      items[2],
      items[3],
      items[1],
      items[0],
    ]);
  });
});
