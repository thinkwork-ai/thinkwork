import type { GraphQLContext } from "../../context.js";
import { db, eq, users, snakeToCamel } from "../../utils.js";
import { resolveCallerUserId } from "./resolve-auth-user.js";

export const me = async (_parent: any, _args: any, ctx: GraphQLContext) => {
  // Non-cognito callers (apikey/service) may assert an explicit principal via
  // the x-principal-id header — the admin-skill impersonation path. Preserve
  // it unchanged.
  if (ctx.auth.authType !== "cognito") {
    const principalId =
      ctx.headers["x-principal-id"] || ctx.auth.principalId || "";
    if (!principalId) return null;
    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.id, principalId));
    return row ? snakeToCamel(row) : null;
  }

  // Cognito callers resolve through the stable-sub path (by cognito_sub, then
  // native id, then verified email — with opportunistic backfill). This keeps
  // `me` in lockstep with the identity-critical write resolvers, so a healed
  // Google user whose refreshed token lost its `email` claim is not reported
  // as signed-out.
  const userId = await resolveCallerUserId(ctx);
  if (!userId) return null;
  const [row] = await db.select().from(users).where(eq(users.id, userId));
  return row ? snakeToCamel(row) : null;
};
