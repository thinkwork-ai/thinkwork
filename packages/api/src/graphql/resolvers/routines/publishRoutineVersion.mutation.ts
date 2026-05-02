/**
 * publishRoutineVersion (Plan 2026-05-01-005 §U7).
 *
 * Update the ASL on an existing step_functions routine, publish a new
 * version, and flip the `live` alias to point at it. Pipeline:
 *
 *   1. requireTenantAdmin BEFORE any side effect.
 *   2. Look up the routine; reject if engine != 'step_functions' or
 *      state_machine_arn is missing (legacy routines must migrate via
 *      createRoutine; we don't auto-promote).
 *   3. Validate the new ASL.
 *   4. UpdateStateMachine — sets the new definition on the latest
 *      $LATEST pseudo-version.
 *   5. PublishStateMachineVersion — snapshots $LATEST as version N+1.
 *   6. UpdateStateMachineAlias — flips `live` to point at version N+1.
 *   7. Insert new routine_asl_versions row + bump routines.current_version
 *      in a single transaction.
 */

import { and, eq } from "drizzle-orm";
import {
  routineAslVersions,
  routines,
} from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db, snakeToCamel } from "../../utils.js";
import { requireAdminOrApiKeyCaller } from "../core/authz.js";
import { validateRoutineAsl } from "../../../handlers/routine-asl-validator.js";
import {
  PublishStateMachineVersionCommand,
  ROUTINE_ALIAS_NAME,
  UpdateStateMachineAliasCommand,
  UpdateStateMachineCommand,
  getSfnClient,
} from "../../../lib/routines/sfn-client.js";

interface PublishRoutineVersionInput {
  routineId: string;
  asl: string;
  markdownSummary: string;
  stepManifest: string;
}

interface PublishableRoutine {
  id: string;
  tenant_id: string;
  engine: string | null;
  state_machine_arn: string | null;
  state_machine_alias_arn: string | null;
  current_version: number | null;
}

export interface RoutinePublishArtifacts {
  aslJson: unknown;
  markdownSummary: string;
  stepManifestJson: unknown;
}

export async function publishRoutineVersion(
  _parent: unknown,
  args: { input: PublishRoutineVersionInput },
  ctx: GraphQLContext,
): Promise<unknown> {
  const i = args.input;

  // Step 2 — load the routine first so we can run the admin gate against
  // its actual tenant_id (not a caller-supplied one).
  const [routine] = await db
    .select()
    .from(routines)
    .where(eq(routines.id, i.routineId));
  if (!routine) {
    throw new Error(`Routine ${i.routineId} not found`);
  }
  if (routine.engine !== "step_functions" || !routine.state_machine_arn) {
    throw new Error(
      `Routine ${i.routineId} is on the legacy_python engine; publishRoutineVersion only handles step_functions routines.`,
    );
  }

  // Step 1 — admin gate against the routine's own tenant. Apikey
  // callers (Phase C MCP wrappers) hit the per-agent allowlist for
  // `publish_routine_version`; Cognito callers fall through to the
  // existing tenant-admin role check.
  await requireAdminOrApiKeyCaller(
    ctx,
    routine.tenant_id,
    "publish_routine_version",
  );

  // Step 3 — validate.
  let aslJson: unknown;
  try {
    aslJson = JSON.parse(i.asl);
  } catch (err) {
    throw new Error(`asl is not valid JSON: ${(err as Error).message}`);
  }
  let stepManifestJson: unknown;
  try {
    stepManifestJson = JSON.parse(i.stepManifest);
  } catch (err) {
    throw new Error(`stepManifest is not valid JSON: ${(err as Error).message}`);
  }

  return publishRoutineArtifacts(
    i.routineId,
    routine,
    {
      aslJson,
      markdownSummary: i.markdownSummary,
      stepManifestJson,
    },
    ctx,
  );
}

export async function publishRoutineArtifacts(
  routineId: string,
  routine: PublishableRoutine,
  artifacts: RoutinePublishArtifacts,
  ctx: GraphQLContext,
): Promise<unknown> {
  const validation = await validateRoutineAsl({
    asl: artifacts.aslJson,
    currentRoutineId: routineId,
  });
  if (!validation.valid) {
    throw new Error(
      validation.errors.map((e) => e.message).join("\n") ||
        "ASL validation failed",
    );
  }

  // Step 4-6 — SFN: update definition, publish version, flip alias.
  const sfn = getSfnClient();
  const previousVersion = routine.current_version ?? 0;
  const stateMachineArn = routine.state_machine_arn;
  if (!stateMachineArn) {
    throw new Error(
      `Routine ${routineId} has engine='step_functions' but no state machine ARN — invariant violation.`,
    );
  }

  // Capture the *prior version ARN* the alias was pointing at so we have
  // usable rollback metadata. (The schema's `alias_was_pointing` column
  // means "the version_arn the live alias was pointing at before this
  // publish" — recording the alias ARN itself, as a prior version did,
  // would make rollback impossible because the alias has by then been
  // flipped.)
  const [priorVersionRow] = await db
    .select({ version_arn: routineAslVersions.version_arn })
    .from(routineAslVersions)
    .where(
      and(
        eq(routineAslVersions.routine_id, routineId),
        eq(routineAslVersions.version_number, previousVersion),
      ),
    );
  const previousAliasPointing = priorVersionRow?.version_arn ?? null;

  await sfn.send(
    new UpdateStateMachineCommand({
      stateMachineArn,
      definition: JSON.stringify(artifacts.aslJson),
    }),
  );
  const publishResp = await sfn.send(
    new PublishStateMachineVersionCommand({
      stateMachineArn,
      description: `v${previousVersion + 1}`,
    }),
  );
  if (!publishResp.stateMachineVersionArn) {
    throw new Error("PublishStateMachineVersion returned no version ARN");
  }
  if (!routine.state_machine_alias_arn) {
    throw new Error(
      `Routine ${routineId} has engine='step_functions' but no alias ARN — invariant violation.`,
    );
  }
  await sfn.send(
    new UpdateStateMachineAliasCommand({
      stateMachineAliasArn: routine.state_machine_alias_arn,
      routingConfiguration: [
        {
          stateMachineVersionArn: publishResp.stateMachineVersionArn,
          weight: 100,
        },
      ],
    }),
  );

  // Step 7 — DB writes in one transaction.
  const newVersionNumber = previousVersion + 1;
  const inserted = await db.transaction(async (tx) => {
    const [versionRow] = await tx
      .insert(routineAslVersions)
      .values({
        routine_id: routineId,
        tenant_id: routine.tenant_id,
        version_number: newVersionNumber,
        state_machine_arn: stateMachineArn,
        version_arn: publishResp.stateMachineVersionArn!,
        alias_was_pointing: previousAliasPointing,
        asl_json: artifacts.aslJson,
        markdown_summary: artifacts.markdownSummary,
        step_manifest_json: artifacts.stepManifestJson,
        validation_warnings_json:
          validation.warnings.length > 0 ? validation.warnings : null,
        published_by_actor_id: ctx.auth.principalId ?? null,
        published_by_actor_type: ctx.auth.authType ?? null,
      })
      .returning();
    await tx
      .update(routines)
      .set({
        current_version: newVersionNumber,
        documentation_md: artifacts.markdownSummary,
        updated_at: new Date(),
      })
      .where(eq(routines.id, routineId))
      .returning();
    return versionRow;
  });

  return snakeToCamel(inserted);
}
