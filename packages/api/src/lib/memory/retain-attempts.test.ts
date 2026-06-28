import { describe, expect, it } from "vitest";

import {
  buildRetainSourceEventKey,
  classifyRetainError,
  nextRetryAt,
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
});
