import { GraphQLError } from "graphql";
import { and, eq, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { GraphQLContext } from "../../context.js";
import { threads } from "@thinkwork/database-pg/schema";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import {
  resolveCallerTenantId,
  resolveCallerUserId,
} from "../core/resolve-auth-user.js";
import { callerVisibleThreadPredicate } from "../threads/access.js";

export interface KnowledgeGraphScope {
  tenantId: string;
  callerUserId: string | null;
  requiresUserThreadVisibility: boolean;
}

export async function resolveKnowledgeGraphScope(
  ctx: GraphQLContext,
  args: { tenantId?: string | null },
  operationName: string,
): Promise<KnowledgeGraphScope> {
  const callerTenantId =
    ctx.auth.tenantId ?? (await resolveCallerTenantId(ctx));
  const tenantId = args.tenantId ?? callerTenantId;
  if (!tenantId) {
    throw new GraphQLError("Tenant context required", {
      extensions: { code: "UNAUTHENTICATED" },
    });
  }
  if (callerTenantId && callerTenantId !== tenantId) {
    throw new GraphQLError("Access denied: tenant mismatch", {
      extensions: { code: "FORBIDDEN" },
    });
  }

  await requireAdminOrServiceCaller(ctx, tenantId, operationName);

  const callerUserId =
    ctx.auth.authType === "cognito" ? await resolveCallerUserId(ctx) : null;
  if (ctx.auth.authType === "cognito" && !callerUserId) {
    throw new GraphQLError("Caller identity required", {
      extensions: { code: "UNAUTHENTICATED" },
    });
  }

  return {
    tenantId,
    callerUserId,
    requiresUserThreadVisibility: ctx.auth.authType === "cognito",
  };
}

export async function assertCanReadKnowledgeGraphThread(
  ctx: GraphQLContext,
  scope: KnowledgeGraphScope,
  threadId: string,
): Promise<boolean> {
  const conditions: SQL[] = [
    eq(threads.id, threadId),
    eq(threads.tenant_id, scope.tenantId),
  ];
  if (scope.requiresUserThreadVisibility) {
    conditions.push(
      callerVisibleThreadPredicate(scope.tenantId, scope.callerUserId!),
    );
  }

  const [row] = await ctx.db
    .select({ id: threads.id })
    .from(threads)
    .where(and(...conditions))
    .limit(1);

  return Boolean(row);
}

export async function threadVisibilityWhereSql(
  scope: KnowledgeGraphScope,
): Promise<SQL> {
  if (!scope.requiresUserThreadVisibility) {
    return sql`TRUE`;
  }
  const callerUserId = scope.callerUserId!;
  return sql`(
    (
      t.user_id = ${callerUserId}
      OR EXISTS (
        SELECT 1
          FROM thread_participants caller_tp
         WHERE caller_tp.tenant_id = ${scope.tenantId}
           AND caller_tp.thread_id = t.id
           AND caller_tp.participant_type = 'user'
           AND caller_tp.user_id = ${callerUserId}
      )
    )
    AND (
      EXISTS (
        SELECT 1
          FROM spaces caller_space
         WHERE caller_space.tenant_id = ${scope.tenantId}
           AND caller_space.id = t.space_id
           AND caller_space.status = 'active'
           AND (
             caller_space.access_mode = 'public'
             OR EXISTS (
               SELECT 1
                 FROM space_members caller_sm
                WHERE caller_sm.tenant_id = ${scope.tenantId}
                  AND caller_sm.space_id = caller_space.id
                  AND caller_sm.user_id = ${callerUserId}
             )
           )
      )
      OR EXISTS (
        SELECT 1
          FROM thread_participants caller_tp_space
         WHERE caller_tp_space.tenant_id = ${scope.tenantId}
           AND caller_tp_space.thread_id = t.id
           AND caller_tp_space.participant_type = 'user'
           AND caller_tp_space.user_id = ${callerUserId}
      )
    )
  )`;
}
