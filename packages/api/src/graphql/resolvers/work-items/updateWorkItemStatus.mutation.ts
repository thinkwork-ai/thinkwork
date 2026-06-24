import type { GraphQLContext } from "../../context.js";
import { updateWorkItemStatus as updateWorkItemStatusRow } from "../../../lib/work-items/work-item-service.js";
import { toGraphqlWorkItem } from "./shared.js";

export async function updateWorkItemStatus(
  _parent: any,
  args: { input: Record<string, any> },
  ctx: GraphQLContext,
) {
  const row = await updateWorkItemStatusRow(ctx, args.input);
  return toGraphqlWorkItem(row);
}
