/**
 * Turn-bound identity resolution for the agent-facing entity-identity
 * routing surface (THINK-321 U5 — security-critical).
 *
 * Mirrors the search broker's gate (search/search-auth.ts): the Pi agent
 * tools call `resolveEntities` / `proposeMappingCandidates` /
 * `confirmEntityMapping` / `declineEntityMappingCandidates` as SERVICE
 * bearers with a turn-bound header. Tenant, the turn's owning USER, and the
 * THREAD all derive SERVER-SIDE from that reference so a prompt-injected
 * turn cannot widen scope — or ghost-attribute a confirmation — by
 * parameter:
 *
 *   1. `x-thread-turn-id` (strongest): the referenced `thread_turns` row
 *      must still be live (status='running', not finalized); tenant, user,
 *      and thread come from the turn row + its thread.
 *   2. `x-thread-id` (fallback for invocations without a recorded turn
 *      row): tenant + user come from the thread row.
 *
 * A caller-asserted tenant (GraphQL arg or `x-tenant-id`) or threadRef that
 * disagrees with the derivation is rejected.
 *
 * Cognito / apikey callers fall back to the existing tenant-admin gate
 * (canonicalEntities.query.ts resolveTenantId) — the operator stewardship
 * scope — with the caller's own user id.
 */

import { GraphQLError } from "graphql";
import { sql } from "drizzle-orm";

import type { GraphQLContext } from "../../context.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import { resolveTenantId } from "./canonicalEntities.query.js";

export interface IdentityRoutingScope {
  tenantId: string;
  /** The turn's owning user (service) or the admin caller (cognito/apikey). */
  userId: string | null;
  /** The turn's thread id when derivable (service callers only). */
  threadId: string | null;
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

interface DerivedTurnScope {
  tenant_id: string;
  user_id: string | null;
  thread_id: string | null;
}

async function resolveServiceTurnScope(
  ctx: GraphQLContext,
): Promise<DerivedTurnScope> {
  const threadTurnId = header(ctx, "x-thread-turn-id");
  const threadId = header(ctx, "x-thread-id");

  if (threadTurnId) {
    if (!UUID_RE.test(threadTurnId)) {
      throw forbidden("Invalid thread turn reference");
    }
    // The turn must still be live: a finished/finalized turn id is not a
    // usable credential, so a logged or replayed id goes stale with the turn.
    const result = await ctx.db.execute(sql`
      SELECT tt.tenant_id AS tenant_id, t.user_id AS user_id,
             tt.thread_id AS thread_id
        FROM thread_turns tt
        JOIN threads t ON t.id = tt.thread_id
       WHERE tt.id = ${threadTurnId}
         AND tt.status = 'running'
         AND tt.finalized_at IS NULL
       LIMIT 1
    `);
    const derived = rowsOf<DerivedTurnScope>(result)[0] ?? null;
    if (!derived) {
      throw forbidden("Thread turn reference is not an active turn");
    }
    return derived;
  }

  if (threadId) {
    if (!UUID_RE.test(threadId)) {
      throw forbidden("Invalid thread reference");
    }
    const result = await ctx.db.execute(sql`
      SELECT tenant_id, user_id, id AS thread_id
        FROM threads
       WHERE id = ${threadId}
       LIMIT 1
    `);
    const derived = rowsOf<DerivedTurnScope>(result)[0] ?? null;
    if (!derived) {
      throw forbidden("Unknown thread reference");
    }
    return derived;
  }

  throw forbidden(
    "Service callers must supply a turn-bound thread reference " +
      "(x-thread-turn-id or x-thread-id)",
  );
}

/**
 * Resolve the caller scope for the entity-identity routing surface.
 * Service bearers go through turn-bound resolution; cognito/apikey callers
 * go through the existing tenant-admin stewardship gate.
 */
export async function resolveIdentityRoutingScope(
  ctx: GraphQLContext,
  args: { tenantId?: string | null },
): Promise<IdentityRoutingScope> {
  if (ctx.auth.authType === "service") {
    const derived = await resolveServiceTurnScope(ctx);
    // Reject any caller-asserted tenant that disagrees with the server-side
    // derivation — both the GraphQL argument and the x-tenant-id header
    // (which is what populates ctx.auth.tenantId for service callers).
    if (args.tenantId && args.tenantId !== derived.tenant_id) {
      throw forbidden("Access denied: tenant mismatch for turn-bound caller");
    }
    if (ctx.auth.tenantId && ctx.auth.tenantId !== derived.tenant_id) {
      throw forbidden("Access denied: tenant mismatch for turn-bound caller");
    }
    return {
      tenantId: derived.tenant_id,
      userId: derived.user_id,
      threadId: derived.thread_id,
    };
  }

  const tenantId = await resolveTenantId(ctx, args.tenantId);
  const userId = await resolveCallerUserId(ctx);
  return { tenantId, userId: userId ?? null, threadId: null };
}

/**
 * Resolve the thread reference a consent write is bound to. For turn-bound
 * service callers the server-derived thread id is authoritative — an
 * asserted threadRef that mismatches it is rejected. Admin callers have no
 * derivable thread and must assert one.
 */
export function resolveConsentThreadRef(
  scope: IdentityRoutingScope,
  assertedThreadRef: string | null | undefined,
): string {
  if (scope.threadId) {
    if (assertedThreadRef && assertedThreadRef !== scope.threadId) {
      throw forbidden(
        "Access denied: threadRef mismatch for turn-bound caller",
      );
    }
    return scope.threadId;
  }
  if (!assertedThreadRef) {
    throw forbidden("threadRef is required for non-turn-bound callers");
  }
  return assertedThreadRef;
}

/** Require the turn's owning user for a consent write (confirm/decline). */
export function requireConsentUserId(scope: IdentityRoutingScope): string {
  if (!scope.userId) {
    throw forbidden(
      "Turn-bound reference has no owning user for a consent write",
    );
  }
  return scope.userId;
}
