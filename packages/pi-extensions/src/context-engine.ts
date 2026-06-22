import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import {
  defineExtension,
  type ThinkworkExtension,
} from "./define-extension.js";

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface ContextEngineExtensionOptions {
  enabled: boolean;
  apiUrl: string;
  apiSecret: string;
  tenantId: string;
  userId: string;
  agentId: string;
  threadTurnId?: string;
  // The thread this turn runs in. Forwarded as a query_context argument so the
  // backend can scope Space-bound Knowledge Bases to the thread's Space (U7).
  threadId?: string;
  contextEngineConfig?: Record<string, unknown>;
  fetchImpl?: FetchLike;
}

const REQUEST_TIMEOUT_MS = 20_000;
const NOT_ENABLED = "Context Engine is not enabled for this deployment yet.";
const MISSING_IDENTITY =
  "Context Engine is missing tenant/user identity for this turn.";
const TOOL_NAMES = [
  "query_context",
  "query_memory_context",
  "query_brain_context",
  "query_wiki_context",
] as const;

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function textResult(text: string, details: Record<string, unknown> = {}) {
  return {
    content: [{ type: "text" as const, text }],
    details: { runtime: "pi", provider: "thinkwork-context", ...details },
  };
}

function normalizeMode(value: unknown): "results" | "answer" {
  return value === "answer" ? "answer" : "results";
}

function normalizeScope(value: unknown): "personal" | "team" | "auto" {
  return value === "personal" || value === "team" ? value : "auto";
}

function normalizeDepth(value: unknown): "quick" | "deep" {
  return value === "deep" ? "deep" : "quick";
}

function normalizeLimit(value: unknown): number {
  return Math.max(1, Math.min(Math.trunc(Number(value) || 10), 50));
}

function renderResult(result: Record<string, unknown> | string): string {
  if (typeof result === "string") return result;
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content
    .map((item) =>
      typeof item === "object" && item ? recordOf(item).text : "",
    )
    .filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    )
    .join("\n")
    .trim();
  if (text) return text;
  return JSON.stringify(result.structuredContent ?? result, null, 2);
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const record = recordOf(item);
        return Object.keys(record).length > 0 ? [record] : [];
      })
    : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function wikiContextDetails(
  result: Record<string, unknown> | string,
  request: {
    query: string;
    mode: "results" | "answer";
    scope: "personal" | "team" | "auto";
    depth: "quick" | "deep";
    limit: number;
  },
) {
  if (typeof result === "string") {
    return {
      provider: "thinkwork-context",
      surface: "query_wiki_context",
      retrieval_mode: "db",
      status: "error",
      query: request.query,
      mode: request.mode,
      scope: request.scope,
      depth: request.depth,
      limit: request.limit,
      result_count: 0,
      top_pages: [],
    };
  }

  const structured = recordOf(result.structuredContent);
  const hits = arrayOfRecords(structured.hits);
  const providers = arrayOfRecords(structured.providers);
  const topPages = hits.slice(0, 5).map((hit) => {
    const metadata = recordOf(hit.metadata);
    const page = recordOf(metadata.page);
    const provenance = recordOf(hit.provenance);
    const provenanceMetadata = recordOf(provenance.metadata);
    const rawId = stringValue(page.id) ?? stringValue(provenance.sourceId);
    const id =
      rawId ??
      (stringValue(hit.id)?.startsWith("wiki:")
        ? stringValue(hit.id)?.slice("wiki:".length)
        : stringValue(hit.id));
    return {
      ...(id ? { id } : {}),
      ...(stringValue(hit.id) ? { context_id: stringValue(hit.id) } : {}),
      ...(stringValue(hit.title) ? { title: stringValue(hit.title) } : {}),
      ...((stringValue(page.slug) ?? stringValue(provenanceMetadata.slug))
        ? {
            slug:
              stringValue(page.slug) ?? stringValue(provenanceMetadata.slug),
          }
        : {}),
      ...((stringValue(page.type) ?? stringValue(provenanceMetadata.type))
        ? {
            type:
              stringValue(page.type) ?? stringValue(provenanceMetadata.type),
          }
        : {}),
      ...(numberValue(hit.score) !== undefined
        ? { score: numberValue(hit.score) }
        : {}),
      ...(stringValue(hit.scope) ? { scope: stringValue(hit.scope) } : {}),
    };
  });
  const providerStates = providers.map((provider) => ({
    ...(stringValue(provider.providerId)
      ? { provider_id: stringValue(provider.providerId) }
      : {}),
    ...(stringValue(provider.displayName)
      ? { display_name: stringValue(provider.displayName) }
      : {}),
    ...(stringValue(provider.state)
      ? { state: stringValue(provider.state) }
      : {}),
    ...(numberValue(provider.hitCount) !== undefined
      ? { hit_count: numberValue(provider.hitCount) }
      : {}),
    ...(numberValue(provider.durationMs) !== undefined
      ? { duration_ms: numberValue(provider.durationMs) }
      : {}),
    ...(stringValue(provider.error)
      ? { error: stringValue(provider.error) }
      : {}),
    ...(stringValue(provider.reason)
      ? { reason: stringValue(provider.reason) }
      : {}),
  }));

  return {
    provider: "thinkwork-context",
    surface: "query_wiki_context",
    retrieval_mode: "db",
    status:
      providerStates.find((provider) => provider.state)?.state ??
      (hits.length > 0 ? "ok" : "empty"),
    query: stringValue(structured.query) ?? request.query,
    mode: stringValue(structured.mode) ?? request.mode,
    scope: stringValue(structured.scope) ?? request.scope,
    depth: stringValue(structured.depth) ?? request.depth,
    limit: request.limit,
    result_count: hits.length,
    top_pages: topPages,
    provider_states: providerStates,
    answered_from_db: true,
  };
}

