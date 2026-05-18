import type { GraphQLContext } from "../../context.js";
import { db, eq, teams } from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";

export const deleteTeam = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  const [team] = await db
    .select({ tenant_id: teams.tenant_id })
    .from(teams)
    .where(eq(teams.id, args.id));
  if (!team) return false;
  await requireAdminOrServiceCaller(ctx, team.tenant_id, "delete_team");

  const [row] = await db
    .update(teams)
    .set({ status: "archived", updated_at: new Date() })
    .where(eq(teams.id, args.id))
    .returning();
  return !!row;
};
