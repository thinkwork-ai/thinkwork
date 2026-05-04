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
import { routineAslVersions, routines } from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db, snakeToCamel } from "../../utils.js";
import { requireAdminOrApiKeyCaller } from "../core/authz.js";
import { validateRoutineAsl } from "../../../handlers/routine-asl-validator.js";
import { prepareRoutineCredentialArtifacts } from "../../../lib/routines/credential-bindings.js";
import { buildRoutineDraftFromIntent } from "../../../lib/routines/routine-draft-authoring.js";
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
  /** Visibility (schema follow-up bundle). Defaults to 'agent_private'
   * when owningAgentId resolves to non-null, 'tenant_shared' otherwise. */
  visibility?: "agent_private" | "tenant_shared";
  /** Owning agent (schema follow-up bundle). Splits the conflated
   * agentId field — agentId stays as the primary execution agent. The
   * MCP create_routine tool stamps owningAgentId = caller agent id. */
  owningAgentId?: string;
  name: string;
  description?: string;
  asl?: unknown;
  markdownSummary?: string;
  stepManifest?: unknown;
}

export async function createRoutine(
  _parent: unknown,
  args: { input: CreateRoutineInput },
  ctx: GraphQLContext,
): Promise<unknown> {
  const env = snapshotRoutinesEnv();
  const i = args.input;

  // Step 1 — admin gate before any AWS or DB side effect. Apikey callers
  // (Phase C MCP wrappers) go through requireAgentAllowsOperation per the
  // per-agent operation allowlist; Cognito callers fall through to the
  // existing tenant-admin role check.
  await requireAdminOrApiKeyCaller(ctx, i.tenantId, "create_routine");

  // Step 2 — build or validate ASL artifacts. Explicit artifacts remain
  // the path for chat/agent authoring. Intent-only clients go through the
  // deterministic MVP composer so we never create active no-op routines.
  let aslJson: unknown;
  let stepManifestJson: unknown;
  let markdownSummary = i.markdownSummary;
  const hasExplicitArtifacts =
    i.asl !== undefined ||
    i.markdownSummary !== undefined ||
    i.stepManifest !== undefined;
  const hasAllExplicitArtifacts =
    i.asl !== undefined &&
    i.markdownSummary !== undefined &&
    i.stepManifest !== undefined;

  if (hasExplicitArtifacts && !hasAllExplicitArtifacts) {
    throw new Error(
      "createRoutine requires either all ASL artifacts (asl, markdownSummary, stepManifest) or none of them so server-side authoring can run.",
    );
  }

  if (hasAllExplicitArtifacts) {
    aslJson = parseAwsJsonInput(i.asl!, "asl");
    stepManifestJson = parseAwsJsonInput(i.stepManifest!, "stepManifest");
  } else {
    const draft = buildRoutineDraftFromIntent({
      name: i.name,
      intent: i.description ?? i.name,
    });
    if (!draft.ok) {
      throw new Error(draft.reason);
    }
    aslJson = draft.artifacts.asl;
    stepManifestJson = draft.artifacts.stepManifest;
    markdownSummary = draft.artifacts.markdownSummary;
  }

  const prepared = await prepareRoutineCredentialArtifacts({
    tenantId: i.tenantId,
    artifacts: {
      aslJson,
      markdownSummary: markdownSummary!,
      stepManifestJson,
    },
  });
  aslJson = prepared.artifacts.aslJson;
  stepManifestJson = prepared.artifacts.stepManifestJson;
  markdownSummary = prepared.artifacts.markdownSummary;

  const validation = await validateRoutineAsl({ asl: aslJson });
  if (!validation.valid) {
    throw new Error(
      validation.errors.map((e) => e.message).join("\n") ||
        "ASL validation failed",
    );
  }

  // Pre-allocate the routine id so the state machine name + alias ARN
  // can be computed BEFORE the DB row exists. The DB insert uses this
  // same id so resource and row stay in sync.
  const routineId = randomUUID();
  const smName = stateMachineName(env.stage, routineId);
  const smArn = stateMachineArn(
    env.region,
    env.accountId,
    env.stage,
    routineId,
  );
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
    // Visibility default: when caller supplied owningAgentId, default
    // to agent_private; otherwise tenant_shared. Caller can override
    // explicitly with `visibility`. Mirrors the migration backfill rule
    // so old rows + new rows resolve to the same shape.
    const owning_agent_id = i.owningAgentId ?? null;
    const visibility =
      i.visibility ?? (owning_agent_id ? "agent_private" : "tenant_shared");

    const [routineRow] = await tx
      .insert(routines)
      .values({
        id: routineId,
        tenant_id: i.tenantId,
        team_id: i.teamId,
        agent_id: i.agentId,
        owning_agent_id,
        visibility,
        name: i.name,
        description: i.description,
        type: "scheduled",
        status: "active",
        engine: "step_functions",
        state_machine_arn: smArn,
        state_machine_alias_arn: smAliasArn,
        documentation_md: markdownSummary!,
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
        markdown_summary: markdownSummary!,
        step_manifest_json: stepManifestJson,
        validation_warnings_json:
          validation.warnings.length > 0 || prepared.warnings.length > 0
            ? [...validation.warnings, ...prepared.warnings]
            : null,
        published_by_actor_id: ctx.auth.principalId ?? null,
        published_by_actor_type: ctx.auth.authType ?? null,
      })
      .returning();
    return routineRow;
  });

  return snakeToCamel(inserted);
}

function parseAwsJsonInput(value: unknown, label: string): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch (err) {
    throw new Error(`${label} is not valid JSON: ${(err as Error).message}`);
  }
}
