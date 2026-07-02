import { describe, expect, it } from "vitest";
import { CURRENT_EVAL_SCORING_VERSION } from "@thinkwork/evals-core";
import {
  buildReconcilerErrorRow,
  missingEvalTestCaseIds,
  parsePinnedTrialPlan,
  shouldReconcileEvalRun,
  summarizeEvalRowsForReconciler,
} from "./eval-runs-reconciler.js";

const now = new Date("2026-05-16T22:30:00.000Z");

describe("eval-runs-reconciler stale detection", () => {
  it("reconciles running runs with missing results and stale progress", () => {
    expect(
      shouldReconcileEvalRun(
        {
          status: "running",
          total_tests: 47,
          result_count: 45,
          started_at: new Date("2026-05-16T21:19:00.000Z"),
          last_result_at: new Date("2026-05-16T22:05:00.000Z"),
        },
        now,
        15 * 60_000,
      ),
    ).toBe(true);
  });

  it("does not reconcile a large run that is still making progress", () => {
    expect(
      shouldReconcileEvalRun(
        {
          status: "running",
          total_tests: 1000,
          result_count: 125,
          started_at: new Date("2026-05-16T21:00:00.000Z"),
          last_result_at: new Date("2026-05-16T22:28:00.000Z"),
        },
        now,
        15 * 60_000,
      ),
    ).toBe(false);
  });

  it("reconciles runs with all rows written but no finalizer", () => {
    expect(
      shouldReconcileEvalRun(
        {
          status: "running",
          total_tests: 47,
          result_count: 47,
          started_at: new Date("2026-05-16T22:29:00.000Z"),
          last_result_at: new Date("2026-05-16T22:29:30.000Z"),
        },
        now,
        15 * 60_000,
      ),
    ).toBe(true);
  });

  it("ignores terminal runs", () => {
    expect(
      shouldReconcileEvalRun(
        {
          status: "completed",
          total_tests: 47,
          result_count: 45,
          started_at: new Date("2026-05-16T21:19:00.000Z"),
          last_result_at: new Date("2026-05-16T22:05:00.000Z"),
        },
        now,
        15 * 60_000,
      ),
    ).toBe(false);
  });

  it("compares completion against expected_result_rows on trial-plan runs (U4)", () => {
    const base = {
      status: "running",
      total_tests: 2,
      started_at: new Date("2026-05-16T22:29:00.000Z"),
      last_result_at: new Date("2026-05-16T22:29:30.000Z"),
    };
    // Case count reached but trial fan-out (6 rows) not yet complete —
    // the pre-U4 check would have reconciled at 2.
    expect(
      shouldReconcileEvalRun(
        { ...base, result_count: 2, expected_result_rows: 6 },
        now,
        15 * 60_000,
      ),
    ).toBe(false);
    // All fan-out rows written, no finalizer → reconcile.
    expect(
      shouldReconcileEvalRun(
        { ...base, result_count: 6, expected_result_rows: 6 },
        now,
        15 * 60_000,
      ),
    ).toBe(true);
    // Null expected (pre-trial run) keeps the case-count arithmetic.
    expect(
      shouldReconcileEvalRun(
        { ...base, result_count: 2, expected_result_rows: null },
        now,
        15 * 60_000,
      ),
    ).toBe(true);
  });
});

describe("eval-runs-reconciler pinned trial plan parsing (U4)", () => {
  it("parses a valid plan and floors fractional trial counts", () => {
    expect(
      parsePinnedTrialPlan([
        { caseId: "uuid-a", trials: 3 },
        { caseId: "uuid-b", trials: 1.0 },
      ]),
    ).toEqual([
      { caseId: "uuid-a", trials: 3 },
      { caseId: "uuid-b", trials: 1 },
    ]);
    expect(parsePinnedTrialPlan([])).toEqual([]);
  });

  it("returns null for absent or malformed plans (legacy reconstruction applies)", () => {
    expect(parsePinnedTrialPlan(null)).toBeNull();
    expect(parsePinnedTrialPlan(undefined)).toBeNull();
    expect(parsePinnedTrialPlan("not-a-plan")).toBeNull();
    expect(parsePinnedTrialPlan([{ caseId: "", trials: 3 }])).toBeNull();
    expect(parsePinnedTrialPlan([{ caseId: "uuid-a", trials: 0 }])).toBeNull();
    expect(parsePinnedTrialPlan([{ caseId: "uuid-a" }])).toBeNull();
    expect(parsePinnedTrialPlan([null])).toBeNull();
  });
});

