import type { GraphQLContext } from "../../context.js";
import { and, db, eq, threads } from "../../utils.js";
import { listThreadWorkItems } from "../../../lib/work-items/work-item-service.js";
import { canReadTenantSpaces, hasSpaceMemberAccess } from "../spaces/shared.js";
import { mapWorkItemError, toGraphqlWorkItem } from "./shared.js";

export async function threadWorkItems(
  _parent: any,
  args: { tenantId: string; threadId: string },
  ctx: GraphQLContext,
) {
  try {
    const [thread] = await db
      .select({
        id: threads.id,
        tenant_id: threads.tenant_id,
        space_id: threads.space_id,
      })
      .from(threads)
      .where(
        and(
          eq(threads.tenant_id, args.tenantId),
          eq(threads.id, args.threadId),
        ),
      )
      .limit(1);
    if (!thread) return [];
    if (thread.space_id) {
      if (!(await hasSpaceMemberAccess(ctx, args.tenantId, thread.space_id)))
        return [];
    } else if (!(await canReadTenantSpaces(ctx, args.tenantId))) {
      return [];
    }
    const rows = await listThreadWorkItems(args);
    return rows.map(toGraphqlWorkItem);
  } catch (error) {
    mapWorkItemError(error);
  }
}
