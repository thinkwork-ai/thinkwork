/**
 * Operator inspection of ontology claims for one target scope (THINK-193 U2).
 * Tenant-admin gated. supportCount is a grouped count over ACTIVE
 * memory_claim_evidence edges so retracted evidence stops counting.
 */

import {
  memoryClaims as memoryClaimsTable,
  memoryClaimEvidence as memoryClaimEvidenceTable,
} from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { and, desc, eq, inArray, sql } from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";
import { resolveCallerTenantId } from "../core/resolve-auth-user.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

type ClaimRow = typeof memoryClaimsTable.$inferSelect;

export async function memoryClaims(
  _parent: unknown,
  args: {
    tenantId?: string | null;
    targetScope: string;
    targetId: string;
    subjectKey?: string | null;
    limit?: number | null;
  },
  ctx: GraphQLContext,
) {
  const tenantId =
    args.tenantId ?? ctx.auth.tenantId ?? (await resolveCallerTenantId(ctx));
  if (!tenantId) throw new Error("Tenant context required");
  await requireTenantAdmin(ctx, tenantId);

  const filters = [
    eq(memoryClaimsTable.tenant_id, tenantId),
    eq(memoryClaimsTable.target_scope, args.targetScope),
    eq(memoryClaimsTable.target_id, args.targetId),
  ];
  if (args.subjectKey) {
    filters.push(eq(memoryClaimsTable.subject_key, args.subjectKey));
  }

  const limit = Math.max(1, Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT));
  const rows = await ctx.db
    .select()
    .from(memoryClaimsTable)
    .where(and(...filters))
    .orderBy(desc(memoryClaimsTable.created_at))
    .limit(limit);

  const supportCounts = await loadSupportCounts(
    ctx,
    rows.map((row: ClaimRow) => row.id),
  );

  return rows.map((row: ClaimRow) =>
    toGraphqlClaim(row, supportCounts.get(row.id) ?? 0),
  );
}

async function loadSupportCounts(
  ctx: GraphQLContext,
  claimIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (claimIds.length === 0) return counts;

  const grouped = await ctx.db
    .select({
      claimId: memoryClaimEvidenceTable.claim_id,
      supportCount: sql<number>`count(*)::int`,
    })
    .from(memoryClaimEvidenceTable)
    .where(
      and(
        inArray(memoryClaimEvidenceTable.claim_id, claimIds),
        eq(memoryClaimEvidenceTable.status, "active"),
      ),
    )
    .groupBy(memoryClaimEvidenceTable.claim_id);

  for (const row of grouped) {
    counts.set(row.claimId, Number(row.supportCount));
  }
  return counts;
}

function toGraphqlClaim(row: ClaimRow, supportCount: number) {
  return {
    id: row.id,
    subjectKey: row.subject_key,
    subjectEntityType: row.subject_entity_type,
    ontologyPredicate: row.ontology_predicate,
    value: row.value,
    valueHash: row.value_hash,
    status: row.status,
    conflictState: row.conflict_state,
    effectiveFrom: toIso(row.effective_from),
    effectiveTo: toIso(row.effective_to),
    extractionVersion: row.extraction_version,
    supportCount,
  };
}

function toIso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}
