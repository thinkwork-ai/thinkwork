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

export function toGraphqlRetractionAttempt(row: RetractionAttemptRow) {
  return {
    id: row.id,
    scope: row.scope,
    providerDocumentId: row.provider_document_id,
    targetBankId: row.target_bank_id,
    status: row.status,
    attemptCount: row.attempt_count,
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
