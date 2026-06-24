import type { GraphQLContext } from "../../context.js";
import { getWorkItem } from "../../../lib/work-items/work-item-service.js";
import { toGraphqlWorkItem } from "./shared.js";

export async function workItem(
  _parent: any,
  args: { tenantId?: string | null; id: string },
  ctx: GraphQLContext,
) {
  const row = await getWorkItem(ctx, args);
  return row ? toGraphqlWorkItem(row) : null;
}
