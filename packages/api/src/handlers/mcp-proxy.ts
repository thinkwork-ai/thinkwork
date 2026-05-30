/**
 * MCP proxy for the mobile agent harness.
 *
 * POST /api/mcp/tools/list   body { agentId }              → { tools: [...] }
 * POST /api/mcp/tools/call   body { agentId, name, arguments } → { content, isError? }
 *
 * Cognito-authenticated. The mobile device can't run an MCP client (Hermes has
 * no SDK transport), so it can neither discover which tools its tenant exposes
 * nor act as the signed-in user. This handler does both server-side: it
 * resolves the tenant's MCP servers for a given agent, refreshes per-user OAuth
 * tokens, and forwards JSON-RPC `tools/list` / `tools/call`. No long-lived
 * secret ever lives on the device — only the user's Cognito idToken.
 *
 *   200 → tool defs (list) / forwarded tool result (call); an upstream MCP
 *         `isError` result is returned as 200 with the error payload so the
 *         on-device agent loop can recover rather than crash.
 *   400 → bad body (missing agentId / name)
 *   401 → unauthenticated
 *   403 → authenticated but no tenant resolved for the caller
 *   404 → agent not found for the caller's tenant (also guards cross-tenant use)
 *   502 → upstream MCP transport failure (handled, never an unhandled throw)
 *
 * --- agentId-sourcing decision -------------------------------------------
 * `buildMcpConfigs` is keyed by `agentId`, but this call is user→tenant. The
 * mobile thread always knows its agent's id, so the device passes `agentId` in
 * the POST body. We validate the agent belongs to the caller's resolved tenant
 * (mirroring record-turn's cross-tenant guard) BEFORE calling buildMcpConfigs —
 * a 404 otherwise. `humanPairId` passed to buildMcpConfigs is the CALLER's
 * `users.id` (not the agent's `human_pair_id`), so per-user OAuth tokens belong
 * to the person actually driving the turn. This mirrors how wakeup-processor
 * sources (agentId, humanPairId), except the human is the live caller here.
 *
 * Tenant is resolved by email (the JWT `custom:tenant_id` claim is null for
 * Google-federated users — every mobile OAuth user; see resolveCallerTenantId /
 * [[feedback_oauth_tenant_resolver]]).
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { and, eq } from "drizzle-orm";
import { authenticate } from "../lib/cognito-auth.js";
import {
  handleCors,
  json,
  error,
  unauthorized,
  forbidden,
  notFound,
} from "../lib/response.js";
import { db } from "../lib/db.js";
import { schema } from "@thinkwork/database-pg";
import { buildMcpConfigs, type McpServerConfig } from "../lib/mcp-configs.js";
import {
  mcpListTools,
  mcpCallTool,
  McpTransportError,
  type McpToolDefinition,
} from "../lib/mcp-client-call.js";

const { users, agents } = schema;

const LOG_PREFIX = "[mcp-proxy]";

interface ProxyBody {
  agentId?: string;
  name?: string;
  arguments?: Record<string, unknown>;
}

/**
 * Namespace a tool name with its server so two servers exposing the same tool
 * name don't collide on the aggregated list. The runtime (mcp-connect.ts)
 * namespaces as `mcp_<server>_<tool>`; we use a readable `<server>__<tool>` so
 * tools/call can split it back to (server, tool) on the way out.
 */
const NAME_SEPARATOR = "__";

function qualifyToolName(serverName: string, toolName: string): string {
  return `${serverName}${NAME_SEPARATOR}${toolName}`;
}

function splitQualifiedToolName(
  qualified: string,
): { serverName: string; toolName: string } | null {
  const idx = qualified.indexOf(NAME_SEPARATOR);
  if (idx <= 0) return null;
  return {
    serverName: qualified.slice(0, idx),
    toolName: qualified.slice(idx + NAME_SEPARATOR.length),
  };
}

