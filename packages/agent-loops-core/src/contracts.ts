export const AGENT_LOOP_TRIGGER_FAMILIES = [
  "manual",
  "schedule",
  "api",
  "webhook",
  "app_event",
  "n8n",
] as const;

export const AGENT_LOOP_PHASE1_TRIGGER_FAMILIES = [
  "manual",
  "schedule",
] as const;

export const AGENT_LOOP_JUDGE_MODES = [
  "self_check",
  "human_approval",
  "model_judge",
  "reviewer_agent",
  "eval_threshold",
  "external_callback",
] as const;

export const AGENT_LOOP_PHASE1_JUDGE_MODES = [
  "self_check",
  "human_approval",
] as const;

export const AGENT_LOOP_JUDGMENT_OUTCOMES = [
  "complete",
  "continue",
  "failed",
  "budget_stopped",
  "needs_human_approval",
  "escalated",
] as const;

export const AGENT_LOOP_FAIL_BEHAVIORS = [
  "return_blocker",
  "best_effort_with_warning",
  "escalate",
] as const;

export type AgentLoopTriggerFamily =
  (typeof AGENT_LOOP_TRIGGER_FAMILIES)[number];
export type AgentLoopPhase1TriggerFamily =
  (typeof AGENT_LOOP_PHASE1_TRIGGER_FAMILIES)[number];
export type AgentLoopJudgeMode = (typeof AGENT_LOOP_JUDGE_MODES)[number];
export type AgentLoopPhase1JudgeMode =
  (typeof AGENT_LOOP_PHASE1_JUDGE_MODES)[number];
export type AgentLoopJudgmentOutcome =
  (typeof AGENT_LOOP_JUDGMENT_OUTCOMES)[number];
export type AgentLoopFailBehavior = (typeof AGENT_LOOP_FAIL_BEHAVIORS)[number];

export interface TriggerSpec {
  family: AgentLoopTriggerFamily;
  enabled: boolean;
  scheduleId?: string;
  source?: string;
  config: Record<string, unknown>;
}

export interface GoalSpec {
  objective: string;
  completionCriteria: string[];
  context?: Record<string, unknown>;
}

export interface WorkerSpec {
  type: "agent" | "agent_profile";
  id: string;
  label?: string;
  toolHints: string[];
  config: Record<string, unknown>;
}

export interface JudgeSpec {
  mode: AgentLoopJudgeMode;
  criteria: string[];
  config: Record<string, unknown>;
}

export interface LoopPolicy {
  maxIterations: number;
  maxRuntimeMs?: number;
  maxTokens?: number;
  costBudgetUsd?: number;
  retryBackoffMs?: number;
  failBehavior: AgentLoopFailBehavior;
  escalateOnFailure: boolean;
}

export interface JudgmentResult {
  outcome: AgentLoopJudgmentOutcome;
  reason?: string;
  confidence?: number;
  shouldContinue: boolean;
  terminalReason?: string;
  structuredOutput: Record<string, unknown>;
}

export interface EvidencePolicy {
  redactionState: "summary_only" | "redacted" | "offloaded" | "raw_allowed";
  retainRawEvidence: boolean;
  retentionDays?: number;
}

export const DEFAULT_LOOP_POLICY: LoopPolicy = {
  maxIterations: 1,
  failBehavior: "return_blocker",
  escalateOnFailure: false,
};

const MAX_OBJECTIVE_LENGTH = 5000;
const MAX_CRITERION_LENGTH = 1000;
const MAX_CRITERIA = 20;
const MAX_LABEL_LENGTH = 200;

export function normalizeTriggerSpec(input: unknown): TriggerSpec {
  const source = record(input);
  const family = source.family;
  if (!isEnumValue(family, AGENT_LOOP_PHASE1_TRIGGER_FAMILIES)) {
    throw new Error(
      `Unsupported AgentLoop trigger family '${String(family)}' for Phase 1`,
    );
  }

  return compact({
    family,
    enabled: booleanValue(source.enabled) ?? true,
    scheduleId: optionalString(source.scheduleId ?? source.schedule_id),
    source: optionalString(source.source),
    config: record(source.config),
  });
}

