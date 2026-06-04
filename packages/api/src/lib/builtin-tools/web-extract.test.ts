import { describe, expect, it, vi } from "vitest";

import {
  loadTenantWebExtractConfig,
  runFirecrawlScrape,
} from "./web-extract.js";

function dbWithRows(rows: any[]) {
  return {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(rows),
      }),
    }),
  };
}

describe("tenant Web Extraction built-in tool", () => {
  it("does not resolve Web Extraction config without an enabled row", async () => {
    await expect(
      loadTenantWebExtractConfig("tenant-1", {
        db: dbWithRows([]),
        resolveSecret: async () => "secret",
      }),
    ).resolves.toBeNull();
  });

  it("does not resolve Web Extraction config for disabled or non-Firecrawl rows", async () => {
    await expect(
      loadTenantWebExtractConfig("tenant-1", {
        db: dbWithRows([
          {
            tool_slug: "web-extract",
            provider: "firecrawl",
            enabled: false,
            config: null,
            secret_ref: "secret-ref",
          },
        ]),
        resolveSecret: async () => "secret",
      }),
    ).resolves.toBeNull();

    await expect(
      loadTenantWebExtractConfig("tenant-1", {
        db: dbWithRows([
          {
            tool_slug: "web-extract",
            provider: "exa",
            enabled: true,
            config: null,
            secret_ref: "secret-ref",
          },
        ]),
        resolveSecret: async () => "secret",
      }),
    ).resolves.toBeNull();
  });

  it("does not resolve Web Extraction config when the secret cannot be read", async () => {
    await expect(
      loadTenantWebExtractConfig("tenant-1", {
        db: dbWithRows([
          {
            tool_slug: "web-extract",
            provider: "firecrawl",
            enabled: true,
            config: { onlyMainContent: true },
            secret_ref: "secret-ref",
          },
        ]),
        resolveSecret: async () => null,
      }),
    ).resolves.toBeNull();
  });

  it("resolves enabled Firecrawl config", async () => {
    await expect(
      loadTenantWebExtractConfig("tenant-1", {
        db: dbWithRows([
          {
            tool_slug: "web-extract",
            provider: "firecrawl",
            enabled: true,
            config: { onlyMainContent: true },
            secret_ref: "secret-ref",
          },
        ]),
        resolveSecret: async () => "fc-key",
      }),
    ).resolves.toEqual({
      toolSlug: "web-extract",
      provider: "firecrawl",
      apiKey: "fc-key",
      config: { onlyMainContent: true },
      secretRef: "secret-ref",
    });
  });

  it("runs a Firecrawl scrape request and normalizes markdown metadata", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          markdown: "# Example\n\nReadable content",
          metadata: {
            title: "Example",
            sourceURL: "https://example.com/",
          },
        },
      }),
    })) as unknown as typeof fetch;

    await expect(
      runFirecrawlScrape({
        provider: "firecrawl",
        apiKey: "fc-key",
        url: "https://example.com",
        fetchImpl,
      }),
    ).resolves.toEqual({
      url: "https://example.com/",
      title: "Example",
      markdown: "# Example\n\nReadable content",
      metadata: {
        title: "Example",
        sourceURL: "https://example.com/",
      },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.firecrawl.dev/v2/scrape",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer fc-key",
        }),
        body: JSON.stringify({
          url: "https://example.com/",
          formats: ["markdown"],
          onlyMainContent: true,
        }),
      }),
    );
  });

  it("returns bounded redacted failures for non-2xx Firecrawl responses", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({
        success: false,
        error: "bad key fc-secret-key should not leak",
      }),
    })) as unknown as typeof fetch;

    await expect(
      runFirecrawlScrape({
        provider: "firecrawl",
        apiKey: "fc-secret-key",
        url: "https://example.com",
        fetchImpl,
      }),
    ).rejects.toThrow("bad key [redacted] should not leak");
  });

  it("rejects non-HTTPS or credential-bearing URLs before calling Firecrawl", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    await expect(
      runFirecrawlScrape({
        provider: "firecrawl",
        apiKey: "fc-key",
        url: "http://example.com",
        fetchImpl,
      }),
    ).rejects.toThrow("url must use https");
    await expect(
      runFirecrawlScrape({
        provider: "firecrawl",
        apiKey: "fc-key",
        url: "https://user:pass@example.com",
        fetchImpl,
      }),
    ).rejects.toThrow("url must not contain credentials");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
