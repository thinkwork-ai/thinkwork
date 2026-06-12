export type EvalCaseStatus = "pass" | "fail" | "error";

/**
 * Why a case errored. Mirrors the comment-enum on
 * `eval_results.error_cause`. U2 only distinguishes `reconciler`
 * (synthetic rows) from `infra_other` (everything else); U3 classifies
 * `timeout` / `throttle` / `evaluator_error`.
 */
export type EvalErrorCause =
  | "timeout"
  | "throttle"
  | "evaluator_error"
  | "reconciler"
  | "infra_other";

export interface EvalAssertion {
  type: string;
  value?: string | null;
  path?: string | null;
}

export interface EvalAssertionResult extends EvalAssertion {
  passed: boolean;
  reason: string;
  score?: number;
}

export interface EvalJudgeResult {
  passed: boolean;
  reason: string;
  score: number;
}

export type EvalJudge = (
  query: string,
  output: string,
  rubric: string,
) => EvalJudgeResult | Promise<EvalJudgeResult>;

export interface EvaluatorTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface EvalEvaluatorResult {
  evaluator_id: string;
  source: "agentcore" | "in_house";
  value: number | null;
  label: string | null;
  explanation: string | null;
  skipped?: boolean;
  token_usage?: EvaluatorTokenUsage;
  error?: string;
}

export interface EvalOutcomeScore {
  status: EvalCaseStatus;
  score: number | null;
  assertionsPassed: boolean;
  evaluatorsPassed: boolean;
  /** Set when status is "error"; null otherwise. */
  errorCause: EvalErrorCause | null;
}

/**
 * Status-only rollup of a run's result rows. `errored` and a null
 * `passRate` only exist under versioned (v2+) scoring semantics; legacy
 * runs (null scoring_version) keep the historical error-counts-as-failed
 * math and are never silently upgraded.
 */
export interface EvalStatusSummary {
  completed: number;
  passed: number;
  failed: number;
  /** Null under legacy semantics (errors stay folded into `failed`). */
  errored: number | null;
  /**
   * pass / (pass + fail) under current semantics; null when no clean
   * scoreable execution exists (all-error or zero-case run). Legacy
   * semantics keep pass / total (0 when empty).
   */
  passRate: number | null;
}
