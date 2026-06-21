export const GOAL_MODE_METADATA_KEY = "goalMode";

export type ComposerGoalModeAction =
  | "start"
  | "resume"
  | "pause"
  | "cancel"
  | "clear";

export interface ComposerGoalModeIntent {
  enabled: true;
  action: ComposerGoalModeAction;
  objective?: string;
  goalRunId?: string;
}

export function createStartGoalModeIntent(
  objective: string,
): ComposerGoalModeIntent | null {
  const trimmed = objective.trim();
  if (!trimmed) return null;
  return {
    enabled: true,
    action: "start",
    objective: trimmed,
  };
}

export function appendGoalModeMetadata(
  metadata: Record<string, unknown>,
  goalMode: ComposerGoalModeIntent | null | undefined,
): Record<string, unknown> {
  if (!goalMode) return metadata;
  return {
    ...metadata,
    [GOAL_MODE_METADATA_KEY]: goalMode,
  };
}
