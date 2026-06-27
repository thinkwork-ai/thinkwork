import type { GraphQLContext } from "../../context.js";
import { listWorkItemLabels } from "../../../lib/work-items/work-item-service.js";
import { toGraphqlWorkItemLabel } from "./shared.js";

export async function workItemLabels(
  _parent: any,
  args: { input?: Record<string, any> | null },
  ctx: GraphQLContext,
) {
  const rows = await listWorkItemLabels(ctx, args.input ?? {});
  return rows.map((row) => toGraphqlWorkItemLabel(row));
}
