import type {
  ExtensionAPI,
  ExtensionHandler,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type {
  SearchProvider,
  SearchProviderRequest,
} from "@thinkwork/pi-runtime-core";
import { describe, expect, it } from "vitest";

import {
  toExtensionFactory,
  type ProviderBundle,
} from "../src/define-extension.js";
import { createSearchExtension } from "../src/search.js";

function makeFakeApi() {
  const tools: ToolDefinition[] = [];
  const handlers = new Map<string, ExtensionHandler<any, any>>();
  const api = {
    registerTool: (tool: ToolDefinition) => {
      tools.push(tool);
    },
    on: (event: string, handler: ExtensionHandler<any, any>) => {
      handlers.set(event, handler);
    },
  } as unknown as ExtensionAPI;
  return { api, tools, handlers };
}

function makeFakeSearch(
  impl?: (req: SearchProviderRequest) => Promise<{ legs: any[] }>,
) {
  const calls: SearchProviderRequest[] = [];
  const provider: SearchProvider = {
    search: async (request) => {
      calls.push(request);
      if (impl) return impl(request);
      return {
        legs: [
          {
            source: "THREADS",
            status: "OK",
            lines: ["Acme SOW [TH-1]"],
          },
          { source: "ENTITIES", status: "TIMEOUT", lines: [] },
        ],
      };
    },
  };
  return { provider, calls };
}

function getTool(tools: ToolDefinition[], name: string): ToolDefinition {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not registered`);
  return tool;
}

const NO_UPDATE = undefined;
const NO_SIGNAL = undefined;
const NO_CTX = undefined as never;

describe("createSearchExtension", () => {
  it("has a stable kebab-case name and declares the search tool in toolNames", () => {
    const extension = createSearchExtension();
    expect(extension.name).toBe("thinkwork-search");
    // toolNames is the allowlist contract: an omitted name registers but
    // never reaches the model.
    expect(extension.toolNames).toEqual(["search"]);
  });

  it("fails loud at load when the host supplies no search provider", () => {
    const { api } = makeFakeApi();
    const providers: ProviderBundle = {};
    expect(() =>
      toExtensionFactory(createSearchExtension(), providers)(api),
    ).toThrow(/requires a "search" provider/);
  });

  it("registers exactly the search tool", async () => {
    const { provider } = makeFakeSearch();
    const { api, tools } = makeFakeApi();
    await toExtensionFactory(createSearchExtension(), { search: provider })(
      api,
    );
    expect(tools.map((t) => t.name)).toEqual(["search"]);
  });

  it("param schema carries NO tenant/user/thread identity fields", async () => {
    const { provider } = makeFakeSearch();
    const { api, tools } = makeFakeApi();
    await toExtensionFactory(createSearchExtension(), { search: provider })(
      api,
    );

    const schema = getTool(tools, "search").parameters as {
      properties?: Record<string, unknown>;
    };
    const paramNames = Object.keys(schema.properties ?? {});
    expect(paramNames.sort()).toEqual(["limit", "query", "sources"]);
    for (const name of paramNames) {
      expect(name).not.toMatch(/tenant|user|agent|thread|turn|principal/i);
    }
  });

  it("passes the query/sources/limit through to the provider and formats source-tagged legs", async () => {
    const { provider, calls } = makeFakeSearch();
    const { api, tools } = makeFakeApi();
    await toExtensionFactory(createSearchExtension(), { search: provider })(
      api,
    );

    const result = await getTool(tools, "search").execute(
      "call-1",
      { query: "Acme", sources: ["THREADS", "ENTITIES"], limit: 5 },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );

    expect(calls).toEqual([
      { query: "Acme", sources: ["THREADS", "ENTITIES"], limit: 5 },
    ]);
    const text = (result.content?.[0] as { text: string }).text;
    expect(text).toContain("THREADS:");
    expect(text).toContain("Acme SOW [TH-1]");
    // A degraded leg renders as unavailable, not as an empty/OK rail.
    expect(text).toContain("ENTITIES (timeout): unavailable for this query");
  });

  it("degrades to an explicit unavailable result instead of throwing when the provider fails", async () => {
    const { provider } = makeFakeSearch(async () => {
      throw new Error("broker exploded");
    });
    const { api, tools } = makeFakeApi();
    await toExtensionFactory(createSearchExtension(), { search: provider })(
      api,
    );

    const result = await getTool(tools, "search").execute(
      "call-1",
      { query: "Acme" },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );
    const text = (result.content?.[0] as { text: string }).text;
    expect(text).toBe("ThinkWork search is currently unavailable.");
    expect((result.details as { ok?: boolean }).ok).toBe(false);
  });

  it("rejects an empty query without calling the provider", async () => {
    const { provider, calls } = makeFakeSearch();
    const { api, tools } = makeFakeApi();
    await toExtensionFactory(createSearchExtension(), { search: provider })(
      api,
    );

    const result = await getTool(tools, "search").execute(
      "call-1",
      { query: "   " },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );
    expect(calls).toHaveLength(0);
    expect((result.content?.[0] as { text: string }).text).toMatch(
      /non-empty query/,
    );
  });
});
