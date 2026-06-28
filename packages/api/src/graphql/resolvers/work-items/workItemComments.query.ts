import type { GraphQLContext } from "../../context.js";
import { listWorkItemComments } from "../../../lib/work-items/work-item-service.js";
import { toGraphqlWorkItemComment } from "./shared.js";

export async function workItemComments(
  _parent: unknown,
  args: { input: Record<string, unknown> },
  ctx: GraphQLContext,
) {
  const rows = await listWorkItemComments(ctx, args.input);
  return rows.map((row) => toGraphqlWorkItemComment(row));
}
