import {
  DEFAULT_LOOP_POLICY,
  normalizeGoalSpec,
  normalizeLoopPolicy,
  normalizeRoutineActionsSpec,
  normalizeTargetSpec,
  normalizeTriggerSpec,
  normalizeWorkerSpec,
  targetSpecFromLegacy,
  type RoutineActionsSpec,
  type TargetSpec,
} from "@thinkwork/agent-loops-core";
import { and, desc, eq } from "drizzle-orm";
import type { GraphQLContext } from "../../context.js";
import { inArray } from "drizzle-orm";
import {
  agents,
  agentLoopVersions,
  agentLoops,
  db,
  generateSlug,
  routines,
  spaces,
} from "../../utils.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import { syncAgentLoopScheduleBinding } from "../../../lib/agent-loops/schedule-binding.js";
import { syncAgentLoopWebhookBinding } from "../../../lib/agent-loops/webhook-binding.js";
import {
  agentLoopRowToGraphql,
  parseAwsJsonObject,
  requireAgentLoopAdmin,
} from "./types.js";
import {
  normalizeAutomationDraft,
  promptFirstDraftNeedsDefaultWorker,
  type DefaultAutomationWorker,
} from "../../../lib/agent-loops/automation-draft.js";

type SaveAgentLoopInput = {
  id?: string | null;
  tenantId: string;
  name: string;
  slug?: string | null;
  description?: string | null;
  lifecycleStatus?: string | null;
  enabled?: boolean | null;
  ownerUserId?: string | null;
  ownerAgentId?: string | null;
  runAsUserId?: string | null;
  spaceId?: string | null;
  triggerSpec: unknown;
  goalSpec: unknown;
  workerSpec: unknown;
  targetSpec?: unknown;
  // Loop-policy is off the product surface (R11) — accepted and ignored. The
  // judge / evidence inputs were removed in THINK-137 U10.
  loopPolicy?: unknown;
  routineActionsSpec?: unknown;
  sourceMetadata?: unknown;
};

export async function saveAgentLoop(
  _parent: unknown,
  args: { input: SaveAgentLoopInput },
  ctx: GraphQLContext,
): Promise<unknown> {
  const input = args.input;
  await requireAgentLoopAdmin(ctx, input.tenantId, "save_agent_loop");

  const normalized = await normalizeSpecs(input);
  const actorId = await resolveCallerUserId(ctx);
  const spaceId =
    input.spaceId === undefined
      ? undefined
      : await resolveAgentLoopSpaceId(input.tenantId, input.spaceId);

  if (input.id) {
    return updateAgentLoop(input.id, input, normalized, actorId, spaceId);
  }
  return createAgentLoop(input, normalized, actorId, spaceId ?? null);
}

async function createAgentLoop(
  input: SaveAgentLoopInput,
  normalized: NormalizedAgentLoopSpecs,
  actorId: string | null,
  spaceId: string | null,
): Promise<unknown> {
  // R4: an agent_thread automation needs a home Space. Routine/workflow
  // targets save fine without one (they run headless).
  assertAgentThreadTargetHasSpace(normalized.targetSpec, spaceId);

  const [loop] = await db
    .insert(agentLoops)
    .values({
      tenant_id: input.tenantId,
      name: input.name.trim(),
      slug: normalizeSlug(input.slug ?? input.name),
      description: input.description ?? null,
      lifecycle_status: normalizeLifecycle(input.lifecycleStatus, "active"),
      enabled: input.enabled ?? true,
      owner_user_id: input.ownerUserId ?? actorId,
      owner_agent_id: input.ownerAgentId ?? null,
      run_as_user_id: input.runAsUserId ?? actorId,
      space_id: spaceId,
      primary_trigger_family: normalized.triggerSpec.family,
    })
    .returning();

  const [version] = await db
    .insert(agentLoopVersions)
    .values({
      tenant_id: input.tenantId,
      agent_loop_id: loop.id,
      version_number: 1,
      version_status: "active",
      trigger_spec: normalized.triggerSpec,
      goal_spec: normalized.goalSpec,
      worker_spec: normalized.workerSpec,
      target_spec: normalized.targetSpec,
      loop_policy: normalized.loopPolicy,
      routine_actions_spec: normalized.routineActionsSpec,
      source_metadata: normalized.sourceMetadata,
      created_by_actor_type: actorId ? "user" : "system",
      created_by_actor_id: actorId,
      published_at: new Date(),
    })
    .returning();

  await db
    .update(agentLoops)
    .set({
      current_version_id: version.id,
      current_version_number: version.version_number,
      updated_at: new Date(),
    })
    .where(eq(agentLoops.id, loop.id));

  await syncAgentLoopScheduleBinding({
    tenantId: input.tenantId,
    agentLoopId: loop.id,
    name: input.name.trim(),
    description: input.description ?? null,
    goalObjective: normalized.goalSpec.objective,
    workerAgentId: workerAgentId(normalized.workerSpec),
    spaceId,
    triggerSpec: normalized.triggerSpec,
    loopEnabled: input.enabled ?? true,
    actorId,
  });

  // R6: a webhook-trigger automation mints/links its inbound endpoint row.
  await syncAgentLoopWebhookBinding({
    tenantId: input.tenantId,
    agentLoopId: loop.id,
    name: input.name.trim(),
    triggerFamily: normalized.triggerSpec.family,
    loopEnabled: input.enabled ?? true,
    actorId,
  });

  return loadAgentLoop(loop.id);
}

