/**
 * mcp-capability-search — the scoped external MCP `search` facade over the
 * governed capability runtime (THINK-280 U8).
 *
 * `/mcp/capabilities` is a streamable-HTTP MCP resource that exposes EXACTLY
 * ONE read-only tool: `search`. It resolves the admitted operation projection
 * for the token subject's tenant and returns ONLY:
 *   - permitted descriptor fields (namespace/class/slug/version/summary),
 *   - the exact compatibility identity (twcap + signed contract hash),
 *   - safe effect/principal/data/budget annotations,
 *   - a REDACTED readiness/remediation summary for the token's own principal.
 *
 * It NEVER exposes: credential references, private provenance payloads, other
 * principals' grants, broker/session APIs, proposal mutation, admission, or any
 * execute-shaped tool. There is no tool by those names to call (AE9): the only
 * method is `search`, and every read is scoped to the mapped tenant + principal
 * so a tenant-A token can never observe tenant-B state.
 *
 * Identity mapping (fail closed):
 *   - an M2M `client_credentials` token maps to exactly one ACTIVE external
 *     client → one ACTIVE service principal (service mode);
 *   - a user auth-code token maps to exactly one ACTIVE tenant user (requester
 *     mode);
 *   - a revoked/unmapped subject, wrong resource audience, missing
 *     `capabilities:search` scope, expired token, or ambiguous mapping all
 *     resolve to no data.
 *
 * The facade is INERT unless `CAPABILITY_EXTERNAL_SEARCH_ENABLED` is truthy
 * (external search is the last rollout gate).
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { getConfig } from "@thinkwork/runtime-config";
import { getDb } from "@thinkwork/database-pg";
import {
  capabilityCredentialBindings,
  capabilityDefinitions,
  capabilityDefinitionVersions,
  capabilityExternalClients,
  tenantServicePrincipals,
  users,
} from "@thinkwork/database-pg/schema";
import { and, eq } from "drizzle-orm";
import { verifyMcpAccessToken } from "./mcp-oauth.js";
import { handleCors, json } from "../lib/response.js";
import {
  projectOperationIdentities,
  type CanonicalOperationIdentity,
} from "../lib/capabilities/operation-identity.js";

const SEARCH_SCOPE = "capabilities:search";
const MAX_RESULTS = 50;

/** The ONLY tool. No execute/session/admission/proposal/credential tool exists. */
const TOOLS = [
  {
    name: "search",
    description:
      "Search admitted Thinkwork capability operations available to the " +
      "authenticated tenant. Read-only: returns operation identity, safe " +
      "annotations, and a redacted readiness summary. Cannot invoke, bind, " +
      "propose, or admit anything.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Free-text match over namespace/class/slug/operation id/summary.",
        },
        effect: {
          type: "string",
          enum: ["none", "read", "create", "update", "delete", "execute"],
          description: "Optional exact effect filter.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_RESULTS,
          description: "Maximum operations to return.",
        },
      },
      additionalProperties: false,
    },
  },
] as const;

// ---------------------------------------------------------------------------
// Principal mapping
// ---------------------------------------------------------------------------

type MappedPrincipal =
  | {
      kind: "service";
      tenantId: string;
      servicePrincipalId: string;
      principalMode: "service";
    }
  | {
      kind: "user";
      tenantId: string;
      userId: string;
      principalMode: "requester";
    };

/**
 * Resolve the token subject to exactly one active tenant user OR active
 * service principal. Ambiguous, revoked, or unmapped subjects return null
 * (fail closed) — the caller then sees an empty, tenant-scoped projection.
 */
