import {
  loadTenantWebSearchConfig,
  runWebSearch,
  type TenantWebSearchConfig,
  type WebSearchResult,
} from "../../builtin-tools/web-search.js";
import type {
  ContextHit,
  ContextProviderDescriptor,
  ContextProviderResult,
} from "../types.js";

export const WEB_SEARCH_CONTEXT_PROVIDER_ID = "builtin:web-search";

export async function createTenantWebSearchContextProvider(caller: {
  tenantId: string;
}): Promise<ContextProviderDescriptor | null> {
  const config = await loadTenantWebSearchConfig(caller.tenantId);
  return config ? createWebSearchContextProvider({ config }) : null;
}

export function createWebSearchContextProvider(args: {
  config: TenantWebSearchConfig;
  search?: (query: string, limit: number) => Promise<WebSearchResult[]>;
}): ContextProviderDescriptor {
  return {
    id: WEB_SEARCH_CONTEXT_PROVIDER_ID,
    family: "mcp",
    sourceFamily: "web",
    displayName: "Web Search",
    defaultEnabled: false,
    supportedScopes: ["personal", "team", "auto"],
    config: {
      toolSlug: args.config.toolSlug,
      provider: args.config.provider,
      externalTrust: "lower",
    },
    timeoutMs: 12_000,
    async query(request): Promise<ContextProviderResult> {
      try {
        const results = await (args.search ?? defaultSearch)(
          request.query,
          request.limit,
        );
        return {
          hits: results.map((result, index) =>
            webSearchResultToHit(result, index, request.scope),
          ),
        };
      } catch (err) {
        return {
          hits: [],
          status: {
            state: "error",
            error: err instanceof Error ? err.message : String(err),
            metadata: { provider: args.config.provider },
          },
        };
      }
    },
  };

  function defaultSearch(query: string, limit: number) {
    return runWebSearch({
      provider: args.config.provider,
      apiKey: args.config.apiKey,
      query,
      limit,
    });
  }
}

function webSearchResultToHit(
  result: WebSearchResult,
  index: number,
  scope: "personal" | "team" | "auto",
): ContextHit {
  const sourceId = result.id || result.url || String(index + 1);
  return {
    id: `${WEB_SEARCH_CONTEXT_PROVIDER_ID}:${sourceId}`,
    providerId: WEB_SEARCH_CONTEXT_PROVIDER_ID,
    family: "mcp",
    sourceFamily: "web",
    title: result.title,
    snippet: result.snippet,
    score: result.score ?? 1 / (index + 1),
    scope,
    provenance: {
      label: "Web Search",
      uri: result.url,
      sourceId,
      metadata: {
        sourceFamily: "web",
        trust: "external",
      },
    },
    metadata: {
      sourceFamily: "web",
      trust: "external",
      raw: result.raw,
    },
  };
}