async function updateAgentLoop(
  id: string,
  input: SaveAgentLoopInput,
  normalized: NormalizedAgentLoopSpecs,
  actorId: string | null,
  spaceId: string | null | undefined,
): Promise<unknown> {
  const [existing] = await db
    .select()
    .from(agentLoops)
    .where(eq(agentLoops.id, id))
    .limit(1);
  if (!existing) {
    throw new Error(`AgentLoop ${id} not found`);
  }
  if (existing.tenant_id !== input.tenantId) {
    throw new Error("AgentLoop does not belong to this tenant");
  }

  // R4: validate against the EFFECTIVE Space — an unchanged (undefined)
  // spaceId keeps the existing loop's Space.
  const effectiveSpaceId = spaceId === undefined ? existing.space_id : spaceId;
  assertAgentThreadTargetHasSpace(normalized.targetSpec, effectiveSpaceId);

  const currentVersion = existing.current_version_id
    ? await loadVersion(existing.current_version_id)
    : null;
  const specsChanged =
    !currentVersion || !versionSpecsEqual(currentVersion, normalized);

  let currentVersionId = existing.current_version_id;
  let currentVersionNumber = existing.current_version_number;

  if (specsChanged) {
    const nextNumber = await nextVersionNumber(existing.id);
    const [version] = await db
      .insert(agentLoopVersions)
      .values({
        tenant_id: input.tenantId,
        agent_loop_id: existing.id,
        version_number: nextNumber,
        version_status: "active",
        trigger_spec: normalized.triggerSpec,
        goal_spec: normalized.goalSpec,
        worker_spec: normalized.workerSpec,
        target_spec: normalized.targetSpec,
        loop_policy: normalized.loopPolicy,
        routine_actions_spec: normalized.routineActionsSpec,
        source_metadata: normalized.sourceMetadata,
        created_by_actor_type: actorId ? "user" : "system",
        created_by_actor_id: actorId,
        published_at: new Date(),
      })
      .returning();

    if (currentVersionId) {
      await db
        .update(agentLoopVersions)
        .set({ version_status: "superseded" })
        .where(eq(agentLoopVersions.id, currentVersionId));
    }
    currentVersionId = version.id;
    currentVersionNumber = version.version_number;
  }

  await db
    .update(agentLoops)
    .set({
      name: input.name.trim(),
      slug: input.slug ? normalizeSlug(input.slug) : existing.slug,
      description: input.description ?? null,
      lifecycle_status: normalizeLifecycle(
        input.lifecycleStatus,
        existing.lifecycle_status,
      ),
      enabled: input.enabled ?? existing.enabled,
      owner_user_id:
        input.ownerUserId === undefined
          ? existing.owner_user_id
          : input.ownerUserId,
      owner_agent_id:
        input.ownerAgentId === undefined
          ? existing.owner_agent_id
          : input.ownerAgentId,
      // R1: default run-as identity to the existing value, else the caller —
      // any save backfills run_as_user_id on pre-U3 loops.
      run_as_user_id: input.runAsUserId ?? existing.run_as_user_id ?? actorId,
      space_id: spaceId === undefined ? existing.space_id : spaceId,
      primary_trigger_family: normalized.triggerSpec.family,
      current_version_id: currentVersionId,
      current_version_number: currentVersionNumber,
      updated_at: new Date(),
    })
    .where(eq(agentLoops.id, existing.id));

  await syncAgentLoopScheduleBinding({
    tenantId: input.tenantId,
    agentLoopId: existing.id,
    name: input.name.trim(),
    description: input.description ?? null,
    goalObjective: normalized.goalSpec.objective,
    workerAgentId: workerAgentId(normalized.workerSpec),
    spaceId: spaceId === undefined ? existing.space_id : spaceId,
    triggerSpec: normalized.triggerSpec,
    loopEnabled: input.enabled ?? existing.enabled,
    actorId,
  });

  // R6: mint/link (or disable, on family switch) the inbound webhook endpoint.
  await syncAgentLoopWebhookBinding({
    tenantId: input.tenantId,
    agentLoopId: existing.id,
    name: input.name.trim(),
    triggerFamily: normalized.triggerSpec.family,
    loopEnabled: input.enabled ?? existing.enabled,
    actorId,
  });

  return loadAgentLoop(existing.id);
}

