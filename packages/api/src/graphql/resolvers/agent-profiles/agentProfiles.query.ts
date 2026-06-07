import type { GraphQLContext } from "../../context.js";
import {
  agentProfiles as agentProfilesTable,
  and,
  asc,
  db,
  eq,
} from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { ensureBuiltInAgentProfiles, toAgentProfileGraphql } from "./shared.js";

export async function agentProfiles(
  _parent: unknown,
  args: { tenantId: string; includeDisabled?: boolean | null },
  ctx: GraphQLContext,
) {
  await requireAdminOrServiceCaller(ctx, args.tenantId, "agent_profiles:read");
  await ensureBuiltInAgentProfiles(args.tenantId);

  const conditions = [eq(agentProfilesTable.tenant_id, args.tenantId)];
  if (args.includeDisabled === false) {
    conditions.push(eq(agentProfilesTable.enabled, true));
  }

  const rows = await db
    .select()
    .from(agentProfilesTable)
    .where(and(...conditions))
    .orderBy(asc(agentProfilesTable.name));

  return rows.map(toAgentProfileGraphql);
}
