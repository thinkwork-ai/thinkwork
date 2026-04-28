export interface ThreadHitlReview {
  threadId?: string | null;
  requestedAt?: string | null;
  reason?: string | null;
  targetPath?: string | null;
  responsibleUserId?: string | null;
  kind?: string | null;
  run?: {
    id?: string | null;
    agentId?: string | null;
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

/**
 * Pending review whose `run.agentId` is NOT among the user's directly-paired
 * agents — i.e. it surfaced via the `parent_agent_id` chain walk. Mobile
 * shows these with a sub-agent-specific label so the operator knows the
 * action belongs to a child agent rather than the thread's own agent.
 */
export function isSubAgentReview(
  review: ThreadHitlReview | null | undefined,
  pairedAgentIds: ReadonlySet<string>,
): boolean {
  const runAgentId = review?.run?.agentId ?? null;
  if (!runAgentId) return false;
  return !pairedAgentIds.has(runAgentId);
}

/**
 * Label override for sub-agent reviews surfaced through the parent chain.
 * When the run's agent isn't directly paired to the caller (i.e. it's a
 * descendant in the `parent_agent_id` chain), render a label that names
 * the originating sub-agent and its target path so the operator has
 * context that the action belongs to a child agent.
 *
 * Returns `null` for direct-agent reviews so callers fall through to
 * `hitlThreadPreview`'s default copy.
 */
export function subAgentReviewPreview(
  review: ThreadHitlReview | null | undefined,
  options: {
    pairedAgentIds: ReadonlySet<string>;
    agentNames: Readonly<Record<string, string>>;
  },
): string | null {
  if (!review) return null;
  if (!isSubAgentReview(review, options.pairedAgentIds)) return null;
  const runAgentId = review.run?.agentId ?? "";
  const subAgentName =
    (runAgentId && options.agentNames[runAgentId]) || "sub-agent";
  const target = review.targetPath?.trim();
  if (target) {
    return `Sub-agent ${subAgentName} needs your input on ${target}`;
  }
  return `Sub-agent ${subAgentName} needs your input`;
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