async function loadAgentLoop(id: string): Promise<unknown> {
  const [row] = await db
    .select()
    .from(agentLoops)
    .where(eq(agentLoops.id, id))
    .limit(1);
  if (!row) throw new Error(`AgentLoop ${id} not found after save`);
  return agentLoopRowToGraphql(row);
}

/**
 * R4 save-time guard (THINK-137 U4): an `agent_thread` target must have a
 * Space to run in. Routine/workflow targets are headless and save without one.
 */
function assertAgentThreadTargetHasSpace(
  targetSpec: TargetSpec,
  spaceId: string | null | undefined,
): void {
  if (targetSpec.kind === "agent_thread" && !spaceId) {
    throw new Error(
      "Agent-thread automations need a Space — pick one or switch to a routine/workflow target.",
    );
  }
}

async function resolveAgentLoopSpaceId(
  tenantId: string,
  spaceId: string | null,
): Promise<string | null> {
  if (!spaceId) return null;
  const [space] = await db
    .select({ id: spaces.id })
    .from(spaces)
    .where(
      and(
        eq(spaces.id, spaceId),
        eq(spaces.tenant_id, tenantId),
        eq(spaces.status, "active"),
      ),
    )
    .limit(1);
  if (!space) {
    throw new Error(
      "Automation Space is not active or does not belong to this tenant",
    );
  }
  return space.id;
}

async function loadVersion(id: string) {
  const [row] = await db
    .select()
    .from(agentLoopVersions)
    .where(eq(agentLoopVersions.id, id))
    .limit(1);
  return row ?? null;
}

async function nextVersionNumber(agentLoopId: string): Promise<number> {
  const [row] = await db
    .select({ version_number: agentLoopVersions.version_number })
    .from(agentLoopVersions)
    .where(eq(agentLoopVersions.agent_loop_id, agentLoopId))
    .orderBy(desc(agentLoopVersions.version_number))
    .limit(1);
  return (row?.version_number ?? 0) + 1;
}

interface NormalizedAgentLoopSpecs {
  triggerSpec: ReturnType<typeof normalizeTriggerSpec>;
  goalSpec: ReturnType<typeof normalizeGoalSpec>;
  workerSpec: ReturnType<typeof normalizeWorkerSpec>;
  targetSpec: TargetSpec;
  loopPolicy: ReturnType<typeof normalizeLoopPolicy>;
  routineActionsSpec: RoutineActionsSpec | null;
  sourceMetadata: Record<string, unknown>;
}

async function normalizeSpecs(
  input: SaveAgentLoopInput,
): Promise<NormalizedAgentLoopSpecs> {
  const triggerSpec = parseAwsJsonObject(input.triggerSpec);
  const goalSpec = parseAwsJsonObject(input.goalSpec);
  const workerSpec = parseAwsJsonObject(input.workerSpec);
  const sourceMetadata = parseAwsJsonObject(input.sourceMetadata);
  const defaultWorker = promptFirstDraftNeedsDefaultWorker({
    workerSpec,
    sourceMetadata,
  })
    ? await loadDefaultAutomationWorker(input.tenantId)
    : null;
  const draft = normalizeAutomationDraft({
    goalSpec,
    workerSpec,
    // Judge is off the product surface (R11); pass an empty spec so the draft
    // helper's goal/worker inference still runs without judge inference.
    judgeSpec: {},
    sourceMetadata,
    defaultWorker,
  });

  const routineActionsSpec = normalizeRoutineActionsSpec(
    input.routineActionsSpec,
  );
  if (routineActionsSpec) {
    await assertRoutineActionsValid(input.tenantId, routineActionsSpec);
  }

  const normalizedGoal = normalizeGoalSpec(draft.goalSpec);
  const normalizedWorker = normalizeWorkerSpec(draft.workerSpec);

  // R3: target_spec is authoritative. When the caller sends one, validate +
  // write it; otherwise derive it from the (still-written) legacy inputs so no
  // version row is ever created with a NULL target_spec.
  const targetSpec =
    input.targetSpec != null
      ? normalizeTargetSpec(parseAwsJsonObject(input.targetSpec))
      : targetSpecFromLegacy({
          goalSpec: normalizedGoal,
          workerSpec: normalizedWorker,
          routineActionsSpec,
        });

  return {
    triggerSpec: normalizeTriggerSpec(triggerSpec),
    goalSpec: normalizedGoal,
    workerSpec: normalizedWorker,
    targetSpec,
    loopPolicy: input.loopPolicy
      ? normalizeLoopPolicy(parseAwsJsonObject(input.loopPolicy))
      : DEFAULT_LOOP_POLICY,
    routineActionsSpec,
    sourceMetadata: draft.sourceMetadata,
  };
}

