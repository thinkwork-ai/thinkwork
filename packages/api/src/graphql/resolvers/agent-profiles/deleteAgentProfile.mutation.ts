import type { GraphQLContext } from "../../context.js";
import {
  deleteAgentProfileFileForTenant,
  deleteAgentProfileFolderInstructionsForTenant,
  getAgentFolderProfileForTenant,
} from "../../../lib/agent-profile-workspace-files.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { badInput, normalizeProfileSlug, notFound } from "./shared.js";
import { BUILT_IN_AGENT_PROFILE_KEYS } from "./built-in-agent-profiles.js";

/**
 * Delete a sub-agent (subagent-folders U11): folder-write only — removes
 * the folder's INSTRUCTIONS.md (grant folders wither at compile without
 * their parent entry and are swept by the reconciler, never bulk-deleted
 * here) plus the legacy `agents/<slug>.md` form. No `agent_profiles` row
 * is touched.
 */
export async function deleteAgentProfile(
  _parent: unknown,
  args: { tenantId: string; id: string },
  ctx: GraphQLContext,
) {
  await requireAdminOrServiceCaller(
    ctx,
    args.tenantId,
    "agent_profiles:delete",
  );

  const slug = normalizeProfileSlug(args.id);
  if ((BUILT_IN_AGENT_PROFILE_KEYS as readonly string[]).includes(slug)) {
    throw badInput("Built-in Agent Profiles can be disabled but not deleted");
  }
  const existing = await getAgentFolderProfileForTenant(args.tenantId, slug);
  if (!existing) throw notFound("Agent Profile not found");

  await deleteAgentProfileFolderInstructionsForTenant({
    tenantId: args.tenantId,
    slug,
  });
  await deleteAgentProfileFileForTenant({ tenantId: args.tenantId, slug });
  return true;
}
