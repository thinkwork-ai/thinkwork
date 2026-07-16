import type { GraphQLContext } from "../../context.js";
import {
  getAgentFolderProfileForTenant,
  listAgentFolderProfilesForTenant,
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
  parseJsonInput,
  resolveAvailableCustomSlug,
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

/**
 * Create a sub-agent (subagent-folders U11): a pure folder write — the
 * mutation serializes `agents/<slug>/INSTRUCTIONS.md` (strict U3 format)
 * into the tenant's agent workspace; the next render compiles it into
 * the capabilities manifest. No `agent_profiles` row is written.
 * `spaceIds` is ignored: space-scoped sub-agents are a future
 * folder-based arc. `skillPolicy` is ignored: grants are folder presence
 * (`agents/<slug>/skills|connectors/<child>/`), written by the grant
 * mutations.
 */
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

  const input = args.input;
  const existingSlugs = (
    (await listAgentFolderProfilesForTenant(args.tenantId)) ?? []
  ).map((profile) => profile.slug);

  // An explicit slug is honored as-is (collision is a clean user error); when
  // it's derived from the name we resolve to a free slug so a generic default
  // like "New Agent Profile" can be created repeatedly.
  let slug: string;
  if (input.slug) {
    slug = normalizeProfileSlug(input.slug);
    assertCustomProfileSlugAvailable(slug);
    if (existingSlugs.includes(slug)) {
      throw badInput(`An Agent Profile with slug "${slug}" already exists`);
    }
  } else {
    slug = resolveAvailableCustomSlug(existingSlugs, input.name);
  }
  await assertAvailableModel(args.tenantId, input.modelId);
  const toolPolicy = (parseJsonInput(input.toolPolicy) ?? {}) as Record<
    string,
    unknown
  >;
  const executionControls = normalizeExecutionControlsForStorage(
    parseJsonInput(input.executionControls) ?? {},
  );

  const written = await writeAgentProfileFolderForTenant({
    tenantId: args.tenantId,
    slug,
    source: {
      slug,
      name: input.name,
      description: input.description,
      routingGuidance: input.routingGuidance,
      instructions: input.instructions,
      modelId: input.modelId,
      enabled: input.enabled ?? true,
      toolPolicy,
      executionControls,
    },
  });
  if (!written) {
    throw new Error(
      "Agent Profile folder write failed: no workspace target is resolvable for this tenant",
    );
  }

  const profile = await getAgentFolderProfileForTenant(args.tenantId, slug);
  if (!profile) {
    throw new Error(
      `Agent Profile folder for "${slug}" was written but did not read back`,
    );
  }
  return folderProfileToGraphql(args.tenantId, profile);
}
