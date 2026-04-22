import type { GraphQLContext } from "../../context.js";
import { db, eq, teams, teamAgents, snakeToCamel } from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";

export const addTeamAgent = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  const i = args.input;
  const [team] = await db
    .select({ tenant_id: teams.tenant_id })
    .from(teams)
    .where(eq(teams.id, args.teamId));
  if (!team) throw new Error("Team not found");
  await requireTenantAdmin(ctx, team.tenant_id);
  const [row] = await db
    .insert(teamAgents)
    .values({
      team_id: args.teamId,
      agent_id: i.agentId,
      tenant_id: team.tenant_id,
      role: i.role ?? "member",
      joined_at: new Date(),
    })
    .returning();
  return snakeToCamel(row);
};
