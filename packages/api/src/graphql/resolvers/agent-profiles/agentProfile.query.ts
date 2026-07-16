import type { GraphQLContext } from "../../context.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { getAgentFolderProfileForTenant } from "../../../lib/agent-profile-workspace-files.js";
import {
  badInput,
  folderProfileToGraphql,
  normalizeProfileSlug,
} from "./shared.js";

/**
 * Single-profile lookup (subagent-folders U11): folder-index sourced.
 * `id` and `slug` are the same identifier now — the folder slug is the
 * profile identity (legacy row UUIDs no longer resolve).
 */
export async function agentProfile(
  _parent: unknown,
  args: { tenantId: string; id?: string | null; slug?: string | null },
  ctx: GraphQLContext,
) {
  await requireAdminOrServiceCaller(ctx, args.tenantId, "agent_profiles:read");

  const ref = args.id ?? args.slug;
  if (!ref) {
    throw badInput("Either id or slug is required");
  }

  const slug = normalizeProfileSlug(ref);
  const profile = await getAgentFolderProfileForTenant(args.tenantId, slug);
  return profile ? folderProfileToGraphql(args.tenantId, profile) : null;
}
