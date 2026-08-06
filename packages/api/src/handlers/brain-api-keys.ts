/**
 * brain-api-keys — per-tenant Bearer token management for the platform
 * Company Brain MCP server.
 *
 * Mirrors mcp-admin-keys (tkm_) but mints `tkt_` keys into
 * tenant_mcp_twin_keys, and every create/revoke republishes the
 * hashed-key manifest (twin-mcp-keys/<tenantId>/latest.json) that the
 * platform Brain MCP verifies bearers against — the platform server is
 * DB-free, so the manifest IS the credential store it sees. Publish
 * failure never blocks the mutation; it surfaces as `keyManifest` in the
 * response (same contract as mcp-twin-provision).
 *
 * Per-key grants (twin-mcp-keys/v2, THINK-412): `securityGroups` are the
 * graph security groups a key may see on top of the always-visible PUBLIC
 * group (empty = PUBLIC only) and `kbCollections` are the KB collections
 * it may retrieve (empty = none — KB is grant-only). `"*"` in either list
 * is the wildcard the platform-provisioned "default" key carries. Grants
 * live on the row and reach the platform ONLY via the manifest, so every
 * grant change republishes.
 *
 * Trusted subsystem (THINK-626): `trustedSubsystem` lets a key assert
 * `on_behalf_of` — swap the acting principal to a named signed-in human
 * for one tools/call. It is not a grant, it is the right to speak for
 * someone else, so it is **platform-operator only**: a tenant owner/admin
 * on the Cognito path is refused with 403, while the shared-secret
 * (apikey/service) path — CI, the CLI, the provisioning ceremony — may set
 * it. The provisioned "default" connector key gets it automatically in
 * provision-connector.ts; this surface exists for the rare second
 * platform-held key and for turning one back off.
 *
 * Routes (tenantId accepted as UUID or slug):
 *   POST   /api/tenants/:tenantId/brain-api-keys
 *     body: { name: string, expiresInDays?: number,
 *             securityGroups?: string[], kbCollections?: string[],
 *             trustedSubsystem?: boolean (operator-only) }
 *     → 201 { id, name, token, key_suffix, created_at, expires_at,
 *             security_groups, kb_collections, trusted_subsystem,
 *             keyManifest }
 *       `token` is the ONLY time the raw value is returned. The stored
 *       key_suffix (last 8 chars) is the display handle afterwards.
 *
 *   GET    /api/tenants/:tenantId/brain-api-keys
 *     → 200 { keys: [{ id, name, key_suffix, created_at, expires_at,
 *             security_groups, kb_collections, trusted_subsystem,
 *             created_by_user_id, last_used_at, revoked_at }] }
 *
 *   PATCH  /api/tenants/:tenantId/brain-api-keys/:id
 *     body: { securityGroups?: string[], kbCollections?: string[],
 *             trustedSubsystem?: boolean (operator-only) }
 *       (at least one; omitted field is left untouched)
 *     → 200 { id, name, security_groups, kb_collections,
 *             trusted_subsystem, keyManifest }
 *       404 when the key is unknown to this tenant.
 *
 *   DELETE /api/tenants/:tenantId/brain-api-keys/:id
 *     → 200 { keyManifest } (idempotent; already-revoked rows too)
 *
 * The provisioned connector's "default" key rides mcp-twin-provision and
 * is listed here like any other row — revoking it breaks the
 * platform-managed connector until a re-provision, so the UI should warn.
 *
 * Auth (requireTenantMembership): reads allow any active member;
 * mutations require owner/admin. Shared API_AUTH_SECRET is the
 * platform-credential path.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { tenantMcpTwinKeys } from "@thinkwork/database-pg/schema";
import { error, json, notFound } from "../lib/response.js";
import { requireTenantMembership } from "../lib/tenant-membership.js";
import { generateTwinKey } from "../lib/twin/provision-connector.js";
import { publishTwinKeyManifest } from "../lib/twin/key-manifest.js";
import { parseGrantList } from "../lib/twin/grants.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const KEY_SUFFIX_CHARS = 8;
/** 10 years — the UI's "no expiry" cap guard; anything above is rejected. */
const MAX_EXPIRES_IN_DAYS = 3650;

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  if (event.requestContext.http.method === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, x-tenant-id, x-tenant-slug, x-thinkwork-tenant-id, x-thinkwork-tenant-slug, x-api-key, x-thinkwork-deployment-token",
      },
      body: "",
    };
  }

  const method = event.requestContext.http.method;
  const path = event.rawPath;

  const listOrCreateMatch = path.match(
    /^\/api\/tenants\/([^/]+)\/brain-api-keys\/?$/,
  );
  const keyMatch = path.match(
    /^\/api\/tenants\/([^/]+)\/brain-api-keys\/([^/]+)\/?$/,
  );

  try {
    if (listOrCreateMatch) {
      const tenantIdOrSlug = listOrCreateMatch[1]!;
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
        return createKey(
          db,
          verdict.tenantId,
          event,
          verdict.userId,
          isPlatformOperator(verdict),
        );
      return error("Method not allowed", 405);
    }

    if (keyMatch) {
      const tenantIdOrSlug = keyMatch[1]!;
      const keyId = keyMatch[2]!;
      if (!UUID_RE.test(keyId))
        return error("key id: valid UUID required", 400);

      const verdict = await requireTenantMembership(event, tenantIdOrSlug);
      if (!verdict.ok) return error(verdict.reason, verdict.status);

      const db = getDb();
      if (method === "DELETE") return revokeKey(db, verdict.tenantId, keyId);
      if (method === "PATCH")
        return updateKeyGrants(
          db,
          verdict.tenantId,
          keyId,
          event,
          isPlatformOperator(verdict),
        );
      return error("Method not allowed", 405);
    }

    return notFound("Route not found");
  } catch (err: unknown) {
    console.error("brain-api-keys handler error:", err);
    return error("Internal server error", 500);
  }
}

