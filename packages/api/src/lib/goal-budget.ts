export const DEFAULT_GOAL_TOKEN_BUDGET = 100_000;
export const MAX_GOAL_TOKEN_BUDGET = 2_000_000;

export function normalizeGoalDefaultTokenBudgetInput(
  value: unknown,
): number | null {
  if (value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > MAX_GOAL_TOKEN_BUDGET
  ) {
    throw new Error(
      `Goal token budget must be a positive whole number no greater than ${MAX_GOAL_TOKEN_BUDGET}.`,
    );
  }
  return value;
}
