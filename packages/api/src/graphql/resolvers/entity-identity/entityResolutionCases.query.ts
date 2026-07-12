/**
 * Resolution queue queries (THINK-193 U4). Tenant-admin gated. Cases carry
 * source-safe identity evidence only — the jsonb passes through as-is
 * because the writer (snapshot-resolution) never stores private content.
 */

import { and, desc, eq } from "drizzle-orm";
import { entityResolutionCases as casesTable } from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { resolveTenantId } from "./canonicalEntities.query.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

type CaseRow = typeof casesTable.$inferSelect;

export async function entityResolutionCases(
  _parent: unknown,
  args: {
    tenantId?: string | null;
    status?: string | null;
    limit?: number | null;
  },
  ctx: GraphQLContext,
) {
  const tenantId = await resolveTenantId(ctx, args.tenantId);
  const filters = [eq(casesTable.tenant_id, tenantId)];
  filters.push(eq(casesTable.status, args.status ?? "open"));

  const limit = Math.max(1, Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT));
  const rows = await ctx.db
    .select()
    .from(casesTable)
    .where(and(...filters))
    .orderBy(desc(casesTable.updated_at))
    .limit(limit);
  return rows.map((row: CaseRow) => toGraphqlResolutionCase(row));
}

export async function entityResolutionCase(
  _parent: unknown,
  args: { tenantId?: string | null; caseId: string },
  ctx: GraphQLContext,
) {
  const tenantId = await resolveTenantId(ctx, args.tenantId);
  const [row] = await ctx.db
    .select()
    .from(casesTable)
    .where(
      and(eq(casesTable.id, args.caseId), eq(casesTable.tenant_id, tenantId)),
    )
    .limit(1);
  return row ? toGraphqlResolutionCase(row as CaseRow) : null;
}

export function toGraphqlResolutionCase(row: CaseRow) {
  return {
    id: row.id,
    signatureHash: row.signature_hash,
    entityTypeSlug: row.entity_type_slug,
    displayHint: row.display_hint,
    candidates: row.candidates ?? [],
    conflictingClaims: row.conflicting_claims ?? [],
    impactSummary: row.impact_summary ?? {},
    itemCount: row.item_count,
    status: row.status,
    decision: row.decision,
    decidedByUserId: row.decided_by_user_id,
    resolvedCanonicalEntityId: row.resolved_canonical_entity_id,
    decidedAt: toIso(row.decided_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function toIso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}
