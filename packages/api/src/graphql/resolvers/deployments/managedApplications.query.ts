import { and, eq } from "drizzle-orm";
import { managedApplications } from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db, snakeToCamel } from "../../utils.js";
import { MANAGED_APP_CATALOG, requireDeploymentTenantAdmin } from "./shared.js";

export async function managedApplications_(
  _parent: unknown,
  _args: unknown,
  ctx: GraphQLContext,
) {
  const { tenantId } = await requireDeploymentTenantAdmin(ctx);
  const rows = await db
    .select()
    .from(managedApplications)
    .where(eq(managedApplications.tenant_id, tenantId));
  const byKey = new Map(rows.map((row) => [row.key, row]));

  return MANAGED_APP_CATALOG.map((app) => {
    const row = byKey.get(app.key);
    if (row) return snakeToCamel(row);
    return {
      id: `${tenantId}:${app.key}`,
      key: app.key,
      displayName: app.displayName,
      desiredStatus: "disabled",
      currentStatus: "unknown",
      desiredConfig: {},
      selectedReleaseVersion: null,
      selectedManifestDigest: null,
      lastJobId: null,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
  });
}

export async function loadManagedApplicationForTenant(
  tenantId: string,
  key: string,
) {
  const [row] = await db
    .select()
    .from(managedApplications)
    .where(
      and(
        eq(managedApplications.tenant_id, tenantId),
        eq(managedApplications.key, key),
      ),
    )
    .limit(1);
  return row ?? null;
}
