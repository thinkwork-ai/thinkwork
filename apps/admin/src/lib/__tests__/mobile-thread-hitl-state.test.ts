import { describe, expect, it } from "vitest";
import {
  hitlThreadPreview,
  pendingHitlByThreadId,
  sortThreadsWithHitlFirst,
  threadTabBadgeState,
} from "../../../../mobile/lib/thread-hitl-state";

describe("mobile thread HITL state helpers", () => {
  it("pins pending HITL threads above newer regular threads", () => {
    const reviews = pendingHitlByThreadId([
      {
        threadId: "thread-hitl",
        requestedAt: "2026-04-26T12:00:00.000Z",
      },
    ]);

    const threads = sortThreadsWithHitlFirst(
      [
        { id: "thread-new", lastTurnCompletedAt: "2026-04-26T12:30:00.000Z" },
        { id: "thread-hitl", lastTurnCompletedAt: "2026-04-26T12:00:00.000Z" },
      ],
      reviews,
      (thread) => thread.lastTurnCompletedAt,
    );

    expect(threads.map((thread) => thread.id)).toEqual([
      "thread-hitl",
      "thread-new",
    ]);
  });

  it("uses the newest pending review per thread", () => {
    const reviews = pendingHitlByThreadId([
      {
        threadId: "thread-1",
        requestedAt: "2026-04-26T12:00:00.000Z",
        reason: "old",
      },
      {
        threadId: "thread-1",
        requestedAt: "2026-04-26T12:05:00.000Z",
        reason: "needs_approval",
      },
    ]);

    expect(reviews.get("thread-1")?.reason).toBe("needs_approval");
    expect(hitlThreadPreview(reviews.get("thread-1"))).toBe(
      "Waiting for confirmation: needs approval",
    );
  });

  it("colors the tab badge for visible HITL before unread count", () => {
    const reviews = pendingHitlByThreadId([{ threadId: "thread-1" }]);

    expect(
      threadTabBadgeState(
        [{ id: "thread-1" }, { id: "thread-2" }],
        reviews,
        () => true,
      ),
    ).toEqual({ kind: "hitl", count: 1 });

    expect(
      threadTabBadgeState([{ id: "thread-2" }], reviews, () => true),
    ).toEqual({ kind: "unread", count: 1 });
  });
});
