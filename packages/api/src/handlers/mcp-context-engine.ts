import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { handleCors, json } from "../lib/response.js";
import { getContextEngineService } from "../lib/context-engine/service.js";
import type {
  ContextEngineDepth,
  ContextEngineMode,
  ContextEngineCaller,
  ContextProviderOptions,
  ContextEngineScope,
  ContextProviderFamily,
  ContextProviderSelection,
} from "../lib/context-engine/types.js";
import { upsertTenantContextProviderSetting } from "../lib/context-engine/admin-config.js";
import { sourceFamilyForProvider } from "../lib/context-engine/source-families.js";
import { resolveAgentRuntimeConfig } from "../lib/resolve-agent-runtime-config.js";
import { verifyMcpAccessToken } from "./mcp-oauth.js";

const MAX_LIMIT = 50;

const TOOLS = [
  {
    name: "query_context",
    description:
      "Search permissioned Thinkwork context across fast default providers: ontology Brain facets, wiki pages, workspace files, Bedrock Knowledge Bases, and approved context-safe MCP tools. Use query_memory_context for Hindsight Memory synthesis.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        mode: { type: "string", enum: ["results", "answer"] },
        scope: { type: "string", enum: ["personal", "team", "auto"] },
        depth: { type: "string", enum: ["quick", "deep"] },
        limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
        agentId: {
          type: "string",
          description:
            "Optional Thinkwork agent id whose workspace files should be searched.",
        },
        providers: {
          type: "object",
          properties: {
            ids: { type: "array", items: { type: "string" } },
            families: {
              type: "array",
              items: {
                type: "string",
                enum: [
                  "memory",
                  "brain",
                  "wiki",
                  "workspace",
                  "knowledge-base",
                  "mcp",
                  "sub-agent",
                ],
              },
            },
          },
          additionalProperties: false,
        },
        providerOptions: {
          type: "object",
          properties: {
            memory: {
              type: "object",
              properties: {
                queryMode: { type: "string", enum: ["recall", "reflect"] },
                includeLegacyBanks: { type: "boolean" },
              },
              additionalProperties: false,
            },
          },
          additionalProperties: false,
        },
        contextClass: { type: "string" },
        computerId: { type: "string" },
        sourceSurface: { type: "string" },
        credentialSubject: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["user", "service"] },
            userId: { type: "string" },
            connectionId: { type: "string" },
            provider: { type: "string" },
          },
          required: ["type"],
          additionalProperties: false,
        },
        event: {
          type: "object",
          properties: {
            provider: { type: "string" },
            eventType: { type: "string" },
            eventId: { type: "string" },
            metadata: { type: "object" },
          },
          additionalProperties: false,
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "query_memory_context",
    description:
      "Search only Thinkwork Hindsight Memory. The memory provider may use Hindsight reflect for synthesized agent context, which is slower than wiki/context search but produces a grounded answer-style memory summary.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        mode: { type: "string", enum: ["results", "answer"] },
        scope: { type: "string", enum: ["personal", "auto"] },
        depth: { type: "string", enum: ["quick", "deep"] },
        limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
        agentId: {
          type: "string",
          description:
            "Optional Thinkwork agent id whose workspace files should be searched.",
        },
        providerOptions: {
          type: "object",
          properties: {
            memory: {
              type: "object",
              properties: {
                queryMode: { type: "string", enum: ["recall", "reflect"] },
                includeLegacyBanks: { type: "boolean" },
              },
              additionalProperties: false,
            },
          },
          additionalProperties: false,
        },
        contextClass: { type: "string" },
        computerId: { type: "string" },
        sourceSurface: { type: "string" },
        credentialSubject: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["user", "service"] },
            userId: { type: "string" },
            connectionId: { type: "string" },
            provider: { type: "string" },
          },
          required: ["type"],
          additionalProperties: false,
        },
        event: {
          type: "object",
          properties: {
            provider: { type: "string" },
            eventType: { type: "string" },
            eventId: { type: "string" },
            metadata: { type: "object" },
          },
          additionalProperties: false,
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "query_brain_context",
    description:
      "Search only tenant-shared ontology-shaped Company Brain pages and facets. Use this for business/domain context such as customers, opportunities, commitments, risks, relationships, and cited provenance.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        mode: { type: "string", enum: ["results", "answer"] },
        scope: { type: "string", enum: ["team", "auto"] },
        depth: { type: "string", enum: ["quick", "deep"] },
        limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "query_wiki_context",
    description:
      "Search only owner-scoped compiled wiki pages. Use this for fast personal page/entity/topic lookup without waiting on Hindsight Memory.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        mode: { type: "string", enum: ["results", "answer"] },
        scope: { type: "string", enum: ["personal", "auto"] },
        depth: { type: "string", enum: ["quick", "deep"] },
        limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "list_context_providers",
    description:
      "List Company Brain source families available through ThinkWork Brain.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "get_agent_context_policy",
    description:
      "Admin-only read model explaining the effective Company Brain policy for one Thinkwork agent.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string" },
      },
      required: ["agentId"],
      additionalProperties: false,
    },
  },
  {
    name: "update_context_provider_setting",
    description:
      "Admin-only update for tenant built-in Company Brain source eligibility, defaults, and provider-specific config.",
    inputSchema: {
      type: "object",
      properties: {
        providerId: { type: "string" },
        enabled: { type: "boolean" },
        defaultEnabled: { type: "boolean" },
        config: { type: "object" },
      },
      required: ["providerId", "enabled", "defaultEnabled"],
      additionalProperties: false,
    },
  },
] as const;

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const preflight = handleCors(event);
  if (preflight) return preflight;

  const metadataUrl = `${issuerUrl(event)}/.well-known/oauth-protected-resource/mcp/context-engine`;
  const bearer = bearerToken(event);
  if (!bearer) return unauthorized(metadataUrl);

  let claims: Record<string, unknown>;
  if (isServiceBearer(bearer)) {
    claims = {
      "tw:auth_kind": "service",
      scope: "context:read",
      "custom:tenant_id": event.headers["x-tenant-id"],
      "custom:user_id":
        event.headers["x-user-id"] || event.headers["x-principal-id"],
      "custom:agent_id": event.headers["x-agent-id"],
    };
  } else {
    try {
      claims = await verifyMcpAccessToken(
        bearer,
        resourceUrl(event),
        issuerUrl(event),
      );
      claims["tw:auth_kind"] = "oauth";
    } catch (err) {
      const auth = await tryFirstPartyAuth(event);
      if (!auth) {
        console.warn("[mcp-context-engine] bearer verification failed", {
          reason: err instanceof Error ? err.message : String(err),
        });
        return unauthorized(metadataUrl);
      }
      claims = {
        "tw:auth_kind": "first-party",
        scope: "context:read",
        sub: auth.principalId,
        email: auth.email,
        tenant_id: auth.tenantId,
        "custom:agent_id": auth.agentId,
      };
    }
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
      return jsonRpcResult(request.id, {
        protocolVersion: request.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "thinkwork-brain", version: "0.1.0" },
      });
    case "tools/list":
      return jsonRpcResult(request.id, { tools: TOOLS });
    case "tools/call":
      return await handleToolCall(request, claims);
    default:
      return jsonRpcError(
        request.id,
        -32601,
        `Method not found: ${request.method}`,
      );
  }
}

