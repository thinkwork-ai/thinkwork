import type {
  WorkItemPriority,
  WorkItemSavedViewSummary,
  WorkItemStatusCategory,
  WorkItemViewType,
} from "./work-item-display";
import {
  normalizeWorkItemStatusCategory,
  WORK_ITEM_PRIORITY_ORDER,
} from "./work-item-display";

export interface WorkItemRouteSearch {
  view: "list" | "board";
  savedViewId?: string;
  spaceId?: string;
  search?: string;
  statusCategory?: WorkItemStatusCategory;
  priority?: WorkItemPriority;
  blocked?: boolean;
  required?: boolean;
  applicable?: boolean;
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
    savedViewId: stringParam(search.savedViewId),
    spaceId: stringParam(search.spaceId),
    search: stringParam(search.search),
    statusCategory: parseStatusCategory(search.statusCategory),
    priority: parsePriority(search.priority),
    blocked: booleanParam(search.blocked),
    required: booleanParam(search.required),
    applicable: booleanParam(search.applicable),
    threadId: stringParam(search.threadId),
    sort: parseSort(search.sort),
  };
}

export function workItemRouteSearchToParams(state: WorkItemRouteSearch) {
  const params: Record<string, string | boolean | undefined> = {
    view: state.view === DEFAULT_WORK_ITEM_SEARCH.view ? undefined : state.view,
    savedViewId: state.savedViewId,
    spaceId: state.spaceId,
    search: state.search,
    statusCategory: state.statusCategory,
    priority: state.priority,
    blocked: state.blocked,
    required: state.required,
    applicable: state.applicable,
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
    search: state.search,
    statusCategory: state.statusCategory,
    priority: state.priority,
    blocked: state.blocked,
    required: state.required,
    applicable: state.applicable,
    includeArchived: false,
    limit: 200,
  };
}

export function routeSearchFromSavedView(
  view: WorkItemSavedViewSummary,
): WorkItemRouteSearch {
  const filters = parseJsonObject(view.filters);
  return {
    ...DEFAULT_WORK_ITEM_SEARCH,
    ...parseWorkItemRouteSearch(filters),
    view: view.viewType === "BOARD" ? "board" : "list",
    savedViewId: view.id,
    spaceId: stringParam(filters.spaceId) ?? view.spaceId ?? undefined,
  };
}

export function savedViewInputFromRouteSearch(
  tenantId: string,
  name: string,
  state: WorkItemRouteSearch,
  id?: string | null,
) {
  const filters = {
    spaceId: state.spaceId,
    search: state.search,
    statusCategory: state.statusCategory,
    priority: state.priority,
    blocked: state.blocked,
    required: state.required,
    applicable: state.applicable,
    threadId: state.threadId,
    sort: state.sort,
  };
  return {
    tenantId,
    id: id ?? undefined,
    name,
    spaceId: state.spaceId,
    viewType: routeViewToGraphql(state.view),
    filters: JSON.stringify(compact(filters)),
    grouping: JSON.stringify({
      mode: state.view === "board" ? "status" : "none",
    }),
    sorting: JSON.stringify({
      field: state.sort ?? DEFAULT_WORK_ITEM_SEARCH.sort,
      direction: "desc",
    }),
    viewConfig: JSON.stringify({
      version: 1,
    }),
    isPrivate: true,
    isFavorite: true,
  };
}

export function routeViewToGraphql(view: WorkItemRouteSearch["view"]) {
  return (view === "board" ? "BOARD" : "LIST") satisfies WorkItemViewType;
}

export function hasActiveWorkItemFilters(state: WorkItemRouteSearch) {
  return Boolean(
    state.spaceId ||
      state.search ||
      state.statusCategory ||
      state.priority ||
      state.blocked !== undefined ||
      state.required !== undefined ||
      state.applicable !== undefined ||
      state.threadId,
  );
}

export function clearWorkItemFilters(
  state: WorkItemRouteSearch,
): WorkItemRouteSearch {
  return {
    view: state.view,
    savedViewId: undefined,
    sort: state.sort,
  };
}

function parseStatusCategory(value: unknown): WorkItemStatusCategory | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return normalizeWorkItemStatusCategory(value);
}

function parsePriority(value: unknown): WorkItemPriority | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toUpperCase();
  return WORK_ITEM_PRIORITY_ORDER.includes(normalized as WorkItemPriority)
    ? (normalized as WorkItemPriority)
    : undefined;
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

function booleanParam(value: unknown): boolean | undefined {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return undefined;
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

function compact(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}
