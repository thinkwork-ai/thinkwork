/**
 * Canonical entity registry queries (THINK-193 U4). Tenant-admin gated.
 */

import { and, desc, eq, ilike, inArray, or } from "drizzle-orm";
import {
  canonicalEntities as canonicalEntitiesTable,
  entitySourceMappings,
} from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { requireTenantAdmin } from "../core/authz.js";
import { resolveCallerTenantId } from "../core/resolve-auth-user.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

type CanonicalRow = typeof canonicalEntitiesTable.$inferSelect;
type MappingRow = typeof entitySourceMappings.$inferSelect;

export async function resolveTenantId(
  ctx: GraphQLContext,
  tenantId?: string | null,
): Promise<string> {
  const resolved =
    tenantId ?? ctx.auth.tenantId ?? (await resolveCallerTenantId(ctx));
  if (!resolved) throw new Error("Tenant context required");
  await requireTenantAdmin(ctx, resolved);
  return resolved;
}

export async function canonicalEntities(
  _parent: unknown,
  args: {
    tenantId?: string | null;
    entityTypeSlug?: string | null;
    search?: string | null;
    status?: string | null;
    limit?: number | null;
  },
  ctx: GraphQLContext,
) {
  const tenantId = await resolveTenantId(ctx, args.tenantId);
  const filters = [eq(canonicalEntitiesTable.tenant_id, tenantId)];
  if (args.entityTypeSlug) {
    filters.push(
      eq(canonicalEntitiesTable.entity_type_slug, args.entityTypeSlug),
    );
  }
  if (args.status) {
    filters.push(eq(canonicalEntitiesTable.status, args.status));
  }
  if (args.search?.trim()) {
    const pattern = `%${args.search.trim()}%`;
    filters.push(
      or(
        ilike(canonicalEntitiesTable.display_name, pattern),
        ilike(canonicalEntitiesTable.normalized_name, pattern),
      )!,
    );
  }

  const limit = Math.max(1, Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT));
  const rows = await ctx.db
    .select()
    .from(canonicalEntitiesTable)
    .where(and(...filters))
    .orderBy(desc(canonicalEntitiesTable.updated_at))
    .limit(limit);

  const mappings = await loadMappings(
    ctx,
    rows.map((row: CanonicalRow) => row.id),
  );
  return rows.map((row: CanonicalRow) =>
    toGraphqlCanonicalEntity(row, mappings.get(row.id) ?? []),
  );
}

export async function canonicalEntity(
  _parent: unknown,
  args: { tenantId?: string | null; id: string },
  ctx: GraphQLContext,
) {
  const tenantId = await resolveTenantId(ctx, args.tenantId);
  const [row] = await ctx.db
    .select()
    .from(canonicalEntitiesTable)
    .where(
      and(
        eq(canonicalEntitiesTable.id, args.id),
        eq(canonicalEntitiesTable.tenant_id, tenantId),
      ),
    )
    .limit(1);
  if (!row) return null;
  const mappings = await loadMappings(ctx, [row.id]);
  return toGraphqlCanonicalEntity(row as CanonicalRow, mappings.get(row.id) ?? []);
}

async function loadMappings(
  ctx: GraphQLContext,
  canonicalIds: string[],
): Promise<Map<string, MappingRow[]>> {
  const byCanonical = new Map<string, MappingRow[]>();
  if (canonicalIds.length === 0) return byCanonical;
  const rows = await ctx.db
    .select()
    .from(entitySourceMappings)
    .where(inArray(entitySourceMappings.canonical_entity_id, canonicalIds));
  for (const row of rows as MappingRow[]) {
    const list = byCanonical.get(row.canonical_entity_id) ?? [];
    list.push(row);
    byCanonical.set(row.canonical_entity_id, list);
  }
  return byCanonical;
}

export function toGraphqlCanonicalEntity(
  row: CanonicalRow,
  mappings: MappingRow[],
) {
  return {
    id: row.id,
    entityTypeSlug: row.entity_type_slug,
    displayName: row.display_name,
    normalizedName: row.normalized_name,
    status: row.status,
    mergedIntoId: row.merged_into_id,
    version: row.version,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    sourceMappings: mappings.map((mapping) => ({
      id: mapping.id,
      canonicalEntityId: mapping.canonical_entity_id,
      sourceSystem: mapping.source_system,
      namespace: mapping.namespace,
      externalId: mapping.external_id,
      visibility: mapping.visibility,
      createdBy: mapping.created_by,
      createdAt: toIso(mapping.created_at),
    })),
  };
}

export function toIso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}
