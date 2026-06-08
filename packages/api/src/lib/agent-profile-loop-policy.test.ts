import { describe, expect, it } from "vitest";
import {
  defaultAgentLoopPolicy,
  normalizeAgentLoopPolicy,
  normalizeAgentProfileExecutionControls,
} from "./agent-profile-loop-policy.js";

describe("agent profile loop policy", () => {
  it("fills conservative closed-loop defaults", () => {
    expect(normalizeAgentLoopPolicy({})).toEqual(defaultAgentLoopPolicy());
  });

  it("preserves legacy review controls while producing a normalized policy", () => {
    expect(
      normalizeAgentProfileExecutionControls({
        clarify: true,
        maxRuntimeMs: "90000",
        maxTokens: 4096,
        costBudgetUsd: 0.25,
        thinking: "low",
        reviewGate: true,
        maxReviewLoops: 3,
      }),
    ).toEqual({
      foreground: true,
      clarify: true,
      maxSubagentDepth: 0,
      maxRuntimeMs: 90000,
      maxTokens: 4096,
      costBudgetUsd: 0.25,
      thinking: "low",
      reviewGate: true,
      maxReviewLoops: 3,
      loopPolicy: {
        mode: "closed",
        enabled: true,
        maxIterations: 1,
        maxReviewLoops: 3,
        reviewGate: true,
        externalReviewerPolicy: "explicit",
        failBehavior: "return_blocker",
        maxRuntimeMs: 90000,
        maxTokens: 4096,
        costBudgetUsd: 0.25,
      },
    });
  });

  it("normalizes explicit loop policy values and rejects unsafe values", () => {
    expect(
      normalizeAgentLoopPolicy({
        loopPolicy: {
          mode: "open",
          enabled: false,
          maxIterations: 4,
          maxReviewLoops: 2,
          reviewGate: true,
          externalReviewerPolicy: "always",
          failBehavior: "best_effort_with_warning",
          maxRuntimeMs: -1,
          maxTokens: 1000,
        },
      }),
    ).toEqual({
      mode: "closed",
      enabled: false,
      maxIterations: 4,
      maxReviewLoops: 2,
      reviewGate: true,
      externalReviewerPolicy: "always",
      failBehavior: "best_effort_with_warning",
      maxTokens: 1000,
    });
  });
});
