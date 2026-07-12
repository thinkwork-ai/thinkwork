/**
 * Operator inspection of the retraction ledger (THINK-193 U2).
 * Tenant-admin gated, shaped like memoryRetainAttempts: every provider
 * delete the retraction path performs is accounted for in these rows.
 */

import { memoryRetractionAttempts as memoryRetractionAttemptsTable } from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { and, desc, eq } from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";
import { resolveCallerTenantId } from "../core/resolve-auth-user.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

type RetractionAttemptRow = typeof memoryRetractionAttemptsTable.$inferSelect;

export async function memoryRetractionAttempts(
  _parent: unknown,
  args: {
    tenantId?: string | null;
    sourceConfigId?: string | null;
    limit?: number | null;
  },
  ctx: GraphQLContext,
) {
  const tenantId =
    args.tenantId ?? ctx.auth.tenantId ?? (await resolveCallerTenantId(ctx));
  if (!tenantId) throw new Error("Tenant context required");
  await requireTenantAdmin(ctx, tenantId);

  const filters = [eq(memoryRetractionAttemptsTable.tenant_id, tenantId)];
  if (args.sourceConfigId) {
    filters.push(
      eq(memoryRetractionAttemptsTable.source_config_id, args.sourceConfigId),
    );
  }

  const limit = Math.max(1, Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT));
  const rows = await ctx.db
    .select()
    .from(memoryRetractionAttemptsTable)
    .where(and(...filters))
    .orderBy(desc(memoryRetractionAttemptsTable.created_at))
    .limit(limit);

  return rows.map(toGraphqlRetractionAttempt);
}

/** Lease horizon: a lock older than this is presumed dead (mirrors
 * RETRACTION_LOCK_STALE_AFTER_MS in lib/memory-sources/retraction.ts). */
const LEASE_TTL_MS = 6 * 60 * 1000;

export function toGraphqlRetractionAttempt(row: RetractionAttemptRow) {
  const lockedAt =
    row.locked_at instanceof Date
      ? row.locked_at
      : row.locked_at
        ? new Date(row.locked_at)
        : null;
  return {
    id: row.id,
    scope: row.scope,
    sourceConfigId: row.source_config_id,
    providerDocumentId: row.provider_document_id,
    targetBankId: row.target_bank_id,
    status: row.status,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    nextRetryAt: toIso(row.next_retry_at),
    lockedBy: row.locked_by,
    lockGeneration: row.lock_generation ?? 0,
    leaseExpiresAt: lockedAt
      ? new Date(lockedAt.getTime() + LEASE_TTL_MS).toISOString()
      : null,
    eraseGeneration: row.erase_generation ?? 0,
    reconsolidationNote: row.reconsolidation_note,
    errorClass: row.error_class,
    errorMessage: row.error_message,
    createdAt: toIso(row.created_at),
    completedAt: toIso(row.completed_at),
  };
}

function toIso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}
