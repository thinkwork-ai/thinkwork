import type { GraphQLContext } from "../../context.js";
import { and, db, eq, tenants, threads } from "../../utils.js";
import { readThreadProgressMarkdown } from "../../../lib/thread-progress/storage.js";
import {
  resolveCallerTenantId,
  resolveCallerUserId,
} from "../core/resolve-auth-user.js";
import { callerVisibleThreadPredicate } from "./access.js";

export async function threadProgress(
  _parent: unknown,
  args: { tenantId: string; threadId: string },
  ctx: GraphQLContext,
) {
  let threadConditions = and(
    eq(threads.id, args.threadId),
    eq(threads.tenant_id, args.tenantId),
  );

  if (
    ctx.auth.authType === "service" &&
    ctx.auth.tenantId &&
    ctx.auth.tenantId !== args.tenantId
  ) {
    return null;
  }

  if (ctx.auth.authType === "cognito") {
    const callerTenantId = await resolveCallerTenantId(ctx);
    if (!callerTenantId || callerTenantId !== args.tenantId) return null;

    const callerUserId = await resolveCallerUserId(ctx);
    if (!callerUserId) return null;

    threadConditions = and(
      threadConditions,
      callerVisibleThreadPredicate(callerTenantId, callerUserId),
    );
  }

  const [thread] = await db
    .select({ id: threads.id, tenant_id: threads.tenant_id })
    .from(threads)
    .where(threadConditions);
  if (!thread) return null;

  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, args.tenantId));
  if (!tenant?.slug) return null;

  const markdown = await readThreadProgressMarkdown({
    tenantSlug: tenant.slug,
    threadId: args.threadId,
  });
  if (!markdown?.trim()) return null;

  return {
    threadId: args.threadId,
    markdown,
  };
}
