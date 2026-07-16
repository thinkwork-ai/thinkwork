import type { GraphQLContext } from "../../context.js";
import {
  deleteAgentProfileFileForTenant,
  deleteAgentProfileFolderInstructionsForTenant,
  getAgentFolderProfileForTenant,
  writeAgentProfileFolderForTenant,
} from "../../../lib/agent-profile-workspace-files.js";
import { normalizeExecutionControlsForStorage } from "../../../lib/agent-profile-loop-policy.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import {
  assertAvailableModel,
  assertCustomProfileSlugAvailable,
  badInput,
  folderProfileToGraphql,
  normalizeProfileSlug,
  notFound,
  parseJsonInput,
} from "./shared.js";
import { BUILT_IN_AGENT_PROFILE_KEYS } from "./built-in-agent-profiles.js";

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

/**
 * Update a sub-agent (subagent-folders U11): folder-write only. The
 * current state is read from `agents/<slug>/INSTRUCTIONS.md`, the input
 * patch is applied, and the folder file is rewritten (the next render
 * recompiles the manifest). Renames delete the old folder file plus the
 * legacy `agents/<slug>.md` form (delete-on-write). `spaceIds` and
 * `skillPolicy` are ignored — see createAgentProfile.
 */
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

  const currentSlug = normalizeProfileSlug(args.id);
  const existing = await getAgentFolderProfileForTenant(
    args.tenantId,
    currentSlug,
  );
  if (!existing) throw notFound("Agent Profile not found");
  const config = existing.config;
  const isBuiltIn = (BUILT_IN_AGENT_PROFILE_KEYS as readonly string[]).includes(
    currentSlug,
  );

  const input = args.input ?? {};
  let finalSlug = currentSlug;
  if (input.slug !== undefined) {
    if (isBuiltIn) {
      throw badInput("Built-in Agent Profile slug cannot be changed");
    }
    const slug = normalizeProfileSlug(input.slug ?? "");
    assertCustomProfileSlugAvailable(slug);
    if (slug !== currentSlug) {
      const clash = await getAgentFolderProfileForTenant(args.tenantId, slug);
      if (clash) {
        throw badInput(`An Agent Profile with slug "${slug}" already exists`);
      }
      finalSlug = slug;
    }
  }

  let modelId = config.model ?? null;
  if (input.modelId !== undefined) {
    if (!input.modelId) throw badInput("Model is required");
    await assertAvailableModel(args.tenantId, input.modelId);
    modelId = input.modelId;
  }

  // The folder format has a single `description` field; incoming
  // description/routingGuidance merge through the serializer exactly like
  // the create path. When neither is provided the existing (already
  // merged) description carries forward.
  const descriptionProvided =
    input.description !== undefined || input.routingGuidance !== undefined;
  const description = descriptionProvided
    ? (input.description ?? null)
    : config.description;
  const routingGuidance = descriptionProvided
    ? (input.routingGuidance ?? null)
    : null;

  const builtInTools =
    input.toolPolicy !== undefined
      ? extractBuiltInTools(parseJsonInput(input.toolPolicy))
      : (config.builtInTools ?? []);

  const executionControls =
    input.executionControls !== undefined
      ? normalizeExecutionControlsForStorage(
          parseJsonInput(input.executionControls) ?? {},
        )
      : (config.execution as unknown as Record<string, unknown>);

  const written = await writeAgentProfileFolderForTenant({
    tenantId: args.tenantId,
    slug: finalSlug,
    source: {
      slug: finalSlug,
      name: input.name ?? finalSlug,
      description,
      routingGuidance,
      instructions:
        input.instructions !== undefined && input.instructions !== null
          ? input.instructions
          : config.instructions,
      modelId: modelId ?? "",
      enabled:
        input.enabled !== undefined ? (input.enabled ?? true) : config.enabled,
      toolPolicy: { builtInTools },
      executionControls,
    },
  });
  if (!written) {
    throw new Error(
      "Agent Profile folder write failed: no workspace target is resolvable for this tenant",
    );
  }

  if (finalSlug !== currentSlug) {
    await deleteAgentProfileFolderInstructionsForTenant({
      tenantId: args.tenantId,
      slug: currentSlug,
    });
    await deleteAgentProfileFileForTenant({
      tenantId: args.tenantId,
      slug: currentSlug,
    });
  }
  // Delete-on-write (U12 cleanup): the folder form is authoritative — a
  // successful folder write removes the legacy agents/<slug>.md file so
  // one slug renders as one entity.
  await deleteAgentProfileFileForTenant({
    tenantId: args.tenantId,
    slug: finalSlug,
  });

  const profile = await getAgentFolderProfileForTenant(
    args.tenantId,
    finalSlug,
  );
  if (!profile) {
    throw new Error(
      `Agent Profile folder for "${finalSlug}" was written but did not read back`,
    );
  }
  return folderProfileToGraphql(args.tenantId, profile);
}

function extractBuiltInTools(toolPolicy: unknown): string[] {
  if (!toolPolicy || typeof toolPolicy !== "object") return [];
  const value = (toolPolicy as { builtInTools?: unknown }).builtInTools;
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is string => typeof entry === "string" && !!entry.trim(),
      )
    : [];
}
