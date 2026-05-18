import type { GraphQLContext } from "../../context.js";
import { db, eq, and, teams, teamUsers } from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";

export const removeTeamUser = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  const [team] = await db
    .select({ tenant_id: teams.tenant_id })
    .from(teams)
    .where(eq(teams.id, args.teamId));
  if (!team) return false;
  await requireAdminOrServiceCaller(ctx, team.tenant_id, "remove_team_user");

  const [row] = await db
    .delete(teamUsers)
    .where(
      and(
        eq(teamUsers.team_id, args.teamId),
        eq(teamUsers.user_id, args.userId),
      ),
    )
    .returning();
  return !!row;
};
