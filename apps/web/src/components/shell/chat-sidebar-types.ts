import { ThreadLifecycleStatus } from "@/gql/graphql";

export { formatTinyRelativeDate } from "@/lib/relative-time";

export interface ChatThreadSummary {
  id: string;
  number?: number | null;
  identifier?: string | null;
  title?: string | null;
  status?: string | null;
  /** Derived lifecycle (RUNNING | AWAITING_USER | ...); drives the waiting badge. */
  lifecycleStatus?: string | null;
  channel?: string | null;
  spaceId?: string | null;
  space?: {
    id: string;
    slug?: string | null;
    name?: string | null;
    kind?: string | null;
  } | null;
  lastReadAt?: string | null;
  /**
   * The CALLER's notification preference for this thread (SUBSCRIBED |
   * MENTIONS | MUTED). Null/absent when the caller has no participant row.
   */
  viewerNotificationPreference?: string | null;
  lastActivityAt?: string | null;
  lastTurnCompletedAt?: string | null;
  archivedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

/**
 * True when the agent parked the thread on a pending ask_user_question
 * batch — drives the amber "Waiting for you" badge. Clears automatically
 * when a thread-update event refreshes lifecycleStatus.
 */
export function isThreadAwaitingUser(thread: ChatThreadSummary): boolean {
  return (
    (thread.lifecycleStatus ?? "").toUpperCase() ===
    ThreadLifecycleStatus.AwaitingUser
  );
}

export function formatCompactCount(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(value);
}

/** True when the caller muted this thread (OS notifications suppressed unless @mentioned). */
export function isThreadMuted(thread: ChatThreadSummary): boolean {
  return (thread.viewerNotificationPreference ?? "").toUpperCase() === "MUTED";
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

/**
 * Optimistic client-side reads: thread id -> epoch-ms of when the caller
 * locally read it (opened the thread / mark-all-as-read). A TIMESTAMP, not a
 * set membership, on purpose: a plain "read ids" set suppressed the unread
 * dot forever once a thread had been opened this session — new server
 * activity could never re-light it until a full reload cleared the set
 * (THINK-136 acceptance finding). With a timestamp, activity newer than the
 * local read wins automatically.
 */
export type LocallyReadThreadAt = ReadonlyMap<string, number>;

export function isThreadLocallyRead(
  thread: ChatThreadSummary,
  locallyReadThreadAt: LocallyReadThreadAt,
): boolean {
  const readAt = locallyReadThreadAt.get(thread.id);
  if (readAt === undefined) return false;
  return activityTime(thread) <= readAt;
}

/**
 * The threads in a section the caller hasn't read yet, honoring optimistic
 * client-side reads (`locallyReadThreadAt`). The single source of truth for a
 * section's unread badge count, its unread filter, and the id set "Mark all as
 * read" targets — keeping all three consistent so the badge reaches zero after
 * a mark-all (see plan KTD-2).
 */
export function filterUnreadThreads(
  threads: ChatThreadSummary[],
  locallyReadThreadAt: LocallyReadThreadAt,
): ChatThreadSummary[] {
  return threads.filter(
    (thread) =>
      isThreadUnread(thread) && !isThreadLocallyRead(thread, locallyReadThreadAt),
  );
}

/**
 * The threads to DISPLAY in a section when its unread filter is on: the unread
 * set, plus the currently-selected thread retained in place even after clicking
 * it marks it locally-read. Without this the active thread vanishes from the
 * list the same frame it's opened — jarring while you're reading it. It drops
 * out naturally once selection moves elsewhere. The badge and "mark all as
 * read" target still use the pure {@link filterUnreadThreads} set, so retaining
 * the selected thread here never inflates the unread count.
 */
export function displayedUnreadThreads(
  threads: ChatThreadSummary[],
  locallyReadThreadAt: LocallyReadThreadAt,
  selectedThreadId: string | undefined,
): ChatThreadSummary[] {
  return threads.filter(
    (thread) =>
      thread.id === selectedThreadId ||
      (isThreadUnread(thread) &&
        !isThreadLocallyRead(thread, locallyReadThreadAt)),
  );
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
