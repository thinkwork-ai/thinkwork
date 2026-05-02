import { planRoutineFromIntent } from "./routine-authoring-planner.js";

export interface RoutineDraftInput {
  name: string;
  intent: string;
  recipient?: string | null;
}

export interface RoutineDraftArtifacts {
  asl: Record<string, unknown>;
  markdownSummary: string;
  stepManifest: Record<string, unknown>;
}

export type RoutineDraftResult =
  | { ok: true; artifacts: RoutineDraftArtifacts }
  | { ok: false; reason: string };

export function buildRoutineDraftFromIntent(
  input: RoutineDraftInput,
): RoutineDraftResult {
  const result = planRoutineFromIntent(input);
  if (!result.ok) return result;

  return {
    ok: true,
    artifacts: {
      asl: result.artifacts.asl,
      markdownSummary: result.artifacts.markdownSummary,
      stepManifest: result.artifacts.stepManifest,
    },
  };
}
