import type { GraphQLContext } from "../../context.js";
import {
  and,
  db,
  eq,
  inArray,
  skillCatalog as skillCatalogTable,
  tenantSkills,
} from "../../utils.js";
import { resolveCaller } from "../core/resolve-auth-user.js";

/**
 * Read the caller's tenant skill catalog. tenant_skills is the per-tenant
 * "what's installed" table; the global skill_catalog supplies display
 * metadata (display_name, description, category, icon). We left-join in
 * application code rather than SQL — Drizzle's join API generates noisy
 * column aliases that don't survive the row mapping cleanly here, and the
 * skill_catalog set is bounded.
 */
export async function skillCatalog(
  _parent: unknown,
  _args: unknown,
  ctx: GraphQLContext,
) {
  const { tenantId } = await resolveCaller(ctx);
  if (!tenantId) return [];

  const installed = await db
    .select()
    .from(tenantSkills)
    .where(eq(tenantSkills.tenant_id, tenantId));
  if (installed.length === 0) return [];

  const skillIds = installed.map((row) => row.skill_id);
  const catalogRows = await db
    .select()
    .from(skillCatalogTable)
    .where(inArray(skillCatalogTable.slug, skillIds));
  const catalogBySlug = new Map<string, (typeof catalogRows)[number]>();
  for (const row of catalogRows) {
    catalogBySlug.set(row.slug, row);
  }

  return installed.map((tenant) => {
    const meta = catalogBySlug.get(tenant.skill_id);
    const displayName =
      meta?.display_name ?? humanizeSlug(tenant.skill_id);
    return {
      id: tenant.id,
      tenantId: tenant.tenant_id,
      skillId: tenant.skill_id,
      displayName,
      description: meta?.description ?? null,
      category: meta?.category ?? null,
      icon: meta?.icon ?? null,
      source: tenant.source,
      enabled: tenant.enabled,
    };
  });
}

function humanizeSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
// Suppress unused warning when Drizzle's `and` is not directly referenced.
void and;
