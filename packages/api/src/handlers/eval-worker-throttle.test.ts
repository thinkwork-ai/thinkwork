/**
 * Throttle-absorption tests (eval throughput fix).
 *
 * The defect: a Bedrock throttle rethrown to SQS parked its FIFO lane
 * for the queue's full 300s visibility timeout — under sustained
 * throttling a 20-lane fan-out collapsed to near-serial throughput.
 * These tests pin the two-layer fix: in-worker retries absorb transient
 * throttles, and redrives release their lane in seconds, not minutes.
 */

import { describe, expect, it, vi } from "vitest";
import {
  evalThrottleRetryAttempts,
  evalThrottleRetryBaseMs,
  queueUrlFromEventSourceArn,
  throttleBackoffMs,
  throttleRedriveVisibilitySeconds,
  withEvalThrottleRetries,
} from "./eval-worker.js";

function throttleError(): Error {
  return new Error("ThrottlingException: Too many requests");
}

describe("withEvalThrottleRetries", () => {
  it("absorbs a transient throttle in-worker and succeeds without a redrive", async () => {
    const sleeper = vi.fn().mockResolvedValue(undefined);
    let calls = 0;
    const result = await withEvalThrottleRetries(
      async () => {
        calls += 1;
        if (calls === 1) throw throttleError();
        return "ok";
      },
      { attempts: 2, baseMs: 1, sleeper },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(2);
    expect(sleeper).toHaveBeenCalledTimes(1);
  });

  it("rethrows once in-worker attempts are exhausted (SQS redrive takes over)", async () => {
    const sleeper = vi.fn().mockResolvedValue(undefined);
    let calls = 0;
    await expect(
      withEvalThrottleRetries(
        async () => {
          calls += 1;
          throw throttleError();
        },
        { attempts: 2, baseMs: 1, sleeper },
      ),
    ).rejects.toThrow(/ThrottlingException/);
    expect(calls).toBe(3); // first try + 2 retries
  });

  it("passes lastAttempt=true only on the exhausted attempt (final-receive record path)", async () => {
    const seen: boolean[] = [];
    await withEvalThrottleRetries(
      async (lastAttempt) => {
        seen.push(lastAttempt);
        if (seen.length <= 2) throw throttleError();
        return null;
      },
      { attempts: 2, baseMs: 1, sleeper: async () => {} },
    );
    expect(seen).toEqual([false, false, true]);
  });

  it("never retries non-throttle errors — timeouts and crashes keep their taxonomy", async () => {
    let calls = 0;
    await expect(
      withEvalThrottleRetries(
        async () => {
          calls += 1;
          throw new Error("something unrelated broke");
        },
        { attempts: 3, baseMs: 1, sleeper: async () => {} },
      ),
    ).rejects.toThrow(/unrelated/);
    expect(calls).toBe(1);
  });

  it("attempts=0 disables in-worker retries entirely", async () => {
    let calls = 0;
    await expect(
      withEvalThrottleRetries(
        async () => {
          calls += 1;
          throw throttleError();
        },
        { attempts: 0, baseMs: 1, sleeper: async () => {} },
      ),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });
});

describe("throttle backoff shapes", () => {
  it("backoff grows exponentially with bounded jitter", () => {
    expect(throttleBackoffMs(1, 8_000, () => 0)).toBe(8_000);
    expect(throttleBackoffMs(2, 8_000, () => 0)).toBe(16_000);
    expect(throttleBackoffMs(1, 8_000, () => 1)).toBe(10_000); // +25% max
  });

  it("redrive visibility stays SECONDS (never the 300s lane-parking default) and grows with receive count", () => {
    expect(throttleRedriveVisibilitySeconds(1, () => 0)).toBe(10);
    expect(throttleRedriveVisibilitySeconds(2, () => 0)).toBe(20);
    expect(throttleRedriveVisibilitySeconds(5, () => 0)).toBe(60); // capped
    expect(throttleRedriveVisibilitySeconds(9, () => 1)).toBe(70); // cap + jitter
    expect(throttleRedriveVisibilitySeconds(Number.NaN, () => 0)).toBe(10);
  });
});

describe("queueUrlFromEventSourceArn", () => {
  it("derives the queue URL from the record's event source ARN", () => {
    expect(
      queueUrlFromEventSourceArn(
        "arn:aws:sqs:us-east-1:487219502366:thinkwork-dev-eval-fanout.fifo",
      ),
    ).toBe(
      "https://sqs.us-east-1.amazonaws.com/487219502366/thinkwork-dev-eval-fanout.fifo",
    );
    expect(queueUrlFromEventSourceArn("not-an-arn")).toBeNull();
  });
});

describe("env knobs", () => {
  it("parses retry attempts and base delay with safe defaults", () => {
    expect(evalThrottleRetryAttempts(undefined)).toBe(2);
    expect(evalThrottleRetryAttempts("4")).toBe(4);
    expect(evalThrottleRetryAttempts("0")).toBe(0);
    expect(evalThrottleRetryAttempts("-1")).toBe(2);
    expect(evalThrottleRetryBaseMs(undefined)).toBe(8_000);
    expect(evalThrottleRetryBaseMs("2500")).toBe(2_500);
    expect(evalThrottleRetryBaseMs("garbage")).toBe(8_000);
  });
});
