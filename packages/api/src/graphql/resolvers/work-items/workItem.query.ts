import type { GraphQLContext } from "../../context.js";
import { getWorkItem } from "../../../lib/work-items/work-item-service.js";
import {
  mapWorkItemError,
  requireWorkItemAccess,
  toGraphqlWorkItem,
} from "./shared.js";

export async function workItem(
  _parent: any,
  args: { tenantId: string; id: string },
  ctx: GraphQLContext,
) {
  try {
    const item = await getWorkItem(args);
    if (!item) return null;
    await requireWorkItemAccess(ctx, args.tenantId, item);
    return toGraphqlWorkItem(item);
  } catch (error) {
    mapWorkItemError(error);
  }
}
