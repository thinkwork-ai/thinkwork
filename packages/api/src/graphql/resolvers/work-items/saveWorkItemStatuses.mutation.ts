import type { GraphQLContext } from "../../context.js";
import { saveWorkItemStatuses as saveStatuses } from "../../../lib/work-items/status-service.js";
import { hasSpaceMemberAccess } from "../spaces/shared.js";
import { mapWorkItemError, toGraphqlWorkItemStatus } from "./shared.js";
import { GraphQLError } from "graphql";

export async function saveWorkItemStatuses(
  _parent: any,
  args: { input: { tenantId: string; spaceId: string; statuses: any[] } },
  ctx: GraphQLContext,
) {
  try {
    if (
      !(await hasSpaceMemberAccess(
        ctx,
        args.input.tenantId,
        args.input.spaceId,
      ))
    ) {
      throw new GraphQLError("Not authorized to configure this Space", {
        extensions: { code: "FORBIDDEN" },
      });
    }
    const rows = await saveStatuses(args.input as any);
    return rows.map(toGraphqlWorkItemStatus);
  } catch (error) {
    mapWorkItemError(error);
  }
}
