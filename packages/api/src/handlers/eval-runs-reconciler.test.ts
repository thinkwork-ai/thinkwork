import { describe, expect, it } from "vitest";
import {
  missingEvalTestCaseIds,
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
  it("counts error rows as failed and preserves evaluator cost accounting", () => {
    const summary = summarizeEvalRowsForReconciler([
      {
        status: "pass",
        evaluator_results: [
          { token_usage: { inputTokens: 1000, outputTokens: 100 } },
        ],
      },
      { status: "fail", evaluator_results: [] },
      { status: "error", evaluator_results: [] },
    ]);

    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(2);
    expect(summary.passRate).toBe(1 / 3);
    expect(summary.totalCostUsd).toBeCloseTo(0.0036);
  });
});
