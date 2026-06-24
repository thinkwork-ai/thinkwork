import type { GraphQLContext } from "../../context.js";
import { saveWorkItemView as saveView } from "../../../lib/work-items/saved-view-service.js";
import { canReadTenantSpaces, hasSpaceMemberAccess } from "../spaces/shared.js";
import {
  mapWorkItemError,
  requireCallerUserId,
  toGraphqlWorkItemSavedView,
} from "./shared.js";
import { GraphQLError } from "graphql";

export async function saveWorkItemView(
  _parent: any,
  args: { input: Record<string, any> },
  ctx: GraphQLContext,
) {
  try {
    if (args.input.spaceId) {
      if (
        !(await hasSpaceMemberAccess(
          ctx,
          args.input.tenantId,
          args.input.spaceId,
        ))
      ) {
        throw new GraphQLError("Not authorized to save a view for this Space", {
          extensions: { code: "FORBIDDEN" },
        });
      }
    } else if (!(await canReadTenantSpaces(ctx, args.input.tenantId))) {
      throw new GraphQLError("Not authorized to save work item views", {
        extensions: { code: "FORBIDDEN" },
      });
    }
    const view = await saveView({
      ...(args.input as any),
      userId: await requireCallerUserId(ctx),
    });
    return toGraphqlWorkItemSavedView(view);
  } catch (error) {
    mapWorkItemError(error);
  }
}
