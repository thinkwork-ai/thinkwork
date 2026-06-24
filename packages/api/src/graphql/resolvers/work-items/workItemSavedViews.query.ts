import type { GraphQLContext } from "../../context.js";
import { listWorkItemSavedViews } from "../../../lib/work-items/saved-view-service.js";
import { toGraphqlWorkItemSavedView } from "./shared.js";

export async function workItemSavedViews(
  _parent: any,
  args: { tenantId?: string | null; spaceId?: string | null },
  ctx: GraphQLContext,
) {
  const rows = await listWorkItemSavedViews(ctx, args);
  return rows.map((row) => toGraphqlWorkItemSavedView(row));
}
