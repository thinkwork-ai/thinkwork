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
  // backend can scope ephemeral context providers to the thread's Space.
  threadId?: string;
  contextEngineConfig?: Record<string, unknown>;
  includeMemoryContext?: boolean;
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
] as const;

const TOOL_NAMES_WITHOUT_MEMORY = [
  "query_context",
  "query_brain_context",
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

export function createContextEngineExtension(
  options: ContextEngineExtensionOptions,
): ThinkworkExtension {
  const includeMemoryContext = options.includeMemoryContext !== false;
  return defineExtension({
    name: "thinkwork-context-engine",
    toolNames: options.enabled
      ? includeMemoryContext
        ? TOOL_NAMES
        : TOOL_NAMES_WITHOUT_MEMORY
      : [],
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
              "Optional ThinkWork Brain source family hint, such as thread or document.",
          }),
        ),
        sourceType: Type.Optional(
          Type.String({
            description:
              "Optional ThinkWork Brain source type hint, such as thread_message.",
          }),
        ),
        datasetId: Type.Optional(
          Type.String({
            description:
              "Optional ThinkWork Brain dataset or dogfood fixture id.",
          }),
        ),
        nodeSetIds: Type.Optional(
          Type.Array(Type.String(), {
            description: "Optional ThinkWork Brain node-set filters.",
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
              "Stable ThinkWork Brain hit ids from a previous shortlist to expand.",
          }),
        ),
        detailIndexes: Type.Optional(
          Type.Array(Type.Number(), {
            description:
              "1-based ThinkWork Brain result indexes from a previous shortlist to expand.",
          }),
        ),
      };

      const queryContext: ToolDefinition = {
        name: "query_context",
        label: "ThinkWork Brain",
        description:
          "Search the ThinkWork Context Engine (ThinkWork Brain) across fast default " +
          "providers: workspace files, sub-agent providers, " +
          "and approved search-safe MCP tools. Use this first for ordinary agent " +
          "context lookup." +
          (includeMemoryContext
            ? " Use query_memory_context only when user-carried or current-space long-term memory is specifically needed."
            : " Do not use this for user or Space long-term memory; use the direct memory tools instead."),
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
          "Search only Thinkwork long-term memory through the host-scoped Context Engine. " +
          'Use scope "personal" for user-carried memory that follows the user, ' +
          'scope "team" for memory owned by the current Space, and scope "auto" ' +
          "when either may be relevant. The agent cannot choose arbitrary user or " +
          "space owners; identity is closed over by the host.",
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
        label: "ThinkWork Brain Search",
        description:
          "Search only tenant-shared ThinkWork Brain business/domain context. " +
          "Use this for governed customers, opportunities, commitments, risks, " +
          "stakeholders, products, relationships, and cited provenance. " +
          (includeMemoryContext
            ? "Use query_memory_context for user/space long-term memory. "
            : "Use direct memory tools for user/space long-term memory. ") +
          "Initial results are shortlists; call again with detailIds or " +
          "detailIndexes to expand selected Brain results.",
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

      pi.registerTool(queryContext);
      if (includeMemoryContext) pi.registerTool(queryMemoryContext);
      pi.registerTool(queryBrainContext);
    },
  });
}
