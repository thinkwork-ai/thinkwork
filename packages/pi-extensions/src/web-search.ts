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

export interface WebSearchConfig {
  provider?: unknown;
  apiKey?: unknown;
}

export interface WebSearchExtensionOptions {
  webSearchConfig?: WebSearchConfig | null;
  fetchImpl?: FetchLike;
}

interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

const REQUEST_TIMEOUT_MS = 15_000;

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function fetchJson(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      ...init,
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        body
          ? `HTTP ${response.status}: ${body.slice(0, 300)}`
          : `HTTP ${response.status}`,
      );
    }
    return (await response.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

function recordsOf(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null,
      )
    : [];
}

async function exaSearch(
  fetchImpl: FetchLike,
  apiKey: string,
  query: string,
  numResults: number,
): Promise<WebSearchResult[]> {
  const data = await fetchJson(fetchImpl, "https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
      "User-Agent": "Thinkwork/1.0",
    },
    body: JSON.stringify({ query, numResults }),
  });
  const results = recordsOf((data as Record<string, unknown>)?.results);
  return results.slice(0, numResults).map((item) => ({
    title: asString(item.title),
    url: asString(item.url),
    snippet: String(item.text ?? item.summary ?? "").slice(0, 500),
  }));
}

async function serpapiSearch(
  fetchImpl: FetchLike,
  apiKey: string,
  query: string,
  numResults: number,
): Promise<WebSearchResult[]> {
  const params = new URLSearchParams({
    engine: "google",
    q: query,
    num: String(Math.max(1, Math.min(numResults, 10))),
    api_key: apiKey,
  });
  const data = (await fetchJson(
    fetchImpl,
    `https://serpapi.com/search.json?${params.toString()}`,
    { method: "GET" },
  )) as Record<string, unknown>;
  if (data?.error) throw new Error(String(data.error));
  const results = recordsOf(data?.organic_results);
  return results.slice(0, numResults).map((item) => ({
    title: asString(item.title),
    url: asString(item.link),
    snippet: String(item.snippet ?? "").slice(0, 500),
  }));
}

export function createWebSearchExtension(
  options: WebSearchExtensionOptions,
): ThinkworkExtension {
  const config = options.webSearchConfig;
  const enabled = typeof config === "object" && config !== null;

  return defineExtension({
    name: "thinkwork-web-search",
    toolNames: enabled ? ["web_search"] : [],
    register(pi) {
      if (!enabled) return;

      const provider = (asString(config.provider) || "exa").toLowerCase();
      const apiKey = asString(config.apiKey);
      const fetchImpl = options.fetchImpl ?? fetch;

      const tool: ToolDefinition = {
        name: "web_search",
        label: "Web Search",
        description:
          "Search the web for current information (locations, business hours, " +
          "current events, prices, schedules, news, definitions). Fast and cheap — " +
          "prefer this for ordinary factual lookups before browser automation.",
        parameters: Type.Object({
          query: Type.String({ description: "Specific search query." }),
          num_results: Type.Optional(
            Type.Number({
              description: "Number of results to return, from 1 to 10.",
              default: 5,
            }),
          ),
        }),
        executionMode: "sequential",
        async execute(_toolCallId, params) {
          const typed = (params ?? {}) as Record<string, unknown>;
          const query = asString(typed.query);
          const boundedResults = Math.max(
            1,
            Math.min(Math.trunc(Number(typed.num_results) || 5), 10),
          );

          if (!apiKey) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    ok: false,
                    provider,
                    result_count: 0,
                    error:
                      "Web Search is enabled but no API key is configured.",
                  }),
                },
              ],
              details: { ok: false, runtime: "pi", provider },
            };
          }
          if (!query) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    ok: false,
                    provider,
                    result_count: 0,
                    error: "web_search requires a non-empty query.",
                  }),
                },
              ],
              details: { ok: false, runtime: "pi", provider },
            };
          }

          const started = Date.now();
          try {
            const results =
              provider === "serpapi"
                ? await serpapiSearch(fetchImpl, apiKey, query, boundedResults)
                : await exaSearch(fetchImpl, apiKey, query, boundedResults);
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    ok: true,
                    provider,
                    query,
                    result_count: results.length,
                    results,
                  }),
                },
              ],
              details: {
                ok: true,
                runtime: "pi",
                provider,
                result_count: results.length,
                duration_ms: Date.now() - started,
              },
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    ok: false,
                    provider,
                    query,
                    result_count: 0,
                    error: message,
                  }),
                },
              ],
              details: {
                ok: false,
                runtime: "pi",
                provider,
                duration_ms: Date.now() - started,
                error: message.slice(0, 200),
              },
            };
          }
        },
      };

      pi.registerTool(tool);
    },
  });
}
