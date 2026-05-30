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
        if (!options.tenantId || !options.userId) return MISSING_IDENTITY;

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
          const response = await fetchImpl(`${apiUrl}/mcp/context-engine`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${apiSecret}`,
              "x-tenant-id": options.tenantId,
              "x-user-id": options.userId,
              "x-agent-id": options.agentId,
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: "pi-context-engine",
              method: "tools/call",
              params: { name, arguments: args },
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
          return textResult(renderResult(result));
        },
      };

      pi.registerTool(queryContext);
      pi.registerTool(queryMemoryContext);
      pi.registerTool(queryWikiContext);
    },
  });
}
