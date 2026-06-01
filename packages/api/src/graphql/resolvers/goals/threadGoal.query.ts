import type { GraphQLContext } from "../../context.js";
import { and, db, eq, goals, snakeToCamel, threads } from "../../utils.js";
import {
  resolveCallerTenantId,
  resolveCallerUserId,
} from "../core/resolve-auth-user.js";
import { callerVisibleThreadPredicate } from "../threads/access.js";

type ThreadGoalArgs = {
  tenantId: string;
  threadId: string;
};

export async function threadGoal(
  _parent: unknown,
  args: ThreadGoalArgs,
  ctx: GraphQLContext,
) {
  return findThreadGoalForVisibleThread(args, ctx);
}

export async function findThreadGoalForVisibleThread(
  args: ThreadGoalArgs,
  ctx: GraphQLContext,
) {
  let conditions = and(
    eq(goals.tenant_id, args.tenantId),
    eq(goals.thread_id, args.threadId),
    eq(threads.tenant_id, args.tenantId),
    eq(threads.id, args.threadId),
  );

  if (ctx.auth.authType !== "cognito") {
    return null;
  }

  if (ctx.auth.authType === "cognito") {
    const callerTenantId = await resolveCallerTenantId(ctx);
    if (!callerTenantId || callerTenantId !== args.tenantId) return null;

    const callerUserId = await resolveCallerUserId(ctx);
    if (!callerUserId) return null;

    conditions = and(
      conditions,
      callerVisibleThreadPredicate(callerTenantId, callerUserId),
    );
  }

  const rows = await db
    .select({
      id: goals.id,
      tenant_id: goals.tenant_id,
      space_id: goals.space_id,
      thread_id: goals.thread_id,
      agent_id: threads.agent_id,
      user_id: threads.user_id,
      workspace_folder_name: threads.workspace_folder_name,
      template_key: goals.template_key,
      outcome: goals.outcome,
      owner_type: goals.owner_type,
      owner_id: goals.owner_id,
      mode: goals.mode,
      status: goals.status,
      progress_model: goals.progress_model,
      completion_rule: goals.completion_rule,
      review_policy: goals.review_policy,
      reviewer_type: goals.reviewer_type,
      reviewer_id: goals.reviewer_id,
      started_at: goals.started_at,
      reviewed_at: goals.reviewed_at,
      completed_at: goals.completed_at,
      cancelled_at: goals.cancelled_at,
      metadata: goals.metadata,
      created_at: goals.created_at,
      updated_at: goals.updated_at,
    })
    .from(goals)
    .innerJoin(
      threads,
      and(
        eq(threads.id, goals.thread_id),
        eq(threads.tenant_id, goals.tenant_id),
      ),
    )
    .where(conditions)
    .limit(1);

  const row = rows[0];
  return row ? threadGoalToGraphql(row) : null;
}

export function threadGoalToGraphql(row: Record<string, unknown>) {
  const result = snakeToCamel(row);
  if (typeof result.mode === "string") {
    result.mode = result.mode.toUpperCase();
  }
  if (typeof result.status === "string") {
    result.status = result.status.toUpperCase();
  }
  return result;
}
