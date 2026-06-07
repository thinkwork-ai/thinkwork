import type { GraphQLContext } from "../../context.js";
import { agentProfiles, and, db, eq } from "../../utils.js";
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
  return true;
}
