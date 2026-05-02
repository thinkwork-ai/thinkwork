import type { GraphQLContext } from "../../context.js";
import { requireAdminOrApiKeyCaller } from "../core/authz.js";
import {
  applyRoutineDefinitionEdits,
  planRoutineFromIntent,
  type RoutineDefinitionStepConfigEdit,
  type RoutinePlanArtifacts,
} from "../../../lib/routines/routine-authoring-planner.js";

interface PlanRoutineDraftInput {
  tenantId: string;
  name: string;
  description?: string | null;
  steps?: RoutineDefinitionStepConfigEdit[] | null;
}

export async function planRoutineDraft(
  _parent: unknown,
  args: { input: PlanRoutineDraftInput },
  ctx: GraphQLContext,
): Promise<unknown> {
  const input = args.input;
  await requireAdminOrApiKeyCaller(ctx, input.tenantId, "create_routine");

  const planned = planRoutineFromIntent({
    name: input.name,
    intent: input.description ?? input.name,
  });
  if (!planned.ok) throw new Error(planned.reason);

  const edited =
    input.steps && input.steps.length > 0
      ? applyRoutineDefinitionEdits(planned.artifacts.plan, input.steps)
      : planned;
  if (!edited.ok) throw new Error(edited.reason);

  return routineDraftPayload(edited.artifacts);
}

function routineDraftPayload(artifacts: RoutinePlanArtifacts): unknown {
  return {
    title: artifacts.plan.title,
    description: artifacts.plan.description,
    kind: artifacts.plan.kind,
    steps: artifacts.plan.steps,
    asl: artifacts.asl,
    markdownSummary: artifacts.markdownSummary,
    stepManifest: artifacts.stepManifest,
  };
}
