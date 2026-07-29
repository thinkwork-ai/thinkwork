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
 * Routes (tenantId accepted as UUID or slug):
 *   POST   /api/tenants/:tenantId/brain-api-keys
 *     body: { name: string, expiresInDays?: number,
 *             securityGroups?: string[], kbCollections?: string[] }
 *     → 201 { id, name, token, key_suffix, created_at, expires_at,
 *             security_groups, kb_collections, keyManifest }
 *       `token` is the ONLY time the raw value is returned. The stored
 *       key_suffix (last 8 chars) is the display handle afterwards.
 *
 *   GET    /api/tenants/:tenantId/brain-api-keys
 *     → 200 { keys: [{ id, name, key_suffix, created_at, expires_at,
 *             security_groups, kb_collections, created_by_user_id,
 *             last_used_at, revoked_at }] }
 *
 *   PATCH  /api/tenants/:tenantId/brain-api-keys/:id
 *     body: { securityGroups?: string[], kbCollections?: string[] }
 *       (at least one; omitted field is left untouched)
 *     → 200 { id, name, security_groups, kb_collections, keyManifest }
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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const KEY_SUFFIX_CHARS = 8;
/** 10 years — the UI's "no expiry" cap guard; anything above is rejected. */
const MAX_EXPIRES_IN_DAYS = 3650;
/** Grant list guards — a manifest entry is not a place to dump free text. */
const MAX_GRANT_ENTRIES = 100;
const MAX_GRANT_LENGTH = 200;

/**
 * Validate one grant list (`securityGroups` / `kbCollections`): an array of
 * non-empty strings, `"*"` allowed as the all-of wildcard. Trims and
 * de-duplicates, order preserved. Returns an error string on rejection —
 * fail the request rather than silently storing a grant we mangled.
 */
function parseGrantList(
  value: unknown,
  field: string,
): { values: string[] } | { error: string } {
  if (!Array.isArray(value))
    return { error: `${field}: array of non-empty strings required` };
  if (value.length > MAX_GRANT_ENTRIES)
    return { error: `${field}: max ${MAX_GRANT_ENTRIES} entries` };
  const values: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string")
      return { error: `${field}: array of non-empty strings required` };
    const trimmed = entry.trim();
    if (!trimmed)
      return { error: `${field}: array of non-empty strings required` };
    if (trimmed.length > MAX_GRANT_LENGTH)
      return { error: `${field}: each entry max ${MAX_GRANT_LENGTH} chars` };
    if (!values.includes(trimmed)) values.push(trimmed);
  }
  return { values };
}

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
        return createKey(db, verdict.tenantId, event, verdict.userId);
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
        return updateKeyGrants(db, verdict.tenantId, keyId, event);
      return error("Method not allowed", 405);
    }

    return notFound("Route not found");
  } catch (err: unknown) {
    console.error("brain-api-keys handler error:", err);
    return error("Internal server error", 500);
  }
}

async function createKey(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  event: APIGatewayProxyEventV2,
  callerUserId: string | null,
): Promise<APIGatewayProxyStructuredResultV2> {
  let body: {
    name?: string;
    expiresInDays?: number;
    securityGroups?: unknown;
    kbCollections?: unknown;
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
        created_by_user_id: createdByUserId,
      })
      .returning({
        id: tenantMcpTwinKeys.id,
        name: tenantMcpTwinKeys.name,
        created_at: tenantMcpTwinKeys.created_at,
        expires_at: tenantMcpTwinKeys.expires_at,
        security_groups: tenantMcpTwinKeys.security_groups,
        kb_collections: tenantMcpTwinKeys.kb_collections,
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
): Promise<APIGatewayProxyStructuredResultV2> {
  let body: { securityGroups?: unknown; kbCollections?: unknown };
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return error("Invalid JSON body", 400);
  }

  const patch: { security_groups?: string[]; kb_collections?: string[] } = {};
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
  if (Object.keys(patch).length === 0)
    return error("securityGroups or kbCollections: at least one required", 400);

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
    });
  if (!updated) return notFound("Key not found");

  const keyManifest = await publishTwinKeyManifest(tenantId, { db });
  return json({
    id: updated.id,
    name: updated.name,
    security_groups: updated.security_groups ?? [],
    kb_collections: updated.kb_collections ?? [],
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
