import type { GraphQLContext } from "../../context.js";
import { agentProfiles, and, db, eq } from "../../utils.js";
import { deleteAgentProfileFileForTenant } from "../../../lib/agent-profile-workspace-files.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import {
  badInput,
  ensureBuiltInAgentProfiles,
  loadAgentProfileRow,
} from "./shared.js";

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
  await ensureBuiltInAgentProfiles(args.tenantId);

  const existing = await loadAgentProfileRow(args.tenantId, args.id);
  // Space-local rows (source_space_id set) are projections of a Space's
  // workspace files. Deleting one here would remove the CENTRAL agent
  // source agents/<slug>.md — killing a same-slug central profile.
  if (existing.source_space_id != null) {
    throw badInput(
      "Space-local Agent Profiles are managed from their Space's workspace files (Settings → Spaces → the owning Space → Workspace files)",
    );
  }
  if (existing.built_in_key) {
    throw badInput("Built-in Agent Profiles can be disabled but not deleted");
  }

  await db
    .delete(agentProfiles)
    .where(
      and(
        eq(agentProfiles.tenant_id, args.tenantId),
        eq(agentProfiles.id, args.id),
      ),
    );
  await deleteAgentProfileFileForTenant({
    tenantId: args.tenantId,
    slug: String(existing.slug),
  });
  return true;
}
