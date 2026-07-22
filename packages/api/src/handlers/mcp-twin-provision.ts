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
 *     body: { url?: string }
 *       url — override the MCP endpoint. Defaults to the stage API
 *             Gateway URL + /mcp/twin.
 *     → 201 { tenantMcpServerId, keyId, secretRef, url, provisioned,
 *             workspaces }
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
import { provisionTwinConnector } from "../lib/twin/provision-connector.js";

const STAGE = process.env.STAGE || "dev";

function defaultTwinMcpUrl(): string {
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

  let body: { url?: string };
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return error("Invalid JSON body", 400);
  }
  const url = (body.url?.trim() || defaultTwinMcpUrl()).trim();
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
