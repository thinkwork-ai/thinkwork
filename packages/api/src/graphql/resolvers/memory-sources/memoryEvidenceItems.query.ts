/**
 * Operator inspection of the evidence ledger for one source config
 * (THINK-193 U2). Tenant-admin gated. Snapshot content (normalized_snapshot,
 * snapshot_ref) is intentionally NOT returned — redacted by design.
 */

import { memoryEvidenceItems as memoryEvidenceItemsTable } from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { and, desc, eq } from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";
import { resolveCallerTenantId } from "../core/resolve-auth-user.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

type EvidenceRow = typeof memoryEvidenceItemsTable.$inferSelect;

export async function memoryEvidenceItems(
  _parent: unknown,
  args: {
    tenantId?: string | null;
    sourceConfigId: string;
    limit?: number | null;
  },
  ctx: GraphQLContext,
) {
  const tenantId =
    args.tenantId ?? ctx.auth.tenantId ?? (await resolveCallerTenantId(ctx));
  if (!tenantId) throw new Error("Tenant context required");
  await requireTenantAdmin(ctx, tenantId);

  const limit = Math.max(1, Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT));
  const rows = await ctx.db
    .select()
    .from(memoryEvidenceItemsTable)
    .where(
      and(
        eq(memoryEvidenceItemsTable.tenant_id, tenantId),
        eq(memoryEvidenceItemsTable.source_config_id, args.sourceConfigId),
      ),
    )
    .orderBy(desc(memoryEvidenceItemsTable.created_at))
    .limit(limit);

  return rows.map(toGraphqlEvidenceSummary);
}

function toGraphqlEvidenceSummary(row: EvidenceRow) {
  return {
    id: row.id,
    sourceConfigId: row.source_config_id,
    sourceItemId: row.source_item_id,
    sourceVersion: row.source_version,
    contentHash: row.content_hash,
    lifecycle: row.lifecycle,
    acquisitionRunId: row.acquisition_run_id,
    createdAt: toIso(row.created_at),
  };
}

function toIso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}
