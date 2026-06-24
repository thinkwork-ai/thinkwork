import type { GraphQLContext } from "../../context.js";
import { saveWorkItemView as saveWorkItemViewRow } from "../../../lib/work-items/saved-view-service.js";
import { toGraphqlWorkItemSavedView } from "./shared.js";

export async function saveWorkItemView(
  _parent: any,
  args: { input: Record<string, any> },
  ctx: GraphQLContext,
) {
  const row = await saveWorkItemViewRow(ctx, args.input);
  return toGraphqlWorkItemSavedView(row);
}
