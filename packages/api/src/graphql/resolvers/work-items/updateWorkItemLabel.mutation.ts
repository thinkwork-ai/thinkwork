import type { GraphQLContext } from "../../context.js";
import { updateWorkItemLabel as updateWorkItemLabelRow } from "../../../lib/work-items/work-item-service.js";
import { toGraphqlWorkItemLabel } from "./shared.js";

export async function updateWorkItemLabel(
  _parent: any,
  args: { input: Record<string, any> },
  ctx: GraphQLContext,
) {
  const row = await updateWorkItemLabelRow(ctx, args.input);
  return toGraphqlWorkItemLabel(row);
}
