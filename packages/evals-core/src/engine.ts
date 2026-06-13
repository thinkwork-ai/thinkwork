/**
 * Scoring-engine contract (Trust Core U10, R14).
 *
 * Scoring sits behind this ThinkWork-owned seam so engine-specific
 * concepts can never leak into the dataset format or the verdict
 * taxonomy. The dataset core schema (engine-neutral case fields) and
 * the verdict types in ./types.ts must compile without importing this
 * module — engines depend on the taxonomy, never the reverse.
 *
 * Persistence mapping (byte-identical to the pre-contract worker; the
 * characterization suite guards this):
 *   - `EngineScoringResult.verdicts`   → eval_results.evaluator_results
 *   - `EngineScoringResult.assertions` → eval_results.assertions
 *
 * Status contribution: the contract deliberately carries NO status
 * field. The host derives the case status by feeding the merged
 * verdicts/assertions of every dispatched engine into
 * `scoreEvalOutcome` — the single ThinkWork-owned status rule. An
 * engine contributes to the status only through its rows. This is what
 * normalizes the existing asymmetry (the in-house judge's verdict
 * lives in the assertions snapshot, AgentCore stubs live in
 * evaluator_results) at the seam without changing persisted shapes.
 *
 * Error semantics at the boundary:
 *   - An engine THROWING propagates raw — `runScoringEngine` never
 *     wraps engine-thrown errors, so throttles stay SQS-retryable and
 *     judge crashes keep their host classification (evaluator_error).
 *   - An engine RETURNING an unknown shape (bad verdict source, a
 *     non-boolean `passed`, a stray status, …) is rejected here with
 *     `EvalEngineContractViolationError`; the host records the case as
 *     error/evaluator_error — never a behavioral fail.
 *
 * This package must stay free of engine implementations' SDKs (no
 * AWS clients): hosts inject side-effectful collaborators (e.g. the
 * Bedrock LLM judge) into engine factories that live with the host.
 */
import type {
  EvalAssertion,
  EvalAssertionResult,
  EvalEvaluatorResult,
} from "./types.js";

/**
 * Engine-neutral scoring input: the case content the engine judges
 * against plus the agent response under test. Field vocabulary mirrors
 * the dataset core schema — nothing here may reference a specific
 * engine.
 */
export interface EngineScoringInput {
  /** The user query the agent under test answered. */
  query: string;
  /** Engine-neutral assertion rows from the case (core schema shape). */
  assertions: EvalAssertion[];
  /**
   * Rubric / resolution target for flagged-thread cases (the case's
   * `expected_behavior`). Null/absent for synthetic cases.
   */
  expectedBehavior?: string | null;
  /**
   * Engine-specific evaluator selection, passed through by the host
   * from the case file's namespaced `engines.*` extension block. The
   * core dataset schema never carries these ids.
   */
  evaluatorIds?: string[];
  /** The agent response being scored. */
  response: {
    output: string;
    durationMs: number;
    sessionId: string;
  };
  /** Execution context an engine may need (model under test, …). */
  context?: {
    modelId?: string | null;
  };
}

export interface EngineScoringResult {
  /**
   * Evaluator verdict rows, persisted verbatim into
   * eval_results.evaluator_results.
   */
  verdicts: EvalEvaluatorResult[];
  /**
   * Assertion-snapshot rows, persisted verbatim into
   * eval_results.assertions.
   */
  assertions: EvalAssertionResult[];
}

export interface ScoringEngine {
  /** Stable engine identifier ("in_house", "agentcore", …). */
  id: string;
  score(input: EngineScoringInput): Promise<EngineScoringResult>;
}

/**
 * An engine returned a result that violates the contract. The host
 * records the case as error/evaluator_error (the evaluator broke, not
 * the agent) — precedent: EvalJudgeInvocationError.
 */
export class EvalEngineContractViolationError extends Error {
  readonly engineId: string;
  readonly violations: string[];

  constructor(engineId: string, violations: string[]) {
    super(
      `Scoring engine '${engineId}' returned a result violating the engine contract: ${violations.join("; ")}`,
    );
    this.name = "EvalEngineContractViolationError";
    this.engineId = engineId;
    this.violations = violations;
  }
}

