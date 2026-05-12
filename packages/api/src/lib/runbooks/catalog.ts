import { and, asc, eq, ne, notInArray, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { tenantRunbookCatalog } from "@thinkwork/database-pg/schema";
import type { RunbookDefinition } from "@thinkwork/runbooks";

const db = getDb();

export type RunbookCatalogRow = typeof tenantRunbookCatalog.$inferSelect;

export type RunbookCatalogSeedRow = {
  tenant_id: string;
  slug: string;
  source_version: string;
  display_name: string;
  description: string;
  category: string;
  status: "active";
  enabled: true;
  definition: RunbookDefinition;
};

export function buildRunbookCatalogSeedRows(input: {
  tenantId: string;
  definitions?: RunbookDefinition[];
}): RunbookCatalogSeedRow[] {
  return [...(input.definitions ?? [])]
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map((definition) => ({
      tenant_id: input.tenantId,
      slug: definition.slug,
      source_version: definition.version,
      display_name: definition.catalog.displayName,
      description: definition.catalog.description,
      category: definition.catalog.category,
      status: "active",
      enabled: true,
      definition,
    }));
}

export function getUnavailableCatalogSlugs(input: {
  existingSlugs: string[];
  sourceSlugs: string[];
}): string[] {
  const source = new Set(input.sourceSlugs);
  return input.existingSlugs
    .filter((slug) => !source.has(slug))
    .sort((a, b) => a.localeCompare(b));
}

export async function seedRunbookCatalogForTenant(input: {
  tenantId: string;
  definitions?: RunbookDefinition[];
  markUnavailable?: boolean;
}) {
  const rows = buildRunbookCatalogSeedRows(input);
  if (rows.length > 0) {
    await db
      .insert(tenantRunbookCatalog)
      .values(rows)
      .onConflictDoUpdate({
        target: [tenantRunbookCatalog.tenant_id, tenantRunbookCatalog.slug],
        set: {
          source_version: sqlExcluded("source_version"),
          display_name: sqlExcluded("display_name"),
          description: sqlExcluded("description"),
          category: sqlExcluded("category"),
          status: "active",
          enabled: true,
          definition: sqlExcluded("definition"),
          updated_at: new Date(),
        },
      });
  }

  if (input.markUnavailable) {
    const activeSlugs = rows.map((row) => row.slug);
    const unavailableWhere =
      activeSlugs.length === 0
        ? and(
            eq(tenantRunbookCatalog.tenant_id, input.tenantId),
            ne(tenantRunbookCatalog.status, "archived"),
          )
        : and(
            eq(tenantRunbookCatalog.tenant_id, input.tenantId),
            ne(tenantRunbookCatalog.status, "archived"),
            notInArray(tenantRunbookCatalog.slug, activeSlugs),
          );
    await db
      .update(tenantRunbookCatalog)
      .set({ status: "unavailable", enabled: false, updated_at: new Date() })
      .where(unavailableWhere);
  }

  return listRunbookCatalog({ tenantId: input.tenantId });
}

export async function listRunbookCatalog(input: { tenantId: string }) {
  const rows = await db
    .select()
    .from(tenantRunbookCatalog)
    .where(eq(tenantRunbookCatalog.tenant_id, input.tenantId))
    .orderBy(asc(tenantRunbookCatalog.display_name));
  return rows.map(toGraphqlRunbookCatalogItem);
}

export function toGraphqlRunbookCatalogItem(row: RunbookCatalogRow) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    slug: row.slug,
    sourceVersion: row.source_version,
    displayName: row.display_name,
    description: row.description,
    category: row.category,
    status: enumToGraphql(row.status),
    enabled: row.enabled,
    definition: row.definition,
    operatorOverrides: row.operator_overrides ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function enumToGraphql(value: string) {
  return value.toUpperCase();
}

function sqlExcluded(columnName: string) {
  return sql.raw(`excluded.${columnName}`);
}
