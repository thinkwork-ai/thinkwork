import type { GraphQLContext } from "../../context.js";
import { listThreadWorkItems } from "../../../lib/work-items/work-item-service.js";
import { toGraphqlWorkItem } from "./shared.js";

export async function threadWorkItems(
  _parent: any,
  args: { tenantId?: string | null; threadId: string },
  ctx: GraphQLContext,
) {
  const rows = await listThreadWorkItems(ctx, args);
  return rows.map((row) => toGraphqlWorkItem(row));
}
