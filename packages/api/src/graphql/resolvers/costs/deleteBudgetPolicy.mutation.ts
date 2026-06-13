import type { GraphQLContext } from "../../context.js";
import { db, eq, budgetPolicies } from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";

export const deleteBudgetPolicy = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  const [policy] = await db
    .select({ tenant_id: budgetPolicies.tenant_id })
    .from(budgetPolicies)
    .where(eq(budgetPolicies.id, args.id))
    .limit(1);
  if (!policy) return false;

  await requireAdminOrServiceCaller(
    ctx,
    policy.tenant_id,
    "budget_policy:delete",
  );

  const [deleted] = await db
    .delete(budgetPolicies)
    .where(eq(budgetPolicies.id, args.id))
    .returning();
  return !!deleted;
};
