import { and, eq } from "drizzle-orm";
import { routineAslVersions, routines } from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db } from "../../utils.js";
import { requireTenantMember } from "../core/authz.js";
import { routineDefinitionFromArtifacts } from "../../../lib/routines/routine-authoring-planner.js";
import { routineDefinitionPayload } from "./routineDefinition.shared.js";

export async function routineDefinition(
  _parent: unknown,
  args: { routineId: string },
  ctx: GraphQLContext,
): Promise<unknown> {
  const [routine] = await db
    .select()
    .from(routines)
    .where(eq(routines.id, args.routineId));
  if (!routine) return null;

  await requireTenantMember(ctx, routine.tenant_id);

  if (routine.engine !== "step_functions" || routine.current_version == null) {
    throw new Error(
      `Routine ${args.routineId} is not an editable Step Functions routine.`,
    );
  }

  const [version] = await db
    .select()
    .from(routineAslVersions)
    .where(
      and(
        eq(routineAslVersions.routine_id, args.routineId),
        eq(routineAslVersions.version_number, routine.current_version),
      ),
    );
  if (!version) {
    throw new Error(
      `Routine ${args.routineId} has no published ASL version ${routine.current_version}.`,
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

  return routineDefinitionPayload({
    routineId: args.routineId,
    currentVersion: routine.current_version,
    versionId: version.id,
    plan: definition.plan,
    aslJson: version.asl_json,
    markdownSummary: version.markdown_summary,
    stepManifestJson: version.step_manifest_json,
  });
}
