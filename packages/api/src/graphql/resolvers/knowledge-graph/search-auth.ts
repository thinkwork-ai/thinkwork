/**
 * Turn-bound tenant resolution for the agent-facing `knowledgeGraphSearch`
 * query (plan 2026-06-09-004 U7, R15 — security-critical).
 *
 * The context-engine service path trusts a caller-asserted `x-tenant-id`
 * header; that pattern is a known weakness and is deliberately NOT imported
 * here. For service-bearer callers (the Pi runtime back-channel), tenant
 * identity derives SERVER-SIDE from a turn-bound reference the host sends:
 *
 *   1. `x-thread-turn-id` (strongest): the referenced `thread_turns` row must
 *      exist, still be `running`, and not be finalized — i.e. the credential
 *      is only valid while the turn it names is actually executing. The
 *      tenant is the turn row's `tenant_id`.
 *   2. `x-thread-id` (fallback for invocations without a recorded turn row):
 *      the tenant is the referenced `threads` row's `tenant_id`.
 *
 * Any asserted tenant (the GraphQL `tenantId` argument or an `x-tenant-id`
 * header) that mismatches the derived tenant is REJECTED — a service caller
 * cannot flip tenants by assertion. A service call with no turn reference is
 * rejected outright.
 *
 * Cognito / apikey callers resolve through the existing
 * {@link resolveKnowledgeGraphScope} admin gate unchanged.
 */

import { GraphQLError } from "graphql";
import { sql } from "drizzle-orm";
import type { GraphQLContext } from "../../context.js";
import { resolveKnowledgeGraphScope } from "./auth.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function forbidden(message: string): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "FORBIDDEN" },
  });
}

function header(ctx: GraphQLContext, name: string): string {
  const value = ctx.headers?.[name];
  return typeof value === "string" ? value.trim() : "";
}

function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

export interface KnowledgeGraphSearchScope {
  tenantId: string;
}

async function resolveServiceCallerTenant(
  ctx: GraphQLContext,
): Promise<string> {
  const threadTurnId = header(ctx, "x-thread-turn-id");
  const threadId = header(ctx, "x-thread-id");

  let derivedTenantId: string | null = null;
  if (threadTurnId) {
    if (!isUuid(threadTurnId)) {
      throw forbidden("Invalid thread turn reference");
    }
    // The turn must still be live: a finished/finalized turn id is not a
    // usable credential, so a logged or replayed id goes stale with the turn.
    const result = await ctx.db.execute(sql`
      SELECT tenant_id
        FROM thread_turns
       WHERE id = ${threadTurnId}
         AND status = 'running'
         AND finalized_at IS NULL
       LIMIT 1
    `);
    derivedTenantId =
      rowsOf<{ tenant_id: string }>(result)[0]?.tenant_id ?? null;
    if (!derivedTenantId) {
      throw forbidden("Thread turn reference is not an active turn");
    }
  } else if (threadId) {
    if (!isUuid(threadId)) {
      throw forbidden("Invalid thread reference");
    }
    const result = await ctx.db.execute(sql`
      SELECT tenant_id
        FROM threads
       WHERE id = ${threadId}
       LIMIT 1
    `);
    derivedTenantId =
      rowsOf<{ tenant_id: string }>(result)[0]?.tenant_id ?? null;
    if (!derivedTenantId) {
      throw forbidden("Unknown thread reference");
    }
  } else {
    throw forbidden(
      "Service callers must supply a turn-bound thread reference " +
        "(x-thread-turn-id or x-thread-id)",
    );
  }

  return derivedTenantId;
}

/**
 * Resolve the tenant scope for `knowledgeGraphSearch`. Service bearers go
 * through turn-bound resolution; cognito/apikey callers go through the
 * existing knowledge-graph admin scope.
 */
export async function resolveKnowledgeGraphSearchScope(
  ctx: GraphQLContext,
  args: { tenantId?: string | null },
): Promise<KnowledgeGraphSearchScope> {
  if (ctx.auth.authType === "service") {
    const derivedTenantId = await resolveServiceCallerTenant(ctx);
    // Reject any caller-asserted tenant that disagrees with the server-side
    // derivation — both the GraphQL argument and the x-tenant-id header
    // (which is what populates ctx.auth.tenantId for service callers).
    if (args.tenantId && args.tenantId !== derivedTenantId) {
      throw forbidden("Access denied: tenant mismatch for turn-bound caller");
    }
    if (ctx.auth.tenantId && ctx.auth.tenantId !== derivedTenantId) {
      throw forbidden("Access denied: tenant mismatch for turn-bound caller");
    }
    return { tenantId: derivedTenantId };
  }

  const scope = await resolveKnowledgeGraphScope(
    ctx,
    args,
    "knowledge_graph_search",
  );
  return { tenantId: scope.tenantId };
}
