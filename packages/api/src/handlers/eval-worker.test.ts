import { describe, expect, it } from "vitest";
import { CURRENT_EVAL_SCORING_VERSION } from "@thinkwork/evals-core";
import { AgentCoreEvalInvocationTimeoutError } from "../lib/evals/agentcore-direct.js";
import {
  agentCoreEvaluatorsEnabled,
  DEFAULT_EVAL_FANOUT_MAX_RECEIVE_COUNT,
  estimateAgentCoreEvaluatorCostUsd,
  evalFanoutMaxReceiveCount,
  isFinalSqsReceive,
  isRetryableEvalInfrastructureError,
  llmJudgeEnabled,
  parseEvalJudgeVerdict,
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

  it("parses flagged-thread payload shas, dropping unknown names and non-string values", () => {
    const parsed = parseEvalWorkerMessage(
      JSON.stringify({
        runId: "run-1",
        testCaseId: "tc-1",
        snapshotKey: "tenants/acme/eval-datasets/.runs/run-1/cases/c.json",
        contentSha: "a".repeat(64),
        payloadShas: {
          history: "b".repeat(64),
          workspace: 42,
          bogus: "c".repeat(64),
        },
      }),
    );
    expect(parsed.payloadShas).toEqual({ history: "b".repeat(64) });

    expect(
      parseEvalWorkerMessage(
        JSON.stringify({ runId: "run-1", testCaseId: "tc-1" }),
      ).payloadShas,
    ).toBeUndefined();
  });
});

describe("eval-worker strict judge verdict validation (U8)", () => {
  it("accepts the exact verdict schema, including inside markdown fences", () => {
    expect(
      parseEvalJudgeVerdict(
        '{"passed": true, "score": 0.85, "reasoning": "meets the criteria"}',
      ),
    ).toEqual({ passed: true, score: 0.85, reasoning: "meets the criteria" });
    expect(
      parseEvalJudgeVerdict(
        '```json\n{"passed": false, "score": 0, "reasoning": "missed"}\n```',
      ),
    ).toEqual({ passed: false, score: 0, reasoning: "missed" });
  });

  it.each([
    ["no JSON object", "the agent did well"],
    ["broken JSON", '{"passed": true,'],
    ["extra keys", '{"passed": true, "score": 1, "reasoning": "x", "y": 1}'],
    ["passed not boolean", '{"passed": "true", "score": 1, "reasoning": "x"}'],
    ["score not a number", '{"passed": true, "score": "1", "reasoning": "x"}'],
    ["score above 1", '{"passed": true, "score": 1.2, "reasoning": "x"}'],
    ["score below 0", '{"passed": true, "score": -0.2, "reasoning": "x"}'],
    ["NaN score", '{"passed": true, "score": null, "reasoning": "x"}'],
    ["reasoning missing", '{"passed": true, "score": 1}'],
    ["array payload", "[1, 2, 3]"],
  ])("rejects %s", (_label, text) => {
    expect(() => parseEvalJudgeVerdict(text)).toThrow();
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

  it("counts operator overrides as the effective verdict (U9)", () => {
    const summary = summarizeEvalResults(
      [
        { status: "pass", override_status: null, evaluator_results: [] },
        { status: "fail", override_status: "pass", evaluator_results: [] },
        { status: "fail", override_status: null, evaluator_results: [] },
        { status: "error", override_status: null, evaluator_results: [] },
      ],
      CURRENT_EVAL_SCORING_VERSION,
    );

    expect(summary.passed).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.errored).toBe(1);
    expect(summary.passRate).toBe(2 / 3);
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
  it("treats Lambda and Bedrock throttling shapes as retryable", () => {
    expect(
      isRetryableEvalInfrastructureError(
        new Error("Lambda.TooManyRequestsException: backoff"),
      ),
    ).toBe(true);
    expect(
      isRetryableEvalInfrastructureError(
        new Error("ThrottlingException: Too many requests"),
      ),
    ).toBe(true);
    expect(
      isRetryableEvalInfrastructureError(
        new Error("ServiceQuotaExceededException: quota reached"),
      ),
    ).toBe(true);
    expect(isRetryableEvalInfrastructureError(new Error("Rate exceeded"))).toBe(
      true,
    );
    expect(
      isRetryableEvalInfrastructureError(new Error("Lambda throttled")),
    ).toBe(true);
  });

  it("recognizes AWS SDK error name and 429 metadata shapes", () => {
    const named = new Error("Too many requests, please wait");
    named.name = "ThrottlingException";
    expect(isRetryableEvalInfrastructureError(named)).toBe(true);

    const metadata = Object.assign(new Error("opaque service error"), {
      $metadata: { httpStatusCode: 429 },
    });
    expect(isRetryableEvalInfrastructureError(metadata)).toBe(true);

    expect(
      isRetryableEvalInfrastructureError(
        new Error("AgentCore 429: slow down (429)"),
      ),
    ).toBe(true);
  });

  it("keeps genuine timeouts and unrelated errors non-retryable", () => {
    // Timeouts already consumed the full response budget — they record
    // error/timeout immediately instead of burning SQS redrives.
    expect(
      isRetryableEvalInfrastructureError(
        new AgentCoreEvalInvocationTimeoutError(180_000),
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
});

describe("eval-worker SQS receive budget", () => {
  it("reads the queue's maxReceiveCount from the env mirror with a safe default", () => {
    expect(evalFanoutMaxReceiveCount("5")).toBe(5);
    expect(evalFanoutMaxReceiveCount("3")).toBe(3);
    expect(evalFanoutMaxReceiveCount(undefined)).toBe(
      DEFAULT_EVAL_FANOUT_MAX_RECEIVE_COUNT,
    );
    expect(evalFanoutMaxReceiveCount("nope")).toBe(
      DEFAULT_EVAL_FANOUT_MAX_RECEIVE_COUNT,
    );
    expect(evalFanoutMaxReceiveCount("0")).toBe(
      DEFAULT_EVAL_FANOUT_MAX_RECEIVE_COUNT,
    );
  });

  it("detects the final receive before the redrive policy dead-letters the message", () => {
    const record = (count: string) =>
      ({ attributes: { ApproximateReceiveCount: count } }) as never;
    expect(isFinalSqsReceive(record("1"), 5)).toBe(false);
    expect(isFinalSqsReceive(record("4"), 5)).toBe(false);
    expect(isFinalSqsReceive(record("5"), 5)).toBe(true);
    expect(isFinalSqsReceive(record("6"), 5)).toBe(true);
    // Missing attribute → assume first receive (rethrow keeps the retry).
    expect(isFinalSqsReceive({ attributes: {} } as never, 5)).toBe(false);
  });
});
