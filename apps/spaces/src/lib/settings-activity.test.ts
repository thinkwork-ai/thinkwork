import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activityTimestamp,
  buildLast30DaysCounts,
  dateKey,
  filterActivityItems,
  isActivityDay,
  mapThreadToActivityItem,
  mapThreadsToActivityItems,
  type ActivityItem,
  type ActivityThreadSummary,
} from "./settings-activity";

function thread(
  overrides: Partial<ActivityThreadSummary> = {},
): ActivityThreadSummary {
  return {
    id: "thread-1",
    number: 42,
    identifier: "CHAT-42",
    title: "Analyze the budget",
    status: "IN_PROGRESS",
    channel: "CHAT",
    costSummary: 0.1234,
    lastActivityAt: "2026-05-31T14:00:00.000Z",
    lastTurnCompletedAt: "2026-05-30T14:00:00.000Z",
    updatedAt: "2026-05-29T14:00:00.000Z",
    createdAt: "2026-05-28T14:00:00.000Z",
    agent: { id: "agent-1", name: "Pi" },
    ...overrides,
  };
}

describe("settings activity helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("maps a thread to an activity row", () => {
    const item = mapThreadToActivityItem(thread());

    expect(item).toMatchObject({
      id: "thread:thread-1",
      threadId: "thread-1",
      type: "chat",
      title: "CHAT-42: Analyze the budget",
      status: "in_progress",
      agentName: "Pi",
      cost: 0.1234,
    });
    expect(item.timestamp).toBe(new Date("2026-05-31T14:00:00.000Z").getTime());
  });

  it("falls back through activity timestamps in order", () => {
    expect(
      activityTimestamp(
        thread({
          lastActivityAt: null,
          lastTurnCompletedAt: "2026-05-30T14:00:00.000Z",
        }),
      ),
    ).toBe(new Date("2026-05-30T14:00:00.000Z").getTime());

    expect(
      activityTimestamp(
        thread({
          lastActivityAt: null,
          lastTurnCompletedAt: null,
          updatedAt: "2026-05-29T14:00:00.000Z",
        }),
      ),
    ).toBe(new Date("2026-05-29T14:00:00.000Z").getTime());

    expect(
      activityTimestamp(
        thread({
          lastActivityAt: null,
          lastTurnCompletedAt: null,
          updatedAt: null,
          createdAt: "2026-05-28T14:00:00.000Z",
        }),
      ),
    ).toBe(new Date("2026-05-28T14:00:00.000Z").getTime());
  });

  it("handles invalid or missing timestamps without crashing", () => {
    const source = thread({
      lastActivityAt: "nope",
      lastTurnCompletedAt: null,
      updatedAt: null,
      createdAt: null,
    });
    const item = mapThreadToActivityItem(source);

    expect(item.timestamp).toBe(0);
    expect(mapThreadsToActivityItems([source])).toHaveLength(1);
  });

  it("builds a complete last-30-days count series", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-05T12:00:00.000Z"));
    const day = dateKey(new Date("2026-05-31T14:00:00.000Z"));
    const items: ActivityItem[] = [
      mapThreadToActivityItem(thread({ id: "a" })),
      mapThreadToActivityItem(thread({ id: "b" })),
    ];

    const counts = buildLast30DaysCounts(items);

    expect(counts).toHaveLength(30);
    expect(counts[0]?.day).toBe("2026-05-07");
    expect(counts.at(-1)?.day).toBe("2026-06-05");
    expect(counts.find((entry) => entry.day === day)?.count).toBe(2);
    expect(counts.find((entry) => entry.day === "2026-05-30")?.count).toBe(0);
  });

  it("filters by search and day", () => {
    const may31 = mapThreadToActivityItem(thread({ id: "may31" }));
    const june1 = mapThreadToActivityItem(
      thread({
        id: "june1",
        title: "Research customer churn",
        lastActivityAt: "2026-06-01T14:00:00.000Z",
        agent: { id: "agent-2", name: "Analyst" },
      }),
    );

    expect(filterActivityItems([may31, june1], { search: "PI" })).toEqual([
      may31,
    ]);
    expect(
      filterActivityItems([may31, june1], {
        day: dateKey(may31.timestamp),
      }),
    ).toEqual([may31]);
    expect(
      filterActivityItems([may31, june1], {
        search: "analyst",
        day: dateKey(june1.timestamp),
      }),
    ).toEqual([june1]);
  });

  it("validates canonical activity day values", () => {
    expect(isActivityDay("2026-05-31")).toBe(true);
    expect(isActivityDay("2026-02-30")).toBe(false);
    expect(isActivityDay("May 31")).toBe(false);
    expect(isActivityDay(null)).toBe(false);
  });
});
