import { describe, expect, it } from "vitest";

import {
  DOCTOR_BEDROCK_PROBE_MODEL_ID,
  MIN_LAMBDA_CONCURRENT_EXECUTIONS,
  evaluateBedrockProbe,
  evaluateLambdaConcurrency,
} from "../src/commands/doctor.js";

describe("doctor Bedrock probe evaluation", () => {
  it("passes on a successful invocation", () => {
    const result = evaluateBedrockProbe(null);
    expect(result.pass).toBe(true);
    expect(result.detail).toContain(DOCTOR_BEDROCK_PROBE_MODEL_ID);
  });

  it("surfaces the Anthropic use-case form as the actionable failure", () => {
    const result = evaluateBedrockProbe(
      "An error occurred (ResourceNotFoundException): Model use case details " +
        "have not been submitted for this account.",
    );
    expect(result.pass).toBe(false);
    expect(result.detail).toContain("put-use-case-for-model-access");
  });

  it("explains the new-account quota ramp on throttling", () => {
    const result = evaluateBedrockProbe(
      "An error occurred (ThrottlingException) when calling the Converse " +
        "operation: Too many tokens per day, please wait before trying again.",
    );
    expect(result.pass).toBe(false);
    expect(result.detail).toContain("ramps up");
  });

  it("points access denials at the model-access console", () => {
    const result = evaluateBedrockProbe(
      "An error occurred (AccessDeniedException) when calling the Converse operation",
    );
    expect(result.pass).toBe(false);
    expect(result.detail).toContain("Model access");
  });

  it("truncates unknown failures", () => {
    const result = evaluateBedrockProbe("X".repeat(500));
    expect(result.pass).toBe(false);
    expect(result.detail.length).toBeLessThan(260);
  });
});

describe("doctor Lambda concurrency evaluation", () => {
  it("passes at or above the floor", () => {
    expect(evaluateLambdaConcurrency(1000).pass).toBe(true);
    expect(
      evaluateLambdaConcurrency(MIN_LAMBDA_CONCURRENT_EXECUTIONS).pass,
    ).toBe(true);
  });

  it("fails the new-account default of 10 with the quota-increase command", () => {
    const result = evaluateLambdaConcurrency(10);
    expect(result.pass).toBe(false);
    expect(result.detail).toContain("L-B99A9384");
  });

  it("fails when the limit cannot be read", () => {
    expect(evaluateLambdaConcurrency(null).pass).toBe(false);
  });
});
