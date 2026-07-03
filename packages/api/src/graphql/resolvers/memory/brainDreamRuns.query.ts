/**
 * Operator ledger query for dream-state runs (THINK-133 U4). Tenant-admin
 * gated, shaped like memoryRetainAttempts: every mutation the dream state
 * makes is accounted for in these rows' plannedCounts/appliedCounts.
 */

import { brainDreamRuns as brainDreamRunsTable } from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { and, desc, eq } from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";
import { resolveCallerTenantId } from "../core/resolve-auth-user.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

type BrainDreamRunRow = typeof brainDreamRunsTable.$inferSelect;

export async function brainDreamRuns(
  _parent: unknown,
  args: {
    tenantId?: string | null;
    bankId?: string | null;
    status?: string | null;
    limit?: number | null;
  },
  ctx: GraphQLContext,
) {
  const tenantId =
    args.tenantId ?? ctx.auth.tenantId ?? (await resolveCallerTenantId(ctx));
  if (!tenantId) throw new Error("Tenant context required");
  await requireTenantAdmin(ctx, tenantId);

  const filters = [eq(brainDreamRunsTable.tenant_id, tenantId)];
  if (args.bankId) filters.push(eq(brainDreamRunsTable.bank_id, args.bankId));
  if (args.status) filters.push(eq(brainDreamRunsTable.status, args.status));

  const limit = Math.max(1, Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT));
  const rows = await ctx.db
    .select()
    .from(brainDreamRunsTable)
    .where(and(...filters))
    .orderBy(desc(brainDreamRunsTable.created_at))
    .limit(limit);

  return rows.map(toGraphqlDreamRun);
}

function toGraphqlDreamRun(row: BrainDreamRunRow) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    bankId: row.bank_id,
    dedupeKey: row.dedupe_key,
    status: row.status,
    plannedCounts: row.planned_counts,
    appliedCounts: row.applied_counts,
    errorMessage: row.error_message,
    startedAt: toIso(row.started_at),
    finishedAt: toIso(row.finished_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function toIso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}