async function mapPrincipal(
  db: ReturnType<typeof getDb>,
  claims: Record<string, unknown>,
): Promise<MappedPrincipal | null> {
  const tenantId =
    stringClaim(claims.tenant_id) ?? stringClaim(claims["custom:tenant_id"]);
  if (!tenantId) return null;

  const servicePrincipalId = stringClaim(claims.service_principal_id);
  const clientId = stringClaim(claims.client_id);
  if (servicePrincipalId) {
    // M2M: the confidential client AND its service principal must both be
    // active, tenant-matched, and mapped one-to-one to this subject.
    if (!clientId) return null;
    const [client] = (await db
      .select()
      .from(capabilityExternalClients)
      .where(eq(capabilityExternalClients.client_id, clientId))
      .limit(1)) as Array<typeof capabilityExternalClients.$inferSelect>;
    if (
      !client ||
      client.status !== "active" ||
      client.tenant_id !== tenantId ||
      client.service_principal_id !== servicePrincipalId
    ) {
      return null;
    }
    const [principal] = (await db
      .select()
      .from(tenantServicePrincipals)
      .where(eq(tenantServicePrincipals.id, servicePrincipalId))
      .limit(1)) as Array<typeof tenantServicePrincipals.$inferSelect>;
    if (
      !principal ||
      principal.status !== "active" ||
      principal.tenant_id !== tenantId
    ) {
      return null;
    }
    return {
      kind: "service",
      tenantId,
      servicePrincipalId,
      principalMode: "service",
    };
  }

  // User token: the subject must be an active user of the claimed tenant.
  const userId =
    stringClaim(claims.user_id) ?? stringClaim(claims["custom:user_id"]);
  if (!userId) return null;
  const [user] = (await db
    .select({ id: users.id, tenant_id: users.tenant_id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)) as Array<{ id: string; tenant_id: string | null }>;
  if (!user || user.tenant_id !== tenantId) return null;
  return { kind: "user", tenantId, userId, principalMode: "requester" };
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

interface ExternalOperationResult {
  twcap: string;
  contractHash: string;
  namespace: string;
  class: string;
  slug: string;
  version: number;
  operationId: string;
  summary: string;
  effect: string;
  principalModes: string[];
  approvalPolicy: string;
  reversibility: string;
  idempotency: string;
  inputDataClass: string;
  outputDataClass: string;
  costClass: string;
  latencyClass: string;
  outputClass: string;
  executable: boolean;
  withheldReasons: string[];
  /** ready | not_ready — redacted readiness for THIS principal only. */
  readiness: "ready" | "not_ready";
  /** Safe, principal-agnostic remediation hint (never credential detail). */
  remediation: string | null;
}

function toResult(
  op: CanonicalOperationIdentity,
  readiness: "ready" | "not_ready",
  remediation: string | null,
): ExternalOperationResult {
  return {
    twcap: op.twcap,
    contractHash: op.contractHash,
    namespace: op.namespace,
    class: op.class,
    slug: op.slug,
    version: op.version,
    operationId: op.operationId,
    summary: op.summary,
    effect: op.effect,
    principalModes: op.principalModes,
    approvalPolicy: op.approvalPolicy,
    reversibility: op.reversibility,
    idempotency: op.idempotency,
    inputDataClass: op.inputDataClass,
    outputDataClass: op.outputDataClass,
    costClass: op.costClass,
    latencyClass: op.latencyClass,
    outputClass: op.outputClass,
    executable: op.executable,
    withheldReasons: op.withheldReasons,
    readiness,
    remediation,
  };
}

async function runSearch(
  db: ReturnType<typeof getDb>,
  principal: MappedPrincipal,
  args: { query?: string; effect?: string; limit?: number },
): Promise<ExternalOperationResult[]> {
  // Working search returns the tenant's OWN admitted definitions only —
  // platform (tenant_id NULL) references and other tenants are never visible.
  const definitionRows = (await db
    .select()
    .from(capabilityDefinitions)
    .where(eq(capabilityDefinitions.tenant_id, principal.tenantId))) as Array<
    typeof capabilityDefinitions.$inferSelect
  >;
  const activeDefs = definitionRows.filter(
    (row) => row.tenant_id === principal.tenantId && row.status === "active",
  );
  if (activeDefs.length === 0) return [];

  const results: ExternalOperationResult[] = [];
  const q = (args.query ?? "").trim().toLowerCase();
  const effectFilter = args.effect;

  for (const def of activeDefs) {
    const versionRows = (await db
      .select()
      .from(capabilityDefinitionVersions)
      .where(eq(capabilityDefinitionVersions.definition_id, def.id))) as Array<
      typeof capabilityDefinitionVersions.$inferSelect
    >;
    const admitted = versionRows
      .filter((row) => row.lifecycle === "admitted")
      .sort((a, b) => a.version - b.version)
      // AE3: external/internal working search returns the pinned admitted
      // version — a newer candidate stays operator-only until granted.
      .at(-1);
    if (!admitted) continue;

    const identities = projectOperationIdentities(
      { namespace: def.namespace, class: def.class, slug: def.slug },
      admitted,
    );
    if (identities.length === 0) continue;

    // Readiness for THIS principal only — never enumerate other principals'
    // grants. Service tokens read the service binding for their own SP; user
    // tokens read requester bindings (unpinned or pinned to them).
    const bindingRows = (await db
      .select()
      .from(capabilityCredentialBindings)
      .where(
        and(
          eq(capabilityCredentialBindings.tenant_id, principal.tenantId),
          eq(capabilityCredentialBindings.definition_version_id, admitted.id),
        ),
      )) as Array<typeof capabilityCredentialBindings.$inferSelect>;
    const readyForPrincipal = bindingRows.some((row) => {
      if (row.readiness !== "ready") return false;
      if (principal.kind === "service") {
        return (
          row.principal_mode === "service" &&
          row.service_principal_id === principal.servicePrincipalId
        );
      }
      return (
        row.principal_mode === "requester" &&
        (row.subject_user_id === null ||
          row.subject_user_id === principal.userId)
      );
    });

    for (const op of identities) {
      if (effectFilter && op.effect !== effectFilter) continue;
      if (q) {
        const haystack =
          `${op.namespace} ${op.class} ${op.slug} ${op.operationId} ${op.summary}`.toLowerCase();
        if (!haystack.includes(q)) continue;
      }
      const principalAccepts = op.principalModes.includes(
        principal.principalMode,
      );
      const readiness: "ready" | "not_ready" =
        readyForPrincipal && principalAccepts ? "ready" : "not_ready";
      const remediation = !principalAccepts
        ? `operation does not accept the ${principal.principalMode} principal mode`
        : readyForPrincipal
          ? null
          : "no ready binding for this principal — operator must complete setup";
      results.push(toResult(op, readiness, remediation));
    }
  }

  results.sort((a, b) => a.twcap.localeCompare(b.twcap));
  const limit = Math.min(args.limit ?? MAX_RESULTS, MAX_RESULTS);
  return results.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const preflight = handleCors(event);
  if (preflight) return preflight;

  const resource = resourceUrl(event);
  const metadataUrl = `${issuerUrl(event)}/.well-known/oauth-protected-resource/mcp/capabilities`;
  const bearer = bearerToken(event);
  if (!bearer) return unauthorized(metadataUrl);

  let claims: Record<string, unknown>;
  try {
    claims = await verifyMcpAccessToken(bearer, resource, issuerUrl(event));
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown";
    console.warn("[mcp-capability-search] bearer verification failed", {
      reason,
    });
    return unauthorized(metadataUrl);
  }

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
          serverInfo: { name: "thinkwork-capability-search", version: "0.1.0" },
        },
      });
    case "tools/list":
      return json({ jsonrpc: "2.0", id: request.id, result: { tools: TOOLS } });
    case "tools/call":
      return await handleToolCall(request, claims);
    default:
      return json({
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32601, message: `Method not found: ${request.method}` },
      });
  }
}

