import { afterEach, describe, expect, it, vi } from "vitest";
import {
  displayedUnreadThreads,
  filterUnreadThreads,
  groupThreadsByRecency,
  isThreadMuted,
  recencyGroupLabel,
  sortThreadsByActivityDesc,
} from "./chat-sidebar-types";

afterEach(() => {
  vi.useRealTimers();
});

describe("chat-sidebar-types", () => {
  it("reads the viewer's muted state case-insensitively and defaults to unmuted", () => {
    expect(isThreadMuted({ id: "t1" })).toBe(false);
    expect(
      isThreadMuted({ id: "t1", viewerNotificationPreference: null }),
    ).toBe(false);
    expect(
      isThreadMuted({ id: "t1", viewerNotificationPreference: "SUBSCRIBED" }),
    ).toBe(false);
    expect(
      isThreadMuted({ id: "t1", viewerNotificationPreference: "MUTED" }),
    ).toBe(true);
    expect(
      isThreadMuted({ id: "t1", viewerNotificationPreference: "muted" }),
    ).toBe(true);
  });

  it("uses only Today, Yesterday, and Older recency groups", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-19T12:00:00Z"));

    expect(recencyGroupLabel("2026-05-19T08:00:00Z")).toBe("Today");
    expect(recencyGroupLabel("2026-05-18T22:00:00Z")).toBe("Yesterday");
    expect(recencyGroupLabel("2026-05-17T22:00:00Z")).toBe("Older");

    const groups = groupThreadsByRecency([
      { id: "today", createdAt: "2026-05-19T08:00:00Z" },
      { id: "yesterday", createdAt: "2026-05-18T22:00:00Z" },
      { id: "last-week", createdAt: "2026-05-13T22:00:00Z" },
    ]);

    expect(groups.map((group) => group.label)).toEqual([
      "Today",
      "Yesterday",
      "Older",
    ]);
  });

  it("sorts newest thread activity first", () => {
    const sorted = sortThreadsByActivityDesc([
      {
        id: "activity-newer-but-created-older",
        createdAt: "2026-05-19T08:00:00Z",
        lastActivityAt: "2026-05-19T12:00:00Z",
      },
      { id: "newest", createdAt: "2026-05-19T10:00:00Z" },
      { id: "middle", createdAt: "2026-05-19T09:00:00Z" },
    ]);

    expect(sorted.map((thread) => thread.id)).toEqual([
      "activity-newer-but-created-older",
      "newest",
      "middle",
    ]);
  });

  it("retains the selected thread in a filtered section even once it's read", () => {
    // Two unread threads plus the one the user just opened (now locally read).
    const threads = [
      { id: "unread-a", lastActivityAt: "2026-05-19T12:00:00Z" },
      { id: "selected", lastActivityAt: "2026-05-19T11:00:00Z" },
      { id: "unread-b", lastActivityAt: "2026-05-19T10:00:00Z" },
    ];
    // Locally read AFTER its latest activity, so it counts as read.
    const locallyRead = new Map([
      ["selected", new Date("2026-05-19T11:30:00Z").getTime()],
    ]);

    // The pure unread set (badge / mark-all target) excludes the read thread.
    expect(filterUnreadThreads(threads, locallyRead).map((t) => t.id)).toEqual([
      "unread-a",
      "unread-b",
    ]);

    // The DISPLAYED set keeps the selected thread in place so it doesn't vanish
    // the frame it's opened, without reordering the unread threads.
    expect(
      displayedUnreadThreads(threads, locallyRead, "selected").map((t) => t.id),
    ).toEqual(["unread-a", "selected", "unread-b"]);

    // With no selection it matches the pure unread set.
    expect(
      displayedUnreadThreads(threads, locallyRead, undefined).map((t) => t.id),
    ).toEqual(["unread-a", "unread-b"]);
  });

  it("re-lights the unread state when activity lands after a local read", () => {
    // THINK-136 acceptance regression: a plain read-ids set suppressed the
    // unread dot forever once a thread was opened this session — a new
    // message could only surface the dot after a full browser reload.
    const readAt = new Date("2026-05-19T11:00:00Z").getTime();
    const locallyRead = new Map([["thread-1", readAt]]);

    const beforeNewMessage = [
      { id: "thread-1", lastActivityAt: "2026-05-19T10:00:00Z" },
    ];
    expect(filterUnreadThreads(beforeNewMessage, locallyRead)).toEqual([]);

    // A refetch brings activity NEWER than the local read → unread again.
    const afterNewMessage = [
      { id: "thread-1", lastActivityAt: "2026-05-19T12:00:00Z" },
    ];
    expect(
      filterUnreadThreads(afterNewMessage, locallyRead).map((t) => t.id),
    ).toEqual(["thread-1"]);
  });
});
