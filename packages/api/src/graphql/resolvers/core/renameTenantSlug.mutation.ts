import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { db, eq, ne, and, tenants, snakeToCamel } from "../../utils.js";
import { requireTenantAdmin } from "./authz.js";
import {
  hasPgErrorCode,
  tenantSlugError,
  validateTenantSlug,
} from "./tenantSlugValidation.js";

export const renameTenantSlug = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  if (ctx.auth.authType !== "cognito") {
    throw new GraphQLError("Tenant admin role required", {
      extensions: { code: "FORBIDDEN" },
    });
  }

  const tenantId = String(args.tenantId);
  const newSlug = String(args.newSlug ?? "");

  await requireTenantAdmin(ctx, tenantId);

  validateTenantSlug(newSlug);

  const [current] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  if (!current) {
    throw new GraphQLError("Tenant not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  if (current.slug === newSlug) {
    return snakeToCamel(current);
  }

  const [conflict] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.slug, newSlug), ne(tenants.id, tenantId)));
  if (conflict) {
    throw tenantSlugError("Tenant slug is unavailable", "SLUG_UNAVAILABLE");
  }

  try {
    const [updated] = await db
      .update(tenants)
      .set({ slug: newSlug, updated_at: new Date() })
      .where(eq(tenants.id, tenantId))
      .returning();
    if (!updated) {
      throw new GraphQLError("Tenant not found", {
        extensions: { code: "NOT_FOUND" },
      });
    }
    return snakeToCamel(updated);
  } catch (err) {
    if (hasPgErrorCode(err, "23505")) {
      throw tenantSlugError("Tenant slug is unavailable", "SLUG_UNAVAILABLE");
    }
    throw err;
  }
};
