/**
 * Digital Twin MCP server (THINK-333 U3) — the single tool surface for
 * cross-system twin queries, mounted by ThinkWork agents (connector grant)
 * and external MCP clients (Claude Desktop etc.) over streamable HTTP at
 * `/mcp/twin`.
 *
 * Auth resolves the tenant SERVER-SIDE, always:
 *  - `tkt_` bearer (agent path): SHA-256 hash lookup in
 *    tenant_mcp_twin_keys where revoked_at IS NULL — the matched row IS
 *    the tenant selection (mirrors packages/lambda/admin-ops-mcp.ts).
 *  - Anything else: MCP OAuth access token (external path) —
 *    `verifyMcpAccessToken` → user claims → tenant, `twin:read` scope.
 * The request body never carries a tenant id.
 *
 * Read-only is structural (R14): no write tool exists here, and the
 * guarded `cypher` twin-query kind rejects mutations independently.
 */
import { createHash } from "node:crypto";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { and, eq, isNull } from "drizzle-orm";
import { tenantMcpTwinKeys } from "@thinkwork/database-pg/schema";
import { verifyMcpAccessToken } from "./mcp-oauth.js";
import { handleCors, json } from "../lib/response.js";
import { executeTwinQuery } from "../lib/twin/client.js";
import { describeTwinOntology } from "../lib/twin/describe-ontology.js";
import { db } from "../lib/db.js";

export const TWIN_KEY_PREFIX = "tkt_";

const TOOLS = [
  {
    name: "twin_describe_ontology",
    description:
      "Describe this company's digital-twin ontology: entity types, facet " +
      "properties, relationship types, and the query addressing contract. " +
      "Read this FIRST — it is the schema you write twin_cypher queries " +
      "against.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "twin_cypher",
    description:
      "Run a read-only openCypher query against the company digital twin " +
      "(cross-system entity graph). The server scopes every query to your " +
      "tenant and clamps rows (default LIMIT 100, max 500). Rejected " +
      "queries return the rule that fired so you can revise. Use " +
      "twin_describe_ontology for labels/properties first.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "openCypher read query (MATCH ... RETURN ...).",
        },
        parameters: {
          type: "object",
          description:
            "Optional query parameters referenced as $name in the query.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "twin_entity",
    description:
      "Fetch one twin entity by canonical id: its facet values with " +
      "per-facet freshness, outgoing edges, and source-system identities. " +
      "Convenience over the same guarded query path.",
    inputSchema: {
      type: "object",
      properties: {
        canonical_id: {
          type: "string",
          description:
            "The entity's canonical id (from a previous query's `~id`, " +
            "without the tenant prefix, or as returned by twin tools).",
        },
      },
      required: ["canonical_id"],
      additionalProperties: false,
    },
  },
] as const;

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const preflight = handleCors(event);
  if (preflight) return preflight;

  const metadataUrl = `${issuerUrl(event)}/.well-known/oauth-protected-resource/mcp/twin`;
  const bearer = bearerToken(event);
  if (!bearer) return unauthorized(metadataUrl);

  const auth = await authenticate(bearer, event);
  if (!auth) return unauthorized(metadataUrl);

  if (event.requestContext.http.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const request = parseJsonRpc(event);
  if (!request) {
    return json(
      {
        jsonrpc: "2.0",
        error: { code: -32700, message: "Parse error" },
        id: null,
      },
      400,
    );
  }

  if (!("id" in request)) {
    return {
      statusCode: 202,
      headers: { "Content-Type": "application/json" },
      body: "",
    };
  }

  switch (request.method) {
    case "initialize":
      return json({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          protocolVersion: request.params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "thinkwork-digital-twin", version: "0.1.0" },
        },
      });
    case "tools/list":
      return json({
        jsonrpc: "2.0",
        id: request.id,
        result: { tools: TOOLS },
      });
    case "tools/call":
      return await handleToolCall(request, auth);
    default:
      return json({
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32601, message: `Method not found: ${request.method}` },
      });
  }
}

interface TwinAuth {
  tenantId: string;
  via: "twin_key" | "oauth";
}

