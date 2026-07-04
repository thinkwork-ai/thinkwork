import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
  db,
  eq,
  and,
  gt,
  threadTurns,
  threadTurnEvents,
  threads,
  snakeToCamel,
} from "../../utils.js";
import { hasServiceSecret, requireTenantMember } from "../core/authz.js";
import { resolveCallerFromAuth } from "../core/resolve-auth-user.js";
import { callerVisibleThreadPredicate } from "../threads/access.js";

/**
 * Turn-event replay is the pipeline canvas STATE_SNAPSHOT events ride on
 * (THINK-145 U3), so this query — previously unguarded (KTD5) — must scope to
 * the caller's tenant and the originating thread's visibility before it serves
 * any rows.
 *
 * Gate (cognito callers):
 *   - tenant membership on the run's tenant (cross-tenant fails closed);
 *   - for a thread-scoped run, the originating thread must be caller-visible
 *     (participant/creator/work-item) OR the caller is a tenant admin/owner —
 *     the admin bypass keeps the operator activity-trace surface
 *     (SettingsActivityExecutionTrace) working for background and other users'
 *     runs;
 *   - a thread-less run (scheduled/webhook/email background work) has no thread
 *     to gate on, so tenant membership is sufficient.
 *
 * Service-secret callers (trusted infra / CLI operator back-channel) bypass.
 */
export const threadTurnEvents_ = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  const [turn] = await db
    .select({
      tenant_id: threadTurns.tenant_id,
      thread_id: threadTurns.thread_id,
    })
    .from(threadTurns)
    .where(eq(threadTurns.id, args.runId));
  // Unknown run: return empty rather than leaking existence.
  if (!turn) return [];

  if (!hasServiceSecret(ctx)) {
    const role = await requireTenantMember(ctx, turn.tenant_id);
    const isTenantAdmin = role === "owner" || role === "admin";
    if (turn.thread_id && !isTenantAdmin) {
      const caller = await resolveCallerFromAuth(ctx.auth);
      if (!caller.userId || caller.tenantId !== turn.tenant_id) {
        throw forbidden();
      }
      const [visibleThread] = await db
        .select({ id: threads.id })
        .from(threads)
        .where(
          and(
            eq(threads.id, turn.thread_id),
            eq(threads.tenant_id, turn.tenant_id),
            callerVisibleThreadPredicate(turn.tenant_id, caller.userId),
          ),
        );
      if (!visibleThread) throw forbidden();
    }
  }

  const conditions = [eq(threadTurnEvents.run_id, args.runId)];
  if (args.afterSeq != null) {
    conditions.push(gt(threadTurnEvents.seq, args.afterSeq));
  }
  const limit = Math.min(args.limit || 100, 500);
  const rows = await db
    .select()
    .from(threadTurnEvents)
    .where(and(...conditions))
    .orderBy(threadTurnEvents.seq)
    .limit(limit);
  return rows.map(snakeToCamel);
};

function forbidden(): GraphQLError {
  return new GraphQLError("Thread turn events require thread access", {
    extensions: { code: "FORBIDDEN" },
  });
}
