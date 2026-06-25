import type { WorkItemViewType } from "./work-item-display";
import {
  DEFAULT_WORK_ITEM_DISPLAY_STATE,
  normalizeWorkItemDisplayState,
  workItemDisplayStateToParams,
  type WorkItemDisplayState,
} from "./work-item-view-display";

export interface WorkItemRouteSearch extends WorkItemDisplayState {
  spaceId?: string;
  threadId?: string;
}

export const DEFAULT_WORK_ITEM_SEARCH: WorkItemRouteSearch = {
  ...DEFAULT_WORK_ITEM_DISPLAY_STATE,
};

export function parseWorkItemRouteSearch(
  search: Record<string, unknown>,
): WorkItemRouteSearch {
  return {
    ...normalizeWorkItemDisplayState(search),
    spaceId: stringParam(search.spaceId),
    threadId: stringParam(search.threadId),
  };
}

export function workItemRouteSearchToParams(state: WorkItemRouteSearch) {
  const params: Record<string, string | boolean | undefined> = {
    ...workItemDisplayStateToParams(state),
    spaceId: state.spaceId,
    threadId: state.threadId,
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

function stringParam(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}
