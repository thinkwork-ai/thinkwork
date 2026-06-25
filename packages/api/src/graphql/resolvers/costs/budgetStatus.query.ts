import type { GraphQLContext } from "../../context.js";
import {
  db,
  eq,
  and,
  gte,
  sql,
  costEvents,
  budgetPolicies,
  snakeToCamel,
  startOfMonth,
} from "../../utils.js";
import {
  budgetMinimumReconciliationStateFromEnv,
  mapConfidenceBreakdown,
} from "../../../lib/cost-confidence.js";

export async function budgetStatusForPolicy(p: any, tenantId: string) {
  const monthStart = startOfMonth();
  const minimumReconciliationState = budgetMinimumReconciliationStateFromEnv();
  const conditions = [
    eq(costEvents.tenant_id, tenantId),
    gte(costEvents.created_at, monthStart),
  ];
  if (p.scope === "agent" && p.agent_id) {
    conditions.push(eq(costEvents.agent_id, p.agent_id));
  }
  if (p.scope === "user" && p.user_id) {
    conditions.push(eq(costEvents.user_id, p.user_id));
  }

  const [spend] = await db
    .select({
      totalUsd: sql<number>`COALESCE(SUM(${costEvents.amount_usd}), 0)::float`,
      estimatedUsd: sql<number>`COALESCE(SUM(CASE WHEN ${costEvents.reconciliation_state} = 'runtime-reported' THEN ${costEvents.amount_usd} ELSE 0 END), 0)::float`,
      invocationReconciledUsd: sql<number>`COALESCE(SUM(CASE WHEN ${costEvents.reconciliation_state} = 'invocation-reconciled' THEN ${costEvents.amount_usd} ELSE 0 END), 0)::float`,
      billReconciledUsd: sql<number>`COALESCE(SUM(CASE WHEN ${costEvents.reconciliation_state} = 'bill-reconciled' THEN ${costEvents.amount_usd} ELSE 0 END), 0)::float`,
      mismatchUsd: sql<number>`COALESCE(SUM(CASE WHEN ${costEvents.reconciliation_state} = 'mismatch' THEN ${costEvents.amount_usd} ELSE 0 END), 0)::float`,
      unreconciledUsd: sql<number>`COALESCE(SUM(CASE WHEN ${costEvents.reconciliation_state} = 'unreconciled/error' THEN ${costEvents.amount_usd} ELSE 0 END), 0)::float`,
    })
    .from(costEvents)
    .where(and(...conditions));
  const limitUsd = Number(p.limit_usd);
  const legacyTotal = (spend as { total?: unknown } | undefined)?.total;
  const confidence = mapConfidenceBreakdown(
    {
      totalUsd: spend?.totalUsd ?? legacyTotal,
      enforcedUsd:
        legacyTotal === undefined
          ? undefined
          : (spend?.billReconciledUsd ?? legacyTotal),
      estimatedUsd: spend?.estimatedUsd,
      invocationReconciledUsd: spend?.invocationReconciledUsd,
      billReconciledUsd: spend?.billReconciledUsd,
      mismatchUsd: spend?.mismatchUsd,
      unreconciledUsd: spend?.unreconciledUsd,
    },
    minimumReconciliationState,
  );
  const spentUsd = confidence.enforcedUsd;
  const remainingUsd = Math.max(0, limitUsd - spentUsd);
  const percentUsed = limitUsd > 0 ? (spentUsd / limitUsd) * 100 : 0;
  const status =
    percentUsed >= 100 ? "exceeded" : percentUsed >= 80 ? "warning" : "normal";
  return {
    policy: snakeToCamel(p),
    spentUsd,
    visibleSpendUsd: confidence.totalUsd,
    remainingUsd,
    percentUsed,
    status,
    minimumReconciliationState,
    estimatedUsd: confidence.estimatedUsd,
    invocationReconciledUsd: confidence.invocationReconciledUsd,
    billReconciledUsd: confidence.billReconciledUsd,
    mismatchUsd: confidence.mismatchUsd,
    unreconciledUsd: confidence.unreconciledUsd,
  };
}

export const budgetStatus = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  const policies = await db
    .select()
    .from(budgetPolicies)
    .where(
      and(
        eq(budgetPolicies.tenant_id, args.tenantId),
        eq(budgetPolicies.enabled, true),
      ),
    );
  return Promise.all(
    policies.map((p) => budgetStatusForPolicy(p, args.tenantId)),
  );
};
