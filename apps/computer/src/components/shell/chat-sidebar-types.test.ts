import { afterEach, describe, expect, it, vi } from "vitest";
import {
  groupThreadsByRecency,
  recencyGroupLabel,
  sortThreadsByActivityDesc,
} from "./chat-sidebar-types";

afterEach(() => {
  vi.useRealTimers();
});

describe("chat-sidebar-types", () => {
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
});
