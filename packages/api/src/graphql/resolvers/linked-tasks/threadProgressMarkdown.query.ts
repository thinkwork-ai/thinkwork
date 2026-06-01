import type { GraphQLContext } from "../../context.js";
import { and, db, eq, tenants, threads } from "../../utils.js";
import {
  readThreadProgressMarkdown,
  threadProgressKey,
} from "../../../lib/thread-progress/storage.js";
import { canReadTenantSpaces, hasSpaceMemberAccess } from "../spaces/shared.js";

export async function threadProgressMarkdown(
  _parent: any,
  args: { tenantId: string; threadId: string },
  ctx: GraphQLContext,
) {
  const [row] = await db
    .select({
      threadId: threads.id,
      tenantId: threads.tenant_id,
      spaceId: threads.space_id,
      threadFolderName: threads.workspace_folder_name,
      tenantSlug: tenants.slug,
    })
    .from(threads)
    .innerJoin(tenants, eq(tenants.id, threads.tenant_id))
    .where(
      and(eq(threads.id, args.threadId), eq(threads.tenant_id, args.tenantId)),
    )
    .limit(1);

  if (!row) return null;

  if (row.spaceId) {
    if (!(await hasSpaceMemberAccess(ctx, args.tenantId, row.spaceId))) {
      return null;
    }
  } else if (!(await canReadTenantSpaces(ctx, args.tenantId))) {
    return null;
  }

  const content = await readThreadProgressMarkdown({
    tenantSlug: row.tenantSlug,
    threadId: row.threadId,
    threadFolderName: row.threadFolderName,
  });
  if (!content) return null;

  return {
    tenantId: row.tenantId,
    tenantSlug: row.tenantSlug,
    threadId: row.threadId,
    key: threadProgressKey({
      tenantSlug: row.tenantSlug,
      threadId: row.threadId,
      threadFolderName: row.threadFolderName,
    }),
    content,
  };
}
