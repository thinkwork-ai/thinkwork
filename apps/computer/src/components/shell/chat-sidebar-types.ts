export interface ChatThreadSummary {
  id: string;
  number?: number | null;
  identifier?: string | null;
  title?: string | null;
  status?: string | null;
  channel?: string | null;
  spaceId?: string | null;
  space?: {
    id: string;
    slug?: string | null;
    name?: string | null;
    kind?: string | null;
  } | null;
  lastReadAt?: string | null;
  lastActivityAt?: string | null;
  lastTurnCompletedAt?: string | null;
  archivedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export function formatCompactCount(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(value);
}

export function threadTitle(thread: ChatThreadSummary): string {
  return thread.title?.trim() || "Untitled thread";
}

export function threadActivityAt(thread: ChatThreadSummary): string | null {
  return (
    thread.lastActivityAt ??
    thread.lastTurnCompletedAt ??
    thread.updatedAt ??
    thread.createdAt ??
    null
  );
}

export function sortThreadsByActivityDesc(
  threads: ChatThreadSummary[],
): ChatThreadSummary[] {
  return [...threads].sort((left, right) => {
    const leftTime = groupTime(left);
    const rightTime = groupTime(right);
    if (leftTime !== rightTime) return rightTime - leftTime;
    return threadTitle(left).localeCompare(threadTitle(right));
  });
}

export function selectNextThreadBelowDeleted(
  orderedThreads: ChatThreadSummary[],
  deletedThreadId: string,
  pendingDeletes: ReadonlySet<string> = new Set(),
) {
  const deletedIndex = orderedThreads.findIndex(
    (thread) => thread.id === deletedThreadId,
  );
  const remainingThreads = orderedThreads.filter(
    (thread) => thread.id !== deletedThreadId && !pendingDeletes.has(thread.id),
  );

  if (remainingThreads.length === 0) return null;
  if (deletedIndex < 0) return remainingThreads[0]?.id ?? null;
  return (
    remainingThreads[Math.min(deletedIndex, remainingThreads.length - 1)]?.id ??
    null
  );
}

export function isThreadUnread(thread: ChatThreadSummary): boolean {
  const activity = threadActivityAt(thread);
  if (!activity) return false;
  if (!thread.lastReadAt) return true;
  return new Date(thread.lastReadAt).getTime() < new Date(activity).getTime();
}

function activityTime(thread: ChatThreadSummary): number {
  const activity = threadActivityAt(thread);
  if (!activity) return 0;
  const time = new Date(activity).getTime();
  return Number.isNaN(time) ? 0 : time;
}

export function formatRelativeDate(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const startOfDate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const diffDays = Math.round(
    (startOfToday.getTime() - startOfDate.getTime()) / 86_400_000,
  );
  if (diffDays === 0) {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  }
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) {
    return new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(
      date,
    );
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
}

export function formatTinyRelativeDate(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const elapsedMs = Math.max(Date.now() - date.getTime(), 0);
  const elapsedMinutes = Math.floor(elapsedMs / 60_000);
  if (elapsedMinutes < 1) return "now";
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 7) return `${elapsedDays}d`;
  const elapsedWeeks = Math.floor(elapsedDays / 7);
  if (elapsedWeeks < 5) return `${elapsedWeeks}w`;
  const elapsedMonths = Math.floor(elapsedDays / 30);
  if (elapsedMonths < 12) return `${Math.max(elapsedMonths, 1)}mo`;
  return `${Math.floor(elapsedDays / 365)}y`;
}

export function recencyGroupLabel(value?: string | null): string {
  if (!value) return "Older";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Older";
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const startOfDate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const diffDays = Math.round(
    (startOfToday.getTime() - startOfDate.getTime()) / 86_400_000,
  );
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return "Older";
}

export function groupThreadsByRecency(threads: ChatThreadSummary[]) {
  const groups: Array<{ label: string; threads: ChatThreadSummary[] }> = [];
  for (const thread of threads) {
    const label = recencyGroupLabel(threadActivityAt(thread));
    let group = groups.find((candidate) => candidate.label === label);
    if (!group) {
      group = { label, threads: [] };
      groups.push(group);
    }
    group.threads.push(thread);
  }
  return groups;
}

function groupTime(thread: ChatThreadSummary): number {
  return activityTime(thread);
}
