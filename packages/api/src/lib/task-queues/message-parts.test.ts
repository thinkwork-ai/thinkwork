import { describe, expect, it } from "vitest";
import {
  taskQueuePart,
  taskQueueThreadMetadata,
  upsertTaskQueuePart,
} from "./message-parts.js";

describe("task queue message parts", () => {
  it("creates a generic task queue data part", () => {
    expect(
      taskQueuePart({
        queueId: "queue-1",
        data: {
          title: "Research plan",
          status: "running",
          items: [{ id: "task-1", title: "Search sources" }],
        },
      }),
    ).toEqual({
      type: "data-task-queue",
      id: "task-queue:queue-1",
      data: {
        queueId: "queue-1",
        title: "Research plan",
        status: "running",
        items: [{ id: "task-1", title: "Search sources" }],
      },
    });
  });

  it("replaces the matching task queue part without touching other parts", () => {
    const text = { type: "text", id: "intro", text: "Starting" };
    const stale = taskQueuePart({
      queueId: "queue-1",
      data: { title: "Old", status: "running" },
    });
    const fresh = taskQueuePart({
      queueId: "queue-1",
      data: { title: "New", status: "completed" },
    });

    expect(upsertTaskQueuePart([text, stale], fresh)).toEqual([text, fresh]);
  });

  it("stores only the active queue pointer in thread metadata", () => {
    expect(taskQueueThreadMetadata({ title: "Untouched" }, "queue-1")).toEqual({
      title: "Untouched",
      activeTaskQueueId: "queue-1",
    });
    expect(
      taskQueueThreadMetadata({ activeTaskQueueId: "queue-1" }, null),
    ).toEqual({});
  });
});
