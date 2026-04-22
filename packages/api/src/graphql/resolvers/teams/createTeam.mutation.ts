import type { GraphQLContext } from "../../context.js";
import { db, teams, snakeToCamel, generateSlug } from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";

export const createTeam = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  const i = args.input;
  await requireTenantAdmin(ctx, i.tenantId);
  const [row] = await db
    .insert(teams)
    .values({
      tenant_id: i.tenantId,
      name: i.name,
      slug: generateSlug(),
      description: i.description,
      type: i.type ?? "team",
      budget_monthly_cents: i.budgetMonthlyCents,
      metadata: i.metadata ? JSON.parse(i.metadata) : undefined,
    })
    .returning();
  return snakeToCamel(row);
};
