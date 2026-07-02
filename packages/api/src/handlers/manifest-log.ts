/**
 * manifest-log — narrow runtime→API endpoint for Resolved Capability
 * Manifests (plan §U15).
 *
 *   POST /api/runtime/manifests
 *     Authorization: Bearer <API_AUTH_SECRET>
 *     body: {
 *       session_id, tenant_id, manifest_json,
 *       agent_id?, template_id?, user_id?,
 *       thread_id?, thread_turn_id?, space_id?, agent_profile_id?,
 *       config_fingerprint?
 *     }
 *     → 201 { id, created_at }
 *
 * manifest_json contract (capability-mapping plan U11): schema_version 2 with
 * `resolved` (what config resolution produced) and `loaded` (what the
 * container actually registered) object sections. Shapeless payloads are
 * rejected — the spine had no producers before U12, so v2 is the only
 * accepted shape. Single-actor scoping is enforced here: a manifest carries
 * at most the one user_id column; payloads that embed per-user aggregates
 * (`users` / `actors` arrays inside manifest_json) are rejected (KTD-7).
 *
 * Retention (U11): rows expire after 30 days. There is no external sweeper;
 * each successful write opportunistically deletes the writing tenant's
 * expired rows (best-effort, never fails the request).
 *
 * Auth rationale: the runtime calls this from its own tenant's
 * AgentCore runtime at session-start. There is no tenant OAuth user on
 * the call (runtime → API path), so we use the shared service secret
 * — same pattern as mcp-admin-keys / sandbox-quota-check. Tenant
 * isolation is still enforced: the body MUST carry a real tenant_id
 * that matches an existing tenants row; the handler rejects otherwise.
 *
 * No reads. No list. Admin UI will read via GraphQL (part 3 of U15); the
 * write endpoint stays narrow so it's trivially auditable.
 *
 * Inert ship: this PR lands the handler + terraform routes. The runtime
 * capability manifest client that POSTs here ships in U15 part 2.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { and, eq, lt, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  resolvedCapabilityManifests,
  tenants,
} from "@thinkwork/database-pg/schema";
import { extractBearerToken, validateApiSecret } from "../lib/auth.js";
import { error, json, notFound, unauthorized } from "../lib/response.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MANIFEST_BYTES = 256 * 1024; // 256 KB — generous for a single session's capability list.
const MAX_FINGERPRINT_CHARS = 256;
const RETENTION_DAYS = 30;
export const MANIFEST_SCHEMA_VERSION = 2;

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  if (event.requestContext.http.method === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, x-tenant-id, x-tenant-slug, x-thinkwork-tenant-id, x-thinkwork-tenant-slug, x-api-key, x-thinkwork-deployment-token",
      },
      body: "",
    };
  }

  if (event.requestContext.http.method !== "POST") {
    return error("Method not allowed", 405);
  }
  if (event.rawPath !== "/api/runtime/manifests") {
    return notFound("Route not found");
  }

  const token = extractBearerToken(event);
  if (!token || !validateApiSecret(token)) return unauthorized();

  // Bound body size BEFORE parsing so a pathological payload can't
  // hog lambda memory. 256 KB is ~orders of magnitude above the plan's
  // typical manifest footprint (tens of capabilities + short specs).
  const body = event.body ?? "";
  if (body.length > MAX_MANIFEST_BYTES) {
    return error(
      `manifest body exceeds ${MAX_MANIFEST_BYTES} bytes (got ${body.length})`,
      413,
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body || "{}") as Record<string, unknown>;
  } catch {
    return error("Invalid JSON body", 400);
  }

  const session_id =
    typeof parsed.session_id === "string" ? parsed.session_id.trim() : "";
  if (!session_id) return error("session_id: required non-empty string", 400);
  if (session_id.length > 256) {
    return error("session_id: max 256 chars", 400);
  }

  const tenant_id =
    typeof parsed.tenant_id === "string" ? parsed.tenant_id : "";
  if (!UUID_RE.test(tenant_id)) {
    return error("tenant_id: valid UUID required", 400);
  }

  const agent_id = optionalUuid(parsed.agent_id);
  const template_id = optionalUuid(parsed.template_id);
  const user_id = optionalUuid(parsed.user_id);
  const thread_id = optionalUuid(parsed.thread_id);
  const thread_turn_id = optionalUuid(parsed.thread_turn_id);
  const space_id = optionalUuid(parsed.space_id);
  const agent_profile_id = optionalUuid(parsed.agent_profile_id);
  if (
    agent_id === "invalid" ||
    template_id === "invalid" ||
    user_id === "invalid" ||
    thread_id === "invalid" ||
    thread_turn_id === "invalid" ||
    space_id === "invalid" ||
    agent_profile_id === "invalid"
  ) {
    return error(
      "agent_id / template_id / user_id / thread_id / thread_turn_id / space_id / agent_profile_id must be UUIDs when set",
      400,
    );
  }

  let config_fingerprint: string | undefined;
  if (parsed.config_fingerprint !== undefined) {
    if (
      typeof parsed.config_fingerprint !== "string" ||
      !parsed.config_fingerprint.trim() ||
      parsed.config_fingerprint.length > MAX_FINGERPRINT_CHARS
    ) {
      return error(
        `config_fingerprint: non-empty string up to ${MAX_FINGERPRINT_CHARS} chars when set`,
        400,
      );
    }
    config_fingerprint = parsed.config_fingerprint.trim();
  }

  const manifest_json = parsed.manifest_json;
  if (
    !manifest_json ||
    typeof manifest_json !== "object" ||
    Array.isArray(manifest_json)
  ) {
    return error("manifest_json: required object", 400);
  }
  const manifestShapeError = validateManifestShape(
    manifest_json as Record<string, unknown>,
  );
  if (manifestShapeError) return error(manifestShapeError, 400);

  try {
    const db = getDb();

    // Tenant isolation check — refuses to persist a row against a
    // tenant that doesn't exist. This is cheap and guards against a
    // compromised runtime secret silently forging cross-tenant rows.
    const [tenantRow] = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.id, tenant_id))
      .limit(1);
    if (!tenantRow) {
      return notFound("tenant not found");
    }

    const [inserted] = await db
      .insert(resolvedCapabilityManifests)
      .values({
        session_id,
        tenant_id,
        agent_id: agent_id ?? null,
        template_id: template_id ?? null,
        user_id: user_id ?? null,
        thread_id: thread_id ?? null,
        thread_turn_id: thread_turn_id ?? null,
        space_id: space_id ?? null,
        agent_profile_id: agent_profile_id ?? null,
        config_fingerprint: config_fingerprint ?? null,
        manifest_json,
      })
      .returning({
        id: resolvedCapabilityManifests.id,
        created_at: resolvedCapabilityManifests.created_at,
      });
    if (!inserted) {
      return error("failed to persist manifest", 500);
    }

    // Opportunistic 30-day retention sweep for the writing tenant.
    // Best-effort: a sweep failure never fails the write.
    try {
      await db
        .delete(resolvedCapabilityManifests)
        .where(
          and(
            eq(resolvedCapabilityManifests.tenant_id, tenant_id),
            lt(
              resolvedCapabilityManifests.created_at,
              sql`now() - interval '${sql.raw(String(RETENTION_DAYS))} days'`,
            ),
          ),
        );
    } catch (sweepErr) {
      console.warn("[manifest-log] retention sweep failed:", sweepErr);
    }

    return json(
      {
        id: inserted.id,
        created_at: inserted.created_at.toISOString(),
      },
      201,
    );
  } catch (err) {
    console.error("[manifest-log] handler crashed:", err);
    return error("internal server error", 500);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize an optional UUID field from the request body.
 *   - undefined / null / empty → `undefined` (field is truly absent)
 *   - valid UUID string → the UUID
 *   - anything else → sentinel `"invalid"` so the caller can 400 once
 *     instead of branching per field.
 */
