import type { GraphQLContext } from "../../context.js";
import type { WikiReadScope } from "../../../lib/wiki/repository.js";
import { hasServiceSecret } from "../core/authz.js";
import {
  requireMemoryTenantScope,
  requireMemoryUserScope,
  UserScopeAuthError,
} from "../core/require-user-scope.js";

export class WikiAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WikiAuthError";
  }
}

/**
 * Tenant-scope wiki read rule (plan 2026-06-09-004 U9): null-owner (tenant)
 * pages are readable by ANY member of the tenant. User-scoped pages keep the
 * owner-match-or-admin rule in {@link assertCanReadWikiScope} — this branch
 * exists because `requireMemoryUserScope` mandates a non-null userId, which
 * a tenant-scope read doesn't need. Returns the caller's userId when one
 * resolved so resolvers can build the U14 union-read scope
 * (`{ kind: "tenantUnion", userId }`).
 */
export async function assertCanReadWikiTenantScope(
  ctx: GraphQLContext,
  args: { tenantId?: string | null },
): Promise<{ tenantId: string; userId: string | null }> {
  try {
    return await requireMemoryTenantScope(ctx, args);
  } catch (err) {
    if (err instanceof UserScopeAuthError) {
      throw new WikiAuthError(err.message);
    }
    throw err;
  }
}

/**
 * Resolve the transitional union-read scope for a wiki read (plan
 * 2026-06-09-004 U14): tenant-scoped (null-owner) pages PLUS one user's
 * own pages.
 *
 *   - No `userId`/`ownerId` arg, or it equals the caller → any tenant
 *     member reads `{ tenantUnion, userId: caller }`. Behavior for the
 *     caller's own pages is identical to the v1 owner-scope read; tenant
 *     pages are additive.
 *   - A different `userId` requested → the v1 owner-match-or-admin rule
 *     applies (unchanged), then the union is keyed on that user.
 *   - Pure service credentials with no user in scope → tenant pages only
 *     (`userId: null`).
 */
export async function resolveWikiUnionReadScope(
  ctx: GraphQLContext,
  args: {
    tenantId?: string | null;
    userId?: string | null;
    ownerId?: string | null;
  },
): Promise<{ tenantId: string; scope: WikiReadScope; userId: string | null }> {
  const requested = args.userId ?? args.ownerId ?? null;
  const { tenantId, userId: callerUserId } = await assertCanReadWikiTenantScope(
    ctx,
    args,
  );
  if (requested && requested !== callerUserId) {
    // Reading another user's scope keeps the strict v1 rule: owner match,
    // tenant admin, or service credential.
    const scope = await assertCanReadWikiScope(ctx, {
      tenantId: args.tenantId,
      userId: requested,
    });
    return {
      tenantId: scope.tenantId,
      scope: { kind: "tenantUnion", userId: scope.userId },
      userId: scope.userId,
    };
  }
  return {
    tenantId,
    scope: { kind: "tenantUnion", userId: callerUserId },
    userId: callerUserId,
  };
}

export async function assertCanReadWikiScope(
  ctx: GraphQLContext,
  args: {
    tenantId?: string | null;
    userId?: string | null;
    ownerId?: string | null;
  },
): Promise<{ tenantId: string; userId: string }> {
  try {
    return await requireMemoryUserScope(ctx, {
      ...args,
      allowTenantAdmin: true,
    });
  } catch (err) {
    if (err instanceof UserScopeAuthError) {
      throw new WikiAuthError(err.message);
    }
    throw err;
  }
}

export async function assertCanAdminWikiScope(
  ctx: GraphQLContext,
  args: {
    tenantId?: string | null;
    userId?: string | null;
    ownerId?: string | null;
  },
): Promise<{ tenantId: string; userId: string }> {
  if (!hasServiceSecret(ctx)) {
    throw new WikiAuthError("Admin-only: requires internal API key credential");
  }
  return assertCanReadWikiScope(ctx, args);
}
