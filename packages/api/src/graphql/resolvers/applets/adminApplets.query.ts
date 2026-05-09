import type { GraphQLContext } from "../../context.js";
import { listAdminApplets } from "./applet.shared.js";

export async function adminApplets(
  _parent: any,
  args: {
    tenantId: string;
    userId?: string | null;
    cursor?: string | null;
    limit?: number | null;
  },
  ctx: GraphQLContext,
) {
  return listAdminApplets({
    ctx,
    tenantId: args.tenantId,
    userId: args.userId,
    cursor: args.cursor,
    limit: args.limit,
  });
}
