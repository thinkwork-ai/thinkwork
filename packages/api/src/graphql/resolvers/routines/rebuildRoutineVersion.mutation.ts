/**
 * rebuildRoutineVersion.
 *
 * Re-author the current server-owned routine draft from persisted routine
 * metadata, then publish it through the same Step Functions + DB versioning
 * path as publishRoutineVersion. This is the product-owned replacement for
 * manually updating a state machine definition and retargeting the live alias.
 */

import { eq } from "drizzle-orm";
import { routines } from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db } from "../../utils.js";
import { requireAdminOrApiKeyCaller } from "../core/authz.js";
import { buildRoutineDraftFromIntent } from "../../../lib/routines/routine-draft-authoring.js";
import { publishRoutineArtifacts } from "./publishRoutineVersion.mutation.js";

interface RebuildRoutineVersionInput {
  routineId: string;
}

export async function rebuildRoutineVersion(
  _parent: unknown,
  args: { input: RebuildRoutineVersionInput },
  ctx: GraphQLContext,
): Promise<unknown> {
  const { routineId } = args.input;
  const [routine] = await db
    .select()
    .from(routines)
    .where(eq(routines.id, routineId));
  if (!routine) {
    throw new Error(`Routine ${routineId} not found`);
  }
  if (routine.engine !== "step_functions" || !routine.state_machine_arn) {
    throw new Error(
      `Routine ${routineId} is on the legacy_python engine; rebuildRoutineVersion only handles step_functions routines.`,
    );
  }

  await requireAdminOrApiKeyCaller(
    ctx,
    routine.tenant_id,
    "publish_routine_version",
  );

  const draft = buildRoutineDraftFromIntent({
    name: routine.name,
    intent: routine.description ?? routine.name,
  });
  if (!draft.ok) {
    throw new Error(draft.reason);
  }

  return publishRoutineArtifacts(
    routineId,
    routine,
    {
      aslJson: draft.artifacts.asl,
      markdownSummary: draft.artifacts.markdownSummary,
      stepManifestJson: draft.artifacts.stepManifest,
    },
    ctx,
  );
}