/**
 * True only for the shared-secret path (CI, the CLI, the provisioning
 * ceremony), which `requireTenantMembership` admits with no per-tenant
 * role. A tenant owner/admin on the Cognito path is NOT an operator here:
 * `trustedSubsystem` is the right to speak for another human, so it stays
 * behind the platform trust boundary, not the tenant one.
 */
function isPlatformOperator(verdict: {
  auth?: { authType?: string } | null;
}): boolean {
  const authType = verdict.auth?.authType;
  return authType === "apikey" || authType === "service";
}

/**
 * Parse the operator-only `trustedSubsystem` field. Absent ⇒ `undefined`
 * (leave alone / default false). Present from a non-operator ⇒ 403 rather
 * than a silent drop: a caller who thinks they minted a trusted key must
 * never walk away believing they did.
 */
function parseTrustedSubsystem(
  value: unknown,
  isOperator: boolean,
): { value?: boolean } | { error: string; status: 400 | 403 } {
  if (value === undefined || value === null) return {};
  if (typeof value !== "boolean")
    return { error: "trustedSubsystem: boolean required", status: 400 };
  if (!isOperator)
    return {
      error:
        "trustedSubsystem: platform-operator credential required (tenant admins cannot grant on_behalf_of assertion)",
      status: 403,
    };
  return { value };
}

