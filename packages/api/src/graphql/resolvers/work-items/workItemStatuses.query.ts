import type { GraphQLContext } from "../../context.js";
import { listWorkItemStatuses } from "../../../lib/work-items/status-service.js";
import { hasSpaceMemberAccess } from "../spaces/shared.js";
import { mapWorkItemError, toGraphqlWorkItemStatus } from "./shared.js";

export async function workItemStatuses(
  _parent: any,
  args: { tenantId: string; spaceId: string },
  ctx: GraphQLContext,
) {
  try {
    if (!(await hasSpaceMemberAccess(ctx, args.tenantId, args.spaceId)))
      return [];
    const rows = await listWorkItemStatuses(args);
    return rows.map(toGraphqlWorkItemStatus);
  } catch (error) {
    mapWorkItemError(error);
  }
}
