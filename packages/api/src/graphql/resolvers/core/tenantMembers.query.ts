import type { GraphQLContext } from "../../context.js";
import { db, eq, tenantMembers, snakeToCamel } from "../../utils.js";
import { requireTenantMember } from "./authz.js";

export const tenantMembers_ = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  // Require a cognito caller to be a member of the requested tenant. Previously
  // any authenticated caller could enumerate any tenant's members and roles
  // (cross-tenant role enumeration). Service/apikey callers pass through.
  if (ctx.auth.authType === "cognito") {
    await requireTenantMember(ctx, args.tenantId);
  }
  const rows = await db
    .select()
    .from(tenantMembers)
    .where(eq(tenantMembers.tenant_id, args.tenantId));
  return Promise.all(
    rows.map(async (r) => {
      const isUser = r.principal_type.toLowerCase() === "user";
      const isAgent = r.principal_type.toLowerCase() === "agent";
      const [user, agent] = await Promise.all([
        isUser ? ctx.loaders.user.load(r.principal_id) : Promise.resolve(null),
        isAgent
          ? ctx.loaders.agent.load(r.principal_id)
          : Promise.resolve(null),
      ]);
      return {
        ...snakeToCamel(r),
        user: user ?? null,
        agent: agent ?? null,
      };
    }),
  );
};
