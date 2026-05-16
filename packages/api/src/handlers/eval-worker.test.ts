import { describe, expect, it } from "vitest";
import {
  agentCoreEvaluatorsEnabled,
  estimateAgentCoreEvaluatorCostUsd,
  parseEvalWorkerMessage,
  summarizeEvalResults,
} from "./eval-worker.js";

describe("eval-worker message parsing", () => {
  it("requires both runId and testCaseId", () => {
    expect(
      parseEvalWorkerMessage(
        JSON.stringify({ runId: "run-1", testCaseId: "tc-1", index: 2 }),
      ),
    ).toEqual({ runId: "run-1", testCaseId: "tc-1", index: 2 });

    expect(() =>
      parseEvalWorkerMessage(JSON.stringify({ runId: "run-1" })),
    ).toThrow(/runId and testCaseId/);
  });
});

describe("eval-worker finalization summary", () => {
  it("aggregates pass/fail totals and input/output evaluator token cost", () => {
    const summary = summarizeEvalResults([
      {
        status: "pass",
        evaluator_results: [
          { token_usage: { inputTokens: 1000, outputTokens: 100 } },
          { token_usage: { inputTokens: 500, outputTokens: 50 } },
        ],
      },
      {
        status: "fail",
        evaluator_results: [
          { token_usage: { totalTokens: 250 } },
          { skipped: true },
        ],
      },
      { status: "error", evaluator_results: [] },
    ]);

    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(2);
    expect(summary.passRate).toBe(1 / 3);
    expect(summary.totalCostUsd).toBeCloseTo(0.0084);
  });
});

describe("eval-worker evaluator cost controls", () => {
  it("uses AWS built-in evaluator input/output rates when token split is available", () => {
    expect(
      estimateAgentCoreEvaluatorCostUsd({
        inputTokens: 59_788,
        outputTokens: 3_311,
        totalTokens: 63_099,
      }),
    ).toBeCloseTo(0.1832232);
  });

  it("falls back to the conservative output-token rate for legacy total-only usage", () => {
    expect(
      estimateAgentCoreEvaluatorCostUsd({ totalTokens: 1000 }),
    ).toBeCloseTo(0.012);
  });

  it("keeps expensive AgentCore built-in evaluators disabled unless explicitly enabled", () => {
    expect(agentCoreEvaluatorsEnabled(undefined)).toBe(false);
    expect(agentCoreEvaluatorsEnabled("disabled")).toBe(false);
    expect(agentCoreEvaluatorsEnabled("enabled")).toBe(true);
    expect(agentCoreEvaluatorsEnabled("FULL")).toBe(true);
  });
});
