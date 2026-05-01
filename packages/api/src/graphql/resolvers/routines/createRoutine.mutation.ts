/**
 * createRoutine (Plan 2026-05-01-005 §U7).
 *
 * Replaces the legacy DB-only resolver under `triggers/` with the live
 * Step Functions publish flow. The legacy version still ships through
 * Phase E (engine='legacy_python' rows continue to read out of the
 * `routines` table); this resolver is the new path for routines authored
 * in Phase B+.
 *
 * Pipeline:
 *   1. requireTenantAdmin BEFORE any side effect — legal/financial
 *      gating fires before AWS spends money.
 *   2. Validate ASL via the Phase A U5 validator (in-process).
 *   3. CreateStateMachine with tenantId/agentId/routineId tags +
 *      routines execution role.
 *   4. PublishStateMachineVersion → version 1.
 *   5. CreateStateMachineAlias `live` pointing at version 1.
 *   6. Insert routines row (engine='step_functions') + first
 *      routine_asl_versions row in a single transaction.
 *
 * Rollback: a failure between step 3 (state machine created) and step 6
 * (DB row inserted) leaves an orphan state machine. We log it; the
 * routines-stepfunctions module's drift reporter (Phase E) reaps
 * orphans. Inline cleanup would race with retries.
 */

import { randomUUID } from "node:crypto";
import {
  routineAslVersions,
  routines,
} from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db, snakeToCamel } from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";
import { validateRoutineAsl } from "../../../handlers/routine-asl-validator.js";
import {
  CreateStateMachineAliasCommand,
  CreateStateMachineCommand,
  PublishStateMachineVersionCommand,
  ROUTINE_ALIAS_NAME,
  getSfnClient,
  snapshotRoutinesEnv,
  stateMachineAliasArn,
  stateMachineArn,
  stateMachineName,
} from "../../../lib/routines/sfn-client.js";

interface CreateRoutineInput {
  tenantId: string;
  teamId?: string;
  agentId?: string;
  name: string;
  description?: string;
  asl: string;
  markdownSummary: string;
  stepManifest: string;
}

export async function createRoutine(
  _parent: unknown,
  args: { input: CreateRoutineInput },
  ctx: GraphQLContext,
): Promise<unknown> {
  const env = snapshotRoutinesEnv();
  const i = args.input;

  // Step 1 — admin gate before any AWS or DB side effect.
  await requireTenantAdmin(ctx, i.tenantId);

  // Step 2 — validate ASL.
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

  const validation = await validateRoutineAsl({ asl: aslJson });
  if (!validation.valid) {
    throw new Error(
      validation.errors.map((e) => e.message).join("\n") || "ASL validation failed",
    );
  }

  // Pre-allocate the routine id so the state machine name + alias ARN
  // can be computed BEFORE the DB row exists. The DB insert uses this
  // same id so resource and row stay in sync.
  const routineId = randomUUID();
  const smName = stateMachineName(env.stage, routineId);
  const smArn = stateMachineArn(env.region, env.accountId, env.stage, routineId);
  const smAliasArn = stateMachineAliasArn(
    env.region,
    env.accountId,
    env.stage,
    routineId,
  );

  // Step 3-5 — provision the state machine + first version + alias.
  const sfn = getSfnClient();
  await sfn.send(
    new CreateStateMachineCommand({
      name: smName,
      definition: JSON.stringify(aslJson),
      roleArn: env.routinesExecutionRoleArn,
      type: "STANDARD",
      tags: [
        { key: "tenantId", value: i.tenantId },
        { key: "routineId", value: routineId },
        ...(i.agentId ? [{ key: "agentId", value: i.agentId }] : []),
      ],
    }),
  );
  const publishResp = await sfn.send(
    new PublishStateMachineVersionCommand({
      stateMachineArn: smArn,
      description: "v1",
    }),
  );
  if (!publishResp.stateMachineVersionArn) {
    throw new Error("PublishStateMachineVersion returned no version ARN");
  }
  await sfn.send(
    new CreateStateMachineAliasCommand({
      name: ROUTINE_ALIAS_NAME,
      routingConfiguration: [
        {
          stateMachineVersionArn: publishResp.stateMachineVersionArn,
          weight: 100,
        },
      ],
    }),
  );

  // Step 6 — DB inserts in a single transaction.
  const inserted = await db.transaction(async (tx) => {
    const [routineRow] = await tx
      .insert(routines)
      .values({
        id: routineId,
        tenant_id: i.tenantId,
        team_id: i.teamId,
        agent_id: i.agentId,
        name: i.name,
        description: i.description,
        type: "scheduled",
        status: "active",
        engine: "step_functions",
        state_machine_arn: smArn,
        state_machine_alias_arn: smAliasArn,
        documentation_md: i.markdownSummary,
        current_version: 1,
      })
      .returning();
    await tx
      .insert(routineAslVersions)
      .values({
        routine_id: routineId,
        tenant_id: i.tenantId,
        version_number: 1,
        state_machine_arn: smArn,
        version_arn: publishResp.stateMachineVersionArn!,
        alias_was_pointing: null,
        asl_json: aslJson,
        markdown_summary: i.markdownSummary,
        step_manifest_json: stepManifestJson,
        validation_warnings_json:
          validation.warnings.length > 0 ? validation.warnings : null,
        published_by_actor_id: ctx.auth.principalId ?? null,
        published_by_actor_type: ctx.auth.authType ?? null,
      })
      .returning();
    return routineRow;
  });

  return snakeToCamel(inserted);
}
