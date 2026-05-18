import { beforeEach, describe, expect, it, vi } from "vitest";

const { runRequesterIdleMemoryLearning } = vi.hoisted(() => ({
  runRequesterIdleMemoryLearning: vi.fn(),
}));

vi.mock("../lib/requester-memory/learner.js", () => ({
  runRequesterIdleMemoryLearning,
}));

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
  beforeEach(() => {
    runRequesterIdleMemoryLearning.mockReset();
  });

  it("delegates a complete scheduler event to the requester memory learner", async () => {
    runRequesterIdleMemoryLearning.mockResolvedValue({
      ok: true,
      status: "changed",
      changedFiles: [{ path: "memory/candidates/2026-05-18.md" }],
      candidateSummary: {
        extracted: 1,
        accepted: 1,
        rejected: 0,
        categories: { preference: 1 },
        durablePromotionEnabled: false,
      },
      budget: { llmCalls: 0 },
      metadata: { runId: "run-1" },
    });

    const result = await handler(baseEvent);

    expect(result).toMatchObject({
      ok: true,
      status: "changed",
      changedFiles: [{ path: "memory/candidates/2026-05-18.md" }],
      budget: { llmCalls: 0 },
      metadata: { runId: "run-1" },
    });
    expect(runRequesterIdleMemoryLearning).toHaveBeenCalledWith(baseEvent);
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
