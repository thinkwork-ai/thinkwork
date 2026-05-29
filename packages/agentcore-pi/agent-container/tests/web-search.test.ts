import { describe, expect, it, vi } from "vitest";

import { buildWebSearchTool } from "../src/runtime/tools/web-search.js";

function parse(result: any): any {
  return JSON.parse((result.content[0] as { text: string }).text);
}

describe("buildWebSearchTool", () => {
  it("returns null when no config object is present", () => {
    expect(
      buildWebSearchTool({ webSearchConfig: null as any }),
    ).toBeNull();
  });

  it("queries Exa and normalizes results", async () => {
    const fetchMock = vi.fn(async (_url: any, _init?: any) => {
      return new Response(
        JSON.stringify({
          results: [
            { title: "Austin Weather", url: "https://example.com/a", text: "Sunny, 88F" },
            { title: "Forecast", url: "https://example.com/b", summary: "Clear skies" },
          ],
        }),
        { status: 200 },
      );
    });
    const tool = buildWebSearchTool({
      webSearchConfig: { provider: "exa", apiKey: "exa-key" },
      fetchImpl: fetchMock as unknown as typeof fetch,
    })!;

    expect(tool.name).toBe("web_search");
    const result = await tool.execute("call-1", { query: "weather in austin" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.exa.ai/search");
    expect((init as any).headers["x-api-key"]).toBe("exa-key");
    expect(JSON.parse((init as any).body)).toMatchObject({
      query: "weather in austin",
      numResults: 5,
    });

    const payload = parse(result);
    expect(payload.ok).toBe(true);
    expect(payload.result_count).toBe(2);
    expect(payload.results[0]).toMatchObject({
      title: "Austin Weather",
      url: "https://example.com/a",
      snippet: "Sunny, 88F",
    });
    expect(payload.results[1].snippet).toBe("Clear skies");
  });

  it("clamps num_results to 1..10 and forwards to the provider", async () => {
    const fetchMock = vi.fn(
      async (_u: unknown, _i?: unknown) => new Response(JSON.stringify({ results: [] }), { status: 200 }),
    );
    const tool = buildWebSearchTool({
      webSearchConfig: { apiKey: "k" },
      fetchImpl: fetchMock as unknown as typeof fetch,
    })!;
    await tool.execute("c", { query: "x", num_results: 99 });
    expect(JSON.parse((fetchMock.mock.calls[0][1] as any).body).numResults).toBe(10);
  });

  it("reports a structured error when no API key is configured", async () => {
    const tool = buildWebSearchTool({ webSearchConfig: { provider: "exa" } })!;
    const result = await tool.execute("c", { query: "x" });
    const payload = parse(result);
    expect(payload.ok).toBe(false);
    expect(payload.error).toMatch(/no API key/i);
  });

  it("surfaces provider failures without throwing", async () => {
    const fetchMock = vi.fn(async (_u: unknown, _i?: unknown) => new Response("boom", { status: 500 }));
    const tool = buildWebSearchTool({
      webSearchConfig: { apiKey: "k" },
      fetchImpl: fetchMock as unknown as typeof fetch,
    })!;
    const result = await tool.execute("c", { query: "x" });
    const payload = parse(result);
    expect(payload.ok).toBe(false);
    expect(payload.error).toMatch(/HTTP 500/);
  });

  it("uses SerpApi GET when provider is serpapi", async () => {
    const fetchMock = vi.fn(
      async (_u: unknown, _i?: unknown) =>
        new Response(
          JSON.stringify({
            organic_results: [
              { title: "T", link: "https://x", snippet: "S" },
            ],
          }),
          { status: 200 },
        ),
    );
    const tool = buildWebSearchTool({
      webSearchConfig: { provider: "serpapi", apiKey: "serp-key" },
      fetchImpl: fetchMock as unknown as typeof fetch,
    })!;
    const result = await tool.execute("c", { query: "hi", num_results: 3 });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("https://serpapi.com/search.json?");
    expect(url).toContain("engine=google");
    expect(url).toContain("api_key=serp-key");
    expect(parse(result).results[0]).toMatchObject({ title: "T", url: "https://x", snippet: "S" });
  });
});
