/**
 * Runtime goal-mode envelope (THINK-597).
 *
 * The user-facing composer Goal surface was removed — nothing here normalizes
 * client metadata any more. What remains is the runtime dispatch contract that
 * **Agent Loops** and workflow steps ride: `agent-loops-core` builds a
 * `RuntimeGoalMode` per iteration (see `run-ledger.ts` / `interpreter-wakeup.ts`)
 * and `wakeup-processor` serializes it onto the AgentCore payload through
 * {@link toRuntimeGoalModePayload}. `question-goal-resume.ts` rebuilds the same
 * shape when a paused goal turn resumes across a user-question card.
 */
export const GOAL_MODE_ACTIONS = [
  "start",
  "resume",
  "pause",
  "cancel",
  "clear",
] as const;

export type GoalModeAction = (typeof GOAL_MODE_ACTIONS)[number];

export interface RuntimeGoalMode {
  enabled: true;
  action: GoalModeAction;
  objective?: string;
  goalRunId?: string;
  resolvedBudget: {
    tokenBudget: number;
  };
}

export function toRuntimeGoalModePayload(goalMode: RuntimeGoalMode) {
  return {
    enabled: goalMode.enabled,
    action: goalMode.action,
    objective: goalMode.objective,
    goal_run_id: goalMode.goalRunId,
    resolved_budget: {
      token_budget: goalMode.resolvedBudget.tokenBudget,
    },
  };
}
