/**
 * Trial → case-verdict aggregation (Eval Profiles U4, KTD4).
 *
 * Per-trial `eval_results` rows keep the closed pass | fail | error
 * status; `unstable` exists ONLY at this layer, as a case-level
 * aggregate verdict. Every summary/read site that consumes trial rows
 * (eval-worker finalization, the override recompute resolver, the
 * eval-runs reconciler, run detail) groups rows by case through these
 * functions so the verdict math can never fork.
 *
 * Override layering (KTD9):
 *   1. Per-trial effective status = row overrideStatus ?? status
 *      (row-level overrides only ever exist on legacy/single-trial rows).
 *   2. The case verdict aggregates the effective trial statuses.
 *   3. The case-level override (eval_case_overrides) applies LAST:
 *      effective case verdict = case override ?? aggregate.
 */

export type EvalCaseVerdict = "pass" | "fail" | "error" | "unstable";

/**
 * Minimum number of scored (pass/fail) trials a multi-trial case needs
 * before a majority verdict is meaningful. Below the quorum the case
 * verdict is `error` (the cause carried by its error trials) — a single
 * surviving trial out of three must not masquerade as a stable verdict.
 * Applies only when the case has more than one trial row; single-trial
 * cases keep identity semantics (legacy behavior unchanged).
 */
export const TRIAL_SCORED_QUORUM = 2;

export interface TrialResultInput {
  testCaseId: string;
  /** 0-based trial index (eval_results.trial_index). */
  trialIndex: number;
  status: "pass" | "fail" | "error";
  /** Row-level operator override ('pass' | 'fail'); null/absent = none. */
  overrideStatus?: "pass" | "fail" | null;
}

export interface CaseOverrideInput {
  testCaseId: string;
  /** Case-level operator override (eval_case_overrides). */
  overrideStatus: "pass" | "fail";
}

export interface CaseVerdictAggregate {
  testCaseId: string;
  verdict: EvalCaseVerdict;
  /** Trial rows observed for the case. */
  trialCount: number;
  /** Trials whose effective status was pass or fail. */
  scoredCount: number;
}

/**
 * Group per-trial rows by case and derive each case's verdict.
 *
 * Rules:
 *   - single-trial case → its effective status (identity — legacy
 *     single-execution behavior is unchanged);
 *   - multi-trial case with fewer than TRIAL_SCORED_QUORUM scored
 *     trials → `error`;
 *   - otherwise majority of scored trials wins; an exact pass/fail tie
 *     → `unstable`;
 *   - a case-level override always wins (applied last).
 *
 * Case order follows first appearance in `rows`.
 */
export function aggregateTrialCaseVerdicts(
  rows: TrialResultInput[],
  caseOverrides: CaseOverrideInput[] = [],
): CaseVerdictAggregate[] {
  const overrideByCase = new Map<string, "pass" | "fail">();
  for (const override of caseOverrides) {
    if (
      override.overrideStatus === "pass" ||
      override.overrideStatus === "fail"
    ) {
      overrideByCase.set(override.testCaseId, override.overrideStatus);
    }
  }

  const byCase = new Map<string, TrialResultInput[]>();
  for (const row of rows) {
    const existing = byCase.get(row.testCaseId);
    if (existing) existing.push(row);
    else byCase.set(row.testCaseId, [row]);
  }

  const verdicts: CaseVerdictAggregate[] = [];
  for (const [testCaseId, trialRows] of byCase) {
    const effective = trialRows.map((row) => row.overrideStatus ?? row.status);
    const passVotes = effective.filter((status) => status === "pass").length;
    const failVotes = effective.filter((status) => status === "fail").length;
    const scoredCount = passVotes + failVotes;

    let aggregate: EvalCaseVerdict;
    if (trialRows.length <= 1) {
      // Identity: a single execution's effective status IS the verdict.
      aggregate = normalizeStatus(effective[0]);
    } else if (scoredCount < TRIAL_SCORED_QUORUM) {
      aggregate = "error";
    } else if (passVotes > failVotes) {
      aggregate = "pass";
    } else if (failVotes > passVotes) {
      aggregate = "fail";
    } else {
      aggregate = "unstable";
    }

    verdicts.push({
      testCaseId,
      verdict: overrideByCase.get(testCaseId) ?? aggregate,
      trialCount: trialRows.length,
      scoredCount,
    });
  }
  return verdicts;
}

function normalizeStatus(status: string | undefined): EvalCaseVerdict {
  return status === "pass" || status === "fail" ? status : "error";
}

export interface CaseVerdictSummary {
  /** Cases with at least one trial row. */
  completedCases: number;
  passed: number;
  failed: number;
  errored: number;
  unstable: number;
  /**
   * passed / (passed + failed) over CASE verdicts. `unstable` is
   * excluded from the denominator exactly like `error` — disagreement
   * is quarantined, never scored. Null when nothing is scoreable.
   */
  passRate: number | null;
}

/** Roll case verdicts up into run-level counters. */
export function summarizeCaseVerdicts(
  verdicts: Array<Pick<CaseVerdictAggregate, "verdict">>,
): CaseVerdictSummary {
  const passed = verdicts.filter((v) => v.verdict === "pass").length;
  const failed = verdicts.filter((v) => v.verdict === "fail").length;
  const errored = verdicts.filter((v) => v.verdict === "error").length;
  const unstable = verdicts.filter((v) => v.verdict === "unstable").length;
  const scoreable = passed + failed;
  return {
    completedCases: verdicts.length,
    passed,
    failed,
    errored,
    unstable,
    passRate: scoreable > 0 ? passed / scoreable : null,
  };
}
