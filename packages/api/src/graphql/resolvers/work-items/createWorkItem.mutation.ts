import type { GraphQLContext } from "../../context.js";
import { createWorkItem as createWorkItemRow } from "../../../lib/work-items/work-item-service.js";
import { toGraphqlWorkItem } from "./shared.js";

export async function createWorkItem(
  _parent: any,
  args: { input: Record<string, any> },
  ctx: GraphQLContext,
) {
  const row = await createWorkItemRow(ctx, args.input);
  return toGraphqlWorkItem(row);
}
