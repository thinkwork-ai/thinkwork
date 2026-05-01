import { describe, expect, it, vi } from "vitest";

import {
  buildWebSearchEnvOverrides,
  loadTenantBuiltinTools,
  loadTenantWebSearchConfig,
  runWebSearch,
} from "./web-search.js";

function dbWithRows(rows: any[]) {
  return {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(rows),
      }),
    }),
  };
}

describe("tenant Web Search built-in tools", () => {
  it("does not resolve Web Search config without an enabled row", async () => {
    await expect(
      loadTenantWebSearchConfig("tenant-1", {
        db: dbWithRows([]),
        resolveSecret: async () => "secret",
      }),
    ).resolves.toBeNull();
  });

  it("does not resolve Web Search config when the secret cannot be read", async () => {
    await expect(
      loadTenantWebSearchConfig("tenant-1", {
        db: dbWithRows([
          {
            tool_slug: "web-search",
            provider: "exa",
            enabled: true,
            config: { numResults: 3 },
            secret_ref: "secret-ref",
          },
        ]),
        resolveSecret: async () => null,
      }),
    ).resolves.toBeNull();
  });

  it("resolves enabled Exa config and keeps runtime env override behavior", async () => {
    const config = await loadTenantWebSearchConfig("tenant-1", {
      db: dbWithRows([
        {
          tool_slug: "web-search",
          provider: "exa",
          enabled: true,
          config: { numResults: 3 },
          secret_ref: "secret-ref",
        },
      ]),
      resolveSecret: async () => "exa-key",
    });

    expect(config).toEqual({
      toolSlug: "web-search",
      provider: "exa",
      apiKey: "exa-key",
      config: { numResults: 3 },
      secretRef: "secret-ref",
    });
    expect(buildWebSearchEnvOverrides(config!)).toEqual({
      WEB_SEARCH_PROVIDER: "exa",
      EXA_API_KEY: "exa-key",
    });
  });

  it("preserves loadTenantBuiltinTools runtime injection output", async () => {
    await expect(
      loadTenantBuiltinTools("tenant-1", {
        db: dbWithRows([
          {
            tool_slug: "web-search",
            provider: "serpapi",
            enabled: true,
            config: null,
            secret_ref: "secret-ref",
          },
        ]),
        resolveSecret: async () => "serp-key",
      }),
    ).resolves.toEqual([
      {
        toolSlug: "web-search",
        provider: "serpapi",
        envOverrides: {
          WEB_SEARCH_PROVIDER: "serpapi",
          SERPAPI_KEY: "serp-key",
        },
      },
    ]);
  });

  it("normalizes Exa results with URL citations", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        results: [
          {
            id: "exa-1",
            title: "Launch notes",
            url: "https://example.com/launch",
            text: "Public launch detail",
            score: 0.8,
          },
        ],
      }),
    })) as unknown as typeof fetch;

    await expect(
      runWebSearch({
        provider: "exa",
        apiKey: "exa-key",
        query: "launch",
        limit: 5,
        fetchImpl,
      }),
    ).resolves.toEqual([
      {
        id: "exa-1",
        title: "Launch notes",
        url: "https://example.com/launch",
        snippet: "Public launch detail",
        score: 0.8,
        raw: expect.any(Object),
      },
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.exa.ai/search",
      expect.objectContaining({
        body: JSON.stringify({
          query: "launch",
          numResults: 5,
          contents: { text: true },
        }),
      }),
    );
  });

  it("normalizes SerpAPI organic results with URL citations", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        organic_results: [
          {
            position: 2,
            title: "Roadmap",
            link: "https://example.com/roadmap",
            snippet: "Public roadmap detail",
          },
        ],
      }),
    })) as unknown as typeof fetch;

    await expect(
      runWebSearch({
        provider: "serpapi",
        apiKey: "serp-key",
        query: "roadmap",
        limit: 5,
        fetchImpl,
      }),
    ).resolves.toEqual([
      {
        id: "2",
        title: "Roadmap",
        url: "https://example.com/roadmap",
        snippet: "Public roadmap detail",
        score: 0.5,
        raw: expect.any(Object),
      },
    ]);
  });
});