/** Reject dangling / ineligible routine refs at save time (U5): every
 * action must point at an enabled git_python routine in this tenant that
 * is usable — validated SHA already recorded, or fixtures declared so the
 * first run can gate it (R9). */
async function assertRoutineActionsValid(
  tenantId: string,
  spec: RoutineActionsSpec,
): Promise<void> {
  const ids = [...new Set(spec.actions.map((action) => action.routineId))];
  const rows = await db
    .select({
      id: routines.id,
      tenant_id: routines.tenant_id,
      engine: routines.engine,
      status: routines.status,
      validated_sha: routines.validated_sha,
      fixture_paths: routines.fixture_paths,
    })
    .from(routines)
    .where(inArray(routines.id, ids));
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const id of ids) {
    const row = byId.get(id);
    if (!row || row.tenant_id !== tenantId) {
      throw new Error(`Routine ${id} was not found in this tenant`);
    }
    if (row.engine !== "git_python") {
      throw new Error(
        `Routine ${id} is a ${row.engine} routine; routine actions require git_python`,
      );
    }
    if (row.status !== "active") {
      throw new Error(`Routine ${id} is ${row.status}, not active`);
    }
    const hasFixtures =
      Array.isArray(row.fixture_paths) && row.fixture_paths.length > 0;
    if (!row.validated_sha && !hasFixtures) {
      throw new Error(
        `Routine ${id} has no validated SHA and no fixtures — it cannot be attached to an Automation yet (R9)`,
      );
    }
  }
}

async function loadDefaultAutomationWorker(
  tenantId: string,
): Promise<DefaultAutomationWorker | null> {
  const [platformDefault] = await db
    .select({
      id: agents.id,
      label: agents.name,
    })
    .from(agents)
    .where(
      and(
        eq(agents.tenant_id, tenantId),
        eq(agents.type, "agent"),
        eq(agents.is_platform_default, true),
      ),
    )
    .limit(1);
  if (platformDefault) {
    return {
      type: "agent",
      id: platformDefault.id,
      label: platformDefault.label,
    };
  }

  const [fallback] = await db
    .select({
      id: agents.id,
      label: agents.name,
    })
    .from(agents)
    .where(and(eq(agents.tenant_id, tenantId), eq(agents.type, "agent")))
    .limit(1);
  return fallback
    ? { type: "agent", id: fallback.id, label: fallback.label }
    : null;
}

function versionSpecsEqual(
  version: {
    trigger_spec: unknown;
    goal_spec: unknown;
    worker_spec: unknown;
    target_spec?: unknown;
    loop_policy: unknown;
    routine_actions_spec?: unknown;
    source_metadata: unknown;
  },
  normalized: NormalizedAgentLoopSpecs,
): boolean {
  return (
    stableJson(version.trigger_spec) === stableJson(normalized.triggerSpec) &&
    stableJson(version.goal_spec) === stableJson(normalized.goalSpec) &&
    stableJson(version.worker_spec) === stableJson(normalized.workerSpec) &&
    stableJson(version.target_spec ?? null) ===
      stableJson(normalized.targetSpec) &&
    stableJson(version.loop_policy) === stableJson(normalized.loopPolicy) &&
    stableJson(version.routine_actions_spec ?? null) ===
      stableJson(normalized.routineActionsSpec) &&
    stableJson(version.source_metadata) ===
      stableJson(normalized.sourceMetadata)
  );
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function workerAgentId(workerSpec: {
  type: string;
  id: string;
}): string | null {
  return workerSpec.type === "agent" ? workerSpec.id : null;
}

function normalizeSlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || generateSlug();
}

function normalizeLifecycle(
  value: string | null | undefined,
  fallback: string,
): string {
  const normalized = value?.toLowerCase() ?? fallback;
  if (!["draft", "active", "paused", "archived"].includes(normalized)) {
    throw new Error(`Unsupported AgentLoop lifecycle status '${value}'`);
  }
  return normalized;
}
