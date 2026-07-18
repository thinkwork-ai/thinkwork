/**
 * Exact-user AgentCore Gateway target for ThinkWork platform web tools.
 *
 * Harness receives only direct, bounded operations. This target re-authorizes
 * the canonical running turn, re-reads the current agent policy, resolves the
 * tenant credential server-side, and returns a sanitized provider projection.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { and, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { agents } from "@thinkwork/database-pg/schema";
import {
  verifyProofProviderAccessToken,
  type AccessTokenClaims,
} from "@thinkwork/lambda/agentcore-proof-oauth-provider";
import {
  resolveHarnessCapabilityContext,
  type HarnessCapabilityClaims,
  type HarnessCapabilityContext,
} from "./harness-capability-mcp.js";
import {
  loadTenantWebSearchConfig,
  runWebSearch,
  type TenantWebSearchConfig,
  type WebSearchResult,
} from "../lib/builtin-tools/web-search.js";
import {
  loadTenantWebExtractConfig,
  runFirecrawlScrape,
  type FirecrawlScrapeResult,
  type TenantWebExtractConfig,
} from "../lib/builtin-tools/web-extract.js";
import { toolPolicyAliases } from "../lib/builtin-tool-policy-aliases.js";
import { validateTemplateWebSearch } from "../lib/templates/web-search-config.js";
import { validateTemplateWebExtract } from "../lib/templates/web-extract-config.js";
import {
  appendToolExecutionStarted,
  appendToolExecutionTerminal,
  drizzleToolExecutionLedgerStore,
  type ToolExecutionCorrelation,
  type ToolExecutionLedgerStore,
} from "../lib/harness/tool-execution-ledger.js";

const SEARCH_PATH = "/agentcore/capabilities/web/search";
const EXTRACT_PATH = "/agentcore/capabilities/web/extract";
const MAX_BODY_BYTES = 16 * 1024;
const MAX_QUERY_CHARS = 2_000;
const MAX_URL_CHARS = 2_048;
const MAX_EXTRACT_MARKDOWN_CHARS = 60_000;

interface SearchBody {
  tenant_id?: unknown;
  query?: unknown;
  limit?: unknown;
}

interface ExtractBody {
  tenant_id?: unknown;
  url?: unknown;
}

export interface HarnessBuiltinToolResolution {
  webSearch?: Pick<TenantWebSearchConfig, "provider" | "apiKey">;
  webExtract?: Pick<TenantWebExtractConfig, "provider" | "apiKey">;
}

export interface HarnessBuiltinToolsDeps {
  verifyAccessToken(token: string): HarnessCapabilityClaims;
  resolveCanonicalContext(
    claims: HarnessCapabilityClaims,
  ): Promise<HarnessCapabilityContext | null>;
  resolveBuiltinTools(
    context: HarnessCapabilityContext,
  ): Promise<HarnessBuiltinToolResolution>;
  search(input: {
    provider: TenantWebSearchConfig["provider"];
    apiKey: string;
    query: string;
    limit: number;
  }): Promise<WebSearchResult[]>;
  extract(input: {
    provider: TenantWebExtractConfig["provider"];
    apiKey: string;
    url: string;
  }): Promise<FirecrawlScrapeResult>;
  ledgerStore: ToolExecutionLedgerStore;
  policyRevision: string;
  now(): number;
}

export function createHarnessBuiltinToolsHandler(
  deps: HarnessBuiltinToolsDeps,
) {
  return async function harnessBuiltinTools(
    event: APIGatewayProxyEventV2,
  ): Promise<APIGatewayProxyStructuredResultV2> {
    const path = event.rawPath || event.requestContext.http.path;
    if (
      event.requestContext.http.method !== "POST" ||
      (path !== SEARCH_PATH && path !== EXTRACT_PATH)
    ) {
      return response(404, { error: "not_found" });
    }
    if (hasIdentityOverride(event.headers)) {
      return response(400, { error: "identity_override_rejected" });
    }
    const authorization =
      event.headers.authorization ?? event.headers.Authorization ?? "";
    if (!authorization.startsWith("Bearer ")) {
      return response(401, { error: "exact_user_token_required" });
    }

    let claims: HarnessCapabilityClaims;
    try {
      claims = deps.verifyAccessToken(authorization.slice(7));
    } catch {
      return response(401, { error: "exact_user_token_invalid" });
    }
    if (!hasCompleteTurnTuple(claims)) {
      return response(401, { error: "turn_bound_token_required" });
    }

    const rawBody = decodeBody(event);
    if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
      return response(413, { error: "request_too_large" });
    }
    let body: SearchBody | ExtractBody;
    try {
      body = JSON.parse(rawBody || "{}") as SearchBody | ExtractBody;
    } catch {
      return response(400, { error: "invalid_json" });
    }
    if (body.tenant_id !== claims.tenant_id) {
      return response(403, { error: "tenant_context_mismatch" });
    }

    const parsed =
      path === SEARCH_PATH
        ? parseSearchBody(body as SearchBody)
        : parseExtractBody(body as ExtractBody);
    if (!parsed.ok) return response(400, { error: parsed.error });

    const context = await deps.resolveCanonicalContext(claims);
    if (!context) {
      return response(403, { error: "canonical_turn_not_authorized" });
    }
    const isSearch = path === SEARCH_PATH;
    const operation = isSearch ? "web.search" : "web.extract";
    const startedAt = deps.now();
    const correlation: ToolExecutionCorrelation = {
      tenantId: context.tenantId,
      threadId: context.threadId,
      turnId: context.turnId,
      principalType: "user",
      principalId: context.userId,
      toolUseId: event.requestContext.requestId,
      operation,
      policyRevision: deps.policyRevision,
      idempotencyKey: event.requestContext.requestId,
      credentialOwnerAlias: `tenant:${context.tenantId}:builtin:${isSearch ? "web-search" : "web-extract"}`,
    };
    await appendToolExecutionStarted(deps.ledgerStore, {
      ...correlation,
      input: isSearch
        ? {
            queryLength: (parsed.value as ParsedSearch).query.length,
            limit: (parsed.value as ParsedSearch).limit,
          }
        : { urlLength: (parsed.value as ParsedExtract).url.length },
      inputAllowPaths: isSearch
        ? ["queryLength", "limit"]
        : ["urlLength"],
    });

    const finish = async (
      status: "completed" | "failed" | "uncertain",
      output: Record<string, unknown>,
      errorCode?: string,
    ) =>
      appendToolExecutionTerminal(deps.ledgerStore, {
        ...correlation,
        status,
        output,
        outputAllowPaths: ["provider", "resultCount", "contentChars", "truncated"],
        ...(errorCode
          ? { error: { code: errorCode }, errorAllowPaths: ["code"] }
          : {}),
        durationMs: Math.max(0, deps.now() - startedAt),
      });

    try {
      const tools = await deps.resolveBuiltinTools(context);
      if (isSearch) {
        if (!tools.webSearch) {
          await finish("failed", { resultCount: 0 }, "web_search_not_authorized");
          return response(403, { error: "web_search_not_authorized" });
        }
        const request = parsed.value as ParsedSearch;
        const results = await deps.search({
          ...tools.webSearch,
          query: request.query,
          limit: request.limit,
        });
        const sanitized = results.map(sanitizeSearchResult);
        await finish("completed", {
          provider: tools.webSearch.provider,
          resultCount: sanitized.length,
        });
        return response(200, {
          provider: tools.webSearch.provider,
          results: sanitized,
        });
      }

      if (!tools.webExtract) {
        await finish("failed", { contentChars: 0 }, "web_extract_not_authorized");
        return response(403, { error: "web_extract_not_authorized" });
      }
      const request = parsed.value as ParsedExtract;
      const result = await deps.extract({
        ...tools.webExtract,
        url: request.url,
      });
      const markdown = result.markdown ?? "";
      const truncated = markdown.length > MAX_EXTRACT_MARKDOWN_CHARS;
      const boundedMarkdown = markdown.slice(0, MAX_EXTRACT_MARKDOWN_CHARS);
      await finish("completed", {
        provider: tools.webExtract.provider,
        contentChars: boundedMarkdown.length,
        truncated,
      });
      return response(200, {
        provider: tools.webExtract.provider,
        url: result.url,
        ...(result.title ? { title: result.title } : {}),
        markdown: boundedMarkdown,
        truncated,
      });
    } catch (error) {
      console.error("[harness-builtin-tools] provider operation failed", {
        tenantId: context.tenantId,
        turnId: context.turnId,
        operation,
        errorType: error instanceof Error ? error.name : "unknown",
      });
      await finish("uncertain", {}, `${operation.replace(".", "_")}_failed`).catch(
        (ledgerError) =>
          console.error("[harness-builtin-tools] terminal evidence failed", {
            tenantId: context.tenantId,
            turnId: context.turnId,
            operation,
            errorType:
              ledgerError instanceof Error ? ledgerError.name : "unknown",
          }),
      );
      return response(502, {
        error: `${operation.replace(".", "_")}_failed`,
      });
    }
  };
}

async function resolveBuiltinToolsForHarness(
  context: HarnessCapabilityContext,
): Promise<HarnessBuiltinToolResolution> {
  const [agent] = await getDb()
    .select({
      webSearch: agents.web_search,
      webExtract: agents.web_extract,
      blockedTools: agents.blocked_tools,
    })
    .from(agents)
    .where(
      and(
        eq(agents.id, context.agentId),
        eq(agents.tenant_id, context.tenantId),
      ),
    )
    .limit(1);
  if (!agent) return {};

  const blocked = new Set(
    Array.isArray(agent.blockedTools)
      ? agent.blockedTools.filter((value): value is string => typeof value === "string")
      : [],
  );
  const isBlocked = (tool: string) =>
    toolPolicyAliases(tool).some((alias) => blocked.has(alias));
  const searchTemplate = validateTemplateWebSearch(agent.webSearch);
  const extractTemplate = validateTemplateWebExtract(agent.webExtract);
  const searchEnabled =
    searchTemplate.ok &&
    searchTemplate.value?.enabled === true &&
    !isBlocked("web-search");
  const extractEnabled =
    extractTemplate.ok &&
    extractTemplate.value?.enabled === true &&
    !isBlocked("web-extract");

  const [webSearch, webExtract] = await Promise.all([
    searchEnabled ? loadTenantWebSearchConfig(context.tenantId) : null,
    extractEnabled ? loadTenantWebExtractConfig(context.tenantId) : null,
  ]);
  return {
    ...(webSearch
      ? { webSearch: { provider: webSearch.provider, apiKey: webSearch.apiKey } }
      : {}),
    ...(webExtract
      ? { webExtract: { provider: webExtract.provider, apiKey: webExtract.apiKey } }
      : {}),
  };
}

interface ParsedSearch {
  query: string;
  limit: number;
}

interface ParsedExtract {
  url: string;
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function parseSearchBody(body: SearchBody): ParseResult<ParsedSearch> {
  if (
    typeof body.query !== "string" ||
    body.query.trim().length === 0 ||
    body.query.length > MAX_QUERY_CHARS
  ) {
    return { ok: false, error: "invalid_query" };
  }
  const limit = body.limit === undefined ? 5 : body.limit;
  if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 10) {
    return { ok: false, error: "invalid_limit" };
  }
  return { ok: true, value: { query: body.query.trim(), limit: Number(limit) } };
}

function parseExtractBody(body: ExtractBody): ParseResult<ParsedExtract> {
  if (
    typeof body.url !== "string" ||
    body.url.length === 0 ||
    body.url.length > MAX_URL_CHARS
  ) {
    return { ok: false, error: "invalid_url" };
  }
  try {
    const parsed = new URL(body.url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      return { ok: false, error: "invalid_url" };
    }
    return { ok: true, value: { url: parsed.toString() } };
  } catch {
    return { ok: false, error: "invalid_url" };
  }
}

function sanitizeSearchResult(result: WebSearchResult) {
  return {
    title: result.title.slice(0, 500),
    ...(result.url ? { url: result.url.slice(0, MAX_URL_CHARS) } : {}),
    snippet: result.snippet.slice(0, 1_500),
    ...(typeof result.score === "number" && Number.isFinite(result.score)
      ? { score: result.score }
      : {}),
  };
}

function hasIdentityOverride(headers: Record<string, string | undefined>) {
  return Boolean(
    headers["x-thinkwork-user-id"] ||
      headers["x-thinkwork-tenant-id"] ||
      headers["x-thinkwork-agent-id"] ||
      headers["x-thinkwork-turn-id"],
  );
}

function hasCompleteTurnTuple(
  claims: HarnessCapabilityClaims,
): claims is HarnessCapabilityClaims {
  return Boolean(
    claims.sub &&
      claims.participant_id &&
      claims.sub === claims.participant_id &&
      claims.tenant_id &&
      claims.agent_id &&
      claims.thread_id &&
      claims.turn_id &&
      Number.isInteger(claims.session_generation) &&
      claims.session_generation > 0,
  );
}

function decodeBody(event: APIGatewayProxyEventV2): string {
  const body = event.body ?? "";
  return event.isBase64Encoded
    ? Buffer.from(body, "base64").toString("utf8")
    : body;
}

function response(
  statusCode: number,
  body: unknown,
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json",
      pragma: "no-cache",
    },
    body: JSON.stringify(body),
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const deployedHandler = createHarnessBuiltinToolsHandler({
  verifyAccessToken(token) {
    return verifyProofProviderAccessToken(token, {
      issuer: requiredEnv("AGENTCORE_PROOF_OAUTH_ISSUER"),
      audience: `${requiredEnv("AGENTCORE_PROOF_OAUTH_ISSUER").replace(/\/+$/, "")}/target`,
      secret: requiredEnv("AGENTCORE_PROOF_OAUTH_CLIENT_SECRET"),
      nowSeconds: Math.floor(Date.now() / 1000),
    }) as AccessTokenClaims & HarnessCapabilityClaims;
  },
  resolveCanonicalContext: resolveHarnessCapabilityContext,
  resolveBuiltinTools: resolveBuiltinToolsForHarness,
  search: runWebSearch,
  extract: runFirecrawlScrape,
  ledgerStore: drizzleToolExecutionLedgerStore(),
  policyRevision:
    process.env.AGENTCORE_GATEWAY_POLICY_REVISION?.trim() || "builtin-web-v1",
  now: Date.now,
});

export const handler = deployedHandler;
