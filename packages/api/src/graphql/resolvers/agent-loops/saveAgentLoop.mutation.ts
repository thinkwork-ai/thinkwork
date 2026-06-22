import {
  DEFAULT_LOOP_POLICY,
  normalizeGoalSpec,
  normalizeJudgeSpec,
  normalizeLoopPolicy,
  normalizeTriggerSpec,
  normalizeWorkerSpec,
  type EvidencePolicy,
} from "@thinkwork/agent-loops-core";
import { and, desc, eq } from "drizzle-orm";
import type { GraphQLContext } from "../../context.js";
import {
  agentLoopVersions,
  agentLoops,
  db,
  generateSlug,
} from "../../utils.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import { syncAgentLoopScheduleBinding } from "../../../lib/agent-loops/schedule-binding.js";
import {
  agentLoopRowToGraphql,
  parseAwsJsonObject,
  requireAgentLoopAdmin,
} from "./types.js";

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
  triggerSpec: unknown;
  goalSpec: unknown;
  workerSpec: unknown;
  judgeSpec: unknown;
  loopPolicy?: unknown;
  evidencePolicy?: unknown;
  sourceMetadata?: unknown;
};

export async function saveAgentLoop(
  _parent: unknown,
  args: { input: SaveAgentLoopInput },
  ctx: GraphQLContext,
): Promise<unknown> {
  const input = args.input;
  await requireAgentLoopAdmin(ctx, input.tenantId, "save_agent_loop");

  const normalized = normalizeSpecs(input);
  const actorId = await resolveCallerUserId(ctx);

  if (input.id) {
    return updateAgentLoop(input.id, input, normalized, actorId);
  }
  return createAgentLoop(input, normalized, actorId);
}

async function createAgentLoop(
  input: SaveAgentLoopInput,
  normalized: NormalizedAgentLoopSpecs,
  actorId: string | null,
): Promise<unknown> {
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
      judge_spec: normalized.judgeSpec,
      loop_policy: normalized.loopPolicy,
      evidence_policy: normalized.evidencePolicy,
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
    triggerSpec: normalized.triggerSpec,
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
        judge_spec: normalized.judgeSpec,
        loop_policy: normalized.loopPolicy,
        evidence_policy: normalized.evidencePolicy,
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
    triggerSpec: normalized.triggerSpec,
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
  judgeSpec: ReturnType<typeof normalizeJudgeSpec>;
  loopPolicy: ReturnType<typeof normalizeLoopPolicy>;
  evidencePolicy: EvidencePolicy;
  sourceMetadata: Record<string, unknown>;
}

function normalizeSpecs(input: SaveAgentLoopInput): NormalizedAgentLoopSpecs {
  return {
    triggerSpec: normalizeTriggerSpec(parseAwsJsonObject(input.triggerSpec)),
    goalSpec: normalizeGoalSpec(parseAwsJsonObject(input.goalSpec)),
    workerSpec: normalizeWorkerSpec(parseAwsJsonObject(input.workerSpec)),
    judgeSpec: normalizeJudgeSpec(parseAwsJsonObject(input.judgeSpec)),
    loopPolicy: input.loopPolicy
      ? normalizeLoopPolicy(parseAwsJsonObject(input.loopPolicy))
      : DEFAULT_LOOP_POLICY,
    evidencePolicy: normalizeEvidencePolicy(input.evidencePolicy),
    sourceMetadata: parseAwsJsonObject(input.sourceMetadata),
  };
}

function normalizeEvidencePolicy(value: unknown): EvidencePolicy {
  const source = parseAwsJsonObject(value);
  const redactionState =
    typeof source.redactionState === "string"
      ? source.redactionState
      : "summary_only";
  if (
    !["summary_only", "redacted", "offloaded", "raw_allowed"].includes(
      redactionState,
    )
  ) {
    throw new Error(`Unsupported evidence redaction state '${redactionState}'`);
  }
  return {
    redactionState: redactionState as EvidencePolicy["redactionState"],
    retainRawEvidence: source.retainRawEvidence === true,
    retentionDays:
      typeof source.retentionDays === "number"
        ? source.retentionDays
        : undefined,
  };
}

function versionSpecsEqual(
  version: {
    trigger_spec: unknown;
    goal_spec: unknown;
    worker_spec: unknown;
    judge_spec: unknown;
    loop_policy: unknown;
    evidence_policy: unknown;
    source_metadata: unknown;
  },
  normalized: NormalizedAgentLoopSpecs,
): boolean {
  return (
    stableJson(version.trigger_spec) === stableJson(normalized.triggerSpec) &&
    stableJson(version.goal_spec) === stableJson(normalized.goalSpec) &&
    stableJson(version.worker_spec) === stableJson(normalized.workerSpec) &&
    stableJson(version.judge_spec) === stableJson(normalized.judgeSpec) &&
    stableJson(version.loop_policy) === stableJson(normalized.loopPolicy) &&
    stableJson(version.evidence_policy) ===
      stableJson(normalized.evidencePolicy) &&
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
