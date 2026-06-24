import type { GraphQLContext } from "../../context.js";
import { saveWorkItemStatuses as saveWorkItemStatusRows } from "../../../lib/work-items/status-service.js";
import { toGraphqlWorkItemStatus } from "./shared.js";

export async function saveWorkItemStatuses(
  _parent: any,
  args: {
    input: {
      tenantId?: string | null;
      spaceId: string;
      statuses: Array<Record<string, any>>;
    };
  },
  ctx: GraphQLContext,
) {
  const rows = await saveWorkItemStatusRows(ctx, args.input);
  return rows.map((row) => toGraphqlWorkItemStatus(row));
}
