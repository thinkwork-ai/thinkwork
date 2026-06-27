import type { GraphQLContext } from "../../context.js";
import { createWorkItemDocument as createWorkItemDocumentRow } from "../../../lib/work-items/work-item-service.js";
import { toGraphqlWorkItemDocument } from "./shared.js";

export async function createWorkItemDocument(
  _parent: unknown,
  args: { input: Record<string, unknown> },
  ctx: GraphQLContext,
) {
  const row = await createWorkItemDocumentRow(ctx, args.input);
  return toGraphqlWorkItemDocument(row);
}