export function normalizeGoalSpec(input: unknown): GoalSpec {
  const source = record(input);
  const objective = requiredString(source.objective, "objective", {
    maxLength: MAX_OBJECTIVE_LENGTH,
  });
  const completionCriteria = stringArray(
    source.completionCriteria ?? source.completion_criteria,
    "completionCriteria",
    {
      maxItems: MAX_CRITERIA,
      maxLength: MAX_CRITERION_LENGTH,
      allowEmpty: false,
    },
  );

  return compact({
    objective,
    completionCriteria,
    context: optionalRecord(source.context),
  });
}

export function normalizeWorkerSpec(input: unknown): WorkerSpec {
  const source = record(input);
  const type = source.type;
  if (!isEnumValue(type, ["agent", "agent_profile"] as const)) {
    throw new Error("worker type must be 'agent' or 'agent_profile'");
  }

  return compact({
    type,
    id: requiredString(source.id, "worker id", { maxLength: 200 }),
    label: optionalString(source.label, { maxLength: MAX_LABEL_LENGTH }),
    toolHints: stringArray(source.toolHints ?? source.tool_hints, "toolHints", {
      allowEmpty: true,
      maxItems: 50,
      maxLength: 100,
    }),
    config: record(source.config),
  });
}

export function normalizeJudgeSpec(
  input: unknown,
  options: { allowFutureModes?: boolean } = {},
): JudgeSpec {
  const source = record(input);
  const mode = source.mode;
  if (!isEnumValue(mode, AGENT_LOOP_JUDGE_MODES)) {
    throw new Error(`Unsupported AgentLoop judge mode '${String(mode)}'`);
  }
  if (
    !options.allowFutureModes &&
    !isEnumValue(mode, AGENT_LOOP_PHASE1_JUDGE_MODES)
  ) {
    throw new Error(
      `AgentLoop judge mode '${mode}' is not executable in Phase 1`,
    );
  }

  return {
    mode,
    criteria: stringArray(source.criteria, "criteria", {
      allowEmpty: true,
      maxItems: MAX_CRITERIA,
      maxLength: MAX_CRITERION_LENGTH,
    }),
    config: record(source.config),
  };
}

export function normalizeLoopPolicy(input: unknown): LoopPolicy {
  const source = record(input);
  const maxRuntimeMs = optionalPositiveInt(
    source.maxRuntimeMs ?? source.max_runtime_ms,
    "maxRuntimeMs",
  );
  const maxTokens = optionalPositiveInt(
    source.maxTokens ?? source.max_tokens,
    "maxTokens",
  );
  const costBudgetUsd = optionalPositiveNumber(
    source.costBudgetUsd ?? source.cost_budget_usd,
    "costBudgetUsd",
  );
  const retryBackoffMs = optionalPositiveInt(
    source.retryBackoffMs ?? source.retry_backoff_ms,
    "retryBackoffMs",
  );
  const failBehavior =
    enumOrDefault(
      source.failBehavior ?? source.fail_behavior,
      AGENT_LOOP_FAIL_BEHAVIORS,
      DEFAULT_LOOP_POLICY.failBehavior,
    ) ?? DEFAULT_LOOP_POLICY.failBehavior;

  return compact({
    maxIterations:
      optionalPositiveInt(
        source.maxIterations ?? source.max_iterations,
        "maxIterations",
      ) ?? DEFAULT_LOOP_POLICY.maxIterations,
    maxRuntimeMs,
    maxTokens,
    costBudgetUsd,
    retryBackoffMs,
    failBehavior,
    escalateOnFailure:
      booleanValue(source.escalateOnFailure ?? source.escalate_on_failure) ??
      DEFAULT_LOOP_POLICY.escalateOnFailure,
  });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined;
  return record(value);
}

function requiredString(
  value: unknown,
  label: string,
  options: { maxLength: number },
): string {
  const trimmed = optionalString(value, { ...options, label });
  if (!trimmed) throw new Error(`${label} is required`);
  return trimmed;
}

function optionalString(
  value: unknown,
  options: { label?: string; maxLength?: number } = {},
): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (options.maxLength && trimmed.length > options.maxLength) {
    throw new Error(
      `${options.label ?? trimmed.slice(0, 40)} must be at most ${options.maxLength} characters`,
    );
  }
  return trimmed;
}

