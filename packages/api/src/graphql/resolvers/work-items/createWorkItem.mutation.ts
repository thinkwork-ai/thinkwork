import type { GraphQLContext } from "../../context.js";
import { createWorkItem as createWorkItemRecord } from "../../../lib/work-items/work-item-service.js";
import { hasSpaceMemberAccess } from "../spaces/shared.js";
import {
  buildWorkItemActor,
  mapWorkItemError,
  toGraphqlWorkItem,
} from "./shared.js";
import { GraphQLError } from "graphql";

export async function createWorkItem(
  _parent: any,
  args: { input: Record<string, any> },
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
      throw new GraphQLError(
        "Not authorized to create work items in this Space",
        {
          extensions: { code: "FORBIDDEN" },
        },
      );
    }
    const item = await createWorkItemRecord({
      ...(args.input as any),
      actor: await buildWorkItemActor(ctx),
    });
    return toGraphqlWorkItem(item);
  } catch (error) {
    mapWorkItemError(error);
  }
}
