import type { GraphQLContext } from "../../context.js";
import { createWorkItemComment as createWorkItemCommentRow } from "../../../lib/work-items/work-item-service.js";
import { toGraphqlWorkItemComment } from "./shared.js";

export async function createWorkItemComment(
  _parent: unknown,
  args: { input: Record<string, unknown> },
  ctx: GraphQLContext,
) {
  const row = await createWorkItemCommentRow(ctx, args.input);
  return toGraphqlWorkItemComment(row);
}
