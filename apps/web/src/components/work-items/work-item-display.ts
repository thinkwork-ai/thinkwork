export type WorkItemStatusCategory =
  | "TODO"
  | "ACTIVE"
  | "BLOCKED"
  | "DONE"
  | "SKIPPED";

export type WorkItemPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export type WorkItemViewType = "LIST" | "BOARD";

export interface WorkItemStatusSummary {
  id: string;
  spaceId?: string | null;
  name: string;
  color?: string | null;
  icon?: string | null;
  category: WorkItemStatusCategory;
  isActive?: boolean | null;
  isFinal?: boolean | null;
  isDefault?: boolean | null;
  displayOrder?: number | null;
}

export interface WorkItemThreadLinkSummary {
  id?: string | null;
  threadId: string;
  relationship?: string | null;
  createdAt?: string | null;
}

export interface WorkItemExternalRefSummary {
  id?: string | null;
  provider?: string | null;
  externalId?: string | null;
  externalUrl?: string | null;
  metadata?: unknown;
}

export interface WorkItemSummary {
  id: string;
  tenantId?: string | null;
  spaceId: string;
  statusId?: string | null;
  status?: WorkItemStatusSummary | null;
  title: string;
  notes?: string | null;
  priority: WorkItemPriority;
  ownerUserId?: string | null;
  ownerAgentId?: string | null;
  dueAt?: string | null;
  required: boolean;
  applicable: boolean;
  blocked: boolean;
  completedAt?: string | null;
  metadata?: unknown;
  threadLinks?: WorkItemThreadLinkSummary[] | null;
  externalRefs?: WorkItemExternalRefSummary[] | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  archivedAt?: string | null;
}

export interface WorkItemAssigneeSummary {
  id: string;
  name: string;
  email?: string | null;
}

export interface WorkItemSavedViewSummary {
  id: string;
  name: string;
  spaceId?: string | null;
  viewType: WorkItemViewType;
  filters?: unknown;
  grouping?: unknown;
  sorting?: unknown;
  viewConfig?: unknown;
  isPrivate: boolean;
  isDefault: boolean;
  isFavorite: boolean;
}

export interface WorkItemSpaceSummary {
  id: string;
  slug?: string | null;
  name?: string | null;
  kind?: string | null;
  templateKey?: string | null;
}

export const WORK_ITEM_CATEGORY_ORDER: WorkItemStatusCategory[] = [
  "TODO",
  "ACTIVE",
  "BLOCKED",
  "DONE",
  "SKIPPED",
];

export const WORK_ITEM_PRIORITY_ORDER: WorkItemPriority[] = [
  "URGENT",
  "HIGH",
  "NORMAL",
  "LOW",
];

export function workItemStatusCategoryLabel(
  category?: WorkItemStatusCategory | string | null,
) {
  switch (normalizeWorkItemStatusCategory(category)) {
    case "ACTIVE":
      return "In progress";
    case "BLOCKED":
      return "Blocked";
    case "DONE":
      return "Done";
    case "SKIPPED":
      return "Skipped";
    case "TODO":
    default:
      return "Todo";
  }
}

export function normalizeWorkItemStatusCategory(
  value?: WorkItemStatusCategory | string | null,
): WorkItemStatusCategory {
  const normalized = String(value ?? "TODO")
    .trim()
    .toUpperCase();
  if (
    normalized === "ACTIVE" ||
    normalized === "BLOCKED" ||
    normalized === "DONE" ||
    normalized === "SKIPPED" ||
    normalized === "TODO"
  ) {
    return normalized;
  }
  return "TODO";
}

export function workItemStatusLabel(item: WorkItemSummary) {
  return (
    item.status?.name?.trim() ||
    workItemStatusCategoryLabel(item.status?.category)
  );
}

export function workItemStatusCategory(item: WorkItemSummary) {
  if (item.blocked) return "BLOCKED";
  if (!item.applicable) return "SKIPPED";
  return normalizeWorkItemStatusCategory(item.status?.category);
}

