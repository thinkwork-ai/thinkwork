/**
 * rebuildSkillCatalogIndex — reconcile the skill_catalog index from the S3
 * catalog (plan 2026-06-04-002 U6). Backs the launch backfill and operator
 * drift recovery; powers `thinkwork skill catalog rebuild`.
 *
 * Authorization:
 *  - `all: true` (every tenant) requires platform-operator — a tenant admin
 *    must not be able to rescan other tenants.
 *  - single-tenant requires tenant admin for the target tenant (defaults to
 *    the caller's tenant).
 *
 * Synchronous: `rescanTenant` lists S3 + upserts per tenant inline, returning
 * counts. No async job surface (unlike wiki) — a reconcile is fast and the
 * operator wants the counts back in the same call.
 */

import { GraphQLError } from "graphql";
import { S3Client } from "@aws-sdk/client-s3";
import type { GraphQLContext } from "../../context.js";
import { db, eq, tenants } from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";
import { resolveCallerTenantId } from "../core/resolve-auth-user.js";
import { isPlatformOperator } from "../../../lib/compliance/resolver-auth.js";
import { rebuildTenantCatalogIndex } from "../../../lib/catalog-index.js";

interface RebuildArgs {
  tenantId?: string | null;
  all?: boolean | null;
  dryRun?: boolean | null;
}

export const rebuildSkillCatalogIndex = async (
  _parent: unknown,
  args: RebuildArgs,
  ctx: GraphQLContext,
) => {
  const all = args.all === true;
  const dryRun = args.dryRun === true;

  const bucket = process.env.WORKSPACE_BUCKET;
  if (!bucket) {
    throw new GraphQLError("WORKSPACE_BUCKET not configured", {
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });
  }
  const client = new S3Client({
    region:
      process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
  });

  let targets: { id: string; slug: string }[];
  if (all) {
    if (!isPlatformOperator(ctx)) {
      throw new GraphQLError(
        "Platform operator role required to rebuild all tenants",
        { extensions: { code: "FORBIDDEN" } },
      );
    }
    targets = (
      await db.select({ id: tenants.id, slug: tenants.slug }).from(tenants)
    ).filter((t): t is { id: string; slug: string } => Boolean(t.slug));
  } else {
    const tenantId = args.tenantId ?? (await resolveCallerTenantId(ctx));
    if (!tenantId) {
      throw new GraphQLError("tenantId is required", {
        extensions: { code: "BAD_USER_INPUT" },
      });
    }
    await requireTenantAdmin(ctx, tenantId);
    const [tenant] = await db
      .select({ id: tenants.id, slug: tenants.slug })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    if (!tenant?.slug) {
      throw new GraphQLError("Tenant not found", {
        extensions: { code: "NOT_FOUND" },
      });
    }
    targets = [{ id: tenant.id, slug: tenant.slug }];
  }

  const results = [];
  for (const target of targets) {
    const counts = await rebuildTenantCatalogIndex({
      tenantId: target.id,
      tenantSlug: target.slug,
      client,
      bucket,
      dryRun,
    });
    results.push({
      tenantId: target.id,
      tenantSlug: target.slug,
      skillsInS3: counts.skillsInS3,
      rowsUpserted: counts.rowsUpserted,
      rowsSkipped: counts.rowsSkipped,
      rowsDeleted: counts.rowsDeleted,
      dryRun,
    });
  }
  return results;
};
