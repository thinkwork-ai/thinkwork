/**
 * manifest-log — narrow runtime→API endpoint for Resolved Capability
 * Manifests (plan §U15).
 *
 *   POST /api/runtime/manifests
 *     Authorization: Bearer <API_AUTH_SECRET>
 *     body: {
 *       session_id, tenant_id, manifest_json,
 *       agent_id?, template_id?, user_id?
 *     }
 *     → 201 { id, created_at }
 *
 * Auth rationale: the Strands container calls this from its own tenant's
 * AgentCore runtime at session-start. There is no tenant OAuth user on
 * the call (runtime → API path), so we use the shared service secret
 * — same pattern as mcp-admin-keys / sandbox-quota-check. Tenant
 * isolation is still enforced: the body MUST carry a real tenant_id
 * that matches an existing tenants row; the handler rejects otherwise.
 *
 * No reads. No list. Admin UI will read via GraphQL (part 3 of U15); the
 * write endpoint stays narrow so it's trivially auditable.
 *
 * Inert ship: this PR lands the handler + terraform routes. The Python
 * capability_manifest.py that POSTs here ships in U15 part 2.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { eq } from "drizzle-orm";
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

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  if (event.requestContext.http.method === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
        "Access-Control-Allow-Headers": "*",
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
  if (
    agent_id === "invalid" ||
    template_id === "invalid" ||
    user_id === "invalid"
  ) {
    return error(
      "agent_id / template_id / user_id must be UUIDs when set",
      400,
    );
  }

  const manifest_json = parsed.manifest_json;
  if (
    !manifest_json ||
    typeof manifest_json !== "object" ||
    Array.isArray(manifest_json)
  ) {
    return error("manifest_json: required object", 400);
  }

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
        manifest_json,
      })
      .returning({
        id: resolvedCapabilityManifests.id,
        created_at: resolvedCapabilityManifests.created_at,
      });
    if (!inserted) {
      return error("failed to persist manifest", 500);
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