async function handleToolCall(
  request: JsonRpcRequest,
  claims: Record<string, unknown>,
): Promise<APIGatewayProxyStructuredResultV2> {
  const params = request.params as ToolCallParams | undefined;
  const toolName = typeof params?.name === "string" ? params.name : "";
  const args = isRecord(params?.arguments) ? params.arguments : {};

  if (!toolName)
    return jsonRpcError(request.id, -32602, "Tool name is required");
  if (!hasScope(claims, "context:read") && !hasScope(claims, "memory:read")) {
    return jsonRpcError(request.id, -32001, "context:read scope is required");
  }

  const caller = await resolveCaller(claims);
  if (!caller) {
    return jsonRpcError(
      request.id,
      -32002,
      "Could not resolve authenticated Thinkwork user",
    );
  }

  const service = getContextEngineService();
  const requesterContext = requesterContextArg(caller, args);
  if (requesterContext.error) {
    return jsonRpcError(request.id, -32602, requesterContext.error);
  }
  const callerWithTarget = {
    ...callerWithTargetArgs(caller, args),
    ...(requesterContext.value
      ? { requesterContext: requesterContext.value }
      : {}),
  };
  switch (toolName) {
    case "query_context": {
      return await queryContextTool(
        request.id,
        args,
        callerWithTarget,
        providersArg(args.providers),
        providerOptionsArg(args.providerOptions),
      );
    }
    case "query_memory_context": {
      return await queryContextTool(
        request.id,
        args,
        callerWithTarget,
        {
          families: ["memory"],
        },
        providerOptionsArg(args.providerOptions),
      );
    }
    case "query_brain_context": {
      return await queryContextTool(request.id, args, callerWithTarget, {
        families: ["brain"],
      });
    }
    case "query_wiki_context": {
      return await queryContextTool(request.id, args, callerWithTarget, {
        families: ["wiki"],
      });
    }
    case "list_context_providers": {
      const providers = await service.listProviders({ caller });
      return jsonRpcResult(request.id, {
        content: [
          {
            type: "text",
            text: providers
              .map((provider) => `${provider.id} (${provider.family})`)
              .join("\n"),
          },
        ],
        structuredContent: {
          providers: providers.map((provider) => ({
            id: provider.id,
            family: provider.family,
            sourceFamily: sourceFamilyForProvider(provider),
            displayName: provider.displayName,
            enabled: provider.enabled !== false,
            defaultEnabled: provider.defaultEnabled,
            config: provider.config ?? {},
            subAgent: provider.subAgent ?? null,
          })),
        },
      });
    }
    case "get_agent_context_policy": {
      if (!(await canManageProviderSettings(claims, caller.tenantId))) {
        return jsonRpcError(
          request.id,
          -32003,
          "first-party admin authentication is required",
        );
      }
      const agentId = stringArg(args.agentId);
      if (!agentId)
        return jsonRpcError(request.id, -32602, "agentId is required");
      const policy = await buildAgentContextPolicy(caller, agentId);
      return jsonRpcResult(request.id, {
        structuredContent: policy,
        content: [
          {
            type: "text",
            text: policy.enabled
              ? `Company Brain uses ${policy.finalProviders.length} provider(s).`
              : "Company Brain is disabled for this agent.",
          },
        ],
      });
    }
    case "update_context_provider_setting": {
      if (!(await canManageProviderSettings(claims, caller.tenantId))) {
        return jsonRpcError(
          request.id,
          -32003,
          "first-party admin authentication is required",
        );
      }
      const providerId = stringArg(args.providerId);
      if (!providerId) {
        return jsonRpcError(request.id, -32602, "providerId is required");
      }
      const enabled = booleanArg(args.enabled);
      const defaultEnabled = booleanArg(args.defaultEnabled);
      if (enabled === null || defaultEnabled === null) {
        return jsonRpcError(
          request.id,
          -32602,
          "enabled and defaultEnabled booleans are required",
        );
      }
      try {
        const setting = await upsertTenantContextProviderSetting({
          tenantId: caller.tenantId,
          providerId,
          enabled,
          defaultEnabled,
          config: isRecord(args.config) ? args.config : {},
        });
        return jsonRpcResult(request.id, {
          structuredContent: {
            setting: {
              id: setting.providerId,
              family: setting.family,
              enabled: setting.enabled,
              defaultEnabled: setting.defaultEnabled,
              config: setting.config,
              lastTestedAt: setting.lastTestedAt,
              lastTestState: setting.lastTestState,
              lastTestLatencyMs: setting.lastTestLatencyMs,
              lastTestError: setting.lastTestError,
            },
          },
          content: [
            {
              type: "text",
              text: `${providerId} saved`,
            },
          ],
        });
      } catch (err) {
        return jsonRpcError(
          request.id,
          -32602,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
    default:
      return jsonRpcError(request.id, -32601, `Unknown tool: ${toolName}`);
  }
}

async function buildAgentContextPolicy(
  caller: NonNullable<Awaited<ReturnType<typeof resolveCaller>>>,
  agentId: string,
) {
  const runtime = await resolveAgentRuntimeConfig({
    tenantId: caller.tenantId,
    agentId,
    currentUserId: caller.userId ?? undefined,
    logPrefix: "[mcp-context-engine]",
  });
  const service = getContextEngineService();
  const providers = await service.listProviders({
    caller: { ...caller, agentId },
  });
  const summaries = providers.map(providerSummary);
  const byId = new Map(summaries.map((provider) => [provider.id, provider]));
  const tenantDefaults = summaries.filter(
    (provider) => provider.enabled !== false && provider.defaultEnabled,
  );
  const overrideIds = runtime.contextEngineConfig?.providers?.ids;
  const finalProviderIds = runtime.contextEngineEnabled
    ? (overrideIds ?? tenantDefaults.map((provider) => provider.id))
    : [];
  const finalProviders = finalProviderIds
    .map((id) => byId.get(id))
    .filter((provider): provider is ReturnType<typeof providerSummary> =>
      Boolean(provider),
    );

  return {
    agentId,
    enabled: runtime.contextEngineEnabled,
    tenantDefaults,
    templateOverride: {
      mode: overrideIds ? "override" : "inherit",
      providerIds: overrideIds ?? [],
    },
    finalProviders,
    providerOptions: runtime.contextEngineConfig?.providerOptions ?? {},
    agentDrift: [],
  };
}

function providerSummary(provider: {
  id: string;
  family: ContextProviderFamily;
  displayName: string;
  enabled?: boolean;
  defaultEnabled: boolean;
  config?: Record<string, unknown>;
  sourceFamily?: ReturnType<typeof sourceFamilyForProvider>;
  subAgent?: Parameters<typeof sourceFamilyForProvider>[0]["subAgent"];
}) {
  return {
    id: provider.id,
    family: provider.family,
    sourceFamily: sourceFamilyForProvider(provider),
    displayName: provider.displayName,
    enabled: provider.enabled !== false,
    defaultEnabled: provider.defaultEnabled,
    config: provider.config ?? {},
    subAgent: provider.subAgent ?? null,
  };
}

function callerWithTargetArgs<T extends { agentId?: string | null }>(
  caller: T,
  args: Record<string, unknown>,
): T {
  const agentId = stringArg(args.agentId);
  return agentId ? { ...caller, agentId } : caller;
}

function requesterContextArg(
  caller: { userId?: string | null },
  args: Record<string, unknown>,
):
  | {
      value?: NonNullable<ContextEngineCaller["requesterContext"]>;
      error?: undefined;
    }
  | { value?: undefined; error: string } {
  const contextClass = stringArg(args.contextClass);
  const computerId = stringArg(args.computerId);
  const sourceSurface = stringArg(args.sourceSurface);
  const credentialSubject = credentialSubjectArg(args.credentialSubject);
  const event = eventArg(args.event);
  if (credentialSubject.error) return { error: credentialSubject.error };
  if (event.error) return { error: event.error };
  if (
    credentialSubject.value?.type === "user" &&
    credentialSubject.value.userId &&
    caller.userId &&
    credentialSubject.value.userId !== caller.userId
  ) {
    return {
      error: "credentialSubject.userId must match the authenticated requester",
    };
  }
  if (
    !contextClass &&
    !computerId &&
    !sourceSurface &&
    !credentialSubject.value &&
    !event.value
  ) {
    return {};
  }
  return {
    value: {
      contextClass: contextClass ?? undefined,
      computerId: computerId ?? null,
      requesterUserId: caller.userId ?? null,
      sourceSurface: sourceSurface ?? null,
      credentialSubject: credentialSubject.value ?? null,
      event: event.value ?? null,
    },
  };
}

function credentialSubjectArg(value: unknown):
  | {
      value?: {
        type: "user" | "service";
        userId?: string | null;
        connectionId?: string | null;
        provider?: string | null;
      };
      error?: undefined;
    }
  | { value?: undefined; error: string } {
  if (value === undefined) return {};
  if (!isRecord(value)) return { error: "credentialSubject must be an object" };
  const type =
    value.type === "user" || value.type === "service" ? value.type : null;
  if (!type) return { error: "credentialSubject.type is required" };
  return {
    value: {
      type,
      userId: stringArg(value.userId),
      connectionId: stringArg(value.connectionId),
      provider: stringArg(value.provider),
    },
  };
}

function eventArg(value: unknown):
  | {
      value?: {
        provider?: string | null;
        eventType?: string | null;
        eventId?: string | null;
        metadata?: Record<string, unknown> | null;
      };
      error?: undefined;
    }
  | { value?: undefined; error: string } {
  if (value === undefined) return {};
  if (!isRecord(value)) return { error: "event must be an object" };
  return {
    value: {
      provider: stringArg(value.provider),
      eventType: stringArg(value.eventType),
      eventId: stringArg(value.eventId),
      metadata: isRecord(value.metadata) ? value.metadata : null,
    },
  };
}

async function queryContextTool(
  id: JsonRpcRequest["id"],
  args: Record<string, unknown>,
  caller: NonNullable<Awaited<ReturnType<typeof resolveCaller>>>,
  providers: ContextProviderSelection | undefined,
  providerOptions?: ContextProviderOptions,
): Promise<APIGatewayProxyStructuredResultV2> {
  const query = stringArg(args.query);
  if (!query) return jsonRpcError(id, -32602, "query is required");
  const service = getContextEngineService();
  const result = await service.query({
    query,
    mode:
      enumArg<ContextEngineMode>(args.mode, ["results", "answer"]) ?? "results",
    scope:
      enumArg<ContextEngineScope>(args.scope, ["personal", "team", "auto"]) ??
      "auto",
    depth:
      enumArg<ContextEngineDepth>(args.depth, ["quick", "deep"]) ?? "quick",
    limit: limitArg(args.limit),
    providers,
    providerOptions,
    caller,
  });
  return jsonRpcResult(id, {
    content: [{ type: "text", text: formatContextResponse(result) }],
    structuredContent: result,
  });
}

async function resolveCaller(claims: Record<string, unknown>) {
  const claimedUserId =
    stringClaim(claims.user_id) ?? stringClaim(claims["custom:user_id"]);
  const claimedTenantId =
    stringClaim(claims.tenant_id) ?? stringClaim(claims["custom:tenant_id"]);
  if (claimedUserId && claimedTenantId) {
    return {
      tenantId: claimedTenantId,
      userId: claimedUserId,
      agentId: stringClaim(claims["custom:agent_id"]) ?? null,
    };
  }

  const sub = stringClaim(claims.sub);
  if (!sub) return null;
  const { resolveCallerFromAuth } =
    await import("../graphql/resolvers/core/resolve-auth-user.js");
  const resolved = await resolveCallerFromAuth({
    authType: "cognito",
    principalId: sub,
    email: stringClaim(claims.email) ?? null,
    tenantId: claimedTenantId ?? null,
    agentId: null,
  });
  const tenantId = claimedTenantId ?? resolved.tenantId;
  const userId = claimedUserId ?? resolved.userId;
  if (!tenantId || !userId) return null;
  return {
    tenantId,
    userId,
    agentId: stringClaim(claims["custom:agent_id"]) ?? null,
  };
}

function formatContextResponse(result: {
  hits: Array<{ title: string; snippet: string; family: string }>;
  answer?: { text: string };
  providers: Array<{
    displayName: string;
    state: string;
    error?: string;
    reason?: string;
    durationMs?: number;
    hitCount?: number;
  }>;
}): string {
  const lines: string[] = [];
  if (result.answer?.text) {
    lines.push(result.answer.text);
  } else if (result.hits.length === 0) {
    lines.push("No matching context found.");
  } else {
    for (const [index, hit] of result.hits.slice(0, 10).entries()) {
      lines.push(`${index + 1}. [${hit.family}] ${hit.title}: ${hit.snippet}`);
    }
  }
  if (result.providers.length > 0) {
    lines.push("", "Provider status");
    for (const provider of result.providers) {
      const details = [
        typeof provider.hitCount === "number"
          ? `${provider.hitCount} hits`
          : null,
        typeof provider.durationMs === "number"
          ? `${provider.durationMs}ms`
          : null,
        provider.error || provider.reason || null,
      ].filter(Boolean);
      lines.push(
        `- ${provider.displayName}: ${provider.state}${details.length > 0 ? ` (${details.join(", ")})` : ""}`,
      );
    }
  }
  return lines.join("\n");
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

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

type ToolCallParams = {
  name?: unknown;
  arguments?: unknown;
};

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

function isServiceBearer(bearer: string): boolean {
  return [
    process.env.THINKWORK_API_SECRET,
    process.env.API_AUTH_SECRET,
    process.env.GRAPHQL_API_KEY,
  ]
    .filter(Boolean)
    .some((secret) => secret === bearer);
}

async function tryFirstPartyAuth(event: APIGatewayProxyEventV2) {
  const { authenticate } = await import("../lib/cognito-auth.js");
  return await authenticate(event.headers);
}

function hasScope(claims: Record<string, unknown>, scope: string): boolean {
  return stringClaim(claims.scope)?.split(/\s+/).includes(scope) ?? false;
}

function stringClaim(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function stringArg(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function enumArg<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | null {
  return typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : null;
}

function limitArg(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) return undefined;
  return Math.min(numeric, MAX_LIMIT);
}

function providersArg(value: unknown): ContextProviderSelection | undefined {
  if (!isRecord(value)) return undefined;
  return {
    ids: Array.isArray(value.ids)
      ? value.ids.filter((item): item is string => typeof item === "string")
      : undefined,
    families: Array.isArray(value.families)
      ? value.families.filter(
          (item): item is ContextProviderFamily => typeof item === "string",
        )
      : undefined,
  };
}

function providerOptionsArg(
  value: unknown,
): ContextProviderOptions | undefined {
  if (!isRecord(value)) return undefined;
  const memory = isRecord(value.memory) ? value.memory : null;
  const queryMode =
    memory?.queryMode === "recall" || memory?.queryMode === "reflect"
      ? memory.queryMode
      : undefined;
  const includeLegacyBanks =
    typeof memory?.includeLegacyBanks === "boolean"
      ? memory.includeLegacyBanks
      : undefined;
  return queryMode || includeLegacyBanks !== undefined
    ? { memory: { queryMode, includeLegacyBanks } }
    : undefined;
}

function booleanArg(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

async function canManageProviderSettings(
  claims: Record<string, unknown>,
  tenantId: string,
): Promise<boolean> {
  if (claims["tw:auth_kind"] !== "first-party") return false;
  const principalId = stringClaim(claims.sub);
  if (!principalId) return false;
  try {
    const { requireTenantAdmin } =
      await import("../graphql/resolvers/core/authz.js");
    await requireTenantAdmin(
      {
        auth: {
          authType: "cognito",
          principalId,
          email: stringClaim(claims.email) ?? null,
          tenantId,
          agentId: null,
        },
      } as any,
      tenantId,
    );
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resourceUrl(event: APIGatewayProxyEventV2): string {
  return `${issuerUrl(event)}/mcp/context-engine`;
}

function issuerUrl(event: APIGatewayProxyEventV2): string {
  const proto = event.headers["x-forwarded-proto"] || "https";
  const host = event.headers.host || event.requestContext.domainName;
  return `${proto}://${host}`;
}
