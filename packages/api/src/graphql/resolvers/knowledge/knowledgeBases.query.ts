import type { GraphQLContext } from "../../context.js";
import { db, eq, desc, knowledgeBases, snakeToCamel } from "../../utils.js";
import { requireTenantMember } from "../core/authz.js";

export const knowledgeBases_ = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  // Tenant-scope the list: a cognito caller may only enumerate KBs for a
  // tenant they belong to (U13 — previously any authenticated user could
  // read any tenant's KBs by passing a different tenantId). This query backs
  // both the operator console and the end-user browse, so it is gated at
  // member level, not admin. Service/apikey callers are trusted.
  if (ctx.auth.authType === "cognito") {
    await requireTenantMember(ctx, args.tenantId);
  }
  const rows = await db
    .select()
    .from(knowledgeBases)
    .where(eq(knowledgeBases.tenant_id, args.tenantId))
    .orderBy(desc(knowledgeBases.created_at));
  return rows.map(snakeToCamel);
};