export function workItemStatusTone(
  category?: WorkItemStatusCategory | string | null,
) {
  switch (normalizeWorkItemStatusCategory(category)) {
    case "ACTIVE":
      return "bg-blue-500/15 text-blue-700 dark:text-blue-300";
    case "BLOCKED":
      return "bg-red-500/15 text-red-700 dark:text-red-300";
    case "DONE":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
    case "SKIPPED":
      return "bg-slate-500/15 text-slate-600 dark:text-slate-300";
    case "TODO":
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function workItemPriorityLabel(
  priority?: WorkItemPriority | string | null,
) {
  switch (
    String(priority ?? "NORMAL")
      .trim()
      .toUpperCase()
  ) {
    case "URGENT":
      return "Urgent";
    case "HIGH":
      return "High";
    case "LOW":
      return "Low";
    case "NORMAL":
    default:
      return "Normal";
  }
}

export function workItemPriorityTone(
  priority?: WorkItemPriority | string | null,
) {
  switch (
    String(priority ?? "NORMAL")
      .trim()
      .toUpperCase()
  ) {
    case "URGENT":
      return "bg-red-500/15 text-red-700 dark:text-red-300";
    case "HIGH":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
    case "LOW":
      return "bg-slate-500/15 text-slate-600 dark:text-slate-300";
    case "NORMAL":
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function workItemOwnerLabel(item: WorkItemSummary) {
  return workItemAssigneeLabel(item);
}

export function workItemAssigneeLabel(
  item: WorkItemSummary,
  assignees: WorkItemAssigneeSummary[] = [],
) {
  const assignee = item.ownerUserId
    ? assignees.find((user) => user.id === item.ownerUserId)
    : undefined;
  if (assignee) return assignee.name.trim() || assignee.email || "Assignee";

  const metadata = objectRecord(item.metadata);
  const metadataAssignee = objectRecord(metadata.assignee);
  const display =
    stringValue(metadataAssignee.displayName) ??
    stringValue(metadata.assigneeDisplay) ??
    stringValue(metadata.ownerDisplay);
  if (display) return display;
  if (item.ownerUserId) return "User";
  if (item.ownerAgentId) return "Agent";
  return "Unassigned";
}

const assigneeColorClasses = [
  "bg-sky-500 text-white",
  "bg-violet-500 text-white",
  "bg-emerald-500 text-white",
  "bg-amber-500 text-white",
  "bg-rose-500 text-white",
  "bg-cyan-500 text-white",
  "bg-fuchsia-500 text-white",
  "bg-lime-600 text-white",
];

export function workItemAssigneeColorClass(seed?: string | null) {
  if (!seed) return "bg-muted text-muted-foreground";

  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }

  return assigneeColorClasses[hash % assigneeColorClasses.length];
}

export function workItemSpaceLabel(
  spaceId: string,
  spaces: WorkItemSpaceSummary[],
) {
  return spaces.find((space) => space.id === spaceId)?.name?.trim() || "Space";
}

export function workItemThreadCountLabel(item: WorkItemSummary) {
  const count = item.threadLinks?.length ?? 0;
  return `${count} thread${count === 1 ? "" : "s"}`;
}

export function workItemDueLabel(value?: string | null, now = new Date()) {
  if (!value) return "No due date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No due date";
  const day = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  if (date.getTime() < startOfToday(now).getTime()) return `${day} overdue`;
  const tomorrow = new Date(startOfToday(now));
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (date < tomorrow) return `${day} today`;
  return day;
}

export function isWorkItemDueSoon(value?: string | null, now = new Date()) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const threshold = new Date(startOfToday(now));
  threshold.setDate(threshold.getDate() + 7);
  return date < threshold;
}

export function isWorkItemOpen(item: WorkItemSummary) {
  const category = workItemStatusCategory(item);
  return category !== "DONE" && category !== "SKIPPED" && !item.completedAt;
}

export function sortWorkItemStatuses(statuses: WorkItemStatusSummary[]) {
  return [...statuses].sort((left, right) => {
    const categoryDelta =
      WORK_ITEM_CATEGORY_ORDER.indexOf(
        normalizeWorkItemStatusCategory(left.category),
      ) -
      WORK_ITEM_CATEGORY_ORDER.indexOf(
        normalizeWorkItemStatusCategory(right.category),
      );
    if (categoryDelta !== 0) return categoryDelta;
    return (left.displayOrder ?? 0) - (right.displayOrder ?? 0);
  });
}

export function buildWorkItemSequenceNumbers(items: WorkItemSummary[]) {
  return new Map(
    [...items]
      .sort((left, right) => {
        const createdDelta =
          sequenceDate(left.createdAt) - sequenceDate(right.createdAt);
        if (createdDelta !== 0) return createdDelta;
        return left.id.localeCompare(right.id);
      })
      .map((item, index) => [item.id, index + 1]),
  );
}

export function categoryStatuses(): WorkItemStatusSummary[] {
  return WORK_ITEM_CATEGORY_ORDER.map((category, index) => ({
    id: category,
    name: workItemStatusCategoryLabel(category),
    category,
    displayOrder: index * 10,
  }));
}

export function workItemSourceLabel(item: WorkItemSummary) {
  const metadata = objectRecord(item.metadata);
  const workflow = stringValue(metadata.workflow);
  if (workflow === "customer_onboarding") return "Customer onboarding";
  const ref = item.externalRefs?.[0];
  if (ref?.provider) return formatProvider(ref.provider);
  return "ThinkWork";
}

function formatProvider(value: string) {
  return value
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function sequenceDate(value?: string | null) {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}

function startOfToday(now: Date) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}
