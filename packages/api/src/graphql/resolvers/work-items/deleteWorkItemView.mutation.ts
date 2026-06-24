import type { GraphQLContext } from "../../context.js";
import { deleteWorkItemView as deleteView } from "../../../lib/work-items/saved-view-service.js";
import { mapWorkItemError, requireCallerUserId } from "./shared.js";

export async function deleteWorkItemView(
  _parent: any,
  args: { input: { tenantId: string; id: string } },
  ctx: GraphQLContext,
) {
  try {
    return deleteView({
      tenantId: args.input.tenantId,
      id: args.input.id,
      userId: await requireCallerUserId(ctx),
    });
  } catch (error) {
    mapWorkItemError(error);
  }
}
