import { WorkItemStatusCategory } from "@/lib/gql/graphql";

export interface WorkItemStatusLookup {
  id: string;
  category: WorkItemStatusCategory;
  isActive?: boolean | null;
  displayOrder?: number | null;
}

export interface WorkItemStatusEvent {
  eventType?: string | null;
  previousStatusId?: string | null;
  newStatusId?: string | null;
  createdAt?: string | null;
}

export function firstActiveStatusInCategory(
  statuses: readonly WorkItemStatusLookup[],
  category: WorkItemStatusCategory,
): WorkItemStatusLookup | null {
  return (
    statuses
      .filter(
        (status) => status.isActive !== false && status.category === category,
      )
      .sort(
        (a, b) =>
          (a.displayOrder ?? Number.MAX_SAFE_INTEGER) -
          (b.displayOrder ?? Number.MAX_SAFE_INTEGER),
      )[0] ?? null
  );
}

export function advanceTargetCategory(
  currentCategory: WorkItemStatusCategory,
  item: { events?: readonly WorkItemStatusEvent[] | null },
  statusCategoryById: ReadonlyMap<string, WorkItemStatusCategory> = new Map(),
): WorkItemStatusCategory | null {
  switch (currentCategory) {
    case WorkItemStatusCategory.Todo:
      return WorkItemStatusCategory.Active;
    case WorkItemStatusCategory.Active:
      return WorkItemStatusCategory.Done;
    case WorkItemStatusCategory.Blocked:
      return (
        previousBlockedCategory(item.events ?? [], statusCategoryById) ??
        WorkItemStatusCategory.Active
      );
    case WorkItemStatusCategory.Done:
    case WorkItemStatusCategory.Skipped:
      return null;
  }
}

function previousBlockedCategory(
  events: readonly WorkItemStatusEvent[],
  statusCategoryById: ReadonlyMap<string, WorkItemStatusCategory>,
): WorkItemStatusCategory | null {
  const mostRecentBlocked = [...events]
    .filter((event) => event.eventType === "BLOCKED" && event.previousStatusId)
    .sort(
      (a, b) =>
        new Date(b.createdAt ?? 0).getTime() -
        new Date(a.createdAt ?? 0).getTime(),
    )[0];
  if (!mostRecentBlocked?.previousStatusId) return null;
  const category = statusCategoryById.get(mostRecentBlocked.previousStatusId);
  if (
    category === WorkItemStatusCategory.Done ||
    category === WorkItemStatusCategory.Skipped
  ) {
    return null;
  }
  return category ?? null;
}
