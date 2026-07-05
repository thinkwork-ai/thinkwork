import { describe, expect, it } from "vitest";
import { WorkItemStatusCategory } from "@/lib/gql/graphql";
import {
  advanceTargetCategory,
  firstActiveStatusInCategory,
} from "./advance-mapping";

describe("advanceTargetCategory", () => {
  it("advances TODO to ACTIVE and ACTIVE to DONE", () => {
    expect(advanceTargetCategory(WorkItemStatusCategory.Todo, {})).toBe(
      WorkItemStatusCategory.Active,
    );
    expect(advanceTargetCategory(WorkItemStatusCategory.Active, {})).toBe(
      WorkItemStatusCategory.Done,
    );
  });

  it("does not advance DONE or SKIPPED", () => {
    expect(advanceTargetCategory(WorkItemStatusCategory.Done, {})).toBeNull();
    expect(
      advanceTargetCategory(WorkItemStatusCategory.Skipped, {}),
    ).toBeNull();
  });

  it("returns BLOCKED items to their most recent pre-blocked category", () => {
    const statusCategoryById = new Map([
      ["todo-status", WorkItemStatusCategory.Todo],
      ["active-status", WorkItemStatusCategory.Active],
    ]);

    expect(
      advanceTargetCategory(
        WorkItemStatusCategory.Blocked,
        {
          events: [
            {
              eventType: "BLOCKED",
              previousStatusId: "todo-status",
              createdAt: "2026-07-04T10:00:00.000Z",
            },
            {
              eventType: "BLOCKED",
              previousStatusId: "active-status",
              createdAt: "2026-07-04T11:00:00.000Z",
            },
          ],
        },
        statusCategoryById,
      ),
    ).toBe(WorkItemStatusCategory.Active);
  });

  it("falls BLOCKED items back to ACTIVE when history is not resolvable", () => {
    expect(
      advanceTargetCategory(WorkItemStatusCategory.Blocked, { events: [] }),
    ).toBe(WorkItemStatusCategory.Active);
  });
});

describe("firstActiveStatusInCategory", () => {
  it("picks the active status with the lowest display order", () => {
    expect(
      firstActiveStatusInCategory(
        [
          {
            id: "done-2",
            category: WorkItemStatusCategory.Done,
            isActive: true,
            displayOrder: 20,
          },
          {
            id: "done-1",
            category: WorkItemStatusCategory.Done,
            isActive: true,
            displayOrder: 10,
          },
          {
            id: "done-inactive",
            category: WorkItemStatusCategory.Done,
            isActive: false,
            displayOrder: 1,
          },
        ],
        WorkItemStatusCategory.Done,
      )?.id,
    ).toBe("done-1");
  });
});
