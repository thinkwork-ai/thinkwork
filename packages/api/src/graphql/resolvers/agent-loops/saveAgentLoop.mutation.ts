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
import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { inArray } from "drizzle-orm";
import {
  agents,
  agentLoopVersions,
  agentLoops,
  db,
  generateSlug,
  memoryProcessorConfigs,
  routines,
  spaces,
} from "../../utils.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import {
  disableAgentLoopScheduleBinding,
  syncAgentLoopScheduleBinding,
} from "../../../lib/agent-loops/schedule-binding.js";
import { syncReportAutomationConvergence } from "../../../lib/agent-loops/report-convergence.js";
import { syncAgentLoopWebhookBinding } from "../../../lib/agent-loops/webhook-binding.js";
import { agentLoopRowToGraphql, parseAwsJsonObject } from "./types.js";
import type { AgentLoopAccessScope } from "./types.js";
import { requireAgentLoopWriteAccess } from "./write-access.js";
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
  args: { input: SaveAgentLoopInput; scope?: AgentLoopAccessScope | null },
  ctx: GraphQLContext,
): Promise<unknown> {
  const input = args.input;
  let normalized: NormalizedAgentLoopSpecs;
  try {
    normalized = await normalizeSpecs(input);
  } catch (err) {
    if (err instanceof GraphQLError) throw err;
    // Contract validation throws bare Errors, which Yoga masks to
    // "Unexpected error." — useless to the web editor and fatal to
    // conversational callers that need the message to self-correct
    // (THINK-246). Spec-shape problems are user input by definition.
    throw new GraphQLError(err instanceof Error ? err.message : String(err), {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  const actorId = await resolveCallerUserId(ctx);

  // THINK-227 U11 (KTD10): role-split write access — admins keep general
  // CRUD; members pass only for member-scoped automations (own, self
  // run-as, self-recipient delivery, readable bound artifact). Replaces the
  // bare requireAgentLoopAdmin gate.
  const existingIdentities = input.id
    ? await loadExistingLoopIdentities(input.id, input.tenantId)
    : null;
  await requireAgentLoopWriteAccess(ctx, input.tenantId, {
    operationName: "save_agent_loop",
    actorId,
    accessScope: args.scope ?? "USER",
    submittedOwnerUserId: input.ownerUserId,
    submittedRunAsUserId: input.runAsUserId,
    targetSpec: normalized.targetSpec,
    existing: existingIdentities,
  });

  const spaceId =
    input.spaceId === undefined
      ? undefined
      : await resolveAgentLoopSpaceId(input.tenantId, input.spaceId);

  // Create-mode document bindings carry the Space the document will live
  // in — resolve slug/name references the same way the automation's own
  // Space is resolved.
  const binding = normalized.targetSpec?.documentBinding;
  if (binding?.spaceId) {
    binding.spaceId =
      (await resolveAgentLoopSpaceId(input.tenantId, binding.spaceId)) ??
      binding.spaceId;
  }

  if (input.id) {
    return updateAgentLoop(input.id, input, normalized, actorId, spaceId);
  }
  return createAgentLoop(input, normalized, actorId, spaceId ?? null);
}

async function loadExistingLoopIdentities(
  id: string,
  tenantId: string,
): Promise<{ ownerUserId: string | null; runAsUserId: string | null }> {
  const [row] = await db
    .select({
      owner_user_id: agentLoops.owner_user_id,
      run_as_user_id: agentLoops.run_as_user_id,
      tenant_id: agentLoops.tenant_id,
    })
    .from(agentLoops)
    .where(eq(agentLoops.id, id))
    .limit(1);
  if (!row) throw new Error(`AgentLoop ${id} not found`);
  if (row.tenant_id !== tenantId) {
    throw new Error("AgentLoop does not belong to this tenant");
  }
  return {
    ownerUserId: row.owner_user_id ?? null,
    runAsUserId: row.run_as_user_id ?? null,
  };
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
      // THINK-159: goal_spec/worker_spec/loop_policy are no longer written —
      // target_spec is the sole dispatch source. The columns are nullable
      // (migration 0215) and dropped in the follow-up PR.
      target_spec: normalized.targetSpec,
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

  // THINK-227 U13: a report-shaped automation (agent turn + document binding)
  // is born converged — its schedule rides the linked workflow, not the
  // legacy agent_loop_schedule binding.
  const converged = await syncReportAutomationConvergence({
    tenantId: input.tenantId,
    loop: {
      id: loop.id,
      name: input.name.trim(),
      description: input.description,
      ownerUserId: loop.owner_user_id ?? null,
      ownerAgentId: loop.owner_agent_id ?? null,
    },
    version: {
      id: version.id,
      routineActionsSpec: normalized.routineActionsSpec,
      targetSpec: normalized.targetSpec,
    },
    triggerSpec: normalized.triggerSpec,
    loopEnabled: input.enabled ?? true,
    actorId,
  });
  if (converged) {
    await disableAgentLoopScheduleBinding(input.tenantId, loop.id);
  } else {
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
  }

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

  // THINK-264: a built-in Automation's definition is code-owned (the memory
  // blueprint), so there is nothing here to version. The only writable field
  // is the off-switch, and it belongs to the processor — writing it on the
  // loop alone would show "disabled" while the pipeline kept running.
  if (existing.kind === "system") {
    if (input.enabled === undefined || input.enabled === null) {
      throw new Error(
        `"${existing.name}" is a built-in automation — only its enabled state can be changed.`,
      );
    }
    return setSystemAgentLoopEnabled(existing, input.enabled);
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
        // THINK-159: goal_spec/worker_spec/loop_policy no longer written.
        target_spec: normalized.targetSpec,
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

  // THINK-227 U13: report-shaped saves converge (workflow upsert + publish +
  // workflow_schedule sync); everything else keeps the legacy binding.
  const converged = currentVersionId
    ? await syncReportAutomationConvergence({
        tenantId: input.tenantId,
        loop: {
          id: existing.id,
          name: input.name.trim(),
          description: input.description,
          ownerUserId:
            input.ownerUserId === undefined
              ? (existing.owner_user_id ?? null)
              : input.ownerUserId,
          ownerAgentId:
            input.ownerAgentId === undefined
              ? (existing.owner_agent_id ?? null)
              : input.ownerAgentId,
        },
        version: {
          id: currentVersionId,
          routineActionsSpec: normalized.routineActionsSpec,
          targetSpec: normalized.targetSpec,
        },
        triggerSpec: normalized.triggerSpec,
        loopEnabled: input.enabled ?? existing.enabled,
        actorId,
      })
    : null;
  if (converged) {
    await disableAgentLoopScheduleBinding(input.tenantId, existing.id);
  } else {
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
  }

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

/**
 * Enable/disable a built-in Automation (THINK-264).
 *
 * The row the inventory renders is a mirror; the processor is the thing that
 * actually gates work. Write the processor first so a failure leaves the UI
 * saying "enabled" while processing is on — never the reverse (a row that
 * reads "disabled" while the pipeline keeps ingesting is the dangerous
 * direction for a memory automation).
 */
async function setSystemAgentLoopEnabled(
  existing: typeof agentLoops.$inferSelect,
  enabled: boolean,
): Promise<unknown> {
  if (existing.system_key === "personal-memory") {
    if (!existing.owner_user_id) {
      throw new Error("Built-in memory automation has no owner");
    }
    await db
      .update(memoryProcessorConfigs)
      .set({ enabled, updated_at: new Date() })
      .where(
        and(
          eq(memoryProcessorConfigs.tenant_id, existing.tenant_id),
          eq(memoryProcessorConfigs.mode, "personal"),
          eq(memoryProcessorConfigs.target_scope, "user"),
          eq(memoryProcessorConfigs.target_id, existing.owner_user_id),
          eq(memoryProcessorConfigs.status, "active"),
        ),
      );
  }

  await db
    .update(agentLoops)
    .set({ enabled, updated_at: new Date() })
    .where(eq(agentLoops.id, existing.id));

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
    throw new GraphQLError(
      "Agent-thread automations need a Space — pick one or switch to a routine/workflow target.",
      { extensions: { code: "BAD_USER_INPUT" } },
    );
  }
}

/**
 * Resolve a Space reference by UUID, slug, or name (case-insensitive).
 * Conversational callers routinely pass the slug ("general") where the
 * column wants the UUID — observed live on TEI (THINK-246 acceptance),
 * where the miss surfaced as a masked "Unexpected error" the agent could
 * not self-correct from. Resolution lives HERE (not the tool layer) so
 * every save path gets it, and a miss names the tenant's actual Spaces.
 * Matching happens in JS over the tenant's active catalog, so a non-UUID
 * reference never reaches the uuid column in SQL.
 */
export async function resolveAgentLoopSpaceId(
  tenantId: string,
  spaceId: string | null,
): Promise<string | null> {
  if (!spaceId) return null;
  const wanted = spaceId.trim();
  const active = await db
    .select({ id: spaces.id, name: spaces.name, slug: spaces.slug })
    .from(spaces)
    .where(and(eq(spaces.tenant_id, tenantId), eq(spaces.status, "active")));
  const lowered = wanted.toLowerCase();
  const match =
    active.find((space) => space.id === wanted) ??
    active.find((space) => space.slug?.toLowerCase() === lowered) ??
    active.find((space) => space.name?.toLowerCase() === lowered);
  if (!match) {
    const catalog = active
      .map(
        (space) =>
          `${space.name} (slug: ${space.slug ?? "-"}, id: ${space.id})`,
      )
      .join("; ");
    // GraphQLError (not bare Error) so Yoga doesn't mask it.
    throw new GraphQLError(
      `Automation Space '${wanted}' does not match any active Space in this tenant. ` +
        (catalog
          ? `Available Spaces: ${catalog}. Pass one of these ids or slugs.`
          : "This tenant has no active Spaces — create one first."),
      { extensions: { code: "BAD_USER_INPUT" } },
    );
  }
  return match.id;
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

  // THINK-227 U10: conversational creates (admin-ops MCP) supply an explicit
  // targetSpec but no worker — backfill the inferred default worker so an
  // agent_thread dispatch always has an agent to wake.
  if (
    targetSpec.kind === "agent_thread" &&
    targetSpec.agentThread &&
    !targetSpec.agentThread.workerId &&
    normalizedWorker.id
  ) {
    targetSpec.agentThread.workerId = normalizedWorker.id;
    targetSpec.agentThread.workerType = normalizedWorker.type;
  }

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
    target_spec?: unknown;
    routine_actions_spec?: unknown;
    source_metadata: unknown;
  },
  normalized: NormalizedAgentLoopSpecs,
): boolean {
  // THINK-159: goal_spec/worker_spec/loop_policy are no longer written, so the
  // dirty-diff compares only the live spec columns. target_spec is the
  // authoritative dispatch source; trigger/routineActions/sourceMetadata round
  // out the version identity.
  return (
    stableJson(version.trigger_spec) === stableJson(normalized.triggerSpec) &&
    stableJson(version.target_spec ?? null) ===
      stableJson(normalized.targetSpec) &&
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
