/**
 * mcp-approval — admin approve/reject for tenant MCP servers (plan §U11, SI-5).
 *
 * Plugin-uploaded MCP servers land in `tenant_mcp_servers` with
 * `status='pending'` (plan R8). The runtime's `buildMcpConfigs` (U3 gate)
 * filters `status='approved' AND enabled=true` with a defensive
 * `url_hash` match, so pending or rejected servers never reach an agent.
 *
 * This handler wires the admin → approved transition. Two routes:
 *
 *   POST /api/tenants/:tenantId/mcp-servers/:serverId/approve
 *     body: {} (no payload required)
 *     → 200 { id, status: 'approved', url_hash, approved_by, approved_at }
 *     Computes `url_hash = sha256(canonical(url, auth_config))` at decision
 *     time. Any subsequent mutation to either field must revert to pending
 *     (enforced in the update paths in skills.ts / plugin-upload.ts that
 *     route through `applyMcpServerFieldUpdate`).
 *
 *   POST /api/tenants/:tenantId/mcp-servers/:serverId/reject
 *     body: { reason?: string } (≤ 500 chars; echoed in CloudWatch audit log)
 *     → 200 { id, status: 'rejected' }
 *     Clears approval metadata. Rejection is NOT terminal from the API side —
 *     an admin can re-approve a rejected row if the uploaded plugin is
 *     genuinely benign. The audit log is the record of prior decisions.
 *
 * Authz: Cognito JWT, caller must be owner/admin of the target tenant.
 *   Mirrors plugin-upload.ts's REST analogue of `requireTenantAdmin`.
 *   Tenant isolation: cross-tenant serverId returns 404 (not 403) so
 *   membership shape of another tenant is not leaked.
 *
 * OPTIONS short-circuits before auth per plan §SI-4 companion discipline.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { and, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { tenantMcpServers, tenantMembers } from "@thinkwork/database-pg/schema";
import { authenticate } from "../lib/cognito-auth.js";
import {
  error,
  forbidden,
  handleCors,
  json,
  notFound,
  unauthorized,
} from "../lib/response.js";
import { computeMcpUrlHash } from "../lib/mcp-server-hash.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const APPROVE_PATH =
  /^\/api\/tenants\/([^/]+)\/mcp-servers\/([^/]+)\/approve\/?$/;
const REJECT_PATH =
  /^\/api\/tenants\/([^/]+)\/mcp-servers\/([^/]+)\/reject\/?$/;

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const cors = handleCors(event);
  if (cors) return cors;

  if (event.requestContext.http.method !== "POST") {
    return error("Method not allowed", 405);
  }

  const path = event.rawPath;
  const approveMatch = path.match(APPROVE_PATH);
  const rejectMatch = path.match(REJECT_PATH);
  if (!approveMatch && !rejectMatch) return notFound("Route not found");

  const tenantIdParam = (approveMatch?.[1] ?? rejectMatch?.[1])!;
  const serverId = (approveMatch?.[2] ?? rejectMatch?.[2])!;

  if (!UUID_RE.test(tenantIdParam)) {
    return error("tenantId: valid UUID required", 400);
  }
  if (!UUID_RE.test(serverId)) {
    return error("serverId: valid UUID required", 400);
  }

  const auth = await authenticate(
    event.headers as Record<string, string | undefined>,
  );
  if (!auth) return unauthorized();

  if (!auth.principalId) {
    return error("authentication carried no principal_id", 401);
  }

  const isAdmin = await callerIsTenantAdmin(tenantIdParam, auth.principalId);
  if (!isAdmin) return forbidden("caller is not a tenant admin or owner");

  try {
    if (approveMatch) {
      return await approveMcpServer(tenantIdParam, serverId, auth.principalId);
    }
    return await rejectMcpServer(
      tenantIdParam,
      serverId,
      auth.principalId,
      event,
    );
  } catch (e) {
    console.error("[mcp-approval] handler crashed:", e);
    return error("internal server error", 500);
  }
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export async function approveMcpServer(
  tenantId: string,
  serverId: string,
  adminUserId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  const db = getDb();
  const [row] = await db
    .select({
      id: tenantMcpServers.id,
      tenant_id: tenantMcpServers.tenant_id,
      url: tenantMcpServers.url,
      auth_config: tenantMcpServers.auth_config,
      status: tenantMcpServers.status,
    })
    .from(tenantMcpServers)
    .where(eq(tenantMcpServers.id, serverId))
    .limit(1);

  // Cross-tenant + non-existent both return 404. Same-tenant admin
  // learns nothing extra from a 403 here — tenant isolation > UX polish.
  if (!row || row.tenant_id !== tenantId)
    return notFound("MCP server not found");

  const urlHash = computeMcpUrlHash(
    row.url,
    row.auth_config as Record<string, unknown> | null,
  );
  const now = new Date();

  await db
    .update(tenantMcpServers)
    .set({
      status: "approved",
      url_hash: urlHash,
      approved_by: adminUserId,
      approved_at: now,
      updated_at: now,
    })
    .where(eq(tenantMcpServers.id, serverId));

  console.log(
    `[mcp-approval] approve tenant=${tenantId} server=${serverId} admin=${adminUserId}`,
  );

  return json({
    id: serverId,
    status: "approved",
    url_hash: urlHash,
    approved_by: adminUserId,
    approved_at: now.toISOString(),
  });
}

export async function rejectMcpServer(
  tenantId: string,
  serverId: string,
  adminUserId: string,
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  let reason: string | undefined;
  if (event.body) {
    try {
      const parsed = JSON.parse(event.body) as { reason?: unknown };
      if (typeof parsed.reason === "string") {
        reason = parsed.reason.slice(0, 500);
      }
    } catch {
      return error("Invalid JSON body", 400);
    }
  }

  const db = getDb();
  const [row] = await db
    .select({
      id: tenantMcpServers.id,
      tenant_id: tenantMcpServers.tenant_id,
      status: tenantMcpServers.status,
    })
    .from(tenantMcpServers)
    .where(eq(tenantMcpServers.id, serverId))
    .limit(1);

  if (!row || row.tenant_id !== tenantId)
    return notFound("MCP server not found");

  const now = new Date();
  await db
    .update(tenantMcpServers)
    .set({
      status: "rejected",
      url_hash: null,
      approved_by: null,
      approved_at: null,
      updated_at: now,
    })
    .where(eq(tenantMcpServers.id, serverId));

  // Rejection reason is captured in CloudWatch only; no DB column exists
  // yet. Future admin-UI iteration can add a persisted column if needed.
  console.log(
    `[mcp-approval] reject tenant=${tenantId} server=${serverId} admin=${adminUserId} reason=${JSON.stringify(reason ?? null)}`,
  );

  return json({
    id: serverId,
    status: "rejected",
    reason: reason ?? null,
  });
}

// ---------------------------------------------------------------------------
// Authz helper — REST analogue of requireTenantAdmin (see plugin-upload.ts)
// ---------------------------------------------------------------------------

async function callerIsTenantAdmin(
  tenantId: string,
  principalId: string,
): Promise<boolean> {
  const rows = await getDb()
    .select({ role: tenantMembers.role })
    .from(tenantMembers)
    .where(
      and(
        eq(tenantMembers.tenant_id, tenantId),
        eq(tenantMembers.principal_id, principalId),
      ),
    )
    .limit(1);
  const role = rows[0]?.role;
  return role === "owner" || role === "admin";
}
