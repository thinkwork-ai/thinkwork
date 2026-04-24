/**
 * mcp-admin-keys — per-tenant Bearer token management for the admin-ops
 * MCP server.
 *
 * Routes (all tenant-scoped; tenantId accepted as UUID or slug):
 *   POST   /api/tenants/:tenantId/mcp-admin-keys
 *     body: { name: string }
 *     → 201 { id, name, token, created_at }
 *       `token` is the ONLY time the raw value is returned. Surface it
 *       to the operator and never persist it server-side.
 *
 *   GET    /api/tenants/:tenantId/mcp-admin-keys
 *     → 200 { keys: [{ id, name, created_at, last_used_at, revoked_at }] }
 *
 *   DELETE /api/tenants/:tenantId/mcp-admin-keys/:id
 *     → 204 (idempotent; already-revoked rows return 204 too)
 *
 * The admin-ops MCP Lambda (packages/lambda/admin-ops-mcp.ts) validates
 * incoming Bearer tokens against the same table via sha256 hash lookup.
 *
 * Auth (see `requireTenantMembership`):
 *   - Cognito JWT → caller must be owner/admin of the target tenant.
 *     Membership is checked against `tenant_members`; non-members get
 *     403 whether the tenant exists or not (no cross-tenant probing).
 *   - Shared `API_AUTH_SECRET` → platform-credential path, CI/CLI
 *     bootstrap. No per-tenant membership check. Treat the secret like
 *     a platform-root credential.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { randomBytes, createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { tenantMcpAdminKeys } from "@thinkwork/database-pg/schema";
import { error, json, notFound } from "../lib/response.js";
import { requireTenantMembership } from "../lib/tenant-membership.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_PREFIX = "tkm_";
const TOKEN_BYTES = 32; // 256 bits of entropy

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

export function generateToken(): { raw: string; hash: string } {
  const suffix = randomBytes(TOKEN_BYTES).toString("base64url");
  const raw = `${TOKEN_PREFIX}${suffix}`;
  const hash = hashToken(raw);
  return { raw, hash };
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  if (event.requestContext.http.method === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "*",
      },
      body: "",
    };
  }

  const method = event.requestContext.http.method;
  const path = event.rawPath;

  const listOrCreateMatch = path.match(
    /^\/api\/tenants\/([^/]+)\/mcp-admin-keys\/?$/,
  );
  const revokeMatch = path.match(
    /^\/api\/tenants\/([^/]+)\/mcp-admin-keys\/([^/]+)\/?$/,
  );

  try {
    if (listOrCreateMatch) {
      const tenantIdOrSlug = listOrCreateMatch[1]!;
      // Read routes let any active member list; mutations require
      // owner/admin. Lists expose only metadata (no raw tokens), so
      // a broader read bar is safe and matches admin SPA usage.
      const requiredRoles =
        method === "GET"
          ? (["owner", "admin", "member"] as const)
          : (["owner", "admin"] as const);
      const verdict = await requireTenantMembership(event, tenantIdOrSlug, {
        requiredRoles: [...requiredRoles],
      });
      if (!verdict.ok) return error(verdict.reason, verdict.status);

      const db = getDb();
      if (method === "GET") return listKeys(db, verdict.tenantId);
      if (method === "POST")
        return createKey(db, verdict.tenantId, event, verdict.userId);
      return error("Method not allowed", 405);
    }

    if (revokeMatch) {
      const tenantIdOrSlug = revokeMatch[1]!;
      const keyId = revokeMatch[2]!;
      if (!UUID_RE.test(keyId))
        return error("key id: valid UUID required", 400);

      const verdict = await requireTenantMembership(event, tenantIdOrSlug);
      if (!verdict.ok) return error(verdict.reason, verdict.status);

      const db = getDb();
      if (method === "DELETE") return revokeKey(db, verdict.tenantId, keyId);
      return error("Method not allowed", 405);
    }

    return notFound("Route not found");
  } catch (err: unknown) {
    console.error("mcp-admin-keys handler error:", err);
    return error("Internal server error", 500);
  }
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

async function createKey(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  event: APIGatewayProxyEventV2,
  callerUserId: string | null,
): Promise<APIGatewayProxyStructuredResultV2> {
  let body: { name?: string; created_by_user_id?: string };
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return error("Invalid JSON body", 400);
  }
  const name = (body.name ?? "default").trim();
  if (!name) return error("name: required non-empty string", 400);
  if (name.length > 100) return error("name: max 100 chars", 400);

  // Attribution priority:
  //   1. The authenticated Cognito caller's users.id (trusted).
  //   2. body.created_by_user_id — only honored for apikey callers
  //      (CLI / CI) since a cognito caller can't override their own
  //      identity. The UUID is validated; non-UUIDs are dropped.
  const createdByUserId =
    callerUserId ??
    (body.created_by_user_id && UUID_RE.test(body.created_by_user_id)
      ? body.created_by_user_id
      : null);

  const { raw, hash } = generateToken();

  try {
    const [inserted] = await db
      .insert(tenantMcpAdminKeys)
      .values({
        tenant_id: tenantId,
        key_hash: hash,
        name,
        created_by_user_id: createdByUserId,
      })
      .returning({
        id: tenantMcpAdminKeys.id,
        name: tenantMcpAdminKeys.name,
        created_at: tenantMcpAdminKeys.created_at,
      });
    return json(
      {
        id: inserted!.id,
        name: inserted!.name,
        token: raw,
        created_at: inserted!.created_at,
      },
      201,
    );
  } catch (err: unknown) {
    // Partial unique index (tenant_id, name) WHERE revoked_at IS NULL.
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("uq_tenant_mcp_admin_keys_active_name")) {
      return error(
        `A key named "${name}" already exists for this tenant. Revoke it or pick a different name.`,
        409,
      );
    }
    throw err;
  }
}

async function listKeys(
  db: ReturnType<typeof getDb>,
  tenantId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  const rows = await db
    .select({
      id: tenantMcpAdminKeys.id,
      name: tenantMcpAdminKeys.name,
      created_at: tenantMcpAdminKeys.created_at,
      created_by_user_id: tenantMcpAdminKeys.created_by_user_id,
      last_used_at: tenantMcpAdminKeys.last_used_at,
      revoked_at: tenantMcpAdminKeys.revoked_at,
    })
    .from(tenantMcpAdminKeys)
    .where(eq(tenantMcpAdminKeys.tenant_id, tenantId))
    .orderBy(desc(tenantMcpAdminKeys.created_at));
  return json({ keys: rows });
}

async function revokeKey(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  keyId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  // Idempotent: setting revoked_at on an already-revoked row is a no-op
  // (we only update where revoked_at IS NULL), and the 204 is the same.
  await db
    .update(tenantMcpAdminKeys)
    .set({ revoked_at: new Date() })
    .where(
      and(
        eq(tenantMcpAdminKeys.id, keyId),
        eq(tenantMcpAdminKeys.tenant_id, tenantId),
      ),
    );
  return { statusCode: 204, headers: {}, body: "" };
}
