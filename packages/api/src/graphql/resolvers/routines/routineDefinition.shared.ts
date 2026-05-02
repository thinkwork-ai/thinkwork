import type {
  RoutineDefinitionField,
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
  steps: RoutinePlanStep[];
  editableFields: RoutineDefinitionField[];
}

export function routineDefinitionPayload(input: {
  routineId: string;
  currentVersion: number | null;
  versionId: string | null;
  plan: RoutinePlan;
}): RoutineDefinitionPayload {
  return {
    routineId: input.routineId,
    currentVersion: input.currentVersion,
    versionId: input.versionId,
    title: input.plan.title,
    description: input.plan.description,
    kind: input.plan.kind,
    steps: input.plan.steps,
    editableFields: input.plan.editableFields,
  };
}
