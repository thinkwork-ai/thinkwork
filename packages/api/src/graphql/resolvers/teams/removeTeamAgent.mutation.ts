import type { GraphQLContext } from "../../context.js";
import { db, eq, and, teams, teamAgents } from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";

export const removeTeamAgent = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  const [team] = await db
    .select({ tenant_id: teams.tenant_id })
    .from(teams)
    .where(eq(teams.id, args.teamId));
  if (!team) return false;
  await requireTenantAdmin(ctx, team.tenant_id);

  const [row] = await db
    .delete(teamAgents)
    .where(
      and(
        eq(teamAgents.team_id, args.teamId),
        eq(teamAgents.agent_id, args.agentId),
      ),
    )
    .returning();
  return !!row;
};
