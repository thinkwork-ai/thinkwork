import { describe, expect, it } from "vitest";

import {
  buildWorkItemsInput,
  clearWorkItemFilters,
  hasActiveWorkItemFilters,
  parseWorkItemRouteSearch,
  routeSearchFromSavedView,
  savedViewInputFromRouteSearch,
  workItemRouteSearchToParams,
} from "./work-item-filters";

describe("work item route filters", () => {
  it("normalizes search params into API-friendly filter state", () => {
    const state = parseWorkItemRouteSearch({
      view: "board",
      spaceId: "space-1",
      statusCategory: "blocked",
      priority: "high",
      due: "due_soon",
      blocked: "true",
      required: false,
      applicable: "false",
      sort: "due",
      search: " contract ",
    });

    expect(state).toEqual({
      view: "board",
      spaceId: "space-1",
      statusCategory: "BLOCKED",
      priority: "HIGH",
      due: "due_soon",
      blocked: true,
      required: false,
      applicable: false,
      sort: "due",
      search: "contract",
      savedViewId: undefined,
      threadId: undefined,
    });
    expect(buildWorkItemsInput("tenant-1", state)).toMatchObject({
      tenantId: "tenant-1",
      spaceId: "space-1",
      statusCategory: "BLOCKED",
      priority: "HIGH",
      dueAfter: expect.any(String),
      dueBefore: expect.any(String),
      blocked: true,
      includeArchived: false,
    });
  });

  it("drops unknown status categories instead of defaulting to todo", () => {
    expect(
      parseWorkItemRouteSearch({
        statusCategory: "not-a-real-status",
      }).statusCategory,
    ).toBeUndefined();
  });

  it("omits default values when writing route params", () => {
    expect(
      workItemRouteSearchToParams({
        view: "list",
        sort: "updated",
        search: "docusign",
      }),
    ).toEqual({ search: "docusign" });
  });

  it("restores saved views from AWSJSON object or string payloads", () => {
    expect(
      routeSearchFromSavedView({
        id: "view-1",
        name: "Blocked onboarding",
        spaceId: "space-1",
        viewType: "BOARD",
        filters: JSON.stringify({
          statusCategory: "BLOCKED",
          priority: "URGENT",
        }),
        isPrivate: true,
        isDefault: false,
        isFavorite: true,
      }),
    ).toMatchObject({
      savedViewId: "view-1",
      view: "board",
      spaceId: "space-1",
      statusCategory: "BLOCKED",
      priority: "URGENT",
    });
  });

  it("serializes saved view payloads as AWSJSON strings", () => {
    const input = savedViewInputFromRouteSearch("tenant-1", "Due soon", {
      view: "list",
      spaceId: "space-1",
      statusCategory: "ACTIVE",
      due: "overdue",
      sort: "due",
    });

    expect(input).toMatchObject({
      tenantId: "tenant-1",
      name: "Due soon",
      spaceId: "space-1",
      viewType: "LIST",
      isPrivate: true,
      isFavorite: true,
    });
    expect(JSON.parse(input.filters)).toEqual({
      spaceId: "space-1",
      statusCategory: "ACTIVE",
      due: "overdue",
      sort: "due",
    });
    expect(JSON.parse(input.sorting)).toEqual({
      field: "due",
      direction: "desc",
    });
  });

  it("tracks whether filters are active while preserving the current view", () => {
    const state = parseWorkItemRouteSearch({
      view: "board",
      required: "true",
    });

    expect(hasActiveWorkItemFilters(state)).toBe(true);
    expect(clearWorkItemFilters(state)).toEqual({
      view: "board",
      savedViewId: undefined,
      sort: "updated",
    });
  });
});
