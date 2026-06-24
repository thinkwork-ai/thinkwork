import type { GraphQLContext } from "../../context.js";
import { deleteWorkItemView as deleteWorkItemViewRow } from "../../../lib/work-items/saved-view-service.js";

export async function deleteWorkItemView(
  _parent: any,
  args: { input: { tenantId?: string | null; id: string } },
  ctx: GraphQLContext,
) {
  return deleteWorkItemViewRow(ctx, args.input);
}
