import type {
  RoutinePlan,
  RoutinePlanStep,
} from "../../../lib/routines/routine-authoring-planner.js";

export interface RoutineDefinitionPayload {
  routineId: string;
  currentVersion: number | null;
  versionId: string | null;
  title: string;
  description: string;
  kind: string;
  aslJson: unknown;
  markdownSummary: string;
  stepManifestJson: unknown;
  steps: RoutinePlanStep[];
}

export function routineDefinitionPayload(input: {
  routineId: string;
  currentVersion: number | null;
  versionId: string | null;
  plan: RoutinePlan;
  aslJson: unknown;
  markdownSummary: string;
  stepManifestJson: unknown;
}): RoutineDefinitionPayload {
  return {
    routineId: input.routineId,
    currentVersion: input.currentVersion,
    versionId: input.versionId,
    title: input.plan.title,
    description: input.plan.description,
    kind: input.plan.kind,
    aslJson: input.aslJson,
    markdownSummary: input.markdownSummary,
    stepManifestJson: input.stepManifestJson,
    steps: input.plan.steps,
  };
}