async function createKey(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  event: APIGatewayProxyEventV2,
  callerUserId: string | null,
  isOperator: boolean,
): Promise<APIGatewayProxyStructuredResultV2> {
  let body: {
    name?: string;
    expiresInDays?: number;
    securityGroups?: unknown;
    kbCollections?: unknown;
    trustedSubsystem?: unknown;
    created_by_user_id?: string;
  };
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return error("Invalid JSON body", 400);
  }
  const name = (body.name ?? "").trim();
  if (!name) return error("name: required non-empty string", 400);
  if (name.length > 100) return error("name: max 100 chars", 400);
  // "default" is reserved for the platform-provisioned connector key —
  // colliding with it would make the next provisioning rotation revoke a
  // user-minted key by name.
  if (name === "default")
    return error(
      'name: "default" is reserved for the platform-managed connector key',
      400,
    );

  let expiresAt: Date | null = null;
  if (body.expiresInDays !== undefined && body.expiresInDays !== null) {
    const days = Number(body.expiresInDays);
    if (!Number.isFinite(days) || days <= 0 || days > MAX_EXPIRES_IN_DAYS)
      return error(
        `expiresInDays: number in (0, ${MAX_EXPIRES_IN_DAYS}] required`,
        400,
      );
    expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  // Absent grants = the least-privilege default (PUBLIC graph, no KB) —
  // a key minted without a grant list must never be born broad.
  let securityGroups: string[] = [];
  let kbCollections: string[] = [];
  if (body.securityGroups !== undefined && body.securityGroups !== null) {
    const parsed = parseGrantList(body.securityGroups, "securityGroups");
    if ("error" in parsed) return error(parsed.error, 400);
    securityGroups = parsed.values;
  }
  if (body.kbCollections !== undefined && body.kbCollections !== null) {
    const parsed = parseGrantList(body.kbCollections, "kbCollections");
    if ("error" in parsed) return error(parsed.error, 400);
    kbCollections = parsed.values;
  }

  const trusted = parseTrustedSubsystem(body.trustedSubsystem, isOperator);
  if ("error" in trusted) return error(trusted.error, trusted.status);
  const trustedSubsystem = trusted.value ?? false;

  const createdByUserId =
    callerUserId ??
    (body.created_by_user_id && UUID_RE.test(body.created_by_user_id)
      ? body.created_by_user_id
      : null);

  const { raw, hash } = generateTwinKey();
  const keySuffix = raw.slice(-KEY_SUFFIX_CHARS);

  let inserted: {
    id: string;
    name: string;
    created_at: Date;
    expires_at: Date | null;
    security_groups: string[] | null;
    kb_collections: string[] | null;
    trusted_subsystem: boolean | null;
  };
  try {
    const [row] = await db
      .insert(tenantMcpTwinKeys)
      .values({
        tenant_id: tenantId,
        key_hash: hash,
        name,
        key_suffix: keySuffix,
        expires_at: expiresAt,
        security_groups: securityGroups,
        kb_collections: kbCollections,
        trusted_subsystem: trustedSubsystem,
        created_by_user_id: createdByUserId,
      })
      .returning({
        id: tenantMcpTwinKeys.id,
        name: tenantMcpTwinKeys.name,
        created_at: tenantMcpTwinKeys.created_at,
        expires_at: tenantMcpTwinKeys.expires_at,
        security_groups: tenantMcpTwinKeys.security_groups,
        kb_collections: tenantMcpTwinKeys.kb_collections,
        trusted_subsystem: tenantMcpTwinKeys.trusted_subsystem,
      });
    inserted = row!;
  } catch (err: unknown) {
    // Partial unique index (tenant_id, name) WHERE revoked_at IS NULL.
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("uq_tenant_mcp_twin_keys_active_name")) {
      return error(
        `A key named "${name}" already exists for this tenant. Revoke it or pick a different name.`,
        409,
      );
    }
    throw err;
  }

  const keyManifest = await publishTwinKeyManifest(tenantId, { db });
  return json(
    {
      id: inserted.id,
      name: inserted.name,
      token: raw,
      key_suffix: keySuffix,
      created_at: inserted.created_at,
      expires_at: inserted.expires_at,
      security_groups: inserted.security_groups ?? securityGroups,
      kb_collections: inserted.kb_collections ?? kbCollections,
      trusted_subsystem: inserted.trusted_subsystem ?? trustedSubsystem,
      keyManifest,
    },
    201,
  );
}

