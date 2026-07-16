import type { GraphQLContext } from "../../context.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { listAgentFolderProfilesForTenant } from "../../../lib/agent-profile-workspace-files.js";
import { folderProfileToGraphql } from "./shared.js";

/**
 * Profiles listing (subagent-folders U11): sourced from the workspace
 * agent-folder index — `agents/<slug>/INSTRUCTIONS.md` folders under the
 * tenant's platform agent workspace — never from `agent_profiles` rows.
 */
export async function agentProfiles(
  _parent: unknown,
  args: { tenantId: string; includeDisabled?: boolean | null },
  ctx: GraphQLContext,
) {
  await requireAdminOrServiceCaller(ctx, args.tenantId, "agent_profiles:read");

  const profiles =
    (await listAgentFolderProfilesForTenant(args.tenantId)) ?? [];
  const visible =
    args.includeDisabled === false
      ? profiles.filter((profile) => profile.config.enabled)
      : profiles;

  return visible
    .map((profile) => folderProfileToGraphql(args.tenantId, profile))
    .sort((left, right) => left.name.localeCompare(right.name));
}
