import type { GraphQLContext } from "../../context.js";
import {
  agentProfiles,
  agentProfileSpaceAssignments,
  and,
  db,
  eq,
} from "../../utils.js";
import {
  deleteAgentProfileFileForTenant,
  serializeAgentProfileFile,
  writeAgentProfileFileForTenant,
} from "../../../lib/agent-profile-workspace-files.js";
import { normalizeExecutionControlsForStorage } from "../../../lib/agent-profile-loop-policy.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import {
  assertAvailableModel,
  assertCustomProfileSlugAvailable,
  assertSpacesBelongToTenant,
  badInput,
  ensureBuiltInAgentProfiles,
  loadAgentProfileRow,
  normalizeProfileSlug,
  parseJsonInput,
  replaceAgentProfileSpaceAssignments,
  toAgentProfileGraphql,
} from "./shared.js";

interface UpdateAgentProfileInput {
  slug?: string | null;
  name?: string | null;
  description?: string | null;
  routingGuidance?: string | null;
  instructions?: string | null;
  modelId?: string | null;
  enabled?: boolean | null;
  toolPolicy?: unknown;
  skillPolicy?: unknown;
  executionControls?: unknown;
  spaceIds?: string[] | null;
}

export async function updateAgentProfile(
  _parent: unknown,
  args: { tenantId: string; id: string; input: UpdateAgentProfileInput },
  ctx: GraphQLContext,
) {
  await requireAdminOrServiceCaller(
    ctx,
    args.tenantId,
    "agent_profiles:update",
  );
  await ensureBuiltInAgentProfiles(args.tenantId);

  const existing = await loadAgentProfileRow(args.tenantId, args.id);
  // Space-local rows (source_space_id set) are projections of a Space's
  // workspace files. Updating one here would write the profile file into the
  // CENTRAL agent source (agents/<slug>.md), minting a phantom central
  // profile via the put hook.
  if (existing.source_space_id != null) {
    throw badInput(
      "Space-local Agent Profiles are managed from their Space's workspace files (Settings → Spaces → the owning Space → Workspace files)",
    );
  }
  const input = args.input ?? {};
  const updates: Record<string, unknown> = { updated_at: new Date() };

  if (input.slug !== undefined) {
    if (existing.built_in_key) {
      throw badInput("Built-in Agent Profile slug cannot be changed");
    }
    const slug = normalizeProfileSlug(input.slug ?? "");
    assertCustomProfileSlugAvailable(slug);
    updates.slug = slug;
  }
  if (input.name !== undefined) updates.name = input.name;
  if (input.description !== undefined) updates.description = input.description;
  if (input.routingGuidance !== undefined) {
    updates.routing_guidance = input.routingGuidance;
  }
  if (input.instructions !== undefined)
    updates.instructions = input.instructions;
  if (input.modelId !== undefined) {
    if (!input.modelId) throw badInput("Model is required");
    await assertAvailableModel(args.tenantId, input.modelId);
    updates.model_id = input.modelId;
  }
  if (input.enabled !== undefined) updates.enabled = input.enabled ?? true;
  if (input.toolPolicy !== undefined) {
    updates.tool_policy = parseJsonInput(input.toolPolicy) ?? {};
  }
  if (input.skillPolicy !== undefined) {
    updates.skill_policy = parseJsonInput(input.skillPolicy) ?? {};
  }
  if (input.executionControls !== undefined) {
    updates.execution_controls = normalizeExecutionControlsForStorage(
      parseJsonInput(input.executionControls) ?? {},
    );
  }

  let spaceIds: string[] | undefined;
  if (input.spaceIds !== undefined) {
    spaceIds = await assertSpacesBelongToTenant(args.tenantId, input.spaceIds);
  }
  const effectiveSpaceIds =
    spaceIds ?? (await loadAgentProfileSpaceIds(args.id));

  const [row] = await db
    .update(agentProfiles)
    .set(updates)
    .where(
      and(
        eq(agentProfiles.tenant_id, args.tenantId),
        eq(agentProfiles.id, args.id),
      ),
    )
    .returning();

  if (spaceIds) {
    await replaceAgentProfileSpaceAssignments({
      tenantId: args.tenantId,
      profileId: args.id,
      spaceIds,
    });
  }

  const finalSlug = String(row.slug);
  if (String(existing.slug) !== finalSlug) {
    await deleteAgentProfileFileForTenant({
      tenantId: args.tenantId,
      slug: String(existing.slug),
    });
  }
  await writeAgentProfileFileForTenant({
    tenantId: args.tenantId,
    slug: finalSlug,
    content: serializeAgentProfileFile({
      slug: finalSlug,
      name: String(row.name),
      description: nullableString(row.description),
      routingGuidance: nullableString(row.routing_guidance),
      instructions: String(row.instructions ?? ""),
      modelId: String(row.model_id),
      enabled: row.enabled !== false,
      builtInKey: nullableString(row.built_in_key),
      toolPolicy: row.tool_policy ?? {},
      skillPolicy: row.skill_policy ?? {},
      executionControls: row.execution_controls ?? {},
      spaceIds: effectiveSpaceIds,
    }),
  });

  return toAgentProfileGraphql(row);
}

async function loadAgentProfileSpaceIds(profileId: string): Promise<string[]> {
  const rows = await db
    .select({ spaceId: agentProfileSpaceAssignments.space_id })
    .from(agentProfileSpaceAssignments)
    .where(eq(agentProfileSpaceAssignments.profile_id, profileId));
  return rows.map((row) => row.spaceId);
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
