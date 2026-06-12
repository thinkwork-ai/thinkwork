import { describe, expect, it, vi } from "vitest";
import {
  canEditEvalResult,
  computeEvalRunComparison,
  countEvalVerdictGroups,
  deriveEvalFailureMode,
  evalErrorCauseBreakdown,
  evalErrorCauseLabel,
  evalFailureModeDescription,
  evalFailureModeLabel,
  evalResultVerdictGroup,
  evalRunPassRateDisplay,
  evaluatorDisplayStatus,
  expectedSummary,
  isDesktopPiEvalRunProvenance,
  isHeuristicRubricFailure,
  openEvalResultEditor,
  parseEvaluatorResults,
  sortEvalSpans,
} from "./eval-result-detail";

describe("evaluation result detail helpers", () => {
  it("classifies a low-scoring evaluator result as judge-fail", () => {
    const result = {
      assertions: [],
      errorMessage: null,
      evaluatorResults: JSON.stringify([
        {
          evaluator_id: "Builtin.Helpfulness",
          value: 0.4,
          explanation: "response lacks specificity",
        },
      ]),
      score: 0.4,
      status: "fail",
    };

    expect(deriveEvalFailureMode(result)).toBe("judge-fail");
    expect(parseEvaluatorResults(result.evaluatorResults)[0]?.explanation).toBe(
      "response lacks specificity",
    );
  });

  it("classifies runner timeouts and assertion-only failures distinctly", () => {
    expect(
      deriveEvalFailureMode({
        assertions: [],
        errorMessage: "AgentCore invocation timeout after 240s",
        evaluatorResults: [],
        score: null,
        status: "error",
      }),
    ).toBe("timeout");

    expect(
      deriveEvalFailureMode({
        assertions: [{ type: "contains", value: "done", passed: false }],
        errorMessage: null,
        evaluatorResults: [],
        score: 0,
        status: "fail",
      }),
    ).toBe("assertion-fail");
  });

  it("classifies heuristic fallback failures separately from evaluator failures", () => {
    const heuristicAssertion = {
      type: "llm-rubric",
      value: "The response should not hide unresolved risks.",
      passed: false,
      score: 0,
      reason:
        "Heuristic rubric check failed: The response should not hide unresolved risks.",
    };

    expect(isHeuristicRubricFailure(heuristicAssertion)).toBe(true);
    expect(
      deriveEvalFailureMode({
        assertions: [heuristicAssertion],
        errorMessage: null,
        evaluatorResults: JSON.stringify([
          {
            evaluator_id: "Builtin.Harmfulness",
            label: "skipped",
            value: null,
            skipped: true,
          },
        ]),
        score: 0.5,
        status: "fail",
      }),
    ).toBe("heuristic-fail");
    expect(evalFailureModeLabel("heuristic-fail")).toBe(
      "Heuristic fallback failed",
    );
    expect(evalFailureModeDescription("heuristic-fail")).toContain(
      "LLM judge did not run",
    );
  });

  it("renders skipped built-in evaluators as skipped rather than errors", () => {
    const skipped = {
      evaluator_id: "Builtin.Harmfulness",
      label: "skipped",
      value: null,
      skipped: true,
    };

    expect(evaluatorDisplayStatus(skipped)).toBe("skipped");
    expect(
      deriveEvalFailureMode({
        assertions: [],
        errorMessage: null,
        evaluatorResults: JSON.stringify([skipped]),
        score: 1,
        status: "pass",
      }),
    ).toBeNull();
  });

  it("detects Desktop Pi eval run provenance from target or host", () => {
    expect(
      isDesktopPiEvalRunProvenance({
        executionTarget: "desktop-pi",
        runtimeHost: "desktop-local",
      }),
    ).toBe(true);
    expect(
      isDesktopPiEvalRunProvenance({
        executionTarget: "agentcore",
        runtimeHost: "desktop-local",
      }),
    ).toBe(true);
    expect(
      isDesktopPiEvalRunProvenance({
        executionTarget: "agentcore",
        runtimeHost: "aws-agentcore",
      }),
    ).toBe(false);
  });

  it("classifies real evaluator errors distinctly", () => {
    expect(
      deriveEvalFailureMode({
        assertions: [],
        errorMessage: null,
        evaluatorResults: JSON.stringify([
          {
            evaluator_id: "Builtin.Harmfulness",
            label: null,
            value: null,
            error: "AgentCore evaluator unavailable",
          },
        ]),
        score: 0,
        status: "fail",
      }),
    ).toBe("evaluator-error");
  });

  it("summarizes assertions and sorts spans chronologically", () => {
    expect(
      expectedSummary([
        { type: "contains", value: "approved" },
        { type: "llm-rubric", value: "must cite sources" },
      ]),
    ).toBe("contains: approved; llm-rubric: must cite sources");

    expect(
      sortEvalSpans([
        { timestamp: "2026-05-16T14:02:00.000Z", name: "b", attributes: {} },
        { timestamp: "2026-05-16T14:01:00.000Z", name: "a", attributes: {} },
      ]).map((span) => span.name),
    ).toEqual(["a", "b"]);
  });

  it("only offers result-to-edit navigation for persisted test cases", () => {
    expect(canEditEvalResult("test-case-1")).toBe(true);
    expect(canEditEvalResult("")).toBe(false);
    expect(canEditEvalResult(null)).toBe(false);
    expect(canEditEvalResult(undefined)).toBe(false);
  });

  it("opens the result editor only when a result has a test case id", () => {
    const onEdit = vi.fn();

    expect(openEvalResultEditor("test-case-1", onEdit)).toBe(true);
    expect(onEdit).toHaveBeenCalledWith("test-case-1");

    expect(openEvalResultEditor(null, onEdit)).toBe(false);
    expect(openEvalResultEditor("", onEdit)).toBe(false);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});

// ────────────────────────────────────────────────────────────────────
// Trust Core U11 — run health, error causes, comparison.
// ────────────────────────────────────────────────────────────────────

describe("evalErrorCauseLabel (U11)", () => {
  it("maps every error cause to a friendly label", () => {
    expect(evalErrorCauseLabel("timeout")).toBe("Timeout");
    expect(evalErrorCauseLabel("throttle")).toBe("Throttled");
    expect(evalErrorCauseLabel("evaluator_error")).toBe("Judge error");
    expect(evalErrorCauseLabel("reconciler")).toBe("Reconciler");
    expect(evalErrorCauseLabel("infra_other")).toBe("Infrastructure");
  });

  it("falls back to a generic label for null (pre-migration rows) and unknown causes", () => {
    expect(evalErrorCauseLabel(null)).toBe("Error");
    expect(evalErrorCauseLabel(undefined)).toBe("Error");
    expect(evalErrorCauseLabel("something-new")).toBe("Error");
  });
});

describe("evalRunPassRateDisplay (U11)", () => {
  it("renders 'No score' for a completed run with a null pass rate — never 0%", () => {
    expect(
      evalRunPassRateDisplay({ status: "completed", passRate: null }),
    ).toBe("No score");
  });

  it("renders the server pass rate (clean denominator) on completed runs", () => {
    expect(
      evalRunPassRateDisplay({ status: "completed", passRate: 0.932 }),
    ).toBe("93.2%");
    // 0 is a real score (everything failed), distinct from "No score".
    expect(evalRunPassRateDisplay({ status: "completed", passRate: 0 })).toBe(
      "0.0%",
    );
  });

  it("shows live progress while running and a dash before anything completes", () => {
    expect(
      evalRunPassRateDisplay({
        status: "running",
        passRate: null,
        passed: 3,
        failed: 1,
      }),
    ).toBe("75.0%");
    expect(
      evalRunPassRateDisplay({
        status: "pending",
        passRate: null,
        passed: 0,
        failed: 0,
      }),
    ).toBe("—");
  });

  it("renders 'No score' for cancelled runs without a score", () => {
    expect(
      evalRunPassRateDisplay({ status: "cancelled", passRate: null }),
    ).toBe("No score");
  });
});

describe("eval verdict grouping (U11)", () => {
  it("groups errors apart from behavioral failures and respects overrides", () => {
    expect(evalResultVerdictGroup({ status: "error" })).toBe("error");
    expect(evalResultVerdictGroup({ status: "fail" })).toBe("fail");
    expect(evalResultVerdictGroup({ status: "pass" })).toBe("pass");
    // Operator override corrects the grouping.
    expect(
      evalResultVerdictGroup({ status: "fail", effectiveStatus: "pass" }),
    ).toBe("pass");
    // Raw error status wins regardless of effectiveStatus echo.
    expect(
      evalResultVerdictGroup({ status: "error", effectiveStatus: "error" }),
    ).toBe("error");
    expect(evalResultVerdictGroup({ status: "running" })).toBe("other");
  });

  it("counts verdict groups for the drill-in chips", () => {
    const counts = countEvalVerdictGroups([
      { status: "pass" },
      { status: "pass" },
      { status: "fail", effectiveStatus: "pass" },
      { status: "fail" },
      { status: "error" },
      { status: "running" },
    ]);
    expect(counts).toEqual({ pass: 3, fail: 1, error: 1, other: 1 });
  });

  it("breaks errors down by friendly cause label, most frequent first", () => {
    const breakdown = evalErrorCauseBreakdown([
      { status: "error", errorCause: "timeout" },
      { status: "error", errorCause: "timeout" },
      { status: "error", errorCause: "throttle" },
      { status: "error", errorCause: null },
      { status: "fail", errorCause: null },
    ]);
    expect(breakdown).toEqual([
      { label: "Timeout", count: 2 },
      { label: "Throttled", count: 1 },
      { label: "Error", count: 1 },
    ]);
  });
});

describe("computeEvalRunComparison (R13)", () => {
  const prev = [
    { testCaseId: "tc-1", testCaseName: "Refund policy", status: "fail" },
    { testCaseId: "tc-2", testCaseName: "Prompt injection", status: "pass" },
    { testCaseId: "tc-3", testCaseName: "Tool misuse", status: "pass" },
    { testCaseId: "tc-4", testCaseName: "Unchanged pass", status: "pass" },
    {
      testCaseId: "tc-5",
      testCaseName: "Throttled before",
      status: "error",
      errorCause: "throttle",
    },
  ];

  it("AE4: a case failing in run N-1 and passing in run N shows as fail → pass", () => {
    const transitions = computeEvalRunComparison(prev, [
      { testCaseId: "tc-1", testCaseName: "Refund policy", status: "pass" },
      { testCaseId: "tc-4", testCaseName: "Unchanged pass", status: "pass" },
    ]);
    expect(transitions).toEqual([
      {
        key: "tc-1",
        name: "Refund policy",
        kind: "fail-to-pass",
        from: "fail",
        to: "pass",
      },
    ]);
  });

  it("marks regressions, new errors (with cause), and resolved errors", () => {
    const transitions = computeEvalRunComparison(prev, [
      { testCaseId: "tc-2", testCaseName: "Prompt injection", status: "fail" },
      {
        testCaseId: "tc-3",
        testCaseName: "Tool misuse",
        status: "error",
        errorCause: "timeout",
      },
      { testCaseId: "tc-4", testCaseName: "Unchanged pass", status: "pass" },
      {
        testCaseId: "tc-5",
        testCaseName: "Throttled before",
        status: "pass",
      },
      {
        testCaseId: "tc-6",
        testCaseName: "Brand new case",
        status: "error",
        errorCause: "infra_other",
      },
    ]);

    expect(transitions.map((t) => [t.key, t.kind])).toEqual([
      ["tc-2", "pass-to-fail"],
      ["tc-6", "new-error"],
      ["tc-3", "new-error"],
      ["tc-5", "error-resolved"],
    ]);
    const newError = transitions.find((t) => t.key === "tc-3");
    expect(newError?.to).toBe("error (Timeout)");
    const resolved = transitions.find((t) => t.key === "tc-5");
    expect(resolved?.from).toBe("error (Throttled)");
  });

  it("uses the effective (override-corrected) verdict for pass/fail comparisons", () => {
    const transitions = computeEvalRunComparison(
      [{ testCaseId: "tc-1", testCaseName: "Case", status: "fail" }],
      [
        {
          testCaseId: "tc-1",
          testCaseName: "Case",
          status: "fail",
          effectiveStatus: "pass",
        },
      ],
    );
    expect(transitions.map((t) => t.kind)).toEqual(["fail-to-pass"]);
  });
});
