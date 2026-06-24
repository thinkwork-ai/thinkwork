import type { GraphQLContext } from "../../context.js";
import {
  getWorkItem,
  updateWorkItemStatus as updateWorkItemStatusRecord,
} from "../../../lib/work-items/work-item-service.js";
import {
  buildWorkItemActor,
  mapWorkItemError,
  requireWorkItemAccess,
  toGraphqlWorkItem,
} from "./shared.js";
import { GraphQLError } from "graphql";

export async function updateWorkItemStatus(
  _parent: any,
  args: { input: Record<string, any> },
  ctx: GraphQLContext,
) {
  try {
    const current = await getWorkItem({
      tenantId: args.input.tenantId,
      id: args.input.id,
    });
    if (!current) {
      throw new GraphQLError("Work item not found", {
        extensions: { code: "NOT_FOUND" },
      });
    }
    await requireWorkItemAccess(ctx, args.input.tenantId, current);
    const item = await updateWorkItemStatusRecord({
      ...(args.input as any),
      actor: await buildWorkItemActor(ctx),
    });
    return toGraphqlWorkItem(item);
  } catch (error) {
    mapWorkItemError(error);
  }
}
