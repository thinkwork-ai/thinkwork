import { describe, expect, it } from "vitest";

import {
  calculateCategoryPassRates,
  groupEvalResultsByCase,
} from "./SettingsEvalRunDetail";

describe("SettingsEvalRunDetail category pass rates", () => {
  it("scores categories from completed eval results only", () => {
    const rates = calculateCategoryPassRates([
      { category: "red-team-prompt-injection", status: "pass" },
      { category: "red-team-prompt-injection", status: "pass" },
      { category: "red-team-prompt-injection", status: "pass" },
      { category: "red-team-prompt-injection", status: "running" },
      { category: "red-team-prompt-injection", status: "pending" },
      { category: "red-team-prompt-injection", status: "waiting" },
    ]);

    expect(rates["red-team-prompt-injection"]).toBe(1);
  });

  it("keeps terminal failures in the denominator but excludes errors (clean executions only)", () => {
    const rates = calculateCategoryPassRates([
      { category: "red-team-prompt-injection", status: "pass" },
      { category: "red-team-prompt-injection", status: "fail" },
      // Errors never score (Trust Core U2): infra noise stays out of
      // the per-category denominator, matching the run-level pass rate.
      { category: "red-team-prompt-injection", status: "error" },
      { category: "red-team-prompt-injection", status: "running" },
    ]);

    expect(rates["red-team-prompt-injection"]).toBe(1 / 2);
  });
});

describe("SettingsEvalRunDetail override-aware pass rates (U9)", () => {
  it("counts the effective verdict when an operator override is present", () => {
    const rates = calculateCategoryPassRates([
      // fail overridden to pass — effective verdict wins.
      {
        category: "red-team-prompt-injection",
        status: "fail",
        effectiveStatus: "pass",
      },
      { category: "red-team-prompt-injection", status: "fail" },
    ]);

    expect(rates["red-team-prompt-injection"]).toBe(0.5);
  });
});

// Case grouping for multi-trial runs (Eval Profiles KTD12): the view
// reads case verdicts through the shared evals-core aggregation layer —
// trial rows never render as top-level results.
function trialRow(overrides: Record<string, unknown>) {
  return {
    id: String(overrides.id ?? "r-1"),
    testCaseId: "case-1",
    testCaseName: "Case One",
    category: "red-team-prompt-injection",
    status: "pass",
    trialIndex: 0,
    score: null,
    durationMs: null,
    agentSessionId: null,
    input: null,
    expected: null,
    actualOutput: null,
    systemPrompt: null,
    assertions: null,
    evaluatorResults: null,
    errorMessage: null,
    errorCause: null,
    overrideStatus: null,
    overriddenBy: null,
    overriddenAt: null,
    overrideReason: null,
    effectiveStatus: String(overrides.status ?? "pass"),
    createdAt: "2026-07-01T00:00:00Z",
    ...overrides,
  } as never;
}

describe("groupEvalResultsByCase (KTD12)", () => {
  it("majority of scored trials wins; trials nest under the case ordered by trialIndex", () => {
    const groups = groupEvalResultsByCase([
      trialRow({ id: "r-2", trialIndex: 1, status: "fail" }),
      trialRow({ id: "r-1", trialIndex: 0, status: "pass" }),
      trialRow({ id: "r-3", trialIndex: 2, status: "pass" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].verdict).toBe("pass");
    expect(groups[0].passVotes).toBe(2);
    expect(groups[0].scoredCount).toBe(3);
    expect(groups[0].trials.map((t) => t.id)).toEqual(["r-1", "r-2", "r-3"]);
  });

  it("an exact pass/fail tie renders unstable (never a stable verdict)", () => {
    const groups = groupEvalResultsByCase([
      trialRow({ id: "r-1", trialIndex: 0, status: "pass" }),
      trialRow({ id: "r-2", trialIndex: 1, status: "fail" }),
      trialRow({ id: "r-3", trialIndex: 2, status: "error" }),
      trialRow({ id: "r-4", trialIndex: 3, status: "fail" }),
      trialRow({ id: "r-5", trialIndex: 4, status: "pass" }),
    ]);
    expect(groups[0].verdict).toBe("unstable");
  });

  it("sub-quorum scored trials collapse to error; row overrides count as effective statuses", () => {
    const subQuorum = groupEvalResultsByCase([
      trialRow({ id: "r-1", trialIndex: 0, status: "pass" }),
      trialRow({ id: "r-2", trialIndex: 1, status: "error" }),
      trialRow({ id: "r-3", trialIndex: 2, status: "error" }),
    ]);
    expect(subQuorum[0].verdict).toBe("error");

    const overridden = groupEvalResultsByCase([
      trialRow({
        id: "r-1",
        trialIndex: 0,
        status: "fail",
        overrideStatus: "pass",
      }),
      trialRow({
        id: "r-2",
        trialIndex: 1,
        status: "fail",
        overrideStatus: "pass",
      }),
      trialRow({ id: "r-3", trialIndex: 2, status: "fail" }),
    ]);
    expect(overridden[0].verdict).toBe("pass");
  });

  it("single-trial cases keep identity semantics and separate cases group apart", () => {
    const groups = groupEvalResultsByCase([
      trialRow({ id: "r-1", testCaseId: "case-1", status: "fail" }),
      trialRow({
        id: "r-2",
        testCaseId: "case-2",
        testCaseName: "Case Two",
        status: "pass",
      }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.verdict)).toEqual(["fail", "pass"]);
  });
});
