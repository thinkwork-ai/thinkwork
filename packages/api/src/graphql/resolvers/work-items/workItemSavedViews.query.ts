import type { GraphQLContext } from "../../context.js";
import { listWorkItemSavedViews } from "../../../lib/work-items/saved-view-service.js";
import { canReadTenantSpaces, hasSpaceMemberAccess } from "../spaces/shared.js";
import {
  mapWorkItemError,
  requireCallerUserId,
  toGraphqlWorkItemSavedView,
} from "./shared.js";

export async function workItemSavedViews(
  _parent: any,
  args: { tenantId: string; spaceId?: string | null },
  ctx: GraphQLContext,
) {
  try {
    if (args.spaceId) {
      if (!(await hasSpaceMemberAccess(ctx, args.tenantId, args.spaceId)))
        return [];
    } else if (!(await canReadTenantSpaces(ctx, args.tenantId))) {
      return [];
    }
    const userId = await requireCallerUserId(ctx);
    const rows = await listWorkItemSavedViews({
      tenantId: args.tenantId,
      userId,
      spaceId: args.spaceId,
    });
    return rows.map(toGraphqlWorkItemSavedView);
  } catch (error) {
    mapWorkItemError(error);
  }
}
