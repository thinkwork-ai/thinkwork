import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "typebox";
import type { PiInvocationPayload } from "./types.js";

interface SearchResult {
  title: string;
  url: string;
  published_date?: string;
  highlights: string[];
  score?: number;
}

interface WebSearchConfig {
  provider: "exa" | "serpapi";
  apiKey: string;
}

function resolveConfig(payload: PiInvocationPayload): WebSearchConfig | null {
  const value = payload.web_search_config;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const provider = record.provider === "serpapi" ? "serpapi" : "exa";
  const apiKey = typeof record.apiKey === "string" ? record.apiKey.trim() : "";
  return apiKey ? { provider, apiKey } : null;
}

function paramsRecord(params: unknown): Record<string, unknown> {
  return params && typeof params === "object"
    ? (params as Record<string, unknown>)
    : {};
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return strings.length ? strings : undefined;
}

async function exaSearch(params: {
  api_key: string;
  query: string;
  num_results: number;
  category?: string;
  start_published_date?: string;
  include_domains?: string[];
  exclude_domains?: string[];
}): Promise<SearchResult[]> {
  const body: Record<string, unknown> = {
    query: params.query,
    type: "auto",
    numResults: Math.max(1, Math.min(params.num_results, 10)),
    contents: { highlights: { maxCharacters: 4000 } },
  };
  if (params.category) body.category = params.category;
  if (params.start_published_date)
    body.startPublishedDate = params.start_published_date;
  if (params.include_domains?.length)
    body.includeDomains = params.include_domains;
  if (params.exclude_domains?.length)
    body.excludeDomains = params.exclude_domains;

  const response = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": params.api_key,
      "user-agent": "Thinkwork/1.0",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(
      `Exa search failed: ${response.status} ${await response.text().catch(() => "")}`,
    );
  }
  const data = (await response.json()) as {
    results?: Array<Record<string, any>>;
  };
  return (data.results ?? []).map((result) => ({
    title: String(result.title ?? ""),
    url: String(result.url ?? ""),
    published_date: String(result.publishedDate ?? ""),
    highlights: Array.isArray(result.highlights)
      ? result.highlights.map((h) => String(h))
      : [],
    score: typeof result.score === "number" ? result.score : 0,
  }));
}

async function serpApiSearch(params: {
  api_key: string;
  query: string;
  num_results: number;
  start_published_date?: string;
}): Promise<SearchResult[]> {
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("api_key", params.api_key);
  url.searchParams.set("engine", "google");
  url.searchParams.set("q", params.query);
  url.searchParams.set(
    "num",
    String(Math.max(1, Math.min(params.num_results, 10))),
  );
  if (params.start_published_date) {
    const dt = new Date(params.start_published_date);
    if (!Number.isNaN(dt.getTime())) {
      url.searchParams.set(
        "tbs",
        `cdr:1,cd_min:${dt.toLocaleDateString("en-US")}`,
      );
    }
  }

  const response = await fetch(url, {
    headers: { "user-agent": "Thinkwork/1.0" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(
      `SerpAPI search failed: ${response.status} ${await response.text().catch(() => "")}`,
    );
  }
  const data = (await response.json()) as {
    organic_results?: Array<Record<string, any>>;
  };
  return (data.organic_results ?? [])
    .slice(0, params.num_results)
    .map((result) => ({
      title: String(result.title ?? ""),
      url: String(result.link ?? ""),
      published_date: String(result.date ?? ""),
      highlights: result.snippet ? [String(result.snippet)] : [],
      score: 0,
    }));
}

export function buildWebSearchTool(
  payload: PiInvocationPayload,
): AgentTool<any> | null {
  const config = resolveConfig(payload);
  if (!config) return null;
  return {
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web for current information. Use this for fresh facts, news, webpages, and current public information.",
    parameters: Type.Object({
      query: Type.String({ description: "The search query." }),
      num_results: Type.Optional(
        Type.Number({ description: "Number of results, 1-10." }),
      ),
      category: Type.Optional(
        Type.String({ description: "Optional provider category." }),
      ),
      start_published_date: Type.Optional(
        Type.String({ description: "ISO date lower bound." }),
      ),
      include_domains: Type.Optional(Type.Array(Type.String())),
      exclude_domains: Type.Optional(Type.Array(Type.String())),
    }),
    execute: async (_toolCallId, params) => {
      const input = paramsRecord(params);
      const query = String(input.query || "").trim();
      if (!query) throw new Error("web_search requires query");
      const numResults = Number(input.num_results || 5);
      const results =
        config.provider === "serpapi"
          ? await serpApiSearch({
              api_key: config.apiKey,
              query,
              num_results: numResults,
              start_published_date:
                typeof input.start_published_date === "string"
                  ? input.start_published_date
                  : undefined,
            })
          : await exaSearch({
              api_key: config.apiKey,
              query,
              num_results: numResults,
              category:
                typeof input.category === "string" ? input.category : undefined,
              start_published_date:
                typeof input.start_published_date === "string"
                  ? input.start_published_date
                  : undefined,
              include_domains: optionalStringArray(input.include_domains),
              exclude_domains: optionalStringArray(input.exclude_domains),
            });
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
        details: {
          provider: config.provider,
          query,
          result_count: results.length,
          results,
        },
      };
    },
  };
}