async function authenticate(
  bearer: string,
  event: APIGatewayProxyEventV2,
): Promise<TwinAuth | null> {
  if (bearer.startsWith(TWIN_KEY_PREFIX)) {
    return authenticateTwinKey(bearer);
  }
  try {
    const claims = await verifyMcpAccessToken(
      bearer,
      `${issuerUrl(event)}/mcp/twin`,
      issuerUrl(event),
    );
    if (!hasScope(claims, "twin:read")) {
      console.warn("[mcp-twin] token missing twin:read scope");
      return null;
    }
    const tenantId = await resolveTenantFromClaims(claims);
    return tenantId ? { tenantId, via: "oauth" } : null;
  } catch (err) {
    console.warn("[mcp-twin] bearer verification failed", {
      reason: err instanceof Error ? err.message : "unknown",
    });
    return null;
  }
}

/**
 * `tkt_` key → tenant, via hash lookup (never a value compare against a
 * stored secret). The row is the tenant selection.
 */
async function authenticateTwinKey(bearer: string): Promise<TwinAuth | null> {
  const hash = createHash("sha256").update(bearer).digest("hex");
  try {
    const [row] = await db
      .select({
        id: tenantMcpTwinKeys.id,
        tenant_id: tenantMcpTwinKeys.tenant_id,
      })
      .from(tenantMcpTwinKeys)
      .where(
        and(
          eq(tenantMcpTwinKeys.key_hash, hash),
          isNull(tenantMcpTwinKeys.revoked_at),
        ),
      )
      .limit(1);
    if (!row) return null;
    // Best-effort last_used_at bump — never blocks auth.
    db.update(tenantMcpTwinKeys)
      .set({ last_used_at: new Date() })
      .where(eq(tenantMcpTwinKeys.id, row.id))
      .catch((err: unknown) => {
        console.warn("[mcp-twin] last_used_at bump failed", err);
      });
    return { tenantId: row.tenant_id, via: "twin_key" };
  } catch (err) {
    console.error("[mcp-twin] twin key lookup failed", err);
    return null;
  }
}

async function resolveTenantFromClaims(
  claims: Record<string, unknown>,
): Promise<string | null> {
  const claimedTenantId =
    stringClaim(claims.tenant_id) ?? stringClaim(claims["custom:tenant_id"]);
  if (claimedTenantId) return claimedTenantId;
  const sub = stringClaim(claims.sub);
  if (!sub) return null;
  const { resolveCallerFromAuth } = await import(
    "../graphql/resolvers/core/resolve-auth-user.js"
  );
  const resolved = await resolveCallerFromAuth({
    authType: "cognito",
    principalId: sub,
    email: stringClaim(claims.email) ?? null,
    emailVerified:
      claims.email_verified === true ||
      stringClaim(claims.email_verified) === "true",
    tenantId: null,
    agentId: null,
  });
  return resolved.tenantId ?? null;
}

