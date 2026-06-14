import type { ChatThreadSummary } from "@/components/shell/chat-sidebar-types";

export type ActivityType =
  | "chat"
  | "routine"
  | "task"
  | "scheduled"
  | "thread"
  | "email"
  | "webhook";

export interface ActivityThreadSummary extends ChatThreadSummary {
  channel?: string | null;
  costSummary?: number | null;
  agentId?: string | null;
  agent?: {
    id: string;
    name?: string | null;
    avatarUrl?: string | null;
  } | null;
}

export interface ActivityItem {
  id: string;
  type: ActivityType;
  title: string;
  status: string;
  agentName?: string | null;
  timestamp: number;
  duration?: number | null;
  cost?: number | null;
  sourceId: string;
  threadId: string;
}

export type ActivityRecencyBucket =
  | "today"
  | "yesterday"
  | "last7"
  | "older"
  | "unknown";

export const TYPE_LABELS: Record<ActivityType, string> = {
  chat: "Chat",
  routine: "Routine",
  task: "Task",
  scheduled: "Scheduled",
  thread: "Thread",
  email: "Email",
  webhook: "Webhook",
};

export const TYPE_COLORS: Record<ActivityType, string> = {
  chat: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  routine: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  task: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400",
  scheduled: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  thread: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  email: "bg-teal-500/15 text-teal-600 dark:text-teal-400",
  webhook: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
};

export const STATUS_COLORS: Record<string, string> = {
  succeeded: "bg-green-500/15 text-green-600 dark:text-green-400",
  completed: "bg-green-500/15 text-green-600 dark:text-green-400",
  done: "bg-green-500/15 text-green-600 dark:text-green-400",
  active: "bg-green-500/15 text-green-600 dark:text-green-400",
  open: "bg-green-500/15 text-green-600 dark:text-green-400",
  in_progress: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  running: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  pending: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
  queued: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
  failed: "bg-red-500/15 text-red-600 dark:text-red-400",
  error: "bg-red-500/15 text-red-600 dark:text-red-400",
  cancelled: "bg-muted text-muted-foreground",
  closed: "bg-muted text-muted-foreground",
};

const CHANNEL_TYPE_MAP: Record<string, ActivityType> = {
  CHAT: "chat",
  EMAIL: "email",
  SCHEDULE: "scheduled",
  MANUAL: "thread",
  WEBHOOK: "thread",
  API: "thread",
};

export function isActivityDay(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return false;
  return dateKey(date) === value;
}

export function dateKey(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function formatActivityDay(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function activityRecencyBucket(
  timestampValue: number,
  nowValue: Date | number = Date.now(),
): ActivityRecencyBucket {
  if (!timestampValue) return "unknown";
  const nowKey = dateKey(nowValue);
  const itemKey = dateKey(timestampValue);
  if (itemKey === nowKey) return "today";

  const yesterday = new Date(nowKey + "T00:00:00");
  yesterday.setDate(yesterday.getDate() - 1);
  if (itemKey === dateKey(yesterday)) return "yesterday";

  const itemTime = new Date(itemKey + "T00:00:00").getTime();
  const nowTime = new Date(nowKey + "T00:00:00").getTime();
  const daysAgo = Math.floor((nowTime - itemTime) / 86_400_000);
  if (daysAgo >= 0 && daysAgo < 7) return "last7";
  return "older";
}

export function activityRecencyLabel(bucket: string): string {
  switch (bucket) {
    case "today":
      return "Today";
    case "yesterday":
      return "Yesterday";
    case "last7":
      return "Last 7 days";
    case "older":
      return "Older";
    default:
      return "Unknown";
  }
}

export function activityTimestamp(thread: ActivityThreadSummary): number {
  for (const value of [
    thread.lastActivityAt,
    thread.lastTurnCompletedAt,
    thread.updatedAt,
    thread.createdAt,
  ]) {
    if (!value) continue;
    const time = new Date(value).getTime();
    if (!Number.isNaN(time)) return time;
  }
  return 0;
}

export function activityTitle(thread: ActivityThreadSummary): string {
  const prefix =
    thread.identifier ?? (thread.number != null ? `#${thread.number}` : null);
  const title = thread.title?.trim() || "Untitled thread";
  return prefix ? `${prefix}: ${title}` : title;
}

export function mapThreadToActivityItem(
  thread: ActivityThreadSummary,
): ActivityItem {
  const channel = (thread.channel ?? "").toUpperCase();
  return {
    id: `thread:${thread.id}`,
    type: CHANNEL_TYPE_MAP[channel] ?? "thread",
    title: activityTitle(thread),
    status: (thread.status ?? "open").toLowerCase(),
    agentName: thread.agent?.name ?? null,
    timestamp: activityTimestamp(thread),
    duration: null,
    cost: thread.costSummary ?? null,
    sourceId: thread.id,
    threadId: thread.id,
  };
}

export function mapThreadsToActivityItems(
  threads: ActivityThreadSummary[],
): ActivityItem[] {
  return threads
    .map(mapThreadToActivityItem)
    .sort((left, right) => right.timestamp - left.timestamp);
}

export function buildLast30DaysCounts(items: ActivityItem[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (!item.timestamp) continue;
    const key = dateKey(item.timestamp);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const days: { day: string; count: number }[] = [];
  const now = new Date();
  for (let i = 29; i >= 0; i -= 1) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const key = dateKey(date);
    days.push({ day: key, count: counts.get(key) ?? 0 });
  }
  return days;
}

export function filterActivityItems(
  items: ActivityItem[],
  opts: { search?: string; day?: string | null },
): ActivityItem[] {
  let next = [...items];
  const search = opts.search?.trim().toLowerCase();
  if (search) {
    next = next.filter(
      (item) =>
        item.title.toLowerCase().includes(search) ||
        (item.agentName?.toLowerCase().includes(search) ?? false),
    );
  }
  if (opts.day) {
    next = next.filter(
      (item) => item.timestamp > 0 && dateKey(item.timestamp) === opts.day,
    );
  }
  return next;
}

export function formatCost(cost: number | null | undefined): string {
  if (cost == null || cost === 0) return "—";
  return `$${cost.toFixed(4)}`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || ms === 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}
