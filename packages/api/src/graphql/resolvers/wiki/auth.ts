import type { GraphQLContext } from "../../context.js";
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
