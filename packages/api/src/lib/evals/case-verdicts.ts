/**
 * Run-summary assembly over the evals-core trial-aggregation layer
 * (Eval Profiles U4, KTD4).
 *
 * Every summarizer that writes eval_runs counters from result rows —
 * eval-worker finalization, the override recompute resolver, and the
 * eval-runs reconciler — routes through summarizeEvalRunVerdicts so the
 * case-verdict math (majority over trials, `unstable`, case-level
 * overrides applied last) can never fork between call sites.
 *
 * Versioned runs (scoring_version >= 2) aggregate per-trial rows into
 * case verdicts; single-trial rows are identity under the aggregation,
 * so v2 runs summarize to exactly the numbers the row-level summarizer
 * produced. Legacy runs (null scoring_version) keep the historical
 * errors-count-as-failed row math verbatim and never learn about trials
 * or case overrides.
 */

import {
  aggregateTrialCaseVerdicts,
  summarizeCaseVerdicts,
  summarizeEvalStatuses,
  type CaseOverrideInput,
  type TrialResultInput,
} from "@thinkwork/evals-core";

/** A result row as the run summarizers read it (snake_case DB shape). */
export interface EvalRunVerdictRow {
  test_case_id: string | null;
  /** Null on rows read through fakes/pre-column data — treated as 0. */
  trial_index?: number | null;
  status: string;
  override_status?: string | null;
}

/** An eval_case_overrides row as the summarizers read it. */
export interface EvalRunCaseOverrideRow {
  test_case_id: string;
  override_status: string;
}

export interface EvalRunVerdictSummary {
  /** Result rows observed (per-trial granularity — drives completion). */
  completed: number;
  passed: number;
  failed: number;
  errored: number | null;
  /** Unstable CASE count; null on legacy (unversioned) runs. */
  unstable: number | null;
  passRate: number | null;
}

function toTrialStatus(status: string): "pass" | "fail" | "error" {
  return status === "pass" || status === "fail" ? status : "error";
}

function toRowOverride(
  value: string | null | undefined,
): "pass" | "fail" | null {
  return value === "pass" || value === "fail" ? value : null;
}

/**
 * Summarize a run's result rows under its stamped scoring semantics.
 * Versioned counters are CASE verdicts (not trial rows); `completed`
 * always stays the raw row count so completion checks compare against
 * COALESCE(expected_result_rows, total_tests) fan-out arithmetic.
 */
export function summarizeEvalRunVerdicts(
  rows: EvalRunVerdictRow[],
  caseOverrides: EvalRunCaseOverrideRow[],
  scoringVersion: number | null,
): EvalRunVerdictSummary {
  if (scoringVersion === null) {
    // Legacy (~v1) semantics, preserved verbatim — errors fold into
    // failed, no errored/unstable counters, old denominator.
    const legacy = summarizeEvalStatuses(rows, null);
    return {
      completed: legacy.completed,
      passed: legacy.passed,
      failed: legacy.failed,
      errored: legacy.errored,
      unstable: null,
      passRate: legacy.passRate,
    };
  }

  const trialRows: TrialResultInput[] = rows.map((row, index) => ({
    // A row without a case FK (reconciler synthetic for a hard-deleted
    // index row) can never gain sibling trials — treat it as its own
    // single-trial case.
    testCaseId: row.test_case_id ?? `__row-without-case:${index}`,
    trialIndex: row.trial_index ?? 0,
    status: toTrialStatus(row.status),
    overrideStatus: toRowOverride(row.override_status),
  }));
  const overrides: CaseOverrideInput[] = caseOverrides.flatMap((override) => {
    const status = toRowOverride(override.override_status);
    return status
      ? [{ testCaseId: override.test_case_id, overrideStatus: status }]
      : [];
  });

  const verdicts = aggregateTrialCaseVerdicts(trialRows, overrides);
  const summary = summarizeCaseVerdicts(verdicts);
  return {
    completed: rows.length,
    passed: summary.passed,
    failed: summary.failed,
    errored: summary.errored,
    unstable: summary.unstable,
    passRate: summary.passRate,
  };
}

/**
 * The scoring-semantics version a summary computed by THIS code should
 * record. Runs stamped at or below the deployed version record their own
 * stamp (v2 and v3 share the denominator rule, so recomputes are stable
 * — no reconciler churn); runs stamped by NEWER code record this code's
 * version, keeping them divergent so the newer code recomputes once warm
 * (deploy-window guard). Legacy runs stay null.
 */
export function summaryScoringVersionFor(
  scoringVersion: number | null,
  currentVersion: number,
): number | null {
  if (scoringVersion === null) return null;
  return Math.min(scoringVersion, currentVersion);
}
