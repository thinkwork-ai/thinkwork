import { memoryRetainAttempts as memoryRetainAttemptsTable } from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { and, desc, eq } from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";
import { resolveCallerTenantId } from "../core/resolve-auth-user.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

type MemoryRetainAttemptRow = typeof memoryRetainAttemptsTable.$inferSelect;

export async function memoryRetainAttempts(
  _parent: unknown,
  args: {
    tenantId?: string | null;
    userId?: string | null;
    spaceId?: string | null;
    threadId?: string | null;
    status?: string | null;
    limit?: number | null;
  },
  ctx: GraphQLContext,
) {
  const tenantId =
    args.tenantId ?? ctx.auth.tenantId ?? (await resolveCallerTenantId(ctx));
  if (!tenantId) throw new Error("Tenant context required");
  await requireTenantAdmin(ctx, tenantId);

  const filters = [eq(memoryRetainAttemptsTable.tenant_id, tenantId)];
  if (args.userId)
    filters.push(eq(memoryRetainAttemptsTable.user_id, args.userId));
  if (args.spaceId)
    filters.push(eq(memoryRetainAttemptsTable.space_id, args.spaceId));
  if (args.threadId) {
    filters.push(eq(memoryRetainAttemptsTable.thread_id, args.threadId));
  }
  if (args.status)
    filters.push(eq(memoryRetainAttemptsTable.status, args.status));

  const limit = Math.max(1, Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT));
  const rows = await ctx.db
    .select()
    .from(memoryRetainAttemptsTable)
    .where(and(...filters))
    .orderBy(desc(memoryRetainAttemptsTable.created_at))
    .limit(limit);

  return rows.map(toGraphqlRetainAttempt);
}

function toGraphqlRetainAttempt(row: MemoryRetainAttemptRow) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    spaceId: row.space_id,
    threadId: row.thread_id,
    threadTurnId: row.thread_turn_id,
    sourceEventKey: row.source_event_key,
    sourceEventType: row.source_event_type,
    provider: row.provider,
    status: row.status,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    nextRetryAt: toIso(row.next_retry_at),
    lockedAt: toIso(row.locked_at),
    lockedBy: row.locked_by,
    startedAt: toIso(row.started_at),
    finishedAt: toIso(row.finished_at),
    backendLatencyMs: row.backend_latency_ms,
    providerDocumentId: row.provider_document_id,
    providerResult: row.provider_result,
    errorClass: row.error_class,
    errorMessage: row.error_message,
    metadata: row.metadata,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function toIso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}
