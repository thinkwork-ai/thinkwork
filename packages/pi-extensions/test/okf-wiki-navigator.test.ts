import type {
  ExtensionAPI,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type {
  OkfWikiNavigatorLinksRequest,
  OkfWikiNavigatorListRequest,
  OkfWikiNavigatorProvider,
  OkfWikiNavigatorReadRequest,
  OkfWikiNavigatorSearchRequest,
} from "@thinkwork/pi-runtime-core";
import { describe, expect, it, vi } from "vitest";

import { toExtensionFactory } from "../src/define-extension.js";
import {
  createOkfWikiNavigatorExtension,
  OKF_WIKI_NAVIGATOR_TOOL_NAMES,
} from "../src/okf-wiki-navigator.js";

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

function makeFakeProvider() {
  const calls = {
    list: [] as OkfWikiNavigatorListRequest[],
    search: [] as OkfWikiNavigatorSearchRequest[],
    read: [] as OkfWikiNavigatorReadRequest[],
    links: [] as OkfWikiNavigatorLinksRequest[],
  };
  const provider: OkfWikiNavigatorProvider = {
    list: async (request = {}) => {
      calls.list.push(request);
      return {
        entries: [
          {
            path: "topics/memory.md",
            kind: "file",
            title: "Memory",
            sizeBytes: 128,
          },
        ],
        bounds: {
          maxResults: 25,
          maxBytes: 64_000,
          maxDepth: 4,
          truncated: false,
        },
      };
    },
    search: async (request) => {
      calls.search.push(request);
      return {
        entries: [
          {
            path: "topics/memory.md",
            line: 7,
            snippet: "Compiled memory wiki context.",
            title: "Memory",
          },
        ],
        bounds: {
          maxResults: 25,
          maxBytes: 64_000,
          maxDepth: 4,
          truncated: false,
        },
      };
    },
    read: async (request) => {
      calls.read.push(request);
      return {
        path: request.path,
        content: "# Memory\n\nCompiled memory wiki context.",
        offsetBytes: request.offsetBytes ?? 0,
        bytesRead: 40,
        truncated: false,
        redaction: {
          source: "okf_navigator",
          policy: "cite_or_summarize_only",
        },
      };
    },
    links: async (request) => {
      calls.links.push(request);
      return {
        path: request.path,
        links: [{ path: "decisions/wiki-shape.md", label: "wiki shape" }],
        backlinks: request.includeBacklinks
          ? [{ path: "entities/company-brain.md", title: "Company Brain" }]
          : [],
        bounds: {
          maxResults: 25,
          maxBytes: 64_000,
          maxDepth: 4,
          truncated: false,
        },
      };
    },
  };
  return { provider, calls };
}

const NO_SIGNAL = undefined;
const NO_UPDATE = undefined;
const NO_CTX = undefined as never;

describe("createOkfWikiNavigatorExtension", () => {
  it("declares and registers the four OKF wiki traversal tools", async () => {
    const { provider } = makeFakeProvider();
    const { api, tools } = makeFakeApi();
    const extension = createOkfWikiNavigatorExtension();

    expect(extension.name).toBe("thinkwork-okf-wiki-navigator");
    expect(extension.toolNames).toEqual(OKF_WIKI_NAVIGATOR_TOOL_NAMES);

    await toExtensionFactory(extension, { okfWiki: provider })(api);

    expect(tools.map((tool) => tool.name)).toEqual([
      "wiki_ls",
      "wiki_rg",
      "wiki_read",
      "wiki_links",
    ]);
  });

  it("fails loud at load when the host supplies no OKF wiki provider", () => {
    const { api } = makeFakeApi();
    expect(() =>
      toExtensionFactory(createOkfWikiNavigatorExtension(), {})(api),
    ).toThrow(/requires a "okfWiki" provider/);
  });

  it("keeps tool parameter schemas free of tenant, root, backend, and write fields", async () => {
    const { provider } = makeFakeProvider();
    const { api, tools } = makeFakeApi();
    await toExtensionFactory(createOkfWikiNavigatorExtension(), {
      okfWiki: provider,
    })(api);

    for (const tool of tools) {
      const schema = tool.parameters as {
        properties?: Record<string, unknown>;
      };
      const paramNames = Object.keys(schema.properties ?? {});
      expect(paramNames.join(" ")).not.toMatch(
        /tenant|user|agent|thread|root|s3|bucket|backend|write|delete/i,
      );
    }
  });

  it("lists, searches, reads, and follows links through the host provider", async () => {
    const { provider, calls } = makeFakeProvider();
    const { api, tools } = makeFakeApi();
    await toExtensionFactory(createOkfWikiNavigatorExtension(), {
      okfWiki: provider,
    })(api);

    const list = await getTool(tools, "wiki_ls").execute(
      "call-1",
      { path: "topics", maxDepth: 2 },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );
    expect((list.content?.[0] as { text: string }).text).toContain(
      "topics/memory.md",
    );
    expect((list.details as any).okfWikiTrace.surface).toBe("okf_efs");

    const search = await getTool(tools, "wiki_rg").execute(
      "call-2",
      { query: "memory", path: "topics" },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );
    expect((search.content?.[0] as { text: string }).text).toContain(
      "topics/memory.md:7",
    );

    const read = await getTool(tools, "wiki_read").execute(
      "call-3",
      { path: "topics/memory.md", maxBytes: 1000 },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );
    const readText = (read.content?.[0] as { text: string }).text;
    expect(readText).toContain("Source: topics/memory.md");
    expect(readText).toContain("untrusted source data");

    const links = await getTool(tools, "wiki_links").execute(
      "call-4",
      { path: "topics/memory.md", includeBacklinks: true },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );
    expect((links.content?.[0] as { text: string }).text).toContain(
      "decisions/wiki-shape.md",
    );

    expect(calls.list).toHaveLength(1);
    expect(calls.list[0]).toMatchObject({ path: "topics", maxDepth: 2 });
    expect(calls.search).toHaveLength(1);
    expect(calls.search[0]).toMatchObject({
      query: "memory",
      path: "topics",
    });
    expect(calls.read).toHaveLength(1);
    expect(calls.read[0]).toMatchObject({
      path: "topics/memory.md",
      maxBytes: 1000,
    });
    expect(calls.links).toHaveLength(1);
    expect(calls.links[0]).toMatchObject({
      path: "topics/memory.md",
      includeBacklinks: true,
    });
  });

  it("rejects empty required fields before calling the provider", async () => {
    const { provider, calls } = makeFakeProvider();
    const { api, tools } = makeFakeApi();
    await toExtensionFactory(createOkfWikiNavigatorExtension(), {
      okfWiki: provider,
    })(api);

    const search = await getTool(tools, "wiki_rg").execute(
      "call-1",
      { query: "   " },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );
    const read = await getTool(tools, "wiki_read").execute(
      "call-2",
      { path: "" },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );
    const links = await getTool(tools, "wiki_links").execute(
      "call-3",
      { path: "   " },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );

    expect((search.content?.[0] as { text: string }).text).toMatch(
      /non-empty query/,
    );
    expect((read.content?.[0] as { text: string }).text).toMatch(
      /non-empty path/,
    );
    expect((links.content?.[0] as { text: string }).text).toMatch(
      /non-empty path/,
    );
    expect(calls.search).toHaveLength(0);
    expect(calls.read).toHaveLength(0);
    expect(calls.links).toHaveLength(0);
  });

  it("degrades provider failures to an explicit unavailable tool result", async () => {
    const errors: Array<{ phase: string }> = [];
    const provider: OkfWikiNavigatorProvider = {
      list: async () => {
        throw Object.assign(new Error("mount missing"), {
          code: "not_available",
        });
      },
      search: async () => {
        throw new Error("unused");
      },
      read: async () => {
        throw new Error("unused");
      },
      links: async () => {
        throw new Error("unused");
      },
    };
    const { api, tools } = makeFakeApi();
    await toExtensionFactory(
      createOkfWikiNavigatorExtension({
        onError: (_error, context) => errors.push(context),
      }),
      { okfWiki: provider },
    )(api);

    const result = await getTool(tools, "wiki_ls").execute(
      "call-1",
      {},
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );

    const text = (result.content?.[0] as { text: string }).text;
    expect(text).toContain("OKF wiki navigator is currently unavailable.");
    expect(text).toContain("not_available");
    expect(errors).toEqual([{ phase: "wiki_ls" }]);
  });
});
