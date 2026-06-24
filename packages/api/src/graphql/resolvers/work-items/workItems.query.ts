import type { GraphQLContext } from "../../context.js";
import { listWorkItems } from "../../../lib/work-items/work-item-service.js";
import {
  mapWorkItemError,
  readableSpaceIdsForWorkItems,
  toGraphqlWorkItemConnection,
} from "./shared.js";

export async function workItems(
  _parent: any,
  args: { input: Record<string, any> },
  ctx: GraphQLContext,
) {
  try {
    const readableSpaceIds = await readableSpaceIdsForWorkItems(
      ctx,
      args.input.tenantId,
      args.input.spaceIds,
    );
    if (Array.isArray(readableSpaceIds) && readableSpaceIds.length === 0) {
      return { items: [], pageInfo: { hasNextPage: false, endCursor: null } };
    }
    const result = await listWorkItems({
      ...args.input,
      spaceIds: readableSpaceIds ?? args.input.spaceIds,
    } as any);
    return toGraphqlWorkItemConnection(result);
  } catch (error) {
    mapWorkItemError(error);
  }
}
