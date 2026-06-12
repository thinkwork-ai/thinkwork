// Pure parsing/formatting helpers for evaluation run results. Ported verbatim
// from apps/web's evaluations/-result-detail.ts (no UI, no imports).

export interface EvalResultForDetail {
  assertions: unknown;
  errorMessage: string | null;
  evaluatorResults: unknown;
  score: number | null;
  status: string;
}

export interface AssertionResult {
  type?: string;
  value?: string;
  passed?: boolean;
  reason?: string;
  score?: number;
}

export interface EvaluatorResult {
  evaluator_id?: string;
  evaluatorId?: string;
  source?: string;
  value?: number | null;
  label?: string | null;
  explanation?: string | null;
  error?: string | null;
  skipped?: boolean;
}

export interface EvalSpanRow {
  timestamp: string | null;
  name: string;
  attributes: unknown;
}

export type EvalFailureMode =
  | "timeout"
  | "runner-error"
  | "evaluator-error"
  | "judge-fail"
  | "heuristic-fail"
  | "assertion-fail"
  | null;

const PASS_THRESHOLD = 0.7;

export type EvaluatorDisplayStatus = "pass" | "fail" | "skipped" | "error";

export function isDesktopPiEvalRunProvenance(run: {
  executionTarget?: string | null;
  runtimeHost?: string | null;
}): boolean {
  return (
    run.executionTarget === "desktop-pi" || run.runtimeHost === "desktop-local"
  );
}

export function parseAssertions(raw: unknown): AssertionResult[] {
  return parseArray(raw).filter(isAssertionResult);
}

export function parseEvaluatorResults(raw: unknown): EvaluatorResult[] {
  return parseArray(raw).filter(isEvaluatorResult);
}

