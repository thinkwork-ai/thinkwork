export const AGENT_LOOP_MODES = ["closed"] as const;
export const EXTERNAL_REVIEWER_POLICIES = [
  "never",
  "explicit",
  "profile_required",
  "always",
] as const;
export const LOOP_FAIL_BEHAVIORS = [
  "return_blocker",
  "best_effort_with_warning",
] as const;

export type AgentLoopMode = (typeof AGENT_LOOP_MODES)[number];
export type ExternalReviewerPolicy =
  (typeof EXTERNAL_REVIEWER_POLICIES)[number];
export type LoopFailBehavior = (typeof LOOP_FAIL_BEHAVIORS)[number];

export interface AgentLoopPolicy {
  mode: AgentLoopMode;
  enabled: boolean;
  maxIterations: number;
  maxReviewLoops: number;
  reviewGate: boolean;
  externalReviewerPolicy: ExternalReviewerPolicy;
  failBehavior: LoopFailBehavior;
  maxRuntimeMs?: number;
  maxTokens?: number;
  costBudgetUsd?: number;
}

export interface NormalizedAgentProfileExecutionControls {
  foreground: true;
  clarify: boolean;
  maxSubagentDepth: 0;
  maxRuntimeMs?: number;
  maxTokens?: number;
  costBudgetUsd?: number;
  thinking?: string;
  reviewGate?: boolean;
  maxReviewLoops?: number;
  loopPolicy: AgentLoopPolicy;
}

const DEFAULT_LOOP_POLICY: AgentLoopPolicy = {
  mode: "closed",
  enabled: true,
  maxIterations: 1,
  maxReviewLoops: 1,
  reviewGate: true,
  externalReviewerPolicy: "explicit",
  failBehavior: "return_blocker",
};

export function defaultAgentLoopPolicy(
  overrides: Partial<AgentLoopPolicy> = {},
): AgentLoopPolicy {
  return compactOptionalNumbers({
    ...DEFAULT_LOOP_POLICY,
    ...overrides,
  });
}

