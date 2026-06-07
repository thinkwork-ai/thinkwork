import type { GraphQLContext } from "../../context.js";
import { agentProfiles, and, db, eq } from "../../utils.js";
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
    await assertAvailableModel(input.modelId);
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
    updates.execution_controls = parseJsonInput(input.executionControls) ?? {};
  }

  let spaceIds: string[] | undefined;
  if (input.spaceIds !== undefined) {
    spaceIds = await assertSpacesBelongToTenant(args.tenantId, input.spaceIds);
  }

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

  return toAgentProfileGraphql(row);
}
