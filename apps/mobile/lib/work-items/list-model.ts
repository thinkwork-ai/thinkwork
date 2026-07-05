import { WorkItemPriority, WorkItemStatusCategory } from "@/lib/gql/graphql";

export interface WorkItemListModelItem {
  dueAt?: string | null;
  priority?: WorkItemPriority | null;
  status?: { category?: WorkItemStatusCategory | null } | null;
}

const FINAL_CATEGORIES = new Set<WorkItemStatusCategory>([
  WorkItemStatusCategory.Done,
  WorkItemStatusCategory.Skipped,
]);

const PRIORITY_WEIGHT: Record<WorkItemPriority, number> = {
  [WorkItemPriority.Urgent]: 4,
  [WorkItemPriority.High]: 3,
  [WorkItemPriority.Normal]: 2,
  [WorkItemPriority.Low]: 1,
};

export function shouldShowWorkItemByCategory(
  item: WorkItemListModelItem,
  selectedCategories: readonly WorkItemStatusCategory[],
): boolean {
  const category = item.status?.category ?? null;
  if (!category) return true;
  if (selectedCategories.length > 0) {
    return selectedCategories.includes(category);
  }
  return !FINAL_CATEGORIES.has(category);
}

export function compareWorkItems(
  a: WorkItemListModelItem,
  b: WorkItemListModelItem,
): number {
  const aDue = dueSortValue(a.dueAt);
  const bDue = dueSortValue(b.dueAt);
  if (aDue !== bDue) return aDue - bDue;

  return priorityWeight(b.priority) - priorityWeight(a.priority);
}

function dueSortValue(value: string | null | undefined) {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER;
}

function priorityWeight(priority: WorkItemPriority | null | undefined) {
  return priority ? (PRIORITY_WEIGHT[priority] ?? 0) : 0;
}
