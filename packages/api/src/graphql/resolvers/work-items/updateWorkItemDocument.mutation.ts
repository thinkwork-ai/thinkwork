import type { GraphQLContext } from "../../context.js";
import { updateWorkItemDocument as updateWorkItemDocumentRow } from "../../../lib/work-items/work-item-service.js";
import { toGraphqlWorkItemDocument } from "./shared.js";

export async function updateWorkItemDocument(
  _parent: unknown,
  args: { input: Record<string, unknown> },
  ctx: GraphQLContext,
) {
  const row = await updateWorkItemDocumentRow(ctx, args.input);
  return toGraphqlWorkItemDocument(row);
}
