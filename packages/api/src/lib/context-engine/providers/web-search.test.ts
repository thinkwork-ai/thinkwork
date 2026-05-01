import { describe, expect, it, vi } from "vitest";

import { createContextEngineRouter } from "../router.js";
import { createWebSearchContextProvider } from "./web-search.js";

describe("Web Search Context Engine provider", () => {
  it("builds a default-disabled Web provider with normalized URL-cited hits", async () => {
    const provider = createWebSearchContextProvider({
      config: {
        toolSlug: "web-search",
        provider: "exa",
        apiKey: "exa-key",
        config: null,
        secretRef: "secret-ref",
      },
      search: async () => [
        {
          id: "result-1",
          title: "Fresh public fact",
          snippet: "The public web says something current.",
          url: "https://example.com/fact",
          score: 0.9,
          raw: { id: "result-1" },
        },
      ],
    });

    expect(provider).toMatchObject({
      id: "builtin:web-search",
      family: "mcp",
      sourceFamily: "web",
      displayName: "Exa Research",
      defaultEnabled: false,
    });

    const result = await provider.query({
      query: "fresh fact",
      caller: { tenantId: "tenant-1" },
      mode: "results",
      scope: "auto",
      depth: "quick",
      limit: 5,
    });

    expect(result.hits).toEqual([
      expect.objectContaining({
        id: "builtin:web-search:result-1",
        providerId: "builtin:web-search",
        family: "mcp",
        sourceFamily: "web",
        title: "Fresh public fact",
        snippet: "The public web says something current.",
        provenance: expect.objectContaining({
          label: "Exa Research",
          uri: "https://example.com/fact",
          sourceId: "result-1",
        }),
      }),
    ]);
  });

  it("stays out of default queries unless explicitly selected", async () => {
    const webProvider = createWebSearchContextProvider({
      config: {
        toolSlug: "web-search",
        provider: "exa",
        apiKey: "exa-key",
        config: null,
        secretRef: "secret-ref",
      },
      search: async () => [
        {
          title: "Web result",
          snippet: "snippet",
          url: "https://example.com",
          raw: {},
        },
      ],
    });
    const search = vi.fn(webProvider.query);
    const router = createContextEngineRouter({
      providers: [{ ...webProvider, query: search }],
    });

    const defaultResult = await router.query({
      query: "news",
      caller: { tenantId: "tenant-1" },
    });
    expect(defaultResult.providers).toEqual([]);
    expect(search).not.toHaveBeenCalled();

    const explicitResult = await router.query({
      query: "news",
      providers: { ids: ["builtin:web-search"] },
      caller: { tenantId: "tenant-1" },
    });
    expect(explicitResult.providers).toEqual([
      expect.objectContaining({
        providerId: "builtin:web-search",
        sourceFamily: "web",
        defaultEnabled: false,
        state: "ok",
      }),
    ]);
  });

  it("returns provider-local error status for provider API failures", async () => {
    const provider = createWebSearchContextProvider({
      config: {
        toolSlug: "web-search",
        provider: "serpapi",
        apiKey: "serp-key",
        config: null,
        secretRef: "secret-ref",
      },
      search: async () => {
        throw new Error("SerpAPI: invalid API key");
      },
    });

    const result = await provider.query({
      query: "news",
      caller: { tenantId: "tenant-1" },
      mode: "results",
      scope: "auto",
      depth: "quick",
      limit: 5,
    });

    expect(result).toEqual({
      hits: [],
      status: {
        state: "error",
        error: "SerpAPI: invalid API key",
        metadata: { provider: "serpapi" },
      },
    });
  });
});
