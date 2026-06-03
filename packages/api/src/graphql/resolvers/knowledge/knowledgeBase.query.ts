import type { GraphQLContext } from "../../context.js";
import { db, eq, knowledgeBases, snakeToCamel } from "../../utils.js";
import { requireTenantMember } from "../core/authz.js";

export const knowledgeBase = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  const [row] = await db
    .select()
    .from(knowledgeBases)
    .where(eq(knowledgeBases.id, args.id));
  if (!row) return null;
  // Tenant-scope the read: any member of the KB's tenant may view it (this
  // query backs both the operator console and the end-user browse), but a
  // cognito caller from another tenant must not read it (U13). Service/apikey
  // callers are trusted by the existing secret-holder model.
  if (ctx.auth.authType === "cognito") {
    await requireTenantMember(ctx, row.tenant_id);
  }
  return snakeToCamel(row);
};
