import type { GraphQLContext } from "../../context.js";
import { listWorkItemDocuments } from "../../../lib/work-items/work-item-service.js";
import { toGraphqlWorkItemDocument } from "./shared.js";

export async function workItemDocuments(
  _parent: unknown,
  args: { input: Record<string, unknown> },
  ctx: GraphQLContext,
) {
  const rows = await listWorkItemDocuments(ctx, args.input);
  return rows.map((row) => toGraphqlWorkItemDocument(row));
}