async function handleToolCall(
  request: JsonRpcRequest,
  auth: TwinAuth,
): Promise<APIGatewayProxyStructuredResultV2> {
  const params = request.params as ToolCallParams | undefined;
  const toolName = typeof params?.name === "string" ? params.name : "";
  const args = isRecord(params?.arguments) ? params.arguments : {};

  switch (toolName) {
    case "twin_describe_ontology": {
      try {
        const description = await describeTwinOntology({
          tenantId: auth.tenantId,
        });
        return jsonRpcResult(request.id, {
          content: [{ type: "text", text: description }],
        });
      } catch (err) {
        console.error("[mcp-twin] describe failed", err);
        return jsonRpcResult(request.id, {
          content: [{ type: "text", text: TWIN_UNAVAILABLE_TEXT }],
          isError: true,
        });
      }
    }
    case "twin_cypher": {
      const query = stringArg(args.query);
      if (!query) return jsonRpcError(request.id, -32602, "query is required");
      const parameters = isRecord(args.parameters) ? args.parameters : undefined;
      const result = await executeTwinQuery({
        tenantId: auth.tenantId,
        request: { kind: "cypher", query, ...(parameters ? { parameters } : {}) },
      });
      if (!result.ok) {
        if (result.reason === "rejected") {
          // Guard rejection is a TOOL RESULT the model reads and revises
          // from — not a protocol error.
          return jsonRpcResult(request.id, {
            content: [
              {
                type: "text",
                text: `Query rejected (${result.rule}): ${result.message}`,
              },
            ],
            structuredContent: { ok: false, rule: result.rule },
            isError: true,
          });
        }
        return jsonRpcResult(request.id, {
          content: [{ type: "text", text: TWIN_UNAVAILABLE_TEXT }],
          isError: true,
        });
      }
      const rows = result.results;
      const limitedNote = result.limited
        ? "\n\n(Row cap reached — results may be incomplete; narrow the query or add pagination via SKIP/LIMIT.)"
        : "";
      return jsonRpcResult(request.id, {
        content: [
          {
            type: "text",
            text:
              rows.length === 0
                ? "No rows matched."
                : `${rows.length} row(s):\n${JSON.stringify(rows, null, 2).slice(0, 24_000)}${limitedNote}`,
          },
        ],
        structuredContent: {
          ok: true,
          rowCount: rows.length,
          rows,
          limited: result.limited ?? false,
        },
      });
    }
    case "twin_entity": {
      const canonicalId = stringArg(args.canonical_id);
      if (!canonicalId) {
        return jsonRpcError(request.id, -32602, "canonical_id is required");
      }
      const [entity, systemEdges] = await Promise.all([
        executeTwinQuery({
          tenantId: auth.tenantId,
          request: { kind: "entity_get", canonicalId },
        }),
        executeTwinQuery({
          tenantId: auth.tenantId,
          request: { kind: "system_edges", canonicalId },
        }),
      ]);
      if (!entity.ok && entity.reason === "unavailable") {
        return jsonRpcResult(request.id, {
          content: [{ type: "text", text: TWIN_UNAVAILABLE_TEXT }],
          isError: true,
        });
      }
      const entityRows = entity.ok ? entity.results : [];
      const edgeRows = systemEdges.ok ? systemEdges.results : [];
      if (entityRows.length === 0) {
        return jsonRpcResult(request.id, {
          content: [
            { type: "text", text: `No entity found for id "${canonicalId}".` },
          ],
          structuredContent: { ok: true, entity: null, systemIdentities: [] },
        });
      }
      return jsonRpcResult(request.id, {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { entity: entityRows, systemIdentities: edgeRows },
              null,
              2,
            ).slice(0, 24_000),
          },
        ],
        structuredContent: {
          ok: true,
          entity: entityRows,
          systemIdentities: edgeRows,
        },
      });
    }
    default:
      return jsonRpcError(
        request.id,
        -32602,
        toolName ? `Unknown tool: ${toolName}` : "Tool name is required",
      );
  }
}

const TWIN_UNAVAILABLE_TEXT =
  "The digital twin is currently unavailable. Try again later.";

// ── JSON-RPC / HTTP helpers (mirrors mcp-user-memory.ts) ────────────────

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

type ToolCallParams = { name?: unknown; arguments?: unknown };

function parseJsonRpc(event: APIGatewayProxyEventV2): JsonRpcRequest | null {
  if (!event.body) return null;
  try {
    const body = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body;
    const parsed = JSON.parse(body) as JsonRpcRequest;
    if (parsed.jsonrpc !== "2.0" || typeof parsed.method !== "string")
      return null;
    return parsed;
  } catch {
    return null;
  }
}

function jsonRpcResult(
  id: JsonRpcRequest["id"],
  result: Record<string, unknown>,
) {
  return json({ jsonrpc: "2.0", id, result });
}

function jsonRpcError(id: JsonRpcRequest["id"], code: number, message: string) {
  return json({ jsonrpc: "2.0", id, error: { code, message } });
}

function unauthorized(
  resourceMetadataUrl: string,
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadataUrl}"`,
    },
    body: JSON.stringify({ error: "unauthorized" }),
  };
}

function bearerToken(event: APIGatewayProxyEventV2): string | null {
  const header = event.headers.authorization || event.headers.Authorization;
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringClaim(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function hasScope(claims: Record<string, unknown>, scope: string): boolean {
  return stringClaim(claims.scope)?.split(/\s+/).includes(scope) ?? false;
}

function stringArg(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function issuerUrl(event: APIGatewayProxyEventV2): string {
  const proto = event.headers["x-forwarded-proto"] || "https";
  const host = event.headers.host || event.requestContext.domainName;
  return `${proto}://${host}`;
}