function targetFor(config: McpServerConfig) {
  return {
    url: config.url,
    token: config.auth?.token,
    name: config.name,
  };
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const preflight = handleCors(event);
  if (preflight) return preflight;

  if (event.requestContext.http.method !== "POST") {
    return error("Method not allowed", 405);
  }

  const path = event.requestContext.http.path || "";
  const isList = path.endsWith("/tools/list");
  const isCall = path.endsWith("/tools/call");
  if (!isList && !isCall) {
    return notFound("Unknown MCP proxy route");
  }

  const auth = await authenticate(
    event.headers as Record<string, string | undefined>,
  );
  if (!auth || auth.authType !== "cognito" || !auth.email) {
    return unauthorized("Authentication required");
  }

  // Tenant by email — JWT tenantId is null for Google-federated users.
  const [userRow] = await db
    .select()
    .from(users)
    .where(eq(users.email, auth.email.toLowerCase()))
    .limit(1);
  if (!userRow || !userRow.tenant_id) {
    return forbidden("No tenant resolved for caller");
  }
  const tenantId = userRow.tenant_id;

  let body: ProxyBody;
  try {
    body = JSON.parse(event.body ?? "{}") as ProxyBody;
  } catch {
    return error("Invalid JSON body", 400);
  }
  if (!body.agentId) return error("agentId is required", 400);

  // Agent must exist AND belong to the caller's tenant (guards cross-tenant
  // tool access). 404 like record-turn's cross-tenant thread guard.
  const [agent] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.id, body.agentId), eq(agents.tenant_id, tenantId)))
    .limit(1);
  if (!agent) return notFound("Agent not found");

  // Resolve the agent's MCP servers, with per-user OAuth scoped to the CALLER.
  let configs: McpServerConfig[];
  try {
    configs = await buildMcpConfigs(body.agentId, userRow.id, LOG_PREFIX);
  } catch (err) {
    console.error(`${LOG_PREFIX} buildMcpConfigs failed:`, err);
    return error("Failed to resolve MCP servers", 502);
  }

  if (isList) {
    return handleList(configs, { tenantId, userId: userRow.id });
  }
  return handleCall(configs, body, { tenantId, userId: userRow.id });
}

async function handleList(
  configs: McpServerConfig[],
  ctx: { tenantId: string; userId: string },
): Promise<APIGatewayProxyStructuredResultV2> {
  const tools: Array<{
    name: string;
    description?: string;
    inputSchema?: unknown;
  }> = [];

  for (const config of configs) {
    let defs: McpToolDefinition[];
    try {
      defs = await mcpListTools(targetFor(config));
    } catch (err) {
      // One bad server shouldn't sink the whole list — log + skip, matching
      // buildMcpConfigs' "skip a broken server" posture.
      console.warn(
        `${LOG_PREFIX} tools/list failed for ${config.name}:`,
        err instanceof Error ? err.message : err,
      );
      continue;
    }
    // Honor the per-server tool allowlist (config.tools) if present.
    const allow = config.tools?.length ? new Set(config.tools) : null;
    for (const def of defs) {
      if (!def.name) continue;
      if (allow && !allow.has(def.name)) continue;
      tools.push({
        name: qualifyToolName(config.name, def.name),
        description: def.description,
        inputSchema: def.inputSchema,
      });
    }
  }

  console.info(
    LOG_PREFIX,
    JSON.stringify({
      op: "tools/list",
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      servers: configs.length,
      tools: tools.length,
    }),
  );

  return json({ tools });
}

async function handleCall(
  configs: McpServerConfig[],
  body: ProxyBody,
  ctx: { tenantId: string; userId: string },
): Promise<APIGatewayProxyStructuredResultV2> {
  if (!body.name) return error("name is required", 400);
  const args = body.arguments ?? {};

  // Resolve which server owns this tool. Prefer the server-qualified name the
  // list endpoint emits; fall back to a bare tool name resolved against the
  // single configured server (or the first that has it).
  const split = splitQualifiedToolName(body.name);
  let config: McpServerConfig | undefined;
  let toolName: string;
  if (split) {
    config = configs.find((c) => c.name === split.serverName);
    toolName = split.toolName;
  } else {
    toolName = body.name;
    config =
      configs.length === 1
        ? configs[0]
        : configs.find((c) => !c.tools || c.tools.includes(toolName));
  }

  if (!config) {
    return notFound(`No MCP server resolves tool "${body.name}"`);
  }

  // Defense in depth: respect the per-server allowlist.
  if (config.tools?.length && !config.tools.includes(toolName)) {
    return notFound(`Tool "${toolName}" is not exposed by ${config.name}`);
  }

  try {
    const result = await mcpCallTool(targetFor(config), toolName, args);
    console.info(
      LOG_PREFIX,
      JSON.stringify({
        op: "tools/call",
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        server: config.name,
        tool: toolName,
        isError: result.isError,
      }),
    );
    // An MCP isError result is a recoverable tool failure, not a server fault —
    // forward it as 200 so the on-device loop can react.
    return json({ content: result.content, isError: result.isError });
  } catch (err) {
    if (err instanceof McpTransportError) {
      console.warn(`${LOG_PREFIX} tools/call transport failure:`, err.message);
      return error(`MCP upstream failure: ${err.message}`, 502);
    }
    console.error(`${LOG_PREFIX} tools/call unexpected error:`, err);
    return error("MCP upstream failure", 502);
  }
}
