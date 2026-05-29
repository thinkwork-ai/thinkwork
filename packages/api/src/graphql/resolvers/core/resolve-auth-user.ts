import type { GraphQLContext } from "../../context.js";
import type { AuthResult } from "../../../lib/cognito-auth.js";
import { db, eq, and, isNull, users } from "../../utils.js";

/**
 * Resolve both the DB users.id AND tenant_id for a Cognito caller from a
 * bare AuthResult. Used by non-GraphQL Lambda handlers (like
 * /api/workspaces/files, Unit 5) that don't have a GraphQLContext but need
 * the same tenant-resolution semantics as `resolveCaller`.
 *
 * Resolution order for a Cognito caller (see plan 2026-05-29-006):
 *   1. by stored `cognito_sub` — the stable, always-present link. Healed
 *      users and users created after this shipped resolve here.
 *   2. by `id == sub` — NATIVE users, whose users.id IS the Cognito sub.
 *      Retained so a native user whose token lost `email` still resolves.
 *   3. by `email` — not-yet-healed Google users (users.id is a fresh UUID
 *      != sub). Kept as a last resort; effectively unused as users heal.
 *   4. null — failure posture unchanged; identity-critical writes still
 *      fail loudly, best-effort writes still fail soft (PR #1837).
 *
 * When a row resolves via step 2 or step 3 and has no `cognito_sub` yet, we
 * opportunistically backfill it so the next request resolves by sub. The
 * email-path backfill (step 3) is gated on a verified email so a recycled or
 * unverified email can't permanently bind a sub to the wrong user row.
 */
export async function resolveCallerFromAuth(
  auth: AuthResult,
): Promise<{ userId: string | null; tenantId: string | null }> {
  // Service-secret callers — both `apikey` (declared identity, e.g. the
  // thinkwork-admin skill) and `service` (bearer-only, e.g. the CLI or
  // the agentcore-runtime container calling /api/workspaces/files
  // during bootstrap Unit 7) — have no DB-verified user principal but
  // DO carry an x-tenant-id header. The shared service secret is the
  // trust boundary; anything holding it is trusted infrastructure.
  // Honor the header-supplied tenantId so downstream DB queries scope
  // correctly. principalId is null for service callers (the header was
  // absent); apikey callers may have a header-asserted principalId
  // here — note it is unverified.
  if (auth.authType === "apikey" || auth.authType === "service") {
    return { userId: auth.principalId, tenantId: auth.tenantId };
  }
  if (auth.authType !== "cognito") {
    return { userId: null, tenantId: null };
  }
  const principalId = auth.principalId;
  if (!principalId) return { userId: null, tenantId: null };

  // 1. By stored Cognito sub — the reliable primary path.
  const [bySub] = await db
    .select({ id: users.id, tenant_id: users.tenant_id })
    .from(users)
    .where(eq(users.cognito_sub, principalId));
  if (bySub) return { userId: bySub.id, tenantId: bySub.tenant_id };

  // 2. By id == sub — native users (users.id was minted from the sub).
  const [byId] = await db
    .select({ id: users.id, tenant_id: users.tenant_id, cognito_sub: users.cognito_sub })
    .from(users)
    .where(eq(users.id, principalId));
  if (byId) {
    // Tautological write (cognito_sub = id = sub); heals native rows so the
    // next request hits step 1 in a single lookup.
    if (!byId.cognito_sub) await backfillCognitoSub(byId.id, principalId);
    return { userId: byId.id, tenantId: byId.tenant_id };
  }

  // 3. By email — not-yet-healed Google users.
  const email = auth.email;
  if (!email) return { userId: null, tenantId: null };
  const [byEmail] = await db
    .select({ id: users.id, tenant_id: users.tenant_id, cognito_sub: users.cognito_sub })
    .from(users)
    .where(eq(users.email, email));
  if (!byEmail) return { userId: null, tenantId: null };
  // Only bind the sub to this row for a VERIFIED email — an unverified or
  // recycled email must not permanently capture another user's row + tenant.
  if (!byEmail.cognito_sub && auth.emailVerified) {
    await backfillCognitoSub(byEmail.id, principalId);
  }
  return { userId: byEmail.id, tenantId: byEmail.tenant_id };
}

/**
 * Best-effort write of the Cognito sub onto a user row that lacks one. The
 * `cognito_sub IS NULL` guard is load-bearing: it makes the write idempotent,
 * a no-op for the loser of a concurrent same-user race (both write the same
 * sub to the same row), and prevents overwriting an already-set sub. Never
 * throws and never changes the resolved identity — a unique-constraint
 * conflict (Postgres 23505) means a *different* sub already owns this row's
 * link (a contended one-sub-one-row invariant) and is logged at error level
 * for ops to audit; all other failures are transient and logged at warn.
 */
async function backfillCognitoSub(
  userId: string,
  cognitoSub: string,
): Promise<void> {
  try {
    await db
      .update(users)
      .set({ cognito_sub: cognitoSub })
      .where(and(eq(users.id, userId), isNull(users.cognito_sub)));
  } catch (err) {
    const code = (err as { code?: string } | undefined)?.code;
    if (code === "23505") {
      console.error(
        `[resolve-auth-user] cognito_sub backfill conflict (23505): sub=${cognitoSub} userId=${userId} — a different sub already owns this row's link`,
      );
    } else {
      console.warn(
        `[resolve-auth-user] cognito_sub backfill failed (transient): userId=${userId}`,
        (err as Error)?.message,
      );
    }
  }
}

/**
 * Resolve both the DB users.id AND tenant_id for the current Cognito caller.
 *
 * Returns null fields for non-Cognito (API key) callers or when no matching
 * row is found. Resolvers that use this for access control should fail
 * closed on null.
 */
export async function resolveCaller(
  ctx: GraphQLContext,
): Promise<{ userId: string | null; tenantId: string | null }> {
  return resolveCallerFromAuth(ctx.auth);
}

/**
 * Back-compat: returns only the user id. Prefer `resolveCaller` when you
 * need the tenant id too — it's the same DB round-trip either way.
 */
export async function resolveCallerUserId(
  ctx: GraphQLContext,
): Promise<string | null> {
  const { userId } = await resolveCaller(ctx);
  return userId;
}

/**
 * Convenience: returns only the tenant id. Prefer `resolveCaller` when you
 * need both fields.
 */
export async function resolveCallerTenantId(
  ctx: GraphQLContext,
): Promise<string | null> {
  const { tenantId } = await resolveCaller(ctx);
  return tenantId;
}
