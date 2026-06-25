import type { GraphQLContext } from "../../context.js";
import { db, eq, and, budgetPolicies } from "../../utils.js";
import { budgetStatusForPolicy } from "./budgetStatus.query.js";

export const agentBudgetStatus = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  const [p] = await db
    .select()
    .from(budgetPolicies)
    .where(
      and(
        eq(budgetPolicies.agent_id, args.agentId),
        eq(budgetPolicies.scope, "agent"),
        eq(budgetPolicies.enabled, true),
      ),
    )
    .limit(1);
  if (!p) return null;
  return budgetStatusForPolicy(p, p.tenant_id);
};
