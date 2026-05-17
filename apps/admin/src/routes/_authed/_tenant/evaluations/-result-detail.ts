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
}

export interface EvalSpanRow {
  timestamp: string | null;
  name: string;
  attributes: unknown;
}

export type EvalFailureMode =
  | "timeout"
  | "runner-error"
  | "judge-fail"
  | "assertion-fail"
  | null;

const PASS_THRESHOLD = 0.7;

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
  const hasJudgeFailure =
    evaluatorResults.some(
      (evaluator) =>
        typeof evaluator.value === "number" && evaluator.value < PASS_THRESHOLD,
    ) ||
    (evaluatorResults.length > 0 &&
      typeof result.score === "number" &&
      result.score < PASS_THRESHOLD);
  if (hasJudgeFailure) return "judge-fail";

  if (assertions.some((assertion) => assertion.passed === false)) {
    return "assertion-fail";
  }
  if (result.status === "fail") return "judge-fail";
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
