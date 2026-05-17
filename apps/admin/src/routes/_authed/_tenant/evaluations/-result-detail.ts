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
    assertion.reason?.toLowerCase().startsWith("heuristic rubric check failed")
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
