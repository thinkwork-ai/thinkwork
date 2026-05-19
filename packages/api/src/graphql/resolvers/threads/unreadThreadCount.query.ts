import type { GraphQLContext } from "../../context.js";
import { db, eq, and, or, isNull, sql, threads } from "../../utils.js";
import {
  resolveCallerTenantId,
  resolveCallerUserId,
} from "../core/resolve-auth-user.js";

// Count of non-archived, non-task, top-level threads in the tenant (optionally
// filtered by agent) that have new activity the caller hasn't read yet. Mirrors
// the default filters in `threads.query.ts` so this count matches what hosts
// render in a chat-style inbox. Cognito callers prefer participant-scoped read
// state, with legacy thread-level read state retained for pre-participant rows.
export const unreadThreadCount = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  let callerUserId: string | null = null;
  if (ctx.auth?.authType === "cognito") {
    const callerTenantId = await resolveCallerTenantId(ctx);
    if (!callerTenantId || callerTenantId !== args.tenantId) return 0;
    callerUserId = await resolveCallerUserId(ctx);
    if (!callerUserId) return 0;
  }

  const activityExpression = sql`COALESCE(${threads.last_turn_completed_at}, ${threads.updated_at})`;
  const conditions = [
    eq(threads.tenant_id, args.tenantId),
    isNull(threads.archived_at),
    sql`${threads.channel} != 'task'`,
    isNull(threads.parent_id),
  ];
  if (args.agentId) conditions.push(eq(threads.agent_id, args.agentId));
  if (callerUserId) {
    conditions.push(sql`(
			EXISTS (
				SELECT 1
				FROM thread_participants tp
				WHERE tp.tenant_id = ${threads.tenant_id}
					AND tp.thread_id = ${threads.id}
					AND tp.participant_type = 'user'
					AND tp.user_id = ${callerUserId}::uuid
					AND (tp.last_read_at IS NULL OR ${activityExpression} > tp.last_read_at)
			)
			OR (
				${threads.user_id} = ${callerUserId}::uuid
				AND NOT EXISTS (
					SELECT 1
					FROM thread_participants tp_legacy
					WHERE tp_legacy.tenant_id = ${threads.tenant_id}
						AND tp_legacy.thread_id = ${threads.id}
						AND tp_legacy.participant_type = 'user'
				)
				AND (${threads.last_read_at} IS NULL OR ${activityExpression} > ${threads.last_read_at})
			)
		)`);
  } else {
    conditions.push(
      or(
        isNull(threads.last_read_at),
        sql`${activityExpression} > ${threads.last_read_at}`,
      )!,
    );
  }

  const [row] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(threads)
    .where(and(...conditions));

  return row?.count ?? 0;
};
