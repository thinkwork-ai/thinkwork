import type { GraphQLContext } from "../../context.js";
import { updateWorkItem as updateWorkItemRow } from "../../../lib/work-items/work-item-service.js";
import { toGraphqlWorkItem } from "./shared.js";

export async function updateWorkItem(
  _parent: any,
  args: { input: Record<string, any> },
  ctx: GraphQLContext,
) {
  const row = await updateWorkItemRow(ctx, args.input);
  return toGraphqlWorkItem(row);
}
