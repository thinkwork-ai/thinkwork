import type {
  ExtensionAPI,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import { toExtensionFactory } from "../src/define-extension.js";
import { createWebExtractExtension } from "../src/web-extract.js";

function makeFakeApi() {
  const tools: ToolDefinition[] = [];
  const api = {
    registerTool: (tool: ToolDefinition) => {
      tools.push(tool);
    },
    on: vi.fn(),
  } as unknown as ExtensionAPI;
  return { api, tools };
}

function getTool(tools: ToolDefinition[], name: string): ToolDefinition {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not registered`);
  return tool;
}

async function executeWebExtract(
  tool: ToolDefinition,
  params: Record<string, unknown>,
) {
  const result = await tool.execute(
    "call-1",
    params,
    undefined,
    undefined,
    undefined as never,
  );
  const text = (result.content?.[0] as { text: string }).text;
  return { result, body: JSON.parse(text) as Record<string, unknown> };
}

describe("createWebExtractExtension", () => {
  it("does not register web_extract without config", async () => {
    const { api, tools } = makeFakeApi();
    const extension = createWebExtractExtension({});
    await toExtensionFactory(extension, {})(api);

    expect(extension.toolNames).toEqual([]);
    expect(tools).toEqual([]);
  });

  it("registers web_extract and extracts markdown from Firecrawl", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        success: true,
        data: {
          markdown: "# Example Domain\n\nThis domain is for use in examples.",
          metadata: {
            title: "Example Domain",
            sourceURL: "https://example.com/",
          },
        },
      }),
    );
    const { api, tools } = makeFakeApi();
    const extension = createWebExtractExtension({
      webExtractConfig: { provider: "firecrawl", apiKey: "fc-key" },
      fetchImpl,
    });
    await toExtensionFactory(extension, {})(api);

    expect(extension.toolNames).toEqual(["web_extract"]);
    const { body, result } = await executeWebExtract(
      getTool(tools, "web_extract"),
      {
        url: "https://example.com",
        extraction_goal: "Find the title",
      },
    );

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
    expect(body).toMatchObject({
      ok: true,
      provider: "firecrawl",
      url: "https://example.com/",
      title: "Example Domain",
      extraction_goal: "Find the title",
      truncated: false,
    });
    expect(String(body.markdown)).toContain("This domain");
    expect(result.details).toMatchObject({
      ok: true,
      provider: "firecrawl",
      url: "https://example.com/",
      title: "Example Domain",
    });
  });

  it("returns a structured false result when the API key is missing", async () => {
    const fetchImpl = vi.fn();
    const { api, tools } = makeFakeApi();
    await toExtensionFactory(
      createWebExtractExtension({
        webExtractConfig: { provider: "firecrawl" },
        fetchImpl,
      }),
      {},
    )(api);

    const { body } = await executeWebExtract(getTool(tools, "web_extract"), {
      url: "https://example.com",
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(body).toMatchObject({
      ok: false,
      provider: "firecrawl",
      error:
        "Web Extraction is enabled but no Firecrawl API key is configured.",
    });
  });

  it("rejects empty, non-HTTPS, and credential-bearing URLs", async () => {
    const fetchImpl = vi.fn();
    const { api, tools } = makeFakeApi();
    await toExtensionFactory(
      createWebExtractExtension({
        webExtractConfig: { provider: "firecrawl", apiKey: "fc-key" },
        fetchImpl,
      }),
      {},
    )(api);
    const tool = getTool(tools, "web_extract");

    await expect(executeWebExtract(tool, { url: "" })).resolves.toMatchObject({
      body: { ok: false, error: "web_extract requires a non-empty URL." },
    });
    await expect(
      executeWebExtract(tool, { url: "http://example.com" }),
    ).resolves.toMatchObject({
      body: { ok: false, error: "web_extract requires a public HTTPS URL." },
    });
    await expect(
      executeWebExtract(tool, { url: "https://user:pass@example.com" }),
    ).resolves.toMatchObject({
      body: {
        ok: false,
        error: "web_extract URL must not contain credentials.",
      },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("treats Firecrawl success without markdown as extraction failure", async () => {
    const { api, tools } = makeFakeApi();
    await toExtensionFactory(
      createWebExtractExtension({
        webExtractConfig: { provider: "firecrawl", apiKey: "fc-key" },
        fetchImpl: vi.fn(async () =>
          Response.json({ success: true, data: {} }),
        ),
      }),
      {},
    )(api);

    const { body } = await executeWebExtract(getTool(tools, "web_extract"), {
      url: "https://example.com",
    });

    expect(body).toMatchObject({
      ok: false,
      provider: "firecrawl",
      error: "Firecrawl returned no markdown content for this URL.",
    });
  });

  it("truncates long markdown and marks the result", async () => {
    const { api, tools } = makeFakeApi();
    await toExtensionFactory(
      createWebExtractExtension({
        webExtractConfig: { provider: "firecrawl", apiKey: "fc-key" },
        maxMarkdownChars: 1_000,
        fetchImpl: vi.fn(async () =>
          Response.json({
            success: true,
            data: { markdown: "a".repeat(1_500) },
          }),
        ),
      }),
      {},
    )(api);

    const { body, result } = await executeWebExtract(
      getTool(tools, "web_extract"),
      { url: "https://example.com" },
    );

    expect(String(body.markdown)).toHaveLength(1_000);
    expect(body.truncated).toBe(true);
    expect(result.details).toMatchObject({
      truncated: true,
      content_chars: 1_500,
    });
  });

  it("bounds provider failures and redacts the Firecrawl key", async () => {
    const { api, tools } = makeFakeApi();
    await toExtensionFactory(
      createWebExtractExtension({
        webExtractConfig: { provider: "firecrawl", apiKey: "fc-secret" },
        fetchImpl: vi.fn(async () =>
          Response.json(
            { success: false, error: "bad key fc-secret cannot scrape" },
            { status: 401 },
          ),
        ),
      }),
      {},
    )(api);

    const { body, result } = await executeWebExtract(
      getTool(tools, "web_extract"),
      { url: "https://example.com" },
    );

    expect(body).toMatchObject({
      ok: false,
      provider: "firecrawl",
      error: "bad key [redacted] cannot scrape",
    });
    expect(JSON.stringify(body)).not.toContain("fc-secret");
    expect(JSON.stringify(result.details)).not.toContain("fc-secret");
  });
});
