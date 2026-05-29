import type { GraphQLContext } from "../../context.js";
import { db, eq, tenants, snakeToCamel } from "../../utils.js";
import { requireTenantMember } from "./authz.js";

export const tenant = async (_parent: any, args: any, ctx: GraphQLContext) => {
  // Require a cognito caller to be a member of the requested tenant. Previously
  // this returned any tenant row to any authenticated caller (cross-tenant
  // disclosure). Service/apikey callers (trusted backends) pass through.
  if (ctx.auth.authType === "cognito") {
    await requireTenantMember(ctx, args.id);
  }
  const [row] = await db.select().from(tenants).where(eq(tenants.id, args.id));
  return row ? snakeToCamel(row) : null;
};