async function handleToolCall(
  request: JsonRpcRequest,
  claims: Record<string, unknown>,
): Promise<APIGatewayProxyStructuredResultV2> {
  const params = request.params as ToolCallParams | undefined;
  const toolName = typeof params?.name === "string" ? params.name : "";

  // AE9: the only tool is `search`. execute/session/admit/propose/bind/
  // credential names are unknown here — no such tool exists.
  if (toolName !== "search") {
    return jsonRpcError(
      request.id,
      -32601,
      `Unknown tool: ${toolName || "<missing>"}`,
    );
  }
  if (!hasScope(claims, SEARCH_SCOPE)) {
    return jsonRpcError(
      request.id,
      -32001,
      `${SEARCH_SCOPE} scope is required`,
    );
  }
  if (!isExternalSearchEnabled()) {
    // Inert until the final rollout gate flips. Fail closed with no data.
    return jsonRpcResult(request.id, {
      content: [
        { type: "text", text: "External capability search is not enabled." },
      ],
      structuredContent: { operations: [], disabled: true },
    });
  }

  const db = getDb();
  const principal = await mapPrincipal(db, claims);
  if (!principal) {
    // Unmapped/revoked/ambiguous subject — fail closed with an empty result,
    // never a cross-tenant leak or a distinguishing error.
    return jsonRpcResult(request.id, {
      content: [{ type: "text", text: "No capabilities available." }],
      structuredContent: { operations: [] },
    });
  }

  const args = isRecord(params?.arguments) ? params.arguments : {};
  const results = await runSearch(db, principal, {
    query: stringArg(args.query) ?? undefined,
    effect: stringArg(args.effect) ?? undefined,
    limit: limitArg(args.limit),
  });

  return jsonRpcResult(request.id, {
    content: [{ type: "text", text: formatResults(results) }],
    structuredContent: { operations: results },
  });
}

function formatResults(results: ExternalOperationResult[]): string {
  if (results.length === 0) return "No matching capability operations found.";
  return results
    .map(
      (r, i) =>
        `${i + 1}. ${r.namespace}/${r.class}/${r.slug} ${r.operationId} — ${r.effect} (${r.readiness})`,
    )
    .join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isExternalSearchEnabled(): boolean {
  const value = (
    getConfig("CAPABILITY_EXTERNAL_SEARCH_ENABLED") || ""
  ).toLowerCase();
  return value === "true" || value === "1" || value === "yes";
}

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
function limitArg(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) return undefined;
  return Math.min(numeric, MAX_RESULTS);
}
function resourceUrl(event: APIGatewayProxyEventV2): string {
  return `${issuerUrl(event)}/mcp/capabilities`;
}
function issuerUrl(event: APIGatewayProxyEventV2): string {
  const proto = event.headers["x-forwarded-proto"] || "https";
  const host = event.headers.host || event.requestContext.domainName;
  return `${proto}://${host}`;
}
