/**
 * tenant-membership — REST auth helper for tenant-scoped Lambda handlers.
 *
 * Wraps `authenticate()` + user lookup + `tenant_members` check into one
 * call. The goal is to close the "shared-secret = any-tenant" gap that
 * existed on per-tenant REST endpoints (see mcp-admin-keys /
 * mcp-admin-provision) by enforcing a membership check for end-user
 * callers while keeping the apikey path for CI/ops bootstrap.
 *
 * Two accepted auth modes:
 *
 *   - **cognito** — JWT from the admin SPA / mobile / `thinkwork login`.
 *     The caller's users.id is resolved, and a `tenant_members` row for
 *     `(tenant_id, principal_id=users.id)` with `role ∈ requiredRoles`
 *     must exist. Missing row or non-matching role ⇒ FORBIDDEN.
 *
 *   - **apikey** — shared `API_AUTH_SECRET` / `THINKWORK_API_SECRET`.
 *     Treated as platform-operator credential; no per-tenant
 *     membership check is applied. Callers are expected to be CI, the
 *     agentcore-runtime, or a human operator using the CLI with the
 *     secret in their stage config. Holders of this secret can operate
 *     on any tenant by design — that's the trust boundary.
 *
 * No auth header / invalid JWT / unknown apikey ⇒ UNAUTHORIZED.
 *
 * Follow-up (not in this PR): move apikey auth to IAM-signed internal
 * requests so the shared-secret blast radius narrows from "anyone with
 * the string" to "anyone who can assume the internal IAM role."
 */
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { and, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { tenantMembers, tenants } from "@thinkwork/database-pg/schema";
import { extractBearerToken, validateApiSecret } from "./auth.js";
import { authenticate, type AuthResult } from "./cognito-auth.js";
import { resolveCallerFromAuth } from "../graphql/resolvers/core/resolve-auth-user.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TenantMemberRole = "owner" | "admin" | "member";

export type TenantMembershipVerdict =
  | {
      ok: true;
      auth: AuthResult;
      tenantId: string;
      /** Resolved users.id for cognito callers; null for apikey callers. */
      userId: string | null;
      /**
       * Resolved role on the target tenant for cognito callers. `null`
       * for apikey callers — the platform-credential path has no
       * per-tenant role.
       */
      role: TenantMemberRole | null;
    }
  | { ok: false; status: 401 | 403 | 404; reason: string };

export interface RequireTenantMembershipOptions {
  /**
   * Minimum roles the cognito caller must hold on the target tenant.
   * Default `["owner", "admin"]`. Set to `["owner", "admin", "member"]`
   * for read-only routes that any tenant member should see. The apikey
   * path bypasses this check.
   */
  requiredRoles?: TenantMemberRole[];
}

/**
 * Authenticate the request + resolve the tenant + enforce membership.
 *
 * On success: the tenantIdOrSlug is resolved to a UUID, and (for cognito
 * callers) the membership row is verified. Returns the resolved ids and
 * role so handlers don't repeat the same lookups.
 */
export async function requireTenantMembership(
  event: APIGatewayProxyEventV2,
  tenantIdOrSlug: string,
  opts: RequireTenantMembershipOptions = {},
): Promise<TenantMembershipVerdict> {
  const requiredRoles = opts.requiredRoles ?? ["owner", "admin"];
  let auth = await authenticate(normalizeHeaders(event.headers));

  // Back-compat: the CLI (api-client.ts) sends the shared service secret
  // as `Authorization: Bearer <secret>` without an `x-api-key` header, so
  // `authenticate()` can't identify it. Accept the bearer as the service
  // secret here so `thinkwork mcp key create` / `mcp provision` keep
  // working. A Cognito JWT would already have succeeded above; reaching
  // this branch means the bearer isn't a valid JWT.
  if (!auth) {
    const bearer = extractBearerToken(event);
    if (bearer && validateApiSecret(bearer)) {
      auth = {
        principalId: null,
        tenantId: null,
        email: null,
        authType: "apikey",
        agentId: null,
      };
    }
  }

  if (!auth) return { ok: false, status: 401, reason: "Unauthorized" };

  const db = getDb();
  const tenantId = await resolveTenantUuid(db, tenantIdOrSlug);
  if (!tenantId) return { ok: false, status: 404, reason: "Tenant not found" };

  // Platform-credential path: shared service secret is trusted
  // infrastructure. Preserves CI/CLI bootstrap workflows (no member-
  // ship row required). Do not log or echo the principal id here —
  // apikey principal headers are unverified self-assertions.
  if (auth.authType === "apikey") {
    return { ok: true, auth, tenantId, userId: null, role: null };
  }

  // Cognito path: resolve users.id, then check membership.
  const { userId } = await resolveCallerFromAuth(auth);
  if (!userId) {
    return {
      ok: false,
      status: 403,
      reason: "Caller has no user record for this identity",
    };
  }

  const [membership] = await db
    .select({ role: tenantMembers.role, status: tenantMembers.status })
    .from(tenantMembers)
    .where(
      and(
        eq(tenantMembers.tenant_id, tenantId),
        eq(tenantMembers.principal_type, "user"),
        eq(tenantMembers.principal_id, userId),
      ),
    )
    .limit(1);

  if (!membership || membership.status !== "active") {
    // Don't leak whether the tenant exists — return 403 for any
    // caller who can't prove tenant access, even if they named a
    // real tenant in the URL. (The 404 path above only fires for
    // totally-unknown slugs, which is already derivable without
    // auth by pinging a list endpoint.)
    return { ok: false, status: 403, reason: "Not a member of this tenant" };
  }

  const role = membership.role as TenantMemberRole;
  if (!requiredRoles.includes(role)) {
    return {
      ok: false,
      status: 403,
      reason: `Role "${role}" lacks privilege (requires ${requiredRoles.join(" or ")})`,
    };
  }

  return { ok: true, auth, tenantId, userId, role };
}

async function resolveTenantUuid(
  db: ReturnType<typeof getDb>,
  idOrSlug: string,
): Promise<string | null> {
  if (UUID_RE.test(idOrSlug)) {
    const [row] = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.id, idOrSlug))
      .limit(1);
    return row?.id ?? null;
  }
  const [row] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, idOrSlug))
    .limit(1);
  return row?.id ?? null;
}

function normalizeHeaders(
  h: APIGatewayProxyEventV2["headers"],
): Record<string, string | undefined> {
  // authenticate() reads lowercase keys. API Gateway v2 already
  // lowercases, but a manual call site may not — normalize defensively.
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(h)) {
    if (v !== undefined) out[k.toLowerCase()] = v;
  }
  return out;
}
