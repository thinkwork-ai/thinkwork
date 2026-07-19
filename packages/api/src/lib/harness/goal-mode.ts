import type { FinalizeGoalRunProjection } from "../chat-finalize/types.js";

const MAX_GOAL_OBJECTIVE_LENGTH = 20_000;
const MAX_GOAL_RUN_ID_LENGTH = 128;

export type HarnessGoalAction =
  | "start"
  | "resume"
  | "pause"
  | "cancel"
  | "clear";

export interface HarnessGoalMode {
  enabled: true;
  action: HarnessGoalAction;
  objective?: string;
  goalRunId?: string;
  tokenBudget: number;
}

export interface HarnessGoalExecution {
  action: HarnessGoalAction;
  goalId: string;
  objective: string;
  tokenBudget: number;
  previousTokensUsed: number;
  previousTimeUsedSeconds: number;
  iteration: number;
  startedAt: string;
}

export type HarnessGoalCompletion =
  | {
      ok: true;
      summary: string;
      completionNotes?: string;
      verificationNotes: string[];
    }
  | { ok: false; error: string };

export function parseHarnessGoalMode(value: unknown): HarnessGoalMode | null {
  if (value == null) return null;
  const record = readRecord(value);
  if (Object.keys(record).length === 0 || record.enabled !== true) {
    throw new Error("goal_mode must be an enabled object");
  }
  const action = stringValue(record.action) as HarnessGoalAction | null;
  if (
    !action ||
    !["start", "resume", "pause", "cancel", "clear"].includes(action)
  ) {
    throw new Error("goal_mode action is unsupported");
  }
  const resolvedBudget = readRecord(record.resolved_budget);
  const tokenBudget = finiteInteger(resolvedBudget.token_budget);
  if (!tokenBudget || tokenBudget <= 0) {
    throw new Error("goal_mode requires a positive resolved token budget");
  }
  const objective = boundedString(record.objective, MAX_GOAL_OBJECTIVE_LENGTH);
  const goalRunId = boundedGoalId(record.goal_run_id);
  if (action === "start" && !objective) {
    throw new Error("goal_mode start requires an objective");
  }
  if (action !== "start" && !goalRunId) {
    throw new Error(`goal_mode ${action} requires a goal_run_id`);
  }
  return {
    enabled: true,
    action,
    ...(objective ? { objective } : {}),
    ...(goalRunId ? { goalRunId } : {}),
    tokenBudget,
  };
}

export function resolveHarnessGoalExecution(input: {
  mode: HarnessGoalMode;
  turnId: string;
  previous: unknown;
  now: number;
}): HarnessGoalExecution {
  const { mode } = input;
  if (mode.action === "start") {
    return {
      action: "start",
      goalId: mode.goalRunId ?? `agentcore:${input.turnId}`,
      objective: mode.objective!,
      tokenBudget: mode.tokenBudget,
      previousTokensUsed: 0,
      previousTimeUsedSeconds: 0,
      iteration: 1,
      startedAt: new Date(input.now).toISOString(),
    };
  }

  const previous = normalizePreviousGoal(input.previous, mode.goalRunId!);
  if (!previous) {
    throw new Error(
      `goal_mode ${mode.action} could not resolve canonical prior goal state`,
    );
  }
  if (
    previous.status === "complete" ||
    previous.status === "completed" ||
    previous.status === "cancelled" ||
    previous.status === "cleared"
  ) {
    throw new Error(
      `goal_mode ${mode.action} cannot continue terminal goal ${mode.goalRunId}`,
    );
  }
  if (mode.objective && mode.objective !== previous.objective) {
    throw new Error("goal_mode objective does not match canonical prior state");
  }
  return {
    action: mode.action,
    goalId: previous.goal_id!,
    objective: previous.objective!,
    // An operator may raise the tenant default between resumes. Never lower
    // an already-issued budget, and never accept a composer-supplied budget.
    tokenBudget: Math.max(previous.token_budget ?? 0, mode.tokenBudget),
    previousTokensUsed: previous.tokens_used ?? 0,
    previousTimeUsedSeconds: previous.time_used_seconds ?? 0,
    iteration: (previous.iteration ?? 0) + 1,
    startedAt: previous.started_at ?? new Date(input.now).toISOString(),
  };
}

