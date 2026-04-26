export interface ThreadHitlReview {
  threadId?: string | null;
  requestedAt?: string | null;
  reason?: string | null;
  targetPath?: string | null;
  run?: {
    id?: string | null;
    status?: string | null;
  } | null;
}

export function pendingHitlByThreadId(
  reviews: ThreadHitlReview[] | null | undefined,
): Map<string, ThreadHitlReview> {
  const byThreadId = new Map<string, ThreadHitlReview>();
  for (const review of reviews ?? []) {
    if (!review.threadId) continue;
    const existing = byThreadId.get(review.threadId);
    if (!existing || reviewTime(review) > reviewTime(existing)) {
      byThreadId.set(review.threadId, review);
    }
  }
  return byThreadId;
}

export function sortThreadsWithHitlFirst<T extends { id: string }>(
  threads: T[],
  reviewsByThreadId: Map<string, ThreadHitlReview>,
  getThreadTime: (thread: T) => string | null | undefined,
): T[] {
  return [...threads].sort((a, b) => {
    const aReview = reviewsByThreadId.get(a.id);
    const bReview = reviewsByThreadId.get(b.id);
    if (!!aReview !== !!bReview) return aReview ? -1 : 1;

    const aTime = aReview ? reviewTime(aReview) : timeValue(getThreadTime(a));
    const bTime = bReview ? reviewTime(bReview) : timeValue(getThreadTime(b));
    return bTime - aTime;
  });
}

export function threadTabBadgeState(
  threads: { id: string }[],
  reviewsByThreadId: Map<string, ThreadHitlReview>,
  isThreadUnread: (thread: { id: string }) => boolean,
): { kind: "hitl" | "unread"; count: number } | null {
  const visibleHitlCount = threads.filter((thread) =>
    reviewsByThreadId.has(thread.id),
  ).length;
  if (visibleHitlCount > 0) return { kind: "hitl", count: visibleHitlCount };

  const unreadCount = threads.filter(isThreadUnread).length;
  return unreadCount > 0 ? { kind: "unread", count: unreadCount } : null;
}

export function hitlThreadPreview(review?: ThreadHitlReview | null): string {
  const reason = normalizeReason(review?.reason);
  if (reason) return `Waiting for confirmation: ${reason}`;
  return "Waiting for your confirmation";
}

function normalizeReason(reason?: string | null): string {
  return (reason ?? "").replace(/[_-]+/g, " ").trim();
}

function reviewTime(review: ThreadHitlReview): number {
  return timeValue(review.requestedAt);
}

function timeValue(value?: string | null): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}
