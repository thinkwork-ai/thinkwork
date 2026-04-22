import type { GraphQLContext } from "../../context.js";
import { db, eq, tenants, snakeToCamel } from "../../utils.js";
import { requireTenantAdmin } from "./authz.js";

export const updateTenant = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  await requireTenantAdmin(ctx, args.id);
  const i = args.input;
  const updates: Record<string, unknown> = { updated_at: new Date() };
  if (i.name !== undefined) updates.name = i.name;
  if (i.plan !== undefined) updates.plan = i.plan;
  if (i.issuePrefix !== undefined) updates.issue_prefix = i.issuePrefix;
  const [row] = await db
    .update(tenants)
    .set(updates)
    .where(eq(tenants.id, args.id))
    .returning();
  if (!row) throw new Error("Tenant not found");
  return snakeToCamel(row);
};
