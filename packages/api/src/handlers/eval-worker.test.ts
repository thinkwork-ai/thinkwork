import { describe, expect, it } from "vitest";
import { CURRENT_EVAL_SCORING_VERSION } from "@thinkwork/evals-core";
import {
  agentCoreBudgetExceededAssertion,
  agentCoreEvaluatorsEnabled,
  estimateAgentCoreEvaluatorCostUsd,
  isRetryableEvalInfrastructureError,
  llmJudgeEnabled,
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
  const costRows = [
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
  ];

  it("excludes errors from the pass rate under current scoring semantics", () => {
    const summary = summarizeEvalResults(
      [
        ...costRows,
        { status: "pass", evaluator_results: [] },
        { status: "pass", evaluator_results: [] },
        { status: "error", evaluator_results: [] },
      ],
      CURRENT_EVAL_SCORING_VERSION,
    );

    // 3 pass / 1 fail / 2 error → errors leave the denominator.
    expect(summary.passed).toBe(3);
    expect(summary.failed).toBe(1);
    expect(summary.errored).toBe(2);
    expect(summary.passRate).toBe(0.75);
    expect(summary.totalCostUsd).toBeCloseTo(0.0084);
  });

  it("yields no score (null pass rate) for an all-error run", () => {
    const summary = summarizeEvalResults(
      [
        { status: "error", evaluator_results: [] },
        { status: "error", evaluator_results: [] },
      ],
      CURRENT_EVAL_SCORING_VERSION,
    );
    expect(summary.passed).toBe(0);
    expect(summary.failed).toBe(0);
    expect(summary.errored).toBe(2);
    expect(summary.passRate).toBeNull();
  });

  it("keeps legacy errors-count-as-failed math for unstamped runs", () => {
    const summary = summarizeEvalResults(costRows, null);

    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(2);
    expect(summary.errored).toBeNull();
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

  it("keeps the external LLM judge disabled unless explicitly enabled", () => {
    expect(llmJudgeEnabled(undefined)).toBe(false);
    expect(llmJudgeEnabled("heuristic")).toBe(false);
    expect(llmJudgeEnabled("enabled")).toBe(true);
    expect(llmJudgeEnabled("LLM")).toBe(true);
  });
});

describe("eval-worker infrastructure retry classification", () => {
  it("treats AgentCore throttling as retryable and model throttles as case errors", () => {
    expect(
      isRetryableEvalInfrastructureError(
        new Error("Lambda.TooManyRequestsException: backoff"),
      ),
    ).toBe(true);
    expect(
      isRetryableEvalInfrastructureError(
        new Error("ThrottlingException: Too many requests"),
      ),
    ).toBe(false);
    expect(
      isRetryableEvalInfrastructureError(
        new Error(
          "AgentCore eval invocation exceeded 180000ms response budget",
        ),
      ),
    ).toBe(false);
    expect(
      isRetryableEvalInfrastructureError(new Error("policy violation")),
    ).toBe(false);
  });

  it("represents stalled AgentCore responses as failed eval assertions", () => {
    expect(agentCoreBudgetExceededAssertion(180_000)).toEqual({
      type: "agentcore-response-budget",
      passed: false,
      score: 0,
      reason:
        "AgentCore did not return a response within the 180000ms eval response budget.",
    });
  });
});
