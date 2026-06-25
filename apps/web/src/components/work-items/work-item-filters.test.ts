import { describe, expect, it } from "vitest";

import {
  buildWorkItemsInput,
  parseWorkItemRouteSearch,
  workItemRouteSearchToParams,
} from "./work-item-filters";

describe("work item route display state", () => {
  it("normalizes display params and leaves table filters client-side", () => {
    const state = parseWorkItemRouteSearch({
      view: "board",
      spaceId: "space-1",
      threadId: "thread-1",
      sort: "due",
      search: " contract ",
    });

    expect(state).toEqual({
      view: "board",
      spaceId: "space-1",
      threadId: "thread-1",
      sort: "due",
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
    ).toEqual({
      view: "list",
      spaceId: undefined,
      threadId: undefined,
      sort: "updated",
    });
  });

  it("omits default values when writing route params", () => {
    expect(
      workItemRouteSearchToParams({
        view: "list",
        sort: "updated",
        spaceId: "space-1",
      }),
    ).toEqual({ spaceId: "space-1" });
  });
});
