import type { GraphQLContext } from "../../context.js";
import { db, eq, and, budgetPolicies, users } from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { resolveCaller } from "../core/resolve-auth-user.js";
import { budgetStatusForPolicy } from "./budgetStatus.query.js";

export const userBudgetStatus = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  const caller =
    ctx.auth.authType === "cognito" ? await resolveCaller(ctx) : null;
  const isSelf = caller?.userId === args.userId;
  if (!isSelf) {
    await requireAdminOrServiceCaller(ctx, args.tenantId, "budget_policy:read");
  }

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, args.userId), eq(users.tenant_id, args.tenantId)))
    .limit(1);
  if (!user) {
    throw new Error("User not found in tenant");
  }

  const [policy] = await db
    .select()
    .from(budgetPolicies)
    .where(
      and(
        eq(budgetPolicies.tenant_id, args.tenantId),
        eq(budgetPolicies.scope, "user"),
        eq(budgetPolicies.user_id, args.userId),
        eq(budgetPolicies.enabled, true),
      ),
    )
    .limit(1);
  if (!policy) return null;

  return budgetStatusForPolicy(policy, args.tenantId);
};