function optionalUuid(value: unknown): string | undefined | "invalid" {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return "invalid";
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  if (!UUID_RE.test(trimmed)) return "invalid";
  return trimmed;
}

/**
 * Validate the U11 manifest_json contract. Returns an error message or null.
 *
 *   {
 *     schema_version: 2,
 *     resolved: { skills: [...], builtInTools: [...], mcpServers: [...], piExtensions: [...] },
 *     loaded:   { ...same sections, what actually registered... },
 *     gated?:   [{ capabilityClass, capabilityId, reason, detail? }],
 *     delegatedProfiles?: [{ profileId, slug, resolved, loaded }]
 *   }
 *
 * Deep per-item validation stays with the producer's tests (U12); this
 * boundary check guarantees the resolved-vs-loaded split exists so U13's
 * structural diff never sees a shapeless blob.
 */
function validateManifestShape(
  manifest: Record<string, unknown>,
): string | null {
  if (manifest.schema_version !== MANIFEST_SCHEMA_VERSION) {
    return `manifest_json.schema_version: must be ${MANIFEST_SCHEMA_VERSION}`;
  }
  for (const section of ["resolved", "loaded"] as const) {
    const value = manifest[section];
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return `manifest_json.${section}: required object section`;
    }
  }
  if (manifest.gated !== undefined && !Array.isArray(manifest.gated)) {
    return "manifest_json.gated: must be an array when present";
  }
  if (
    manifest.delegatedProfiles !== undefined &&
    !Array.isArray(manifest.delegatedProfiles)
  ) {
    return "manifest_json.delegatedProfiles: must be an array when present";
  }
  // Single-actor scoping (KTD-7): a manifest never aggregates cross-user
  // state. The actor is the row's user_id column; embedded per-user
  // collections are rejected outright.
  if (manifest.users !== undefined || manifest.actors !== undefined) {
    return "manifest_json: cross-actor aggregates (users/actors) are not allowed — one manifest row per actor";
  }
  return null;
}
