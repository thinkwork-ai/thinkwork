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

export const costSummary = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
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
