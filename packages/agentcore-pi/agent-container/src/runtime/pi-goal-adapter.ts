import process from "node:process";
import type { ExtensionFactory } from "@thinkwork/pi-extensions";
import type {
  GoalRunEvidence,
  ToolInvocationRecord,
} from "@thinkwork/pi-runtime-core";
import piGoal from "./vendor/narumitw-pi-goal.js";

export const PI_GOAL_TOOL_NAMES = ["goal_complete"] as const;
const GOAL_STATE_ENTRY_TYPE = "goal-state";

export interface PiGoalAdapterOptions {
  agentDir: string;
}

export type RuntimeGoalAction =
  | "start"
  | "resume"
  | "pause"
  | "cancel"
  | "clear";

export interface RuntimeGoalMode {
  enabled?: boolean;
  action: RuntimeGoalAction;
  objective?: string;
  goal_run_id?: string;
  resolved_budget?: {
    token_budget?: number;
    source?: string;
  };
}

interface ActiveGoalState {
  id: string;
  text: string;
  status: "active" | "paused" | "budget_limited" | "complete";
  startedAt: number;
  updatedAt: number;
  iteration: number;
  tokenBudget?: number;
  tokensUsed: number;
  timeUsedSeconds: number;
}

export function createPiGoalExtensionFactory(
  options: PiGoalAdapterOptions,
): ExtensionFactory {
  return async (pi) => {
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    const previousHiddenContinuation =
      process.env.THINKWORK_PI_GOAL_DISABLE_HIDDEN_CONTINUATION;
    process.env.PI_CODING_AGENT_DIR = options.agentDir;
    process.env.THINKWORK_PI_GOAL_DISABLE_HIDDEN_CONTINUATION = "true";
    try {
      await piGoal(pi);
    } finally {
      if (previousAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      }
      if (previousHiddenContinuation === undefined) {
        delete process.env.THINKWORK_PI_GOAL_DISABLE_HIDDEN_CONTINUATION;
      } else {
        process.env.THINKWORK_PI_GOAL_DISABLE_HIDDEN_CONTINUATION =
          previousHiddenContinuation;
      }
    }
  };
}

export function normalizeRuntimeGoalMode(
  payload: Record<string, unknown>,
): RuntimeGoalMode | undefined {
  const goalMode = payload.goal_mode ?? payload.goalMode;
  if (!goalMode || typeof goalMode !== "object" || Array.isArray(goalMode)) {
    return undefined;
  }
  const record = goalMode as Record<string, unknown>;
  const action =
    typeof record.action === "string" ? record.action.trim() : undefined;
  if (
    action !== "start" &&
    action !== "resume" &&
    action !== "pause" &&
    action !== "cancel" &&
    action !== "clear"
  ) {
    if (record.enabled === true) return undefined;
    return undefined;
  }

  const resolvedBudget =
    record.resolved_budget &&
    typeof record.resolved_budget === "object" &&
    !Array.isArray(record.resolved_budget)
      ? (record.resolved_budget as Record<string, unknown>)
      : undefined;
  const tokenBudget = resolvedBudget?.token_budget;

  return {
    enabled: record.enabled === true,
    action,
    objective:
      typeof record.objective === "string" ? record.objective : undefined,
    goal_run_id:
      typeof record.goal_run_id === "string" ? record.goal_run_id : undefined,
    resolved_budget:
      typeof tokenBudget === "number" && Number.isFinite(tokenBudget)
        ? {
            token_budget: Math.floor(tokenBudget),
            source:
              typeof resolvedBudget?.source === "string"
                ? resolvedBudget.source
                : undefined,
          }
        : undefined,
  };
}

export function hasPiGoalMode(payload: Record<string, unknown>): boolean {
  return Boolean(normalizeRuntimeGoalMode(payload));
}

export function goalCommandForRuntimeMode(
  payload: Record<string, unknown>,
): string | undefined {
  const goalMode = normalizeRuntimeGoalMode(payload);
  if (!goalMode) return undefined;

  const budgetFlag = goalMode.resolved_budget?.token_budget
    ? ` --tokens ${goalMode.resolved_budget.token_budget}`
    : "";
  switch (goalMode.action) {
    case "start": {
      const objective = goalMode.objective?.trim();
      if (!objective) return undefined;
      return `/goal${budgetFlag} ${objective}`;
    }
    case "resume":
      return `/goal resume${budgetFlag}`;
    case "pause":
      return "/goal pause";
    case "cancel":
    case "clear":
      return "/goal clear";
  }
}

