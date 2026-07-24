/**
 * mcp-twin-provision — idempotent per-tenant provisioning of the Digital
 * Twin MCP connector (THINK-333 U4). Mirrors mcp-admin-provision's route
 * shape; the ceremony itself lives in lib/twin/provision-connector.ts.
 *
 * Re-running IS the rotate op: the old `tkt_` key is revoked, the secret
 * re-pointed, and the registry row re-approved with a fresh url_hash in
 * one call — agents never cross a dead-credential window.
 *
 * Routes:
 *   POST /api/tenants/:tenantId/mcp-twin-provision
 *     body: { url?: string, action?: "republish-keys" }
 *       url — override the MCP endpoint. Defaults to BRAIN_MCP_URL
 *             (platform-served Brain MCP, consolidation U14) when
 *             configured, else the stage API Gateway URL + /mcp/twin.
 *       action "republish-keys" — idempotent backfill: publish the
 *             hashed-key manifest (twin-mcp-keys/<tenantId>/latest.json)
 *             from the CURRENT active keys WITHOUT rotating anything.
 *             For tenants whose keys predate the U12 manifest seam.
 *     → 201 { tenantMcpServerId, keyId, secretRef, url, provisioned,
 *             workspaces, keyManifest }
 *     → 200 { tenantId, keyManifest } for action=republish-keys
 *     → 409 twin_not_deployed when the stage has no NEPTUNE_ENDPOINT.
 *
 * Auth (requireTenantMembership): Cognito owner/admin of the tenant, or
 * the shared API_AUTH_SECRET platform credential (backfill path).
 */
import { getConfig } from "@thinkwork/runtime-config";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { error, json, notFound } from "../lib/response.js";
import { requireTenantMembership } from "../lib/tenant-membership.js";
import { publishTwinKeyManifest } from "../lib/twin/key-manifest.js";
import { provisionTwinConnector } from "../lib/twin/provision-connector.js";

const STAGE = process.env.STAGE || "dev";

function defaultTwinMcpUrl(): string {
  // Consolidation U14: when the stage has a platform-served Brain MCP
  // endpoint configured, register agents against it instead of the
  // product's /mcp/twin route — same tkt_ keys, verified platform-side
  // via the hashed-key manifest. Empty/unset keeps the legacy default.
  let brainMcpUrl = "";
  try {
    brainMcpUrl = (getConfig("BRAIN_MCP_URL") || "").trim();
  } catch {
    brainMcpUrl = "";
  }
  if (brainMcpUrl) return brainMcpUrl.replace(/\/+$/, "");
  const apiUrl = getConfig("THINKWORK_API_URL");
  if (!apiUrl) throw new Error("THINKWORK_API_URL is not set");
  return `${apiUrl.replace(/\/+$/, "")}/mcp/twin`;
}

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
          "Content-Type, Authorization, x-tenant-id, x-api-key",
      },
      body: "",
    };
  }
  if (event.requestContext.http.method !== "POST") {
    return error("Method not allowed", 405);
  }

  const match = event.rawPath.match(
    /^\/api\/tenants\/([^/]+)\/mcp-twin-provision\/?$/,
  );
  if (!match) return notFound("Route not found");

  const verdict = await requireTenantMembership(event, match[1]!);
  if (!verdict.ok) return error(verdict.reason, verdict.status);

  let parsedBody: { url?: string; action?: string };
  try {
    parsedBody = JSON.parse(event.body || "{}");
  } catch {
    return error("Invalid JSON body", 400);
  }

  // Backfill path (U12 manifest seam): republish the hashed-key manifest
  // from current active keys without touching keys/secret/registry. Needs
  // no Neptune — the manifest is an S3-only artifact.
  if (parsedBody.action === "republish-keys") {
    const keyManifest = await publishTwinKeyManifest(verdict.tenantId);
    return json({ tenantId: verdict.tenantId, keyManifest }, 200);
  }
  if (parsedBody.action !== undefined) {
    return error(`Unknown action: ${parsedBody.action}`, 400);
  }

  // The twin must be deployed on this stage — provisioning a connector
  // whose every tool degrades to "unavailable" helps nobody.
  let neptuneConfigured = false;
  try {
    neptuneConfigured = Boolean(getConfig("NEPTUNE_ENDPOINT"));
  } catch {
    neptuneConfigured = false;
  }
  if (!neptuneConfigured) {
    return error("twin_not_deployed: stage has no NEPTUNE_ENDPOINT", 409);
  }

  const url = (parsedBody.url?.trim() || defaultTwinMcpUrl()).trim();
  if (!/^https:\/\//i.test(url)) {
    return error("url must be an https URL", 400);
  }

  try {
    const result = await provisionTwinConnector({
      tenantId: verdict.tenantId,
      twinMcpUrl: url,
      stage: STAGE,
      createdByUserId: verdict.userId ?? null,
    });
    return json(result, 201);
  } catch (err: unknown) {
    console.error("mcp-twin-provision handler error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return error(`Internal server error: ${message}`, 500);
  }
}
