import { describe, expect, it } from "vitest";

import {
  buildWorkItemsInput,
  parseWorkItemRouteSearch,
  routeViewToGraphql,
  workItemRouteSearchToParams,
} from "./work-item-filters";

describe("work item route display state", () => {
  it("normalizes display params and leaves table filters client-side", () => {
    const state = parseWorkItemRouteSearch({
      view: "board",
      spaceId: "space-1",
      threadId: "thread-1",
      search: " contract ",
      statusCategory: "blocked",
      priority: "high",
      due: "due_soon",
      boardColumn: "priority",
      boardRow: "owner",
      boardSort: "due",
      boardDir: "asc",
      boardProps: "priority,owner,source",
    });

    expect(state).toMatchObject({
      view: "board",
      spaceId: "space-1",
      threadId: "thread-1",
      board: {
        column: "priority",
        row: "owner",
        sort: "due",
        dir: "asc",
        properties: ["priority", "owner", "source"],
      },
    });
    expect(buildWorkItemsInput("tenant-1", state)).toEqual({
      tenantId: "tenant-1",
      spaceId: "space-1",
      threadId: "thread-1",
      includeArchived: false,
      limit: 200,
    });
  });

  it("ignores legacy filter and saved-view search params", () => {
    expect(
      parseWorkItemRouteSearch({
        savedViewId: "view-1",
        statusCategory: "blocked",
        priority: "high",
        due: "due_soon",
        blocked: "true",
        required: false,
        applicable: "false",
        search: "contract",
      }),
    ).toMatchObject({
      view: "list",
      spaceId: undefined,
      threadId: undefined,
      list: {
        sort: "updated",
        dir: "desc",
      },
    });
  });

  it("omits default display values when writing route params", () => {
    expect(
      workItemRouteSearchToParams(
        parseWorkItemRouteSearch({
          view: "list",
          spaceId: "space-1",
        }),
      ),
    ).toEqual({ spaceId: "space-1" });
  });

  it("serializes non-default display params", () => {
    const state = parseWorkItemRouteSearch({
      view: "board",
      spaceId: "space-1",
      boardColumn: "priority",
      boardRow: "owner",
      boardSort: "due",
      boardDir: "asc",
      boardShowEmptyColumns: "false",
      boardProps: "priority,owner,source",
    });

    expect(workItemRouteSearchToParams(state)).toEqual({
      view: "board",
      spaceId: "space-1",
      boardColumn: "priority",
      boardRow: "owner",
      boardSort: "due",
      boardDir: "asc",
      boardShowEmptyColumns: false,
      boardProps: "priority,owner,source",
    });
  });

  it("maps route view to GraphQL view type", () => {
    expect(routeViewToGraphql("list")).toBe("LIST");
    expect(routeViewToGraphql("board")).toBe("BOARD");
  });
});
