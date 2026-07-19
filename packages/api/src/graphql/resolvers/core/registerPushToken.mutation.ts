import type { GraphQLContext } from "../../context.js";
import { db, eq, users } from "../../utils.js";
import { resolveCallerFromAuth } from "./resolve-auth-user.js";

export const registerPushToken = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  const { token } = args.input;
  const { userId } = await resolveCallerFromAuth(ctx.auth);
  if (!userId) {
    throw new Error("Unauthorized");
  }

  await db
    .update(users)
    .set({ expo_push_token: token, updated_at: new Date() })
    .where(eq(users.id, userId));
  return true;
};
