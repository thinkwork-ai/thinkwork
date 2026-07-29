/**
 * Turn-bound identity resolution for the agent-facing `search` broker
 * (THINK-263 U8).
 *
 * The Pi agent tool calls `search` as a SERVICE bearer with a turn-bound
 * header. Unlike a tenant-only tool, the
 * search broker reaches into per-user surfaces — thread visibility and the
 * caller's own memory bank — so it must run as the turn's USER, not just the
 * tenant. This helper derives BOTH server-side from the turn reference so a
 * prompt-injected turn cannot widen scope by parameter:
 *
 *   1. `x-thread-turn-id` (strongest): the referenced `thread_turns` row must
 *      still be live (status='running', not finalized); tenant + owning user
 *      come from the turn's thread.
 *   2. `x-thread-id` (fallback for invocations without a recorded turn row):
 *      tenant + user come from the thread row.
 *
 * A caller-asserted tenant (GraphQL arg or `x-tenant-id`) that disagrees with
 * the derivation is rejected.
 */

import { GraphQLError } from "graphql";
import { sql } from "drizzle-orm";

import type { GraphQLContext } from "../../context.js";

export interface SearchCallerScope {
  tenantId: string;
  /** The turn's owning user; the broker runs thread/memory scoping as them. */
  userId: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function forbidden(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "FORBIDDEN" } });
}

function header(ctx: GraphQLContext, name: string): string {
  const value = ctx.headers?.[name];
  return typeof value === "string" ? value.trim() : "";
}

function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

/**
 * Resolve tenant + user for a service (agent-tool) caller from the turn-bound
 * header. Throws FORBIDDEN when the reference is missing, malformed, stale, or
 * disagrees with a caller-asserted tenant.
 */
export async function resolveServiceSearchScope(
  ctx: GraphQLContext,
  args: { tenantId?: string | null },
): Promise<SearchCallerScope> {
  const threadTurnId = header(ctx, "x-thread-turn-id");
  const threadId = header(ctx, "x-thread-id");

  let derived: { tenant_id: string; user_id: string | null } | null = null;
  if (threadTurnId) {
    if (!UUID_RE.test(threadTurnId)) {
      throw forbidden("Invalid thread turn reference");
    }
    const result = await ctx.db.execute(sql`
      SELECT tt.tenant_id AS tenant_id, t.user_id AS user_id
        FROM thread_turns tt
        JOIN threads t ON t.id = tt.thread_id
       WHERE tt.id = ${threadTurnId}
         AND tt.status = 'running'
         AND tt.finalized_at IS NULL
       LIMIT 1
    `);
    derived =
      rowsOf<{ tenant_id: string; user_id: string | null }>(result)[0] ?? null;
    if (!derived) {
      throw forbidden("Thread turn reference is not an active turn");
    }
  } else if (threadId) {
    if (!UUID_RE.test(threadId)) {
      throw forbidden("Invalid thread reference");
    }
    const result = await ctx.db.execute(sql`
      SELECT tenant_id, user_id
        FROM threads
       WHERE id = ${threadId}
       LIMIT 1
    `);
    derived =
      rowsOf<{ tenant_id: string; user_id: string | null }>(result)[0] ?? null;
    if (!derived) {
      throw forbidden("Unknown thread reference");
    }
  } else {
    throw forbidden(
      "Service callers must supply a turn-bound thread reference " +
        "(x-thread-turn-id or x-thread-id)",
    );
  }

  if (!derived.user_id) {
    // A thread with no owning user (system/automation) has no per-user
    // search scope; the broker would leak nothing but also find nothing
    // user-scoped, so reject rather than silently run unscoped.
    throw forbidden("Turn-bound reference has no owning user for search scope");
  }

  if (args.tenantId && args.tenantId !== derived.tenant_id) {
    throw forbidden("Access denied: tenant mismatch for turn-bound caller");
  }
  if (ctx.auth.tenantId && ctx.auth.tenantId !== derived.tenant_id) {
    throw forbidden("Access denied: tenant mismatch for turn-bound caller");
  }

  return { tenantId: derived.tenant_id, userId: derived.user_id };
}
