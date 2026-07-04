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

/**
 * Trigger families acceptable on a SAVED Automation (THINK-137 U3, R2).
 * `schedule` and `webhook` are the real trigger families; `manual` stays valid
 * as the "no automatic trigger, run by hand" family (and as a run trigger
 * source). The dead families api/app_event/n8n are rejected at save time.
 */
export const AGENT_LOOP_SAVEABLE_TRIGGER_FAMILIES = [
  "manual",
  "schedule",
  "webhook",
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
  if (!isEnumValue(family, AGENT_LOOP_SAVEABLE_TRIGGER_FAMILIES)) {
    throw new Error(
      `Unsupported AgentLoop trigger family '${String(family)}'. ` +
        `Trigger families are ${AGENT_LOOP_SAVEABLE_TRIGGER_FAMILIES.join(", ")}.`,
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

// ---------------------------------------------------------------------------
// Target spec (THINK-137 Automations U3 — plan 2026-07-03-006)
// ---------------------------------------------------------------------------
//
// `target_spec` is the authoritative version spec: it names WHAT a run does
// (its target) — an agent thread, a routine, or a workflow. The legacy
// goal/worker/routineActions blobs become read-fallbacks (targetSpecFromLegacy)
// for pre-U3 rows and are still written for column compatibility. Judge /
// loop-policy are off the product surface (R11) and are NOT represented here.

export const AGENT_LOOP_TARGET_KINDS = [
  "agent_thread",
  "routine",
  "workflow",
] as const;

export type AgentLoopTargetKind = (typeof AGENT_LOOP_TARGET_KINDS)[number];

/** agent_thread target — a goal-mode agent turn. `instructions` is the
 * objective the run pursues; `completionCriteria` is carried so the mapping
 * from a legacy goalSpec is lossless. `workerId`/`workerType` name the agent
 * that runs. `threadMode` selects a fresh thread per run or a fixed thread. */
export interface TargetAgentThreadSpec {
  instructions: string;
  completionCriteria?: string[];
  workerId?: string;
  workerType?: "agent" | "agent_profile";
  threadMode: "new_per_run" | "fixed";
  fixedThreadId?: string;
}

/** routine / workflow target — a deterministic git_python routine (routine
 * kind) or a step_functions workflow (workflow kind, D4). `additionalActions`
 * carries the tail of a legacy multi-action routine-only spec so the
 * round-trip through a single-routine target is lossless (see
 * targetSpecFromLegacy). */
export interface TargetRoutineRef {
  routineId: string;
  input?: Record<string, unknown> | null;
  label?: string | null;
  additionalActions?: RoutineActionSpec[];
}

export interface TargetGuards {
  monthlyCostCapUsd?: number;
  maxConcurrentRuns?: number;
}

export interface TargetSpec {
  kind: AgentLoopTargetKind;
  agentThread?: TargetAgentThreadSpec;
  routine?: TargetRoutineRef;
  workflow?: TargetRoutineRef;
  guards?: TargetGuards;
}

/**
 * Validates + normalizes a raw target_spec value (object or JSON string).
 * Rejects unknown kinds and mixed kinds (config for a kind other than the
 * declared one) with actionable errors.
 */
export function normalizeTargetSpec(value: unknown): TargetSpec {
  const source = typeof value === "string" ? JSON.parse(value) : value;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("targetSpec must be an object");
  }
  const rec = source as Record<string, unknown>;
  const kind = rec.kind;
  if (!isEnumValue(kind, AGENT_LOOP_TARGET_KINDS)) {
    throw new Error(
      `targetSpec.kind '${String(kind)}' is not one of ${AGENT_LOOP_TARGET_KINDS.join(", ")}`,
    );
  }

  // Reject config blocks that belong to a different kind (mixed kinds). The
  // agent_thread kind's config key is `agentThread`; routine/workflow match
  // their kind name directly.
  const configKeyForKind: Record<AgentLoopTargetKind, string> = {
    agent_thread: "agentThread",
    routine: "routine",
    workflow: "workflow",
  };
  const ownKey = configKeyForKind[kind];
  const foreignKeys = (["agentThread", "routine", "workflow"] as const).filter(
    (key) => key !== ownKey && rec[key] !== undefined && rec[key] !== null,
  );
  if (foreignKeys.length > 0) {
    throw new Error(
      `targetSpec.kind '${kind}' must not carry ${foreignKeys.join(", ")} config`,
    );
  }

  const guards = normalizeTargetGuards(rec.guards);
  if (kind === "agent_thread") {
    return compact({
      kind,
      agentThread: normalizeTargetAgentThread(rec.agentThread),
      guards,
    });
  }
  if (kind === "routine") {
    return compact({
      kind,
      routine: normalizeTargetRoutineRef(rec.routine, "routine"),
      guards,
    });
  }
  return compact({
    kind,
    workflow: normalizeTargetRoutineRef(rec.workflow, "workflow"),
    guards,
  });
}

function normalizeTargetAgentThread(value: unknown): TargetAgentThreadSpec {
  const rec = record(value);
  const instructions = requiredString(
    rec.instructions,
    "targetSpec.agentThread.instructions",
    {
      maxLength: MAX_OBJECTIVE_LENGTH,
    },
  );
  const threadModeRaw = rec.threadMode ?? "new_per_run";
  if (!isEnumValue(threadModeRaw, ["new_per_run", "fixed"] as const)) {
    throw new Error(
      "targetSpec.agentThread.threadMode must be 'new_per_run' or 'fixed'",
    );
  }
  const workerType = rec.workerType;
  if (
    workerType !== undefined &&
    workerType !== null &&
    !isEnumValue(workerType, ["agent", "agent_profile"] as const)
  ) {
    throw new Error(
      "targetSpec.agentThread.workerType must be 'agent' or 'agent_profile'",
    );
  }
  const fixedThreadId = optionalString(rec.fixedThreadId, { maxLength: 200 });
  if (threadModeRaw === "fixed" && !fixedThreadId) {
    throw new Error(
      "targetSpec.agentThread.fixedThreadId is required when threadMode is 'fixed'",
    );
  }
  const completionCriteria = Array.isArray(rec.completionCriteria)
    ? stringArray(
        rec.completionCriteria,
        "targetSpec.agentThread.completionCriteria",
        {
          allowEmpty: true,
          maxItems: MAX_CRITERIA,
          maxLength: MAX_CRITERION_LENGTH,
        },
      )
    : undefined;
  return compact({
    instructions,
    completionCriteria,
    workerId: optionalString(rec.workerId, { maxLength: 200 }),
    workerType: isEnumValue(workerType, ["agent", "agent_profile"] as const)
      ? workerType
      : undefined,
    threadMode: threadModeRaw,
    fixedThreadId,
  });
}

function normalizeTargetRoutineRef(
  value: unknown,
  label: string,
): TargetRoutineRef {
  const rec = record(value);
  const routineId = rec.routineId;
  if (typeof routineId !== "string" || !UUID_VALUE_RE.test(routineId)) {
    throw new Error(`targetSpec.${label}.routineId must be a routine id`);
  }
  const input = rec.input;
  if (
    input !== undefined &&
    input !== null &&
    (typeof input !== "object" || Array.isArray(input))
  ) {
    throw new Error(`targetSpec.${label}.input must be an object`);
  }
  const additional = rec.additionalActions;
  let additionalActions: RoutineActionSpec[] | undefined;
  if (additional !== undefined && additional !== null) {
    if (!Array.isArray(additional)) {
      throw new Error(`targetSpec.${label}.additionalActions must be an array`);
    }
    const wrapped = normalizeRoutineActionsSpec({
      actions: additional,
      agentTurn: false,
    });
    additionalActions = wrapped?.actions;
  }
  return compact({
    routineId,
    input: (input as Record<string, unknown> | null | undefined) ?? undefined,
    label:
      typeof rec.label === "string" && rec.label.trim()
        ? rec.label.trim().slice(0, 120)
        : undefined,
    additionalActions,
  });
}

function normalizeTargetGuards(value: unknown): TargetGuards | undefined {
  if (value === undefined || value === null) return undefined;
  const rec = record(value);
  const guards = compact({
    monthlyCostCapUsd: optionalPositiveNumber(
      rec.monthlyCostCapUsd,
      "targetSpec.guards.monthlyCostCapUsd",
    ),
    maxConcurrentRuns: optionalPositiveInt(
      rec.maxConcurrentRuns,
      "targetSpec.guards.maxConcurrentRuns",
    ),
  });
  return Object.keys(guards).length > 0 ? guards : undefined;
}

/** Legacy-blob shape read from an agent_loop_versions row. */
export interface LegacyVersionSpecs {
  goalSpec?: unknown;
  workerSpec?: unknown;
  routineActionsSpec?: unknown;
}

/**
 * Maps legacy goal/worker/routineActions blobs to an equivalent TargetSpec.
 * Used to backfill pre-U3 rows and as the dispatch read-fallback when a row
 * has no target_spec.
 *
 *   - routineActionsSpec with agentTurn:false  → kind 'routine'. A single
 *     action maps to routine {routineId, input, label}. Multiple actions map
 *     the FIRST action to the primary routine ref and preserve the remainder
 *     under routine.additionalActions so the mapping is lossless and dispatch
 *     reconstructs the exact original action list.
 *   - everything else (agent-turn or mixed agentTurn:true) → kind
 *     'agent_thread' from goalSpec.objective + workerSpec. A mixed
 *     Automation's bolt-on routine actions stay in the orthogonal
 *     routine_actions_spec column (they are pre-steps of the agent-thread
 *     target, not the target itself) and are read from there at dispatch.
 */
export function targetSpecFromLegacy(version: LegacyVersionSpecs): TargetSpec {
  const routineActions = normalizeRoutineActionsSpec(
    version.routineActionsSpec,
  );
  if (
    routineActions &&
    routineActions.actions.length > 0 &&
    !routineActions.agentTurn
  ) {
    const [primary, ...rest] = routineActions.actions;
    return {
      kind: "routine",
      routine: compact({
        routineId: primary.routineId,
        input: primary.input ?? undefined,
        label: primary.label ?? undefined,
        additionalActions: rest.length > 0 ? rest : undefined,
      }),
    };
  }

  const goal = record(version.goalSpec);
  const worker = record(version.workerSpec);
  const workerType = isEnumValue(worker.type, [
    "agent",
    "agent_profile",
  ] as const)
    ? worker.type
    : undefined;
  const completionCriteria = Array.isArray(goal.completionCriteria)
    ? goal.completionCriteria.filter((c): c is string => typeof c === "string")
    : undefined;
  return {
    kind: "agent_thread",
    agentThread: compact({
      instructions: typeof goal.objective === "string" ? goal.objective : "",
      completionCriteria:
        completionCriteria && completionCriteria.length > 0
          ? completionCriteria
          : undefined,
      workerId: typeof worker.id === "string" ? worker.id : undefined,
      workerType,
      threadMode: "new_per_run" as const,
    }),
  };
}
