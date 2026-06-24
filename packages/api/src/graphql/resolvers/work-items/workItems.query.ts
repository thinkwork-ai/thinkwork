import type { GraphQLContext } from "../../context.js";
import { listWorkItems } from "../../../lib/work-items/work-item-service.js";
import { toGraphqlWorkItem } from "./shared.js";

export async function workItems(
  _parent: any,
  args: { input?: Record<string, any> | null },
  ctx: GraphQLContext,
) {
  const rows = await listWorkItems(ctx, args.input ?? {});
  return rows.map((row) => toGraphqlWorkItem(row));
}
