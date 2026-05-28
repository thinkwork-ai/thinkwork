import type { GraphQLContext } from "../../context.js";
import { db, eq, and, desc, sql, threads, threadToCamel } from "../../utils.js";
import {
  resolveCallerTenantId,
  resolveCallerUserId,
} from "../core/resolve-auth-user.js";
import { callerVisibleThreadPredicate } from "./access.js";
import { threadSearchPredicate } from "./search.js";

export const threads_query = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  let callerUserId: string | null = null;

  // Cross-tenant gate. The caller-supplied args.tenantId must match the
  // caller's authoritative tenant. Without this, a Cognito user with a
  // valid JWT for tenant A can pass args.tenantId = tenant B and read all
  // non-task threads in tenant B (the no-computerId Inbox path bypassed the
  // owner check entirely). resolveCallerTenantId returns null for apikey
  // callers — they are pre-authorized service identities and may legitimately
  // read across tenants, so we only enforce when the caller is a Cognito
  // user. ctx.auth.tenantId is null for Google-federated users until the
  // pre-token Cognito trigger lands, so resolveCallerTenantId is the right
  // helper (it does the email-fallback DB lookup).
  if (ctx.auth.authType === "cognito") {
    const callerTenantId = await resolveCallerTenantId(ctx);
    if (!callerTenantId || callerTenantId !== args.tenantId) return [];
    callerUserId = await resolveCallerUserId(ctx);
    if (!callerUserId) return [];
  }

  const conditions = [eq(threads.tenant_id, args.tenantId)];
  if (args.status)
    conditions.push(eq(threads.status, args.status.toLowerCase()));
  if (args.channel) {
    conditions.push(eq(threads.channel, args.channel.toLowerCase()));
  } else {
    // When no channel specified (Inbox), exclude task-channel threads
    conditions.push(sql`${threads.channel} != 'task'`);
  }
  // After the platform-agent migration, threads.agent_id is the tenant's
  // canonical agent, so historical per-agent filters no longer partition
  // tenant threads by retired agent identity.
  if (args.agentId) conditions.push(eq(threads.agent_id, args.agentId));
  if (ctx.auth.authType === "cognito") {
    if (!callerUserId) return [];
    conditions.push(callerVisibleThreadPredicate(args.tenantId, callerUserId));
  }
  if (args.assigneeId) {
    // Mobile passes user.sub (Cognito) as assigneeId. For Google-OAuth
    // users the DB users.id is a fresh UUID linked by email, so sub !=
    // users.id. When the caller is asking for "threads assigned to me"
    // (passing their own Cognito principalId), rewrite to the caller's
    // DB users.id so threads.assignee_id (which is a users.id FK)
    // actually matches. Non-self filters pass through unchanged.
    let effectiveAssigneeId = args.assigneeId;
    if (
      ctx.auth.authType === "cognito" &&
      args.assigneeId === ctx.auth.principalId
    ) {
      const dbId = await resolveCallerUserId(ctx);
      if (dbId) effectiveAssigneeId = dbId;
    }
    conditions.push(eq(threads.assignee_id, effectiveAssigneeId));
  }
  const search = typeof args.search === "string" ? args.search.trim() : "";
  if (search) {
    conditions.push(threadSearchPredicate(search));
  }
  const limit = Math.min(args.limit || 200, 500);
  const rows = await db
    .select()
    .from(threads)
    .where(and(...conditions))
    .orderBy(desc(threads.created_at))
    .limit(limit);

  return rows.map((r) => threadToCamel(r));
};
