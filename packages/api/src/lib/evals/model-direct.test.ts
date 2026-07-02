/**
 * Tier-`model` invoke tests (Eval Execution Tiers v1): the us.-prefix
 * retry guard. The Converse call itself is exercised through the worker
 * integration suite's seam; here we pin the retry decision logic.
 */

import { describe, expect, it } from "vitest";
import { shouldRetryWithUsPrefix } from "./model-direct.js";

describe("shouldRetryWithUsPrefix", () => {
  it("retries bare model ids that reject with inference-profile validation errors", () => {
    expect(
      shouldRetryWithUsPrefix(
        "moonshotai.kimi-k2.5",
        new Error(
          "ValidationException: Invocation of model ID moonshotai.kimi-k2.5 with on-demand throughput isn’t supported.",
        ),
      ),
    ).toBe(true);
  });

  it("never retries ids already carrying the us. prefix, and never on unrelated errors", () => {
    expect(
      shouldRetryWithUsPrefix(
        "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        new Error("ValidationException: anything"),
      ),
    ).toBe(false);
    expect(
      shouldRetryWithUsPrefix(
        "moonshotai.kimi-k2.5",
        new Error("AccessDeniedException: not authorized"),
      ),
    ).toBe(false);
  });
});