export function normalizeAgentLoopPolicy(
  executionControls: unknown,
): AgentLoopPolicy {
  const execution = normalizeRecord(executionControls);
  const source = normalizeRecord(
    execution.loopPolicy ?? execution.loop_policy ?? execution.loop,
  );
  const reviewGate =
    booleanValue(source.reviewGate ?? source.review_gate) ??
    booleanValue(execution.reviewGate ?? execution.review_gate) ??
    DEFAULT_LOOP_POLICY.reviewGate;
  const maxReviewLoops =
    positiveInt(
      source.maxReviewLoops ??
        source.max_review_loops ??
        execution.maxReviewLoops ??
        execution.max_review_loops,
    ) ?? DEFAULT_LOOP_POLICY.maxReviewLoops;
  const maxRuntimeMs = positiveInt(
    source.maxRuntimeMs ??
      source.max_runtime_ms ??
      execution.maxRuntimeMs ??
      execution.max_runtime_ms ??
      execution.maxRunTimeMs ??
      execution.maxExecutionTimeMs,
  );
  const maxTokens = positiveInt(
    source.maxTokens ?? source.max_tokens ?? execution.maxTokens,
  );
  const costBudgetUsd = positiveNumber(
    source.costBudgetUsd ??
      source.cost_budget_usd ??
      execution.costBudgetUsd ??
      execution.cost_budget_usd,
  );

  return compactOptionalNumbers({
    mode: enumValue(source.mode, AGENT_LOOP_MODES) ?? DEFAULT_LOOP_POLICY.mode,
    enabled:
      booleanValue(source.enabled) ??
      booleanValue(execution.loopEnabled ?? execution.loop_enabled) ??
      DEFAULT_LOOP_POLICY.enabled,
    maxIterations:
      positiveInt(source.maxIterations ?? source.max_iterations) ??
      DEFAULT_LOOP_POLICY.maxIterations,
    maxReviewLoops,
    reviewGate,
    externalReviewerPolicy:
      enumValue(
        source.externalReviewerPolicy ?? source.external_reviewer_policy,
        EXTERNAL_REVIEWER_POLICIES,
      ) ?? DEFAULT_LOOP_POLICY.externalReviewerPolicy,
    failBehavior:
      enumValue(
        source.failBehavior ?? source.fail_behavior,
        LOOP_FAIL_BEHAVIORS,
      ) ?? DEFAULT_LOOP_POLICY.failBehavior,
    ...(maxRuntimeMs !== undefined ? { maxRuntimeMs } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(costBudgetUsd !== undefined ? { costBudgetUsd } : {}),
  });
}

export function normalizeAgentProfileExecutionControls(
  executionControls: unknown,
): NormalizedAgentProfileExecutionControls {
  const execution = normalizeRecord(executionControls);
  const loopPolicy = normalizeAgentLoopPolicy(execution);
  const maxRuntimeMs = positiveInt(
    execution.maxRuntimeMs ??
      execution.maxRunTimeMs ??
      execution.maxExecutionTimeMs ??
      loopPolicy.maxRuntimeMs,
  );
  const maxTokens = positiveInt(execution.maxTokens ?? loopPolicy.maxTokens);
  const costBudgetUsd = positiveNumber(
    execution.costBudgetUsd ?? loopPolicy.costBudgetUsd,
  );
  return {
    foreground: true,
    clarify: booleanValue(execution.clarify) ?? false,
    maxSubagentDepth: 0,
    ...(maxRuntimeMs !== undefined ? { maxRuntimeMs } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(costBudgetUsd !== undefined ? { costBudgetUsd } : {}),
    ...optionalString("thinking", execution.thinking),
    ...(loopPolicy.reviewGate ? { reviewGate: true } : {}),
    ...(loopPolicy.maxReviewLoops !== DEFAULT_LOOP_POLICY.maxReviewLoops ||
    loopPolicy.reviewGate
      ? { maxReviewLoops: loopPolicy.maxReviewLoops }
      : {}),
    loopPolicy,
  };
}

export function normalizeExecutionControlsForStorage(
  executionControls: unknown,
): Record<string, unknown> {
  const normalized = normalizeAgentProfileExecutionControls(executionControls);
  return compactRecord({
    foreground: true,
    clarify: normalized.clarify,
    maxSubagentDepth: 0,
    maxRuntimeMs: normalized.maxRuntimeMs ?? null,
    maxTokens: normalized.maxTokens ?? null,
    costBudgetUsd: normalized.costBudgetUsd ?? null,
    thinking: normalized.thinking ?? null,
    reviewGate: normalized.reviewGate ?? null,
    maxReviewLoops: normalized.maxReviewLoops ?? null,
    loopPolicy: normalized.loopPolicy,
  });
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function positiveInt(value: unknown): number | undefined {
  const numberValue =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  if (!Number.isSafeInteger(numberValue) || numberValue <= 0) return undefined;
  return numberValue;
}

function positiveNumber(value: unknown): number | undefined {
  const numberValue =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  if (!Number.isFinite(numberValue) || numberValue <= 0) return undefined;
  return numberValue;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] | undefined {
  if (typeof value !== "string") return undefined;
  return allowed.includes(value as T[number])
    ? (value as T[number])
    : undefined;
}

function optionalString(key: string, value: unknown): Record<string, string> {
  if (typeof value !== "string") return {};
  const trimmed = value.trim();
  return trimmed ? { [key]: trimmed } : {};
}

function compactRecord(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== null),
  );
}

function compactOptionalNumbers(policy: AgentLoopPolicy): AgentLoopPolicy {
  const copy = { ...policy };
  if (copy.maxRuntimeMs === undefined) delete copy.maxRuntimeMs;
  if (copy.maxTokens === undefined) delete copy.maxTokens;
  if (copy.costBudgetUsd === undefined) delete copy.costBudgetUsd;
  return copy;
}