export function buildHarnessGoalEvidence(input: {
  execution: HarnessGoalExecution;
  status: "paused" | "budget_limited" | "complete" | "cleared";
  currentTokensUsed: number;
  currentTimeUsedSeconds: number;
  now: number;
  summary?: string;
  completionNotes?: string;
  verificationNotes?: string[];
  budgetLimitedReason?: string;
}): FinalizeGoalRunProjection {
  const tokensUsed =
    input.execution.previousTokensUsed + Math.max(0, input.currentTokensUsed);
  return {
    // Compatibility name retained until the shared GoalRunEvidence contract
    // is renamed; this state is runtime-neutral and owned by ThinkWork.
    source: "pi_goal",
    action: input.execution.action,
    goal_id: input.execution.goalId,
    objective: input.execution.objective,
    status: input.status,
    ...(input.summary ? { summary: input.summary } : {}),
    ...(input.status === "complete" && input.summary
      ? { completion_summary: input.summary }
      : {}),
    ...(input.completionNotes
      ? { completion_notes: input.completionNotes }
      : {}),
    ...(input.verificationNotes?.length
      ? { verification_notes: input.verificationNotes.slice(0, 5) }
      : {}),
    token_budget: input.execution.tokenBudget,
    tokens_used: tokensUsed,
    iteration: input.execution.iteration,
    time_used_seconds:
      input.execution.previousTimeUsedSeconds +
      Math.max(0, input.currentTimeUsedSeconds),
    ...(input.budgetLimitedReason
      ? { budget_limited_reason: input.budgetLimitedReason }
      : {}),
    continuation_policy: "thinkwork_managed",
    resume_eligible:
      input.status === "paused" || input.status === "budget_limited",
    started_at: input.execution.startedAt,
    updated_at: new Date(input.now).toISOString(),
  };
}

export function parseGoalCompleteInput(value: unknown): HarnessGoalCompletion {
  const record = readRecord(value);
  const summary = boundedString(record.summary, 4_000);
  if (!summary) {
    return { ok: false, error: "goal_complete requires a non-empty summary" };
  }
  const completionNotes = boundedString(record.completion_notes, 4_000);
  const verificationNotes = Array.isArray(record.verification_notes)
    ? record.verification_notes
        .flatMap((entry) => {
          const note = boundedString(entry, 500);
          return note ? [note] : [];
        })
        .slice(0, 5)
    : [];
  return {
    ok: true,
    summary,
    ...(completionNotes ? { completionNotes } : {}),
    verificationNotes,
  };
}

export function goalStatusAfterStep(
  execution: HarnessGoalExecution,
  currentTokensUsed: number,
): "paused" | "budget_limited" {
  return execution.previousTokensUsed + currentTokensUsed >=
    execution.tokenBudget
    ? "budget_limited"
    : "paused";
}

function normalizePreviousGoal(
  value: unknown,
  expectedGoalId: string,
): FinalizeGoalRunProjection | null {
  const record = readRecord(value);
  const goalId = boundedGoalId(record.goal_id ?? record.goalId);
  const objective = boundedString(record.objective, MAX_GOAL_OBJECTIVE_LENGTH);
  const status = stringValue(record.status);
  if (
    !goalId ||
    goalId !== expectedGoalId ||
    !objective ||
    !status ||
    ![
      "active",
      "paused",
      "budget_limited",
      "complete",
      "completed",
      "cancelled",
      "cleared",
    ].includes(status)
  )
    return null;
  return {
    source: "pi_goal",
    status: status as FinalizeGoalRunProjection["status"],
    goal_id: goalId,
    objective,
    token_budget: finiteInteger(record.token_budget) ?? undefined,
    tokens_used: finiteInteger(record.tokens_used) ?? undefined,
    iteration: finiteInteger(record.iteration) ?? undefined,
    time_used_seconds: finiteNumber(record.time_used_seconds) ?? undefined,
    started_at: boundedString(record.started_at, 80),
    resume_eligible: record.resume_eligible === true,
  };
}

function boundedGoalId(value: unknown): string | undefined {
  const goalId = boundedString(value, MAX_GOAL_RUN_ID_LENGTH);
  return goalId && /^[A-Za-z0-9._:-]+$/.test(goalId) ? goalId : undefined;
}

function boundedString(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text || text.length > limit) return undefined;
  return text;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function finiteInteger(value: unknown): number | null {
  const number = finiteNumber(value);
  return number == null ? null : Math.floor(number);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
