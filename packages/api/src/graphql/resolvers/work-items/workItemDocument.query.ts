import type { GraphQLContext } from "../../context.js";
import { getWorkItemDocument } from "../../../lib/work-items/work-item-service.js";
import { toGraphqlWorkItemDocument } from "./shared.js";

export async function workItemDocument(
  _parent: unknown,
  args: { input: { tenantId?: string | null; id: string } },
  ctx: GraphQLContext,
) {
  const row = await getWorkItemDocument(ctx, args.input);
  return row ? toGraphqlWorkItemDocument(row) : null;
}
