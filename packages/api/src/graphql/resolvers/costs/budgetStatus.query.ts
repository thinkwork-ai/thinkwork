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

export async function budgetStatusForPolicy(p: any, tenantId: string) {
  const monthStart = startOfMonth();
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
      total: sql<number>`COALESCE(SUM(amount_usd), 0)::float`,
    })
    .from(costEvents)
    .where(and(...conditions));
  const limitUsd = Number(p.limit_usd);
  const spentUsd = spend.total;
  const remainingUsd = Math.max(0, limitUsd - spentUsd);
  const percentUsed = limitUsd > 0 ? (spentUsd / limitUsd) * 100 : 0;
  const status =
    percentUsed >= 100 ? "exceeded" : percentUsed >= 80 ? "warning" : "normal";
  return {
    policy: snakeToCamel(p),
    spentUsd,
    remainingUsd,
    percentUsed,
    status,
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
