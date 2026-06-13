import type { GraphQLContext } from "../../context.js";
import {
  getTenantIdForUser,
  listUserModelCatalog,
} from "../../../lib/model-approvals.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { resolveCaller } from "../core/resolve-auth-user.js";

export async function userModelCatalog(
  _parent: unknown,
  args: { userId: string },
  ctx: GraphQLContext,
) {
  const tenantId = await getTenantIdForUser(args.userId);
  const caller =
    ctx.auth.authType === "cognito" ? await resolveCaller(ctx) : null;
  const isSelf = caller?.userId === args.userId;
  if (!isSelf) {
    await requireAdminOrServiceCaller(ctx, tenantId, "user_model_catalog:read");
  }
  return listUserModelCatalog({ tenantId, userId: args.userId });
}
