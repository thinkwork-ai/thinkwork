import type { GraphQLContext } from "../../context.js";
import {
  db,
  eq,
  and,
  gte,
  lte,
  sql,
  costEvents,
  startOfMonth,
} from "../../utils.js";
import {
  budgetMinimumReconciliationStateFromEnv,
  mapConfidenceBreakdown,
} from "../../../lib/cost-confidence.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { computeCacheUsdByModel } from "./cache-usd.js";
// System-source IN list is baked into the SQL templates below (tests mock
// the drizzle `sql` helper, so sql.raw is unavailable). Keep in sync with
// SYSTEM_COST_SOURCES in lib/cost-sources.ts.

export const costSummary = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  // THINK-245 (review P0): tenant-wide financial data — gate like the
  // sibling accountUsage resolver instead of trusting args.tenantId.
  await requireAdminOrServiceCaller(ctx, args.tenantId, "cost_summary:read");

  const from = args.from ? new Date(args.from) : startOfMonth();
  const to = args.to ? new Date(args.to) : new Date();
  const minimumReconciliationState = budgetMinimumReconciliationStateFromEnv();
  const [total] = await db
    .select({
      totalUsd: sql<number>`COALESCE(SUM(${costEvents.amount_usd}), 0)::float`,
      llmUsd: sql<number>`COALESCE(SUM(CASE WHEN ${costEvents.event_type} = 'llm' THEN ${costEvents.amount_usd} ELSE 0 END), 0)::float`,
      computeUsd: sql<number>`COALESCE(SUM(CASE WHEN ${costEvents.event_type} = 'agentcore_compute' THEN ${costEvents.amount_usd} ELSE 0 END), 0)::float`,
      toolsUsd: sql<number>`COALESCE(SUM(CASE WHEN ${costEvents.event_type} NOT IN ('llm', 'agentcore_compute', 'eval') THEN ${costEvents.amount_usd} ELSE 0 END), 0)::float`,
      evalUsd: sql<number>`COALESCE(SUM(CASE WHEN ${costEvents.event_type} = 'eval' THEN ${costEvents.amount_usd} ELSE 0 END), 0)::float`,
      estimatedUsd: sql<number>`COALESCE(SUM(CASE WHEN ${costEvents.reconciliation_state} = 'runtime-reported' THEN ${costEvents.amount_usd} ELSE 0 END), 0)::float`,
      invocationReconciledUsd: sql<number>`COALESCE(SUM(CASE WHEN ${costEvents.reconciliation_state} = 'invocation-reconciled' THEN ${costEvents.amount_usd} ELSE 0 END), 0)::float`,
      billReconciledUsd: sql<number>`COALESCE(SUM(CASE WHEN ${costEvents.reconciliation_state} = 'bill-reconciled' THEN ${costEvents.amount_usd} ELSE 0 END), 0)::float`,
      mismatchUsd: sql<number>`COALESCE(SUM(CASE WHEN ${costEvents.reconciliation_state} = 'mismatch' THEN ${costEvents.amount_usd} ELSE 0 END), 0)::float`,
      unreconciledUsd: sql<number>`COALESCE(SUM(CASE WHEN ${costEvents.reconciliation_state} = 'unreconciled/error' THEN ${costEvents.amount_usd} ELSE 0 END), 0)::float`,
      totalInputTokens: sql<number>`COALESCE(SUM(${costEvents.input_tokens}), 0)::int`,
      totalOutputTokens: sql<number>`COALESCE(SUM(${costEvents.output_tokens}), 0)::int`,
      totalCachedReadTokens: sql<number>`COALESCE(SUM(${costEvents.cached_read_tokens}), 0)::int`,
      totalCachedWriteTokens: sql<number>`COALESCE(SUM(${costEvents.cached_write_tokens}), 0)::int`,
      systemUsd: sql<number>`COALESCE(SUM(CASE WHEN ${costEvents.metadata} ->> 'source' IN ('wiki_compile', 'conformance_judge', 'kg_extraction', 'model_converse', 'idle_learning', 'dreaming', 'backfill_daily_adjustment') THEN ${costEvents.amount_usd} ELSE 0 END), 0)::float`,
      eventCount: sql<number>`COUNT(*)::int`,
    })
    .from(costEvents)
    .where(
      and(
        eq(costEvents.tenant_id, args.tenantId),
        gte(costEvents.created_at, from),
        lte(costEvents.created_at, to),
      ),
    );
  // Cache dollars need per-model rates — aggregate cache tokens by model.
  const cacheRows = await db
    .select({
      model: costEvents.model,
      cachedReadTokens: sql<number>`COALESCE(SUM(${costEvents.cached_read_tokens}), 0)::float`,
      cachedWriteTokens: sql<number>`COALESCE(SUM(${costEvents.cached_write_tokens}), 0)::float`,
    })
    .from(costEvents)
    .where(
      and(
        eq(costEvents.tenant_id, args.tenantId),
        gte(costEvents.created_at, from),
        lte(costEvents.created_at, to),
      ),
    )
    .groupBy(costEvents.model);
  const cacheUsd = computeCacheUsdByModel(cacheRows);

  const confidence = mapConfidenceBreakdown(
    {
      totalUsd: total?.totalUsd,
      estimatedUsd: total?.estimatedUsd,
      invocationReconciledUsd: total?.invocationReconciledUsd,
      billReconciledUsd: total?.billReconciledUsd,
      mismatchUsd: total?.mismatchUsd,
      unreconciledUsd: total?.unreconciledUsd,
    },
    minimumReconciliationState,
  );
  return {
    ...total,
    cacheUsd,
    conversationUsd:
      Math.round(
        ((total?.totalUsd ?? 0) - (total?.systemUsd ?? 0)) * 1_000_000,
      ) / 1_000_000,
    enforcedUsd: confidence.enforcedUsd,
    estimatedUsd: confidence.estimatedUsd,
    invocationReconciledUsd: confidence.invocationReconciledUsd,
    billReconciledUsd: confidence.billReconciledUsd,
    mismatchUsd: confidence.mismatchUsd,
    unreconciledUsd: confidence.unreconciledUsd,
    minimumReconciliationState,
    periodStart: from.toISOString(),
    periodEnd: to.toISOString(),
  };
};
