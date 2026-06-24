import type { GraphQLContext } from "../../context.js";
import { listWorkItemStatuses } from "../../../lib/work-items/status-service.js";
import { toGraphqlWorkItemStatus } from "./shared.js";

export async function workItemStatuses(
  _parent: any,
  args: { tenantId?: string | null; spaceId: string },
  ctx: GraphQLContext,
) {
  const rows = await listWorkItemStatuses(ctx, args);
  return rows.map((row) => toGraphqlWorkItemStatus(row));
}