const VERDICT_SOURCES = ["agentcore", "in_house"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function verdictViolations(verdict: unknown, index: number): string[] {
  const at = `verdicts[${index}]`;
  if (!isRecord(verdict)) return [`${at} is not an object`];
  const violations: string[] = [];
  if (typeof verdict.evaluator_id !== "string" || !verdict.evaluator_id) {
    violations.push(`${at}.evaluator_id must be a non-empty string`);
  }
  if (!VERDICT_SOURCES.includes(verdict.source as never)) {
    violations.push(
      `${at}.source must be one of ${VERDICT_SOURCES.join("|")} (got ${JSON.stringify(verdict.source)})`,
    );
  }
  if (
    verdict.value !== null &&
    (typeof verdict.value !== "number" || !Number.isFinite(verdict.value))
  ) {
    violations.push(`${at}.value must be a finite number or null`);
  }
  if (verdict.label !== null && typeof verdict.label !== "string") {
    violations.push(`${at}.label must be a string or null`);
  }
  if (verdict.explanation !== null && typeof verdict.explanation !== "string") {
    violations.push(`${at}.explanation must be a string or null`);
  }
  if (verdict.skipped !== undefined && typeof verdict.skipped !== "boolean") {
    violations.push(`${at}.skipped must be a boolean when present`);
  }
  if (verdict.error !== undefined && typeof verdict.error !== "string") {
    violations.push(`${at}.error must be a string when present`);
  }
  return violations;
}

function assertionViolations(assertion: unknown, index: number): string[] {
  const at = `assertions[${index}]`;
  if (!isRecord(assertion)) return [`${at} is not an object`];
  const violations: string[] = [];
  if (typeof assertion.type !== "string" || !assertion.type) {
    violations.push(`${at}.type must be a non-empty string`);
  }
  if (typeof assertion.passed !== "boolean") {
    violations.push(
      `${at}.passed must be a boolean (got ${JSON.stringify(assertion.passed)})`,
    );
  }
  if (typeof assertion.reason !== "string") {
    violations.push(`${at}.reason must be a string`);
  }
  if (
    assertion.score !== undefined &&
    (typeof assertion.score !== "number" || !Number.isFinite(assertion.score))
  ) {
    violations.push(`${at}.score must be a finite number when present`);
  }
  if (assertion.rubric !== undefined && typeof assertion.rubric !== "string") {
    violations.push(`${at}.rubric must be a string when present`);
  }
  return violations;
}

/**
 * Contract-boundary validation: collect every shape violation in the
 * engine's result. Returns the violations (empty = valid) so callers
 * can choose between throwing and reporting.
 */
export function engineScoringResultViolations(result: unknown): string[] {
  if (!isRecord(result)) return ["result is not an object"];
  const violations: string[] = [];
  // A status-bearing result is the canonical "unknown shape" — engines
  // never decide case status; the host's scoreEvalOutcome does.
  if ("status" in result) {
    violations.push(
      "result must not carry a status — the host derives status via scoreEvalOutcome",
    );
  }
  if (!Array.isArray(result.verdicts)) {
    violations.push("verdicts must be an array");
  } else {
    result.verdicts.forEach((verdict, index) => {
      violations.push(...verdictViolations(verdict, index));
    });
  }
  if (!Array.isArray(result.assertions)) {
    violations.push("assertions must be an array");
  } else {
    result.assertions.forEach((assertion, index) => {
      violations.push(...assertionViolations(assertion, index));
    });
  }
  return violations;
}

export function validateEngineScoringResult(
  engineId: string,
  result: unknown,
): EngineScoringResult {
  const violations = engineScoringResultViolations(result);
  if (violations.length > 0) {
    throw new EvalEngineContractViolationError(engineId, violations);
  }
  return result as EngineScoringResult;
}

/**
 * Dispatch one engine through the contract boundary. Engine-thrown
 * errors propagate raw (throttles stay retryable; judge crashes keep
 * their classification); only a malformed RETURNED result becomes an
 * EvalEngineContractViolationError.
 */
export async function runScoringEngine(
  engine: ScoringEngine,
  input: EngineScoringInput,
): Promise<EngineScoringResult> {
  const result = await engine.score(input);
  return validateEngineScoringResult(engine.id, result);
}
