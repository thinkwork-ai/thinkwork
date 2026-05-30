import { describe, expect, it } from "vitest";
import {
  clearPendingThreadStart,
  getPendingThreadStart,
  setPendingThreadStart,
} from "./pending-thread-starts";

describe("pending thread starts", () => {
  it("stores and clears the optimistic first-message scaffold", () => {
    clearPendingThreadStart("thread-1");

    setPendingThreadStart({
      threadId: "thread-1",
      title: "Hello",
      content: "Hello",
      expectAssistantResponse: true,
      userId: "user-1",
      createdAt: "2026-05-30T00:00:00.000Z",
    });

    expect(getPendingThreadStart("thread-1")).toMatchObject({
      threadId: "thread-1",
      content: "Hello",
      expectAssistantResponse: true,
    });

    clearPendingThreadStart("thread-1");

    expect(getPendingThreadStart("thread-1")).toBeNull();
  });
});
