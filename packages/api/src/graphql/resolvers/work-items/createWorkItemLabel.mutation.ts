import type { GraphQLContext } from "../../context.js";
import { createWorkItemLabel as createWorkItemLabelRow } from "../../../lib/work-items/work-item-service.js";
import { toGraphqlWorkItemLabel } from "./shared.js";

export async function createWorkItemLabel(
  _parent: any,
  args: { input: Record<string, any> },
  ctx: GraphQLContext,
) {
  const row = await createWorkItemLabelRow(ctx, args.input);
  return toGraphqlWorkItemLabel(row);
}
