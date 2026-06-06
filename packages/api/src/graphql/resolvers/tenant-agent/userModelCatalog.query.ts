import type { GraphQLContext } from "../../context.js";
import {
  getTenantIdForUser,
  listUserModelCatalog,
} from "../../../lib/model-approvals.js";
import { requireTenantAdmin } from "../core/authz.js";

export async function userModelCatalog(
  _parent: unknown,
  args: { userId: string },
  ctx: GraphQLContext,
) {
  const tenantId = await getTenantIdForUser(args.userId);
  await requireTenantAdmin(ctx, tenantId);
  return listUserModelCatalog({ tenantId, userId: args.userId });
}