function stringArray(
  value: unknown,
  label: string,
  options: {
    allowEmpty: boolean;
    maxItems: number;
    maxLength: number;
  },
): string[] {
  const values = Array.isArray(value) ? value : [];
  const normalized = values
    .map((entry) => optionalString(entry, { maxLength: options.maxLength }))
    .filter((entry): entry is string => Boolean(entry));

  if (!options.allowEmpty && normalized.length === 0) {
    throw new Error(`${label} must include at least one item`);
  }
  if (normalized.length > options.maxItems) {
    throw new Error(`${label} must include at most ${options.maxItems} items`);
  }
  return normalized;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function optionalPositiveInt(
  value: unknown,
  label: string,
): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(numberValue) || numberValue <= 0) {
    throw new Error(`${label} must be positive`);
  }
  return numberValue;
}

function optionalPositiveNumber(
  value: unknown,
  label: string,
): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    throw new Error(`${label} must be positive`);
  }
  return numberValue;
}

function enumOrDefault<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
): T[number] {
  return isEnumValue(value, allowed) ? value : fallback;
}

function isEnumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): value is T[number] {
  return typeof value === "string" && allowed.includes(value as T[number]);
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

// ---------------------------------------------------------------------------
// Routine actions (deterministic routines v1 — plan 2026-07-03-004 U5)
// ---------------------------------------------------------------------------

/** One "Run routine" action attached to an Automation version. Executes a
 * git_python routine deterministically (zero agent turns) before any agent
 * work in the run. */
export interface RoutineActionSpec {
  /** routines.id of a git_python routine. */
  routineId: string;
  /** Optional input forwarded to run(input). */
  input?: Record<string, unknown> | null;
  /** Display label for run detail / the picker. */
  label?: string | null;
}

/** The version-level field. `agentTurn: false` marks a routine-only
 * Automation — the run completes after the actions with no wakeup. */
export interface RoutineActionsSpec {
  actions: RoutineActionSpec[];
  agentTurn: boolean;
}

/** Per-action outcome recorded on the iteration and injected into the
 * agent-turn payload for mixed Automations. */
export interface RoutineActionResult {
  routineId: string;
  label?: string | null;
  status: "succeeded" | "failed";
  executionId?: string | null;
  commitSha?: string | null;
  cacheServed?: boolean;
  outputJson?: unknown;
  errorClass?: string | null;
  errorMessage?: string | null;
}

export const MAX_ROUTINE_ACTIONS_PER_LOOP = 5;

const UUID_VALUE_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Normalizes a raw routineActionsSpec value. Returns null when the field
 * is absent/empty (the common no-routines case); throws on a malformed
 * shape so a bad save is rejected rather than stored. */
export function normalizeRoutineActionsSpec(
  value: unknown,
): RoutineActionsSpec | null {
  if (value === undefined || value === null || value === "") return null;
  const source = typeof value === "string" ? JSON.parse(value) : value;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("routineActionsSpec must be an object");
  }
  const record = source as Record<string, unknown>;
  const rawActions = record.actions;
  if (rawActions === undefined || rawActions === null) return null;
  if (!Array.isArray(rawActions)) {
    throw new Error("routineActionsSpec.actions must be an array");
  }
  if (rawActions.length === 0) return null;
  if (rawActions.length > MAX_ROUTINE_ACTIONS_PER_LOOP) {
    throw new Error(
      `routineActionsSpec.actions must include at most ${MAX_ROUTINE_ACTIONS_PER_LOOP} actions`,
    );
  }
  const actions = rawActions.map((entry, index): RoutineActionSpec => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`routineActionsSpec.actions[${index}] must be an object`);
    }
    const action = entry as Record<string, unknown>;
    const routineId = action.routineId;
    if (typeof routineId !== "string" || !UUID_VALUE_RE.test(routineId)) {
      throw new Error(
        `routineActionsSpec.actions[${index}].routineId must be a routine id`,
      );
    }
    const input = action.input;
    if (
      input !== undefined &&
      input !== null &&
      (typeof input !== "object" || Array.isArray(input))
    ) {
      throw new Error(
        `routineActionsSpec.actions[${index}].input must be an object`,
      );
    }
    const label = action.label;
    return compact({
      routineId,
      input: (input as Record<string, unknown> | null | undefined) ?? undefined,
      label:
        typeof label === "string" && label.trim()
          ? label.trim().slice(0, 120)
          : undefined,
    });
  });
  return {
    actions,
    agentTurn: record.agentTurn !== false,
  };
}
