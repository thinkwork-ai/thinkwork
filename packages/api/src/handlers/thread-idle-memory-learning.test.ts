import { describe, expect, it } from "vitest";
import { handler } from "./thread-idle-memory-learning.js";

const baseEvent = {
  runId: "run-1",
  tenantId: "tenant-1",
  threadId: "thread-1",
  computerId: "computer-1",
  requesterUserId: "user-1",
  scheduledJobId: "job-1",
  activitySequence: 3,
  scheduledFor: "2026-05-18T17:15:00.000Z",
  lastActivityAt: "2026-05-18T17:00:00.000Z",
};

describe("thread-idle-memory-learning handler", () => {
  it("returns an inert no-change result for a complete Slice A event", async () => {
    const result = await handler(baseEvent);

    expect(result).toMatchObject({
      ok: true,
      status: "no_change",
      changedFiles: [],
      budget: {
        mode: "inert",
        llmCalls: 0,
        memoryWrites: 0,
      },
      metadata: {
        runId: "run-1",
        scheduledJobId: "job-1",
        activitySequence: 3,
      },
    });
  });

  it("fails fast when required scheduler fields are absent", async () => {
    const result = await handler({
      ...baseEvent,
      threadId: undefined,
      activitySequence: undefined,
    });

    expect(result).toEqual({
      ok: false,
      status: "failed",
      changedFiles: [],
      error: "missing required fields: threadId, activitySequence",
    });
  });
});