export function parseSpanAttributes(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function sortEvalSpans(spans: EvalSpanRow[]): EvalSpanRow[] {
  return [...spans].sort((a, b) => {
    if (!a.timestamp) return 1;
    if (!b.timestamp) return -1;
    return Date.parse(a.timestamp) - Date.parse(b.timestamp);
  });
}

export function canEditEvalResult(
  testCaseId: string | null | undefined,
): testCaseId is string {
  return typeof testCaseId === "string" && testCaseId.length > 0;
}

export function openEvalResultEditor(
  testCaseId: string | null | undefined,
  onEditTestCase: (testCaseId: string) => void,
) {
  if (!canEditEvalResult(testCaseId)) return false;
  onEditTestCase(testCaseId);
  return true;
}

export function expectedSummary(assertions: AssertionResult[]): string {
  return assertions
    .map((assertion) => {
      if (!assertion.type) return null;
      if (assertion.type === "llm-rubric") {
        return `llm-rubric: ${assertion.value ?? ""}`;
      }
      return `${assertion.type}: ${assertion.value ?? ""}`;
    })
    .filter(Boolean)
    .join("; ");
}

export function evaluatorDisplayStatus(
  evaluator: EvaluatorResult,
): EvaluatorDisplayStatus {
  if (evaluator.skipped || evaluator.label === "skipped") return "skipped";
  if (typeof evaluator.value === "number") {
    return evaluator.value >= PASS_THRESHOLD ? "pass" : "fail";
  }
  return "error";
}

export function isHeuristicRubricFailure(assertion: AssertionResult): boolean {
  return (
    assertion.passed === false &&
    assertion.type === "llm-rubric" &&
    (assertion.reason
      ?.toLowerCase()
      .startsWith("heuristic rubric check failed") ??
      false)
  );
}

export function evalFailureModeLabel(mode: EvalFailureMode): string | null {
  switch (mode) {
    case "timeout":
      return "Timed out";
    case "runner-error":
      return "Runner error";
    case "evaluator-error":
      return "Evaluator error";
    case "judge-fail":
      return "Evaluator failed";
    case "heuristic-fail":
      return "Heuristic fallback failed";
    case "assertion-fail":
      return "Assertion failed";
    default:
      return null;
  }
}

export function evalFailureModeDescription(
  mode: EvalFailureMode,
): string | null {
  switch (mode) {
    case "timeout":
      return "The target agent did not return before the eval response budget. Check the trace, then rerun the test after fixing latency or timeout settings.";
    case "runner-error":
      return "The eval runner could not complete this case. Check the error message and trace before changing the eval itself.";
    case "evaluator-error":
      return "A configured built-in evaluator did not return a score. Check evaluator access/configuration, then rerun this case.";
    case "judge-fail":
      return "A scored built-in evaluator returned below the pass threshold. Review the evaluator explanation and the target output.";
    case "heuristic-fail":
      return "The LLM judge did not run for this rubric, so the local fallback heuristic scored it. If the target output looks safe, edit the eval assertion or rerun with the LLM judge enabled.";
    case "assertion-fail":
      return "One or more deterministic assertions failed. Review the assertion JSON and target output, then edit the eval if the assertion is too brittle.";
    default:
      return null;
  }
}

export function deriveEvalFailureMode(
  result: EvalResultForDetail,
): EvalFailureMode {
  if (
    result.status === "error" &&
    result.errorMessage?.toLowerCase().includes("timeout")
  ) {
    return "timeout";
  }
  if (result.status === "error") return "runner-error";

  const evaluatorResults = parseEvaluatorResults(result.evaluatorResults);
  const assertions = parseAssertions(result.assertions);
  const evaluatorStatuses = evaluatorResults
    .filter((evaluator) => evaluatorDisplayStatus(evaluator) !== "skipped")
    .map(evaluatorDisplayStatus);
  if (evaluatorStatuses.includes("error")) return "evaluator-error";
  if (evaluatorStatuses.includes("fail")) return "judge-fail";

  if (assertions.some(isHeuristicRubricFailure)) return "heuristic-fail";
  if (assertions.some((assertion) => assertion.passed === false)) {
    return "assertion-fail";
  }
  if (result.status === "fail") return "assertion-fail";
  return null;
}

// ────────────────────────────────────────────────────────────────────
// Trust Core U11 — run health, error causes, comparison.
// ────────────────────────────────────────────────────────────────────

/**
 * Friendly labels for `eval_results.error_cause` (Trust Core U2/U3).
 * Error rows render by cause, never by score — the score-1-on-error
 * quirk is pinned server-side, so a score on an error row is noise.
 */
const EVAL_ERROR_CAUSE_LABELS: Record<string, string> = {
  timeout: "Timeout",
  throttle: "Throttled",
  evaluator_error: "Judge error",
  reconciler: "Reconciler",
  infra_other: "Infrastructure",
};

export function evalErrorCauseLabel(cause: string | null | undefined): string {
  if (!cause) return "Error";
  return EVAL_ERROR_CAUSE_LABELS[cause] ?? "Error";
}

export function evalErrorCauseDescription(
  cause: string | null | undefined,
): string {
  switch (cause) {
    case "timeout":
      return "The agent did not respond before the eval response budget. Infrastructure noise — excluded from the score.";
    case "throttle":
      return "Bedrock throttled the invocation and the bounded retry budget ran out. Excluded from the score.";
    case "evaluator_error":
      return "The judge/evaluator crashed or returned an invalid verdict. The case was not scored.";
    case "reconciler":
      return "The run reconciler closed this case out after the worker went silent. The case was not scored.";
    case "infra_other":
      return "An infrastructure error prevented this case from executing. Excluded from the score.";
    default:
      return "This case errored before it could be scored. Excluded from the score.";
  }
}

/**
 * Display label for a run's pass rate under current scoring semantics.
 * The server computes passRate over clean executions only and returns
 * null when nothing was scoreable — render "No score", never 0%.
 * In-flight runs show live progress from the override-corrected
 * counters when available.
 */
export function evalRunPassRateDisplay(run: {
  status: string;
  passRate?: number | null;
  passed?: number | null;
  failed?: number | null;
}): string {
  const status = String(run.status).toLowerCase();
  if (status === "pending" || status === "running") {
    const completed = (run.passed ?? 0) + (run.failed ?? 0);
    if (completed > 0)
      return `${(((run.passed ?? 0) / completed) * 100).toFixed(1)}%`;
    return "—";
  }
  if (run.passRate != null) return `${(run.passRate * 100).toFixed(1)}%`;
  return "No score";
}

export type EvalVerdictGroup = "pass" | "fail" | "error" | "other";

/**
 * Verdict grouping for the run drill-in: errors (raw status) are a
 * separate bucket from behavioral failures (effective status — the
 * operator override corrects the grouping too).
 */
export function evalResultVerdictGroup(result: {
  status: string;
  effectiveStatus?: string | null;
}): EvalVerdictGroup {
  if (result.status === "error") return "error";
  const status = result.effectiveStatus ?? result.status;
  if (status === "pass" || status === "completed") return "pass";
  if (status === "fail" || status === "failed") return "fail";
  return "other";
}

export function countEvalVerdictGroups(
  results: Array<{ status: string; effectiveStatus?: string | null }>,
): Record<EvalVerdictGroup, number> {
  const counts: Record<EvalVerdictGroup, number> = {
    pass: 0,
    fail: 0,
    error: 0,
    other: 0,
  };
  for (const result of results) counts[evalResultVerdictGroup(result)] += 1;
  return counts;
}

/** Per-cause error breakdown for a run's drill-in health summary. */
export function evalErrorCauseBreakdown(
  results: Array<{ status: string; errorCause?: string | null }>,
): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const result of results) {
    if (result.status !== "error") continue;
    const label = evalErrorCauseLabel(result.errorCause);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

// Run comparison (Trust Core R13): per-case verdict transitions between
// two runs of the same dataset, keyed by test case id.

export type EvalRunTransitionKind =
  | "fail-to-pass"
  | "pass-to-fail"
  | "new-error"
  | "error-resolved";

export interface EvalRunComparisonResult {
  testCaseId: string | null;
  testCaseName: string | null;
  status: string;
  effectiveStatus?: string | null;
  errorCause?: string | null;
}

export interface EvalRunTransition {
  key: string;
  name: string | null;
  kind: EvalRunTransitionKind;
  from: string;
  to: string;
}

const EVAL_RUN_TRANSITION_ORDER: Record<EvalRunTransitionKind, number> = {
  "pass-to-fail": 0,
  "new-error": 1,
  "fail-to-pass": 2,
  "error-resolved": 3,
};

/**
 * Compute per-case verdict transitions from a previous run to the
 * current one. Pass/fail comparisons use the effective status
 * (override-aware); errors compare on the raw status. Covers AE4: a
 * case failing in run N-1 and passing in run N shows as fail→pass.
 */
export function computeEvalRunComparison(
  previous: EvalRunComparisonResult[],
  current: EvalRunComparisonResult[],
): EvalRunTransition[] {
  const keyOf = (r: EvalRunComparisonResult) =>
    r.testCaseId ?? (r.testCaseName ? `name:${r.testCaseName}` : null);
  const prevByKey = new Map<string, EvalRunComparisonResult>();
  for (const result of previous) {
    const key = keyOf(result);
    if (key) prevByKey.set(key, result);
  }

  const transitions: EvalRunTransition[] = [];
  for (const result of current) {
    const key = keyOf(result);
    if (!key) continue;
    const prev = prevByKey.get(key);
    const currGroup = evalResultVerdictGroup(result);
    const prevGroup = prev ? evalResultVerdictGroup(prev) : null;

    let kind: EvalRunTransitionKind | null = null;
    if (currGroup === "error" && prevGroup !== "error") {
      // New errors include cases the previous run never executed.
      kind = "new-error";
    } else if (prevGroup === "error" && currGroup !== "error") {
      kind = "error-resolved";
    } else if (prevGroup === "fail" && currGroup === "pass") {
      kind = "fail-to-pass";
    } else if (prevGroup === "pass" && currGroup === "fail") {
      kind = "pass-to-fail";
    }
    if (!kind) continue;

    transitions.push({
      key,
      name: result.testCaseName,
      kind,
      from: prev
        ? prevGroup === "error"
          ? `error (${evalErrorCauseLabel(prev.errorCause)})`
          : (prevGroup ?? "—")
        : "not run",
      to:
        currGroup === "error"
          ? `error (${evalErrorCauseLabel(result.errorCause)})`
          : currGroup,
    });
  }

  return transitions.sort(
    (a, b) =>
      EVAL_RUN_TRANSITION_ORDER[a.kind] - EVAL_RUN_TRANSITION_ORDER[b.kind] ||
      (a.name ?? a.key).localeCompare(b.name ?? b.key),
  );
}

export function evalRunTransitionLabel(kind: EvalRunTransitionKind): string {
  switch (kind) {
    case "fail-to-pass":
      return "fail → pass";
    case "pass-to-fail":
      return "pass → fail";
    case "new-error":
      return "new error";
    case "error-resolved":
      return "error resolved";
  }
}

function parseArray(raw: unknown): unknown[] {
  let parsed = raw;
  while (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  return Array.isArray(parsed) ? parsed : [];
}

function isAssertionResult(value: unknown): value is AssertionResult {
  return typeof value === "object" && value !== null;
}

function isEvaluatorResult(value: unknown): value is EvaluatorResult {
  return typeof value === "object" && value !== null;
}
