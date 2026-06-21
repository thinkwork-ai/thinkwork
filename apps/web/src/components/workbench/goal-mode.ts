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

export interface ComposerGoalModeSubmission {
  content: string;
  goalMode: ComposerGoalModeIntent | null;
  requested: boolean;
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

export function isGoalModeShorthand(content: string): boolean {
  return /^\/goal(?:\s|$)/i.test(content.trimStart());
}

export function resolveStartGoalModeSubmission(
  content: string,
  enabled: boolean,
): ComposerGoalModeSubmission {
  const trimmed = content.trim();
  const shorthand = parseGoalModeShorthand(trimmed);
  const requested = enabled || shorthand !== null;
  const normalizedContent = (shorthand ?? trimmed).trim();

  return {
    content: requested ? normalizedContent : trimmed,
    goalMode: requested ? createStartGoalModeIntent(normalizedContent) : null,
    requested,
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

function parseGoalModeShorthand(content: string): string | null {
  const match = content.match(/^\/goal(?:\s+(.*))?$/is);
  if (!match) return null;
  return match[1] ?? "";
}
