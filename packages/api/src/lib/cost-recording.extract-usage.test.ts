/**
 * Tests the REAL extractUsage export (cost-recording.test.ts uses a local
 * copy, which is how a key mismatch shipped unnoticed).
 *
 * Regression: the Pi runtime returns pi-ai style usage keys
 * ({input, output, cacheRead}) under response.usage. extractUsage only
 * checked inputTokens/input_tokens/prompt_tokens, so every wakeup-dispatched
 * turn (question_answer, automation) recorded 0/0 tokens and the turn
 * header lost its "X in / Y out" label.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("@thinkwork/database-pg", async (importOriginal) => {
  const actual = await importOriginal<object>();
  return { ...actual, getDb: () => ({}) };
});

import { extractUsage } from "./cost-recording";

describe("extractUsage", () => {
  it("reads pi-ai style keys (input/output/cacheRead) from response.usage", () => {
    const usage = extractUsage({
      response: {
        model: "moonshotai.kimi-k2.5",
        usage: { input: 8968, output: 427, cacheRead: 12 },
      },
    });
    expect(usage).toEqual({
      inputTokens: 8968,
      outputTokens: 427,
      cachedReadTokens: 12,
      model: "moonshotai.kimi-k2.5",
    });
  });

  it("still reads AgentCore snake_case keys", () => {
    const usage = extractUsage({
      usage: { input_tokens: 100, output_tokens: 20, cached_read_tokens: 5 },
      model: "claude-sonnet-4-6",
    });
    expect(usage.inputTokens).toBe(100);
    expect(usage.outputTokens).toBe(20);
    expect(usage.cachedReadTokens).toBe(5);
  });

  it("returns zeros for missing usage", () => {
    const usage = extractUsage({});
    expect(usage.inputTokens).toBe(0);
    expect(usage.outputTokens).toBe(0);
  });
});
