import type { GraphQLContext } from "../../context.js";
import { db, eq, users } from "../../utils.js";
import { resolveCallerFromAuth } from "./resolve-auth-user.js";

export const unregisterPushToken = async (
  _parent: any,
  _args: any,
  ctx: GraphQLContext,
) => {
  const { userId } = await resolveCallerFromAuth(ctx.auth);
  if (!userId) throw new Error("Unauthorized");

  await db
    .update(users)
    .set({ expo_push_token: null, updated_at: new Date() })
    .where(eq(users.id, userId));
  return true;
};
