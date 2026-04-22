import type { GraphQLContext } from "../../context.js";
import { db, tenantMembers, snakeToCamel } from "../../utils.js";
import { requireTenantAdmin } from "./authz.js";

export const addTenantMember = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  await requireTenantAdmin(ctx, args.tenantId);
  const i = args.input;
  const [row] = await db
    .insert(tenantMembers)
    .values({
      tenant_id: args.tenantId,
      principal_type: i.principalType,
      principal_id: i.principalId,
      role: i.role ?? "member",
      status: "active",
    })
    .returning();
  return snakeToCamel(row);
};