export function createContextEngineExtension(
  options: ContextEngineExtensionOptions,
): ThinkworkExtension {
  return defineExtension({
    name: "thinkwork-context-engine",
    toolNames: options.enabled ? TOOL_NAMES : [],
    register(pi) {
      if (!options.enabled) return;

      const apiUrl = options.apiUrl.replace(/\/+$/, "");
      const apiSecret = options.apiSecret;
      const fetchImpl = options.fetchImpl ?? fetch;
      const config = recordOf(options.contextEngineConfig);
      const providerDefaults = recordOf(config.providers);
      const providerOptions = recordOf(config.providerOptions);

      async function jsonRpc(
        name: string,
        args: Record<string, unknown>,
      ): Promise<Record<string, unknown> | string> {
        if (!apiUrl || !apiSecret) return NOT_ENABLED;
        if (!options.threadTurnId && (!options.tenantId || !options.userId)) {
          return MISSING_IDENTITY;
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
          const authHeaders: Record<string, string> = options.threadTurnId
            ? { "x-thread-turn-id": options.threadTurnId }
            : {
                "x-tenant-id": options.tenantId,
                "x-user-id": options.userId,
                "x-agent-id": options.agentId,
              };
          const response = await fetchImpl(`${apiUrl}/mcp/context-engine`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${apiSecret}`,
              ...authHeaders,
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: "pi-context-engine",
              method: "tools/call",
              params: {
                name,
                arguments: options.threadId
                  ? { ...args, threadId: options.threadId }
                  : args,
              },
            }),
            signal: controller.signal,
          });
          const payload = recordOf(await response.json().catch(() => ({})));
          if (payload.error) {
            const message = recordOf(payload.error).message ?? "unknown error";
            return `Context Engine failed: ${String(message)}`;
          }
          const result = payload.result;
          return typeof result === "object" && result !== null
            ? (result as Record<string, unknown>)
            : {};
        } catch (err) {
          return `Context Engine failed: ${err instanceof Error ? err.message : String(err)}`;
        } finally {
          clearTimeout(timer);
        }
      }

      const sharedParams = {
        query: Type.String({ description: "The search query." }),
        mode: Type.Optional(
          Type.String({ description: '"results" (default) or "answer".' }),
        ),
        scope: Type.Optional(
          Type.String({
            description: '"personal", "team", or "auto" (default).',
          }),
        ),
        depth: Type.Optional(
          Type.String({ description: '"quick" (default) or "deep".' }),
        ),
        limit: Type.Optional(
          Type.Number({ description: "Max results, 1-50 (default 10)." }),
        ),
      };

      const brainParams = {
        ...sharedParams,
        sourceKind: Type.Optional(
          Type.String({
            description:
              "Optional Company Brain source family hint, such as thread or document.",
          }),
        ),
        sourceType: Type.Optional(
          Type.String({
            description:
              "Optional Company Brain source type hint, such as thread_message.",
          }),
        ),
        datasetId: Type.Optional(
          Type.String({
            description:
              "Optional Company Brain dataset or dogfood fixture id.",
          }),
        ),
        nodeSetIds: Type.Optional(
          Type.Array(Type.String(), {
            description: "Optional Company Brain node-set filters.",
          }),
        ),
        topK: Type.Optional(
          Type.Number({
            description:
              "Brain retrieval candidate count, 1-50. Defaults to limit.",
          }),
        ),
        onlyContext: Type.Optional(
          Type.Boolean({
            description:
              "Return source context only, without asking Brain to synthesize an answer.",
          }),
        ),
        detailIds: Type.Optional(
          Type.Array(Type.String(), {
            description:
              "Stable Company Brain hit ids from a previous shortlist to expand.",
          }),
        ),
        detailIndexes: Type.Optional(
          Type.Array(Type.Number(), {
            description:
              "1-based Company Brain result indexes from a previous shortlist to expand.",
          }),
        ),
      };

      const queryContext: ToolDefinition = {
        name: "query_context",
        label: "Company Brain",
        description:
          "Search the Thinkwork Context Engine (Company Brain) across fast default " +
          "providers: wiki, workspace files, knowledge bases, sub-agent providers, " +
          "and approved search-safe MCP tools. Use this first for ordinary agent " +
          "context lookup. Use query_memory_context only when raw Hindsight Memory " +
          "is specifically needed.",
        parameters: Type.Object({
          ...sharedParams,
          provider_ids: Type.Optional(
            Type.Array(Type.String(), {
              description: "Restrict to these provider ids.",
            }),
          ),
          provider_families: Type.Optional(
            Type.Array(Type.String(), {
              description: "Restrict to these provider families.",
            }),
          ),
        }),
        executionMode: "sequential",
        async execute(_id, params) {
          const typed = recordOf(params);
          const query = String(typed.query ?? "").trim();
          if (!query) {
            return textResult("query_context requires a non-empty query.", {
              ok: false,
            });
          }
          const providers: Record<string, unknown> = {};
          if (
            Array.isArray(typed.provider_ids) &&
            typed.provider_ids.length > 0
          ) {
            providers.ids = typed.provider_ids;
          }
          if (
            Array.isArray(typed.provider_families) &&
            typed.provider_families.length > 0
          ) {
            providers.families = typed.provider_families;
          }
          if (Object.keys(providers).length === 0) {
            Object.assign(providers, providerDefaults);
          }
          const result = await jsonRpc("query_context", {
            query,
            mode: normalizeMode(typed.mode),
            scope: normalizeScope(typed.scope),
            depth: normalizeDepth(typed.depth),
            limit: normalizeLimit(typed.limit),
            ...(Object.keys(providers).length > 0 ? { providers } : {}),
            ...(Object.keys(providerOptions).length > 0
              ? { providerOptions }
              : {}),
          });
          return textResult(renderResult(result));
        },
      };

      const queryMemoryContext: ToolDefinition = {
        name: "query_memory_context",
        label: "Memory Search",
        description:
          "Search only Thinkwork Hindsight Memory. Use this when the user " +
          "specifically asks for raw long-term memory recall. Can be much slower " +
          "than query_context.",
        parameters: Type.Object(sharedParams),
        executionMode: "sequential",
        async execute(_id, params) {
          const typed = recordOf(params);
          const query = String(typed.query ?? "").trim();
          if (!query) {
            return textResult(
              "query_memory_context requires a non-empty query.",
              { ok: false },
            );
          }
          const result = await jsonRpc("query_memory_context", {
            query,
            mode: normalizeMode(typed.mode),
            scope: normalizeScope(typed.scope),
            depth: normalizeDepth(typed.depth),
            limit: normalizeLimit(typed.limit),
            ...(Object.keys(providerOptions).length > 0
              ? { providerOptions }
              : {}),
          });
          return textResult(renderResult(result));
        },
      };

      const queryBrainContext: ToolDefinition = {
        name: "query_brain_context",
        label: "Company Brain Search",
        description:
          "Search only tenant-shared Company Brain business/domain context. " +
          "Use this for governed customers, opportunities, commitments, risks, " +
          "stakeholders, products, relationships, and cited provenance. " +
          "Use query_memory_context for raw Hindsight Memory and " +
          "query_wiki_context for compiled page lookup. Initial results are " +
          "shortlists; call again with detailIds or detailIndexes to expand " +
          "selected Brain results.",
        parameters: Type.Object(brainParams),
        executionMode: "sequential",
        async execute(_id, params) {
          const typed = recordOf(params);
          const query = String(typed.query ?? "").trim();
          if (!query) {
            return textResult(
              "query_brain_context requires a non-empty query.",
              { ok: false },
            );
          }
          const result = await jsonRpc("query_brain_context", {
            query,
            mode: normalizeMode(typed.mode),
            scope: normalizeScope(typed.scope),
            depth: normalizeDepth(typed.depth),
            limit: normalizeLimit(typed.limit),
            ...(typed.topK !== undefined || typed.limit !== undefined
              ? { topK: normalizeLimit(typed.topK ?? typed.limit) }
              : {}),
            ...(typeof typed.sourceKind === "string" && typed.sourceKind.trim()
              ? { sourceKind: typed.sourceKind.trim() }
              : {}),
            ...(typeof typed.sourceType === "string" && typed.sourceType.trim()
              ? { sourceType: typed.sourceType.trim() }
              : {}),
            ...(typeof typed.datasetId === "string" && typed.datasetId.trim()
              ? { datasetId: typed.datasetId.trim() }
              : {}),
            ...(Array.isArray(typed.nodeSetIds)
              ? {
                  nodeSetIds: typed.nodeSetIds.filter(
                    (item): item is string => typeof item === "string",
                  ),
                }
              : {}),
            ...(typeof typed.onlyContext === "boolean"
              ? { onlyContext: typed.onlyContext }
              : {}),
            ...(Array.isArray(typed.detailIds)
              ? {
                  detailIds: typed.detailIds.filter(
                    (item): item is string => typeof item === "string",
                  ),
                }
              : {}),
            ...(Array.isArray(typed.detailIndexes)
              ? {
                  detailIndexes: typed.detailIndexes
                    .map((item) =>
                      typeof item === "number" ? item : Number(item),
                    )
                    .filter((item) => Number.isInteger(item) && item >= 1),
                }
              : {}),
          });
          return textResult(renderResult(result));
        },
      };

      const queryWikiContext: ToolDefinition = {
        name: "query_wiki_context",
        label: "Wiki Search",
        description:
          "Search only Thinkwork Compounding Wiki pages (entities, topics, " +
          "decisions). Fast page lookup without waiting on Hindsight Memory.",
        parameters: Type.Object(sharedParams),
        executionMode: "sequential",
        async execute(_id, params) {
          const typed = recordOf(params);
          const query = String(typed.query ?? "").trim();
          if (!query) {
            return textResult(
              "query_wiki_context requires a non-empty query.",
              {
                ok: false,
              },
            );
          }
          const result = await jsonRpc("query_wiki_context", {
            query,
            mode: normalizeMode(typed.mode),
            scope: normalizeScope(typed.scope),
            depth: normalizeDepth(typed.depth),
            limit: normalizeLimit(typed.limit),
          });
          const mode = normalizeMode(typed.mode);
          const scope = normalizeScope(typed.scope);
          const depth = normalizeDepth(typed.depth);
          const limit = normalizeLimit(typed.limit);
          return textResult(renderResult(result), {
            wiki_context: wikiContextDetails(result, {
              query,
              mode,
              scope,
              depth,
              limit,
            }),
          });
        },
      };

      pi.registerTool(queryContext);
      pi.registerTool(queryMemoryContext);
      pi.registerTool(queryBrainContext);
      pi.registerTool(queryWikiContext);
    },
  });
}
