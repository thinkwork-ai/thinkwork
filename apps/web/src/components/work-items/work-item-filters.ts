import type { WorkItemViewType } from "./work-item-display";

export interface WorkItemRouteSearch {
  view: "list" | "board";
  spaceId?: string;
  threadId?: string;
  sort?: "updated" | "due" | "priority" | "title";
}

export const DEFAULT_WORK_ITEM_SEARCH: WorkItemRouteSearch = {
  view: "list",
  sort: "updated",
};

export function parseWorkItemRouteSearch(
  search: Record<string, unknown>,
): WorkItemRouteSearch {
  return {
    view: search.view === "board" ? "board" : "list",
    spaceId: stringParam(search.spaceId),
    threadId: stringParam(search.threadId),
    sort: parseSort(search.sort),
  };
}

export function workItemRouteSearchToParams(state: WorkItemRouteSearch) {
  const params: Record<string, string | boolean | undefined> = {
    view: state.view === DEFAULT_WORK_ITEM_SEARCH.view ? undefined : state.view,
    spaceId: state.spaceId,
    threadId: state.threadId,
    sort: state.sort === DEFAULT_WORK_ITEM_SEARCH.sort ? undefined : state.sort,
  };
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined),
  );
}

export function buildWorkItemsInput(
  tenantId: string,
  state: WorkItemRouteSearch,
) {
  return {
    tenantId,
    spaceId: state.spaceId,
    threadId: state.threadId,
    includeArchived: false,
    limit: 200,
  };
}

export function routeViewToGraphql(view: WorkItemRouteSearch["view"]) {
  return (view === "board" ? "BOARD" : "LIST") satisfies WorkItemViewType;
}

function parseSort(value: unknown): WorkItemRouteSearch["sort"] {
  if (
    value === "due" ||
    value === "priority" ||
    value === "title" ||
    value === "updated"
  ) {
    return value;
  }
  return DEFAULT_WORK_ITEM_SEARCH.sort;
}

function stringParam(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}
