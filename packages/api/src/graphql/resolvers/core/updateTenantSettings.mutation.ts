import type { GraphQLContext } from "../../context.js";
import { db, eq, tenantSettings, snakeToCamel } from "../../utils.js";
import { normalizeGoalDefaultTokenBudgetInput } from "../../../lib/goal-budget.js";
import { requireAdminOrServiceCaller } from "./authz.js";
import { republishUserClaimsQuietly } from "./userBrainClaims.js";

export const updateTenantSettings = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  await requireAdminOrServiceCaller(
    ctx,
    args.tenantId,
    "update_tenant_settings",
  );
  const i = args.input;
  const updates: Record<string, unknown> = { updated_at: new Date() };
  if (i.defaultModel !== undefined) updates.default_model = i.defaultModel;
  if (i.budgetMonthlyCents !== undefined)
    updates.budget_monthly_cents = i.budgetMonthlyCents;
  if (i.goalDefaultTokenBudget !== undefined) {
    updates.goal_default_token_budget = normalizeGoalDefaultTokenBudgetInput(
      i.goalDefaultTokenBudget,
    );
  }
  if (i.autoCloseThreadMinutes !== undefined)
    updates.auto_close_thread_minutes = i.autoCloseThreadMinutes;
  if (i.maxAgents !== undefined) updates.max_agents = i.maxAgents;
  if (
    i.brainUserClaimsEnabled !== undefined &&
    i.brainUserClaimsEnabled !== null
  )
    updates.brain_user_claims_enabled = i.brainUserClaimsEnabled;
  if (i.features !== undefined) updates.features = JSON.parse(i.features);
  const [row] = await db
    .update(tenantSettings)
    .set(updates)
    .where(eq(tenantSettings.tenant_id, args.tenantId))
    .returning();
  if (!row) throw new Error("Tenant settings not found");
  // The claims interlock is only real if flipping it acts immediately: on
  // means publish the tenant's full manifest, off means delete the object.
  // The publisher reads the freshly-committed flag and does whichever.
  if (updates.brain_user_claims_enabled !== undefined) {
    await republishUserClaimsQuietly(args.tenantId);
  }
  return snakeToCamel(row);
};
