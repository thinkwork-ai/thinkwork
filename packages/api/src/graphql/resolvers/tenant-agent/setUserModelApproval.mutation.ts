import type { GraphQLContext } from "../../context.js";
import {
  getTenantIdForUser,
  listUserModelCatalog,
  setUserModelApproval as setUserModelApprovalForUser,
} from "../../../lib/model-approvals.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";

export async function setUserModelApproval(
  _parent: unknown,
  args: { userId: string; modelId: string; approved: boolean },
  ctx: GraphQLContext,
) {
  const tenantId = await getTenantIdForUser(args.userId);
  await requireAdminOrServiceCaller(
    ctx,
    tenantId,
    "user_model_approval:update",
  );
  await setUserModelApprovalForUser({
    tenantId,
    userId: args.userId,
    modelId: args.modelId,
    approved: args.approved,
  });
  return listUserModelCatalog({ tenantId, userId: args.userId });
}