export function extractGoalRunEvidence(args: {
  payload: Record<string, unknown>;
  sessionEntries: unknown[];
  toolInvocations: ToolInvocationRecord[];
}): GoalRunEvidence | undefined {
  const goalMode = normalizeRuntimeGoalMode(args.payload);
  if (!goalMode) return undefined;

  const completion = completedGoal(args.toolInvocations);
  const goals = args.sessionEntries.flatMap((entry) => {
    const goal = goalFromEntry(entry);
    return goal ? [goal] : [];
  });
  const lastGoal = goals.at(-1);
  const evidence = lastGoal
    ? mapGoal(goalMode.action, lastGoal)
    : ({
        source: "pi_goal",
        action: goalMode.action,
        status:
          goalMode.action === "cancel" || goalMode.action === "clear"
            ? "cleared"
            : "paused",
        continuation_policy: "thinkwork_managed",
      } satisfies GoalRunEvidence);

  if (completion) {
    evidence.status = "complete";
    evidence.completion_summary = completion.summary;
    evidence.objective = evidence.objective ?? completion.goal;
  }
  if (evidence.status === "budget_limited") {
    evidence.budget_limited_reason = "token_budget_reached";
  }
  return evidence;
}

function goalFromEntry(entry: unknown): ActiveGoalState | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const record = entry as Record<string, unknown>;
  if (
    record.type !== "custom" ||
    record.customType !== GOAL_STATE_ENTRY_TYPE ||
    !record.data ||
    typeof record.data !== "object"
  ) {
    return undefined;
  }
  const goal = (record.data as Record<string, unknown>).goal;
  if (!goal || typeof goal !== "object" || Array.isArray(goal))
    return undefined;
  const goalRecord = goal as Record<string, unknown>;
  if (
    typeof goalRecord.id !== "string" ||
    typeof goalRecord.text !== "string" ||
    (goalRecord.status !== "active" &&
      goalRecord.status !== "paused" &&
      goalRecord.status !== "budget_limited" &&
      goalRecord.status !== "complete")
  ) {
    return undefined;
  }
  return {
    id: goalRecord.id,
    text: goalRecord.text,
    status: goalRecord.status,
    startedAt:
      typeof goalRecord.startedAt === "number" ? goalRecord.startedAt : 0,
    updatedAt:
      typeof goalRecord.updatedAt === "number" ? goalRecord.updatedAt : 0,
    iteration:
      typeof goalRecord.iteration === "number" ? goalRecord.iteration : 0,
    tokenBudget:
      typeof goalRecord.tokenBudget === "number"
        ? goalRecord.tokenBudget
        : undefined,
    tokensUsed:
      typeof goalRecord.tokensUsed === "number" ? goalRecord.tokensUsed : 0,
    timeUsedSeconds:
      typeof goalRecord.timeUsedSeconds === "number"
        ? goalRecord.timeUsedSeconds
        : 0,
  };
}

function mapGoal(
  action: RuntimeGoalAction,
  goal: ActiveGoalState,
): GoalRunEvidence {
  return {
    source: "pi_goal",
    action,
    goal_id: goal.id,
    objective: goal.text,
    status: goal.status,
    iteration: goal.iteration,
    token_budget: goal.tokenBudget,
    tokens_used: goal.tokensUsed,
    time_used_seconds: goal.timeUsedSeconds,
    started_at: timestamp(goal.startedAt),
    updated_at: timestamp(goal.updatedAt),
    continuation_policy: "thinkwork_managed",
  };
}

function completedGoal(
  toolInvocations: ToolInvocationRecord[],
): { goal: string; summary: string } | undefined {
  for (const invocation of [...toolInvocations].reverse()) {
    if (invocation.tool_name !== "goal_complete") continue;
    const details =
      invocation.result &&
      typeof invocation.result === "object" &&
      !Array.isArray(invocation.result)
        ? (invocation.result as Record<string, unknown>).details
        : undefined;
    if (!details || typeof details !== "object" || Array.isArray(details)) {
      continue;
    }
    const record = details as Record<string, unknown>;
    if (typeof record.goal === "string" && typeof record.summary === "string") {
      return { goal: record.goal, summary: record.summary };
    }
  }
  return undefined;
}

function timestamp(value: number): string | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return new Date(value).toISOString();
}
