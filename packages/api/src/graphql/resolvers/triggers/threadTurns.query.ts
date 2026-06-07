import type { GraphQLContext } from "../../context.js";
import {
  db,
  eq,
  and,
  desc,
  sql,
  inArray,
  scheduledJobs,
  threadTurns,
  costEvents,
  snakeToCamel,
} from "../../utils.js";
import { withRuntimeType } from "./threadTurnRuntime.js";

export const threadTurns_ = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  const conditions = [eq(threadTurns.tenant_id, args.tenantId)];
  if (args.agentId) conditions.push(eq(threadTurns.agent_id, args.agentId));
  if (args.routineId)
    conditions.push(eq(threadTurns.routine_id, args.routineId));
  if (args.threadId) conditions.push(eq(threadTurns.thread_id, args.threadId));
  if (args.jobId) conditions.push(eq(threadTurns.trigger_id, args.jobId));
  if (args.status)
    conditions.push(eq(threadTurns.status, args.status.toLowerCase()));
  const limit = Math.min(args.limit || 50, 200);
  const rows = await db
    .select({
      id: threadTurns.id,
      tenant_id: threadTurns.tenant_id,
      trigger_id: threadTurns.trigger_id,
      agent_id: threadTurns.agent_id,
      thread_id: threadTurns.thread_id,
      runtime_type: threadTurns.runtime_type,
      routine_id: threadTurns.routine_id,
      invocation_source: threadTurns.invocation_source,
      trigger_detail: threadTurns.trigger_detail,
      wakeup_request_id: threadTurns.wakeup_request_id,
      status: threadTurns.status,
      started_at: threadTurns.started_at,
      finished_at: threadTurns.finished_at,
      error: threadTurns.error,
      error_code: threadTurns.error_code,
      system_prompt: threadTurns.system_prompt,
      usage_json: threadTurns.usage_json,
      result_json: threadTurns.result_json,
      context_snapshot: threadTurns.context_snapshot,
      session_id_before: threadTurns.session_id_before,
      session_id_after: threadTurns.session_id_after,
      external_run_id: threadTurns.external_run_id,
      log_store: threadTurns.log_store,
      log_ref: threadTurns.log_ref,
      log_bytes: threadTurns.log_bytes,
      log_sha256: threadTurns.log_sha256,
      log_compressed: threadTurns.log_compressed,
      stdout_excerpt: threadTurns.stdout_excerpt,
      stderr_excerpt: threadTurns.stderr_excerpt,
      created_at: threadTurns.created_at,
      trigger_name: scheduledJobs.name,
    })
    .from(threadTurns)
    .leftJoin(scheduledJobs, eq(threadTurns.trigger_id, scheduledJobs.id))
    .where(and(...conditions))
    .orderBy(desc(threadTurns.started_at))
    .limit(limit);

  // Batch-resolve totalCost per turn from parent cost events plus routed child
  // model events. Child rows use metadata.parent_request_id because their
  // request_id is `${turnId}:tool:${toolCallId}:model`.
  const requestIds = [
    ...new Set(
      rows.flatMap((r) =>
        [r.id, r.wakeup_request_id].filter(Boolean) as string[],
      ),
    ),
  ];
  const directCostByRequestId = new Map<string, number>();
  if (requestIds.length > 0) {
    try {
      const costRows = await db
        .select({
          request_id: costEvents.request_id,
          total: sql<string>`COALESCE(SUM(amount_usd), 0)`,
        })
        .from(costEvents)
        .where(inArray(costEvents.request_id, requestIds))
        .groupBy(costEvents.request_id);
      for (const row of costRows) {
        directCostByRequestId.set(row.request_id, Number(row.total));
      }
    } catch (costErr) {
      console.error("[graphql] ThreadTurn direct cost batch failed:", costErr);
    }
  }

  const turnIds = rows.map((r) => r.id);
  const childCostByTurnId = new Map<string, number>();
  if (turnIds.length > 0) {
    try {
      const childCostRows = await db
        .select({
          parent_request_id: sql<string>`${costEvents.metadata}->>'parent_request_id'`,
          total: sql<string>`COALESCE(SUM(amount_usd), 0)`,
        })
        .from(costEvents)
        .where(
          and(
            eq(costEvents.tenant_id, args.tenantId),
            inArray(
              sql`${costEvents.metadata}->>'parent_request_id'`,
              turnIds,
            ),
          ),
        )
        .groupBy(sql`${costEvents.metadata}->>'parent_request_id'`);
      for (const row of childCostRows) {
        if (!row.parent_request_id) continue;
        childCostByTurnId.set(row.parent_request_id, Number(row.total));
      }
    } catch (costErr) {
      console.error("[graphql] ThreadTurn child cost batch failed:", costErr);
    }
  }

  return rows.map((r) => {
    const directRequestIds = [
      ...new Set(
        [r.id, r.wakeup_request_id].filter(Boolean) as string[],
      ),
    ];
    const directCost = directRequestIds.reduce(
      (sum, requestId) => sum + (directCostByRequestId.get(requestId) ?? 0),
      0,
    );
    const totalCost = directCost + (childCostByTurnId.get(r.id) ?? 0);
    return {
      ...withRuntimeType(snakeToCamel(r)),
      totalCost: totalCost > 0 ? totalCost : null,
    };
  });
};