describe("eval-runs-reconciler missing result selection", () => {
  it("returns expected cases that have no result row", () => {
    expect(
      missingEvalTestCaseIds(
        ["case-1", "case-2", "case-3"],
        ["case-1", null, "case-3"],
      ),
    ).toEqual(["case-2"]);
  });
});

describe("eval-runs-reconciler summary", () => {
  const rows = [
    {
      status: "pass",
      evaluator_results: [
        { token_usage: { inputTokens: 1000, outputTokens: 100 } },
      ],
    },
    { status: "fail", evaluator_results: [] },
    { status: "error", evaluator_results: [] },
  ];

  it("excludes errors from the pass rate under current scoring semantics", () => {
    const summary = summarizeEvalRowsForReconciler(
      rows,
      CURRENT_EVAL_SCORING_VERSION,
    );

    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.errored).toBe(1);
    expect(summary.passRate).toBe(0.5);
    expect(summary.totalCostUsd).toBeCloseTo(0.0036);
  });

  it("yields no score for a run whose remaining rows are all errors", () => {
    const summary = summarizeEvalRowsForReconciler(
      [
        { status: "error", evaluator_results: [] },
        { status: "error", evaluator_results: [] },
      ],
      CURRENT_EVAL_SCORING_VERSION,
    );
    expect(summary.passRate).toBeNull();
    expect(summary.errored).toBe(2);
  });

  it("keeps a pre-migration stale run on legacy semantics (never upgraded)", () => {
    const summary = summarizeEvalRowsForReconciler(rows, null);

    // Legacy: errors fold into failed; old denominator; no errored count.
    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(2);
    expect(summary.errored).toBeNull();
    expect(summary.passRate).toBe(1 / 3);
    expect(summary.totalCostUsd).toBeCloseTo(0.0036);
  });

  it("reconciler finalization counts operator overrides as the effective verdict (U9)", () => {
    // An override that landed before the reconciler finalizes must
    // survive finalization — the summary reads override_status last.
    const summary = summarizeEvalRowsForReconciler(
      [
        { status: "fail", override_status: "pass", evaluator_results: [] },
        { status: "fail", override_status: null, evaluator_results: [] },
        { status: "error", override_status: null, evaluator_results: [] },
      ],
      CURRENT_EVAL_SCORING_VERSION,
    );

    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.errored).toBe(1);
    expect(summary.passRate).toBe(0.5);
  });
});

describe("eval-runs-reconciler synthetic rows", () => {
  it("tags synthesized rows as error/reconciler so they never read as failures", () => {
    const row = buildReconcilerErrorRow(
      "run-1",
      { id: "case-1", query: "q", assertions: [] },
      "Reconciler recorded missing eval result",
    );

    expect(row.status).toBe("error");
    expect(row.error_cause).toBe("reconciler");
    expect(row.run_id).toBe("run-1");
    expect(row.test_case_id).toBe("case-1");
    expect(row.error_message).toMatch(/missing eval result/);

    // And the summary keeps them out of `failed`.
    const summary = summarizeEvalRowsForReconciler(
      [
        { status: "pass", evaluator_results: [] },
        { status: row.status, evaluator_results: row.evaluator_results },
      ],
      CURRENT_EVAL_SCORING_VERSION,
    );
    expect(summary.failed).toBe(0);
    expect(summary.errored).toBe(1);
    expect(summary.passRate).toBe(1);
  });

  it("records the trial index on synthesized rows and disambiguates their session ids (U4)", () => {
    const trialRow = buildReconcilerErrorRow(
      "run-1",
      { id: "case-1", query: "q", assertions: [], trialIndex: 2 },
      "Reconciler recorded missing eval result",
    );
    expect(trialRow.trial_index).toBe(2);
    expect(trialRow.agent_session_id).toBe("reconciler:run-1:case-1:trial-2");

    // Trial 0 (and the default) keep the historical session-id shape.
    const defaultRow = buildReconcilerErrorRow(
      "run-1",
      { id: "case-1", query: "q", assertions: [] },
      "Reconciler recorded missing eval result",
    );
    expect(defaultRow.trial_index).toBe(0);
    expect(defaultRow.agent_session_id).toBe("reconciler:run-1:case-1");
  });
});
