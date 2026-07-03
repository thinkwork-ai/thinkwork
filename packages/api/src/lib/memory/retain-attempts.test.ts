import { describe, expect, it, vi } from "vitest";

const updateMock = vi.hoisted(() => vi.fn());

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({ update: updateMock }),
}));

import {
  buildRetainSourceEventKey,
  classifyRetainError,
  nextRetryAt,
  runningAttemptStaleBefore,
  sweepExhaustedRunningAttempts,
} from "./retain-attempts.js";

describe("retain-attempts helpers", () => {
  it("uses explicit source event keys when the runtime provides one", () => {
    expect(
      buildRetainSourceEventKey({
        tenantId: "tenant-1",
        userId: "user-1",
        threadId: "thread-1",
        metadata: { sourceEventKey: "turn:abc" },
      }),
    ).toBe("turn:abc");
  });

  it("derives a stable source key from the event tail when no turn id exists", () => {
    const input = {
      tenantId: "tenant-1",
      userId: "user-1",
      threadId: "thread-1",
      transcript: [{ role: "user", content: "Birdie is my puppy." }],
    };
    expect(buildRetainSourceEventKey(input)).toBe(
      buildRetainSourceEventKey(input),
    );
    expect(buildRetainSourceEventKey(input)).toMatch(/^thread:thread-1:/);
  });

  it("classifies aborts and timeout messages as retryable timeouts", () => {
    expect(
      classifyRetainError(
        new Error(
          "[hindsight-adapter] retainConversation failed: The operation was aborted due to timeout",
        ),
      ),
    ).toMatchObject({
      status: "failed_timeout",
      retryable: true,
      errorClass: "timeout",
    });
  });

  it("classifies Hindsight 5xx as retryable backend failure", () => {
    expect(
      classifyRetainError(
        new Error(
          "[hindsight-adapter] retainConversation failed: hindsight retainConversation 503",
        ),
      ),
    ).toMatchObject({
      status: "failed_backend",
      retryable: true,
      errorClass: "hindsight_503",
    });
  });

  it("classifies an ALB 504 HTML error page as retryable backend failure", () => {
    // Real shape observed on dev: the Hindsight ALB times out before the
    // backend finishes and returns its own HTML 504 page.
    expect(
      classifyRetainError(
        new Error(
          "[hindsight-adapter] retainConversation failed: hindsight retainConversation 504: <html>\r\n<head><title>504 Gateway Time-out</title></head>",
        ),
      ),
    ).toMatchObject({
      status: "failed_backend",
      retryable: true,
      errorClass: "hindsight_504",
    });
  });

  it("classifies Hindsight 4xx as non-retryable dead letter", () => {
    expect(
      classifyRetainError(
        new Error(
          "[hindsight-adapter] retainConversation failed: hindsight retainConversation 400",
        ),
      ),
    ).toMatchObject({
      status: "dead_lettered",
      retryable: false,
      errorClass: "hindsight_400",
    });
  });

  it("uses bounded exponential-ish retry delays", () => {
    const now = new Date("2026-06-28T00:00:00.000Z");
    expect(nextRetryAt(1, now).toISOString()).toBe("2026-06-28T00:00:30.000Z");
    expect(nextRetryAt(2, now).toISOString()).toBe("2026-06-28T00:02:00.000Z");
    expect(nextRetryAt(9, now).toISOString()).toBe("2026-06-28T00:30:00.000Z");
  });

  it("derives the stale running lease cutoff from the current time", () => {
    const now = new Date("2026-06-28T00:10:00.000Z");
    // Default lease must exceed the memory-retain Lambda timeout (300s) so a
    // live in-flight attempt is never reclaimed and double-run.
    expect(runningAttemptStaleBefore(now).toISOString()).toBe(
      "2026-06-28T00:04:00.000Z",
    );
    expect(runningAttemptStaleBefore(now, 30_000).toISOString()).toBe(
      "2026-06-28T00:09:30.000Z",
    );
  });

  it("sweeps exhausted stale running attempts to dead_lettered", async () => {
    const returningMock = vi
      .fn()
      .mockResolvedValue([{ id: "a-1" }, { id: "a-2" }]);
    const whereMock = vi.fn().mockReturnValue({ returning: returningMock });
    const setMock = vi.fn().mockReturnValue({ where: whereMock });
    updateMock.mockReturnValue({ set: setMock });

    const swept = await sweepExhaustedRunningAttempts({
      now: new Date("2026-06-28T00:10:00.000Z"),
    });

    expect(swept).toBe(2);
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "dead_lettered",
        next_retry_at: null,
        locked_at: null,
        locked_by: null,
      }),
    );
    expect(whereMock).toHaveBeenCalledTimes(1);
  });
});
