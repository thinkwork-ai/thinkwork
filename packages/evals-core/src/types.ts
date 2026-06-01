export type EvalCaseStatus = "pass" | "fail" | "error";

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
}
