import { describe, expect, it } from "vitest";
import {
  aggregateTrialCaseVerdicts,
  summarizeCaseVerdicts,
  TRIAL_SCORED_QUORUM,
  type TrialResultInput,
} from "../src/trial-aggregation.js";

function trials(
  testCaseId: string,
  statuses: Array<"pass" | "fail" | "error">,
): TrialResultInput[] {
  return statuses.map((status, trialIndex) => ({
    testCaseId,
    trialIndex,
    status,
  }));
}

describe("aggregateTrialCaseVerdicts", () => {
  it("exposes the scored quorum as a named constant", () => {
    expect(TRIAL_SCORED_QUORUM).toBe(2);
  });

  it("AE2: pass/fail/pass across three trials aggregates to a pass verdict", () => {
    expect(
      aggregateTrialCaseVerdicts(trials("case-1", ["pass", "fail", "pass"])),
    ).toEqual([
      { testCaseId: "case-1", verdict: "pass", trialCount: 3, scoredCount: 3 },
    ]);
  });

  it("majority fail wins the same way", () => {
    expect(
      aggregateTrialCaseVerdicts(trials("case-1", ["fail", "pass", "fail"])),
    ).toEqual([
      { testCaseId: "case-1", verdict: "fail", trialCount: 3, scoredCount: 3 },
    ]);
  });

  it("AE2: a 1-1 scored split with the third trial erroring is unstable", () => {
    expect(
      aggregateTrialCaseVerdicts(trials("case-1", ["pass", "fail", "error"])),
    ).toEqual([
      {
        testCaseId: "case-1",
        verdict: "unstable",
        trialCount: 3,
        scoredCount: 2,
      },
    ]);
  });

  it("an exact 2-2 tie over four scored trials is unstable", () => {
    expect(
      aggregateTrialCaseVerdicts(
        trials("case-1", ["pass", "fail", "pass", "fail"]),
      )[0].verdict,
    ).toBe("unstable");
  });

  it("2 errors + 1 pass falls below the scored quorum → case error, never a 1-trial 'majority'", () => {
    expect(
      aggregateTrialCaseVerdicts(trials("case-1", ["error", "pass", "error"])),
    ).toEqual([
      { testCaseId: "case-1", verdict: "error", trialCount: 3, scoredCount: 1 },
    ]);
  });

  it("all-error trials aggregate to a case error", () => {
    expect(
      aggregateTrialCaseVerdicts(
        trials("case-1", ["error", "error", "error"]),
      )[0].verdict,
    ).toBe("error");
  });

  it("single-trial cases keep identity semantics (legacy behavior unchanged)", () => {
    expect(aggregateTrialCaseVerdicts(trials("p", ["pass"]))[0].verdict).toBe(
      "pass",
    );
    expect(aggregateTrialCaseVerdicts(trials("f", ["fail"]))[0].verdict).toBe(
      "fail",
    );
    // A lone error trial stays an error even though it is below the
    // multi-trial quorum — the quorum only applies to >1-trial cases.
    expect(aggregateTrialCaseVerdicts(trials("e", ["error"]))[0].verdict).toBe(
      "error",
    );
  });

  it("row-level overrides feed the per-trial effective status (single-trial rows)", () => {
    const [verdict] = aggregateTrialCaseVerdicts([
      {
        testCaseId: "case-1",
        trialIndex: 0,
        status: "fail",
        overrideStatus: "pass",
      },
    ]);
    expect(verdict).toMatchObject({ verdict: "pass", scoredCount: 1 });
  });

  it("case-level override applies LAST and wins over the aggregate", () => {
    // Aggregate would be unstable (1-1 + error); the operator settled it.
    expect(
      aggregateTrialCaseVerdicts(trials("case-1", ["pass", "fail", "error"]), [
        { testCaseId: "case-1", overrideStatus: "fail" },
      ]),
    ).toEqual([
      {
        testCaseId: "case-1",
        verdict: "fail",
        trialCount: 3,
        scoredCount: 2,
      },
    ]);
    // …and it can also overturn a clean majority.
    expect(
      aggregateTrialCaseVerdicts(trials("case-2", ["pass", "pass", "pass"]), [
        { testCaseId: "case-2", overrideStatus: "fail" },
      ])[0].verdict,
    ).toBe("fail");
  });

  it("groups multiple cases independently, preserving first-appearance order", () => {
    const rows = [
      ...trials("case-a", ["pass", "pass", "fail"]),
      ...trials("case-b", ["fail"]),
      ...trials("case-c", ["pass", "fail", "error"]),
    ];
    expect(
      aggregateTrialCaseVerdicts(rows).map((v) => [v.testCaseId, v.verdict]),
    ).toEqual([
      ["case-a", "pass"],
      ["case-b", "fail"],
      ["case-c", "unstable"],
    ]);
  });

  it("returns no verdicts for no rows", () => {
    expect(aggregateTrialCaseVerdicts([])).toEqual([]);
  });
});

describe("summarizeCaseVerdicts", () => {
  it("excludes unstable from the pass-rate denominator exactly like error", () => {
    const summary = summarizeCaseVerdicts([
      { verdict: "pass" },
      { verdict: "pass" },
      { verdict: "fail" },
      { verdict: "unstable" },
      { verdict: "error" },
    ]);
    expect(summary).toEqual({
      completedCases: 5,
      passed: 2,
      failed: 1,
      errored: 1,
      unstable: 1,
      passRate: 2 / 3,
    });
  });

  it("yields no score (null pass rate) when nothing is scoreable", () => {
    expect(
      summarizeCaseVerdicts([{ verdict: "unstable" }, { verdict: "error" }]),
    ).toEqual({
      completedCases: 2,
      passed: 0,
      failed: 0,
      errored: 1,
      unstable: 1,
      passRate: null,
    });
    expect(summarizeCaseVerdicts([]).passRate).toBeNull();
  });

  it("round-trips with the aggregation layer (AE2 end-to-end)", () => {
    const verdicts = aggregateTrialCaseVerdicts([
      ...trials("stable-pass", ["pass", "fail", "pass"]),
      ...trials("split", ["pass", "fail", "error"]),
      ...trials("quorum-error", ["error", "pass", "error"]),
      ...trials("legacy-single", ["pass"]),
    ]);
    const summary = summarizeCaseVerdicts(verdicts);
    expect(summary.completedCases).toBe(4);
    expect(summary.passed).toBe(2); // stable-pass + legacy-single
    expect(summary.failed).toBe(0);
    expect(summary.errored).toBe(1); // quorum-error
    expect(summary.unstable).toBe(1); // split
    expect(summary.passRate).toBe(1); // 2 / (2 + 0)
  });
});
