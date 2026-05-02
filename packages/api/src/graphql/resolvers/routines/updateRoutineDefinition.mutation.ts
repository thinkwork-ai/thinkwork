import { and, eq } from "drizzle-orm";
import { routineAslVersions, routines } from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db } from "../../utils.js";
import { requireAdminOrApiKeyCaller } from "../core/authz.js";
import {
  applyRoutineDefinitionEdits,
  routineDefinitionFromArtifacts,
  type RoutineDefinitionStepConfigEdit,
} from "../../../lib/routines/routine-authoring-planner.js";
import { publishRoutineArtifacts } from "./publishRoutineVersion.mutation.js";
import { routineDefinitionPayload } from "./routineDefinition.shared.js";

interface UpdateRoutineDefinitionInput {
  routineId: string;
  steps: RoutineDefinitionStepConfigEdit[];
}

export async function updateRoutineDefinition(
  _parent: unknown,
  args: { input: UpdateRoutineDefinitionInput },
  ctx: GraphQLContext,
): Promise<unknown> {
  const { routineId, steps } = args.input;
  const [routine] = await db
    .select()
    .from(routines)
    .where(eq(routines.id, routineId));
  if (!routine) {
    throw new Error(`Routine ${routineId} not found`);
  }
  if (routine.engine !== "step_functions" || !routine.state_machine_arn) {
    throw new Error(
      `Routine ${routineId} is not an editable Step Functions routine.`,
    );
  }

  await requireAdminOrApiKeyCaller(
    ctx,
    routine.tenant_id,
    "publish_routine_version",
  );

  const [version] = await db
    .select()
    .from(routineAslVersions)
    .where(
      and(
        eq(routineAslVersions.routine_id, routineId),
        eq(routineAslVersions.version_number, routine.current_version ?? 0),
      ),
    );
  if (!version) {
    throw new Error(
      `Routine ${routineId} has no published ASL version ${routine.current_version}.`,
    );
  }

  const definition = routineDefinitionFromArtifacts({
    routineName: routine.name,
    routineDescription: routine.description,
    stepManifestJson: version.step_manifest_json,
    aslJson: version.asl_json,
  });
  if (!definition.ok) {
    throw new Error(definition.reason);
  }

  const edited = applyRoutineDefinitionEdits(definition.plan, steps);
  if (!edited.ok) {
    throw new Error(edited.reason);
  }

  const published = (await publishRoutineArtifacts(
    routineId,
    routine,
    {
      aslJson: edited.artifacts.asl,
      markdownSummary: edited.artifacts.markdownSummary,
      stepManifestJson: edited.artifacts.stepManifest,
    },
    ctx,
    { description: edited.artifacts.plan.description },
  )) as { id?: string; version_number?: number; versionNumber?: number };

  return routineDefinitionPayload({
    routineId,
    currentVersion:
      published.versionNumber ??
      published.version_number ??
      (routine.current_version ?? 0) + 1,
    versionId: published.id ?? null,
    plan: edited.artifacts.plan,
  });
}
