import type { GraphQLContext } from "../../context.js";
import { and, asc, db, eq, linkedTasks, threads } from "../../utils.js";
import { canReadTenantSpaces, hasSpaceMemberAccess } from "../spaces/shared.js";
import { toGraphqlLinkedTask } from "./shared.js";

export async function threadLinkedTasks(
  _parent: any,
  args: { tenantId: string; threadId: string },
  ctx: GraphQLContext,
) {
  const [thread] = await db
    .select({
      id: threads.id,
      tenant_id: threads.tenant_id,
      space_id: threads.space_id,
    })
    .from(threads)
    .where(eq(threads.id, args.threadId));

  if (!thread || thread.tenant_id !== args.tenantId) {
    return [];
  }

  if (thread.space_id) {
    if (!(await hasSpaceMemberAccess(ctx, args.tenantId, thread.space_id))) {
      return [];
    }
  } else if (!(await canReadTenantSpaces(ctx, args.tenantId))) {
    return [];
  }

  const rows = await db
    .select()
    .from(linkedTasks)
    .where(
      and(
        eq(linkedTasks.tenant_id, args.tenantId),
        eq(linkedTasks.thread_id, args.threadId),
      ),
    )
    .orderBy(asc(linkedTasks.created_at));

  return rows
    .filter((row) => !isRemovedChecklistTask(row.metadata))
    .map((row) => toGraphqlLinkedTask(row));
}

function isRemovedChecklistTask(metadata: unknown): boolean {
  const record =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};
  const nativeChecklist =
    record.nativeChecklist &&
    typeof record.nativeChecklist === "object" &&
    !Array.isArray(record.nativeChecklist)
      ? (record.nativeChecklist as Record<string, unknown>)
      : {};
  return Boolean(nativeChecklist.removedAt);
}
