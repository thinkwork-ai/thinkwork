import type { RuntimeGoalMode } from "../goal-mode.js";

/**
 * Carry a paused Goal-mode orchestration record across the governed question
 * card boundary. The source turn is canonical database state; the answer
 * wakeup payload itself is never trusted to choose a goal or budget.
 */
export function goalModeFromQuestionSourceTurn(input: {
  resultJson: unknown;
  usageJson: unknown;
}): RuntimeGoalMode | null {
  const result = readRecord(input.resultJson);
  const usage = readRecord(input.usageJson);
  const goal = readRecord(result.goal_run ?? usage.goal_run);
  if (goal.status !== "paused" && goal.status !== "budget_limited") {
    return null;
  }
  const goalRunId = boundedString(goal.goal_id, 128);
  const objective = boundedString(goal.objective, 20_000);
  const tokenBudget = finitePositiveInteger(goal.token_budget);
  if (!goalRunId || !objective || !tokenBudget) return null;
  return {
    enabled: true,
    action: "resume",
    objective,
    goalRunId,
    resolvedBudget: { tokenBudget },
  };
}

function boundedString(value: unknown, limit: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= limit ? text : null;
}

function finitePositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : null;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
