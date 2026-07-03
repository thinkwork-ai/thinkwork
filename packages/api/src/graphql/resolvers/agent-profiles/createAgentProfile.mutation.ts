import type { GraphQLContext } from "../../context.js";
import { agentProfiles, db } from "../../utils.js";
import {
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
  normalizeProfileSlug,
  parseJsonInput,
  replaceAgentProfileSpaceAssignments,
  resolveAvailableCustomSlug,
  toAgentProfileGraphql,
} from "./shared.js";

interface AgentProfileInput {
  slug?: string | null;
  name: string;
  description?: string | null;
  routingGuidance?: string | null;
  instructions: string;
  modelId: string;
  enabled?: boolean | null;
  toolPolicy?: unknown;
  skillPolicy?: unknown;
  executionControls?: unknown;
  spaceIds?: string[] | null;
}

export async function createAgentProfile(
  _parent: unknown,
  args: { tenantId: string; input: AgentProfileInput },
  ctx: GraphQLContext,
) {
  await requireAdminOrServiceCaller(
    ctx,
    args.tenantId,
    "agent_profiles:create",
  );
  await ensureBuiltInAgentProfiles(args.tenantId);

  const input = args.input;
  // An explicit slug is honored as-is (collision is a clean user error); when
  // it's derived from the name we resolve to a free slug so a generic default
  // like "New Agent Profile" can be created repeatedly.
  let slug: string;
  if (input.slug) {
    slug = normalizeProfileSlug(input.slug);
    assertCustomProfileSlugAvailable(slug);
    const clash = await resolveAvailableCustomSlug(args.tenantId, slug);
    if (clash !== slug) {
      throw badInput(`An Agent Profile with slug "${slug}" already exists`);
    }
  } else {
    slug = await resolveAvailableCustomSlug(args.tenantId, input.name);
  }
  await assertAvailableModel(args.tenantId, input.modelId);
  const spaceIds = await assertSpacesBelongToTenant(
    args.tenantId,
    input.spaceIds,
  );
  const toolPolicy = (parseJsonInput(input.toolPolicy) ?? {}) as Record<
    string,
    unknown
  >;
  const skillPolicy = (parseJsonInput(input.skillPolicy) ?? {}) as Record<
    string,
    unknown
  >;
  const executionControls = normalizeExecutionControlsForStorage(
    parseJsonInput(input.executionControls) ?? {},
  );

  const [row] = await db
    .insert(agentProfiles)
    .values({
      tenant_id: args.tenantId,
      slug,
      name: input.name.trim(),
      description: input.description ?? null,
      routing_guidance: input.routingGuidance ?? null,
      instructions: input.instructions,
      model_id: input.modelId,
      enabled: input.enabled ?? true,
      built_in_key: null,
      tool_policy: toolPolicy,
      skill_policy: skillPolicy,
      execution_controls: executionControls,
      updated_at: new Date(),
    })
    .returning();

  await replaceAgentProfileSpaceAssignments({
    tenantId: args.tenantId,
    profileId: row.id,
    spaceIds,
  });

  await writeAgentProfileFileForTenant({
    tenantId: args.tenantId,
    slug,
    content: serializeAgentProfileFile({
      slug,
      name: input.name,
      description: input.description,
      routingGuidance: input.routingGuidance,
      instructions: input.instructions,
      modelId: input.modelId,
      enabled: input.enabled ?? true,
      toolPolicy,
      skillPolicy,
      executionControls,
      spaceIds,
    }),
  });

  return toAgentProfileGraphql(row);
}