async function listKeys(
  db: ReturnType<typeof getDb>,
  tenantId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  const rows = await db
    .select({
      id: tenantMcpTwinKeys.id,
      name: tenantMcpTwinKeys.name,
      key_suffix: tenantMcpTwinKeys.key_suffix,
      created_at: tenantMcpTwinKeys.created_at,
      expires_at: tenantMcpTwinKeys.expires_at,
      security_groups: tenantMcpTwinKeys.security_groups,
      kb_collections: tenantMcpTwinKeys.kb_collections,
      trusted_subsystem: tenantMcpTwinKeys.trusted_subsystem,
      created_by_user_id: tenantMcpTwinKeys.created_by_user_id,
      last_used_at: tenantMcpTwinKeys.last_used_at,
      revoked_at: tenantMcpTwinKeys.revoked_at,
    })
    .from(tenantMcpTwinKeys)
    .where(eq(tenantMcpTwinKeys.tenant_id, tenantId))
    .orderBy(desc(tenantMcpTwinKeys.created_at));
  return json({ keys: rows });
}

/**
 * Edit an existing key's grants. Only the fields present in the body are
 * touched, so narrowing groups never clears collections by omission. The
 * platform reads grants from the manifest alone — a grant change that
 * never reaches S3 has not happened — so this republishes, and the publish
 * outcome rides back in `keyManifest` (never blocks the mutation).
 */
async function updateKeyGrants(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  keyId: string,
  event: APIGatewayProxyEventV2,
  isOperator: boolean,
): Promise<APIGatewayProxyStructuredResultV2> {
  let body: {
    securityGroups?: unknown;
    kbCollections?: unknown;
    trustedSubsystem?: unknown;
  };
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return error("Invalid JSON body", 400);
  }

  const patch: {
    security_groups?: string[];
    kb_collections?: string[];
    trusted_subsystem?: boolean;
  } = {};
  if (body.securityGroups !== undefined && body.securityGroups !== null) {
    const parsed = parseGrantList(body.securityGroups, "securityGroups");
    if ("error" in parsed) return error(parsed.error, 400);
    patch.security_groups = parsed.values;
  }
  if (body.kbCollections !== undefined && body.kbCollections !== null) {
    const parsed = parseGrantList(body.kbCollections, "kbCollections");
    if ("error" in parsed) return error(parsed.error, 400);
    patch.kb_collections = parsed.values;
  }
  const trusted = parseTrustedSubsystem(body.trustedSubsystem, isOperator);
  if ("error" in trusted) return error(trusted.error, trusted.status);
  if (trusted.value !== undefined) patch.trusted_subsystem = trusted.value;
  if (Object.keys(patch).length === 0)
    return error(
      "securityGroups, kbCollections or trustedSubsystem: at least one required",
      400,
    );

  const [updated] = await db
    .update(tenantMcpTwinKeys)
    .set(patch)
    .where(
      and(
        eq(tenantMcpTwinKeys.id, keyId),
        eq(tenantMcpTwinKeys.tenant_id, tenantId),
      ),
    )
    .returning({
      id: tenantMcpTwinKeys.id,
      name: tenantMcpTwinKeys.name,
      security_groups: tenantMcpTwinKeys.security_groups,
      kb_collections: tenantMcpTwinKeys.kb_collections,
      trusted_subsystem: tenantMcpTwinKeys.trusted_subsystem,
    });
  if (!updated) return notFound("Key not found");

  const keyManifest = await publishTwinKeyManifest(tenantId, { db });
  return json({
    id: updated.id,
    name: updated.name,
    security_groups: updated.security_groups ?? [],
    kb_collections: updated.kb_collections ?? [],
    trusted_subsystem: updated.trusted_subsystem ?? false,
    keyManifest,
  });
}

async function revokeKey(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  keyId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  await db
    .update(tenantMcpTwinKeys)
    .set({ revoked_at: new Date() })
    .where(
      and(
        eq(tenantMcpTwinKeys.id, keyId),
        eq(tenantMcpTwinKeys.tenant_id, tenantId),
      ),
    );
  // Republish so the platform verifier drops the hash within its ≤60s
  // cache window — revocation that never reaches the manifest isn't
  // revocation.
  const keyManifest = await publishTwinKeyManifest(tenantId, { db });
  return json({ keyManifest });
}
