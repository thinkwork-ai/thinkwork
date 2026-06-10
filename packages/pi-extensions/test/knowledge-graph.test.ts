import type {
  ExtensionAPI,
  ExtensionHandler,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type {
  KnowledgeGraphProvider,
  KnowledgeGraphSearchRequest,
} from "@thinkwork/pi-runtime-core";
import { describe, expect, it } from "vitest";

import {
  toExtensionFactory,
  type ProviderBundle,
} from "../src/define-extension.js";
import { createKnowledgeGraphExtension } from "../src/knowledge-graph.js";
import { createMemoryExtension } from "../src/memory.js";

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

/**
 * Fake KnowledgeGraphProvider recording calls — the ONLY graph seam the
 * extension may touch (it must never construct a GraphQL/HTTP client of its
 * own; identity is closed over in the host-supplied provider).
 */
function makeFakeGraph() {
  const searchCalls: KnowledgeGraphSearchRequest[] = [];
  const provider: KnowledgeGraphProvider = {
    search: async (request) => {
      searchCalls.push(request);
      return {
        entities: [
          {
            id: "e1",
            label: "Acme Corp",
            typeSlug: "company",
            summary: "Key customer account.",
            aliases: ["Acme"],
            relationshipCount: 2,
            evidenceCount: 3,
            observationIds: ["obs-1", "obs-2"],
          },
          {
            id: "e2",
            label: "Project Phoenix",
            typeSlug: "project",
            summary: null,
            aliases: [],
            relationshipCount: 1,
            evidenceCount: 1,
            observationIds: ["obs-3"],
          },
        ],
        relationships: [
          {
            id: "r1",
            label: "serves",
            typeSlug: "serves",
            fromLabel: "Acme Corp",
            toLabel: "Project Phoenix",
          },
        ],
      };
    },
  };
  return { provider, searchCalls };
}

function getTool(tools: ToolDefinition[], name: string): ToolDefinition {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not registered`);
  return tool;
}

const NO_UPDATE = undefined;
const NO_SIGNAL = undefined;
const NO_CTX = undefined as never;

describe("createKnowledgeGraphExtension", () => {
  it("has a stable kebab-case name and declares its tool in toolNames", () => {
    const extension = createKnowledgeGraphExtension();
    expect(extension.name).toBe("thinkwork-knowledge-graph");
    expect(extension.toolNames).toEqual(["knowledge_graph_search"]);
  });

  it("fails loud at load when the host supplies no knowledgeGraph provider", () => {
    const { api } = makeFakeApi();
    const providers: ProviderBundle = {};
    expect(() =>
      toExtensionFactory(createKnowledgeGraphExtension(), providers)(api),
    ).toThrow(/requires a "knowledgeGraph" provider/);
  });

  it("registers the knowledge_graph_search tool", async () => {
    const { provider } = makeFakeGraph();
    const { api, tools } = makeFakeApi();
    await toExtensionFactory(createKnowledgeGraphExtension(), {
      knowledgeGraph: provider,
    })(api);
    expect(tools.map((t) => t.name)).toEqual(["knowledge_graph_search"]);
  });

  it("param schema carries NO tenant/user/thread identity fields (R15)", async () => {
    const { provider } = makeFakeGraph();
    const { api, tools } = makeFakeApi();
    await toExtensionFactory(createKnowledgeGraphExtension(), {
      knowledgeGraph: provider,
    })(api);

    const schema = getTool(tools, "knowledge_graph_search").parameters as {
      properties?: Record<string, unknown>;
    };
    const paramNames = Object.keys(schema.properties ?? {});
    expect(paramNames.sort()).toEqual(["limit", "query"]);
    for (const name of paramNames) {
      expect(name).not.toMatch(/tenant|user|agent|thread|turn|principal/i);
    }
  });

  it("formats entities with type, summary, and supporting-observation counts", async () => {
    const { provider, searchCalls } = makeFakeGraph();
    const { api, tools } = makeFakeApi();
    await toExtensionFactory(createKnowledgeGraphExtension(), {
      knowledgeGraph: provider,
    })(api);

    const result = await getTool(tools, "knowledge_graph_search").execute(
      "call-1",
      { query: "Acme", limit: 5 },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );

    expect(searchCalls).toEqual([{ query: "Acme", limit: 5 }]);
    const text = (result.content?.[0] as { text: string }).text;
    expect(text).toContain(
      "1. Acme Corp (company) (aka: Acme) — Key customer account. [2 relationships, 2 supporting observations]",
    );
    expect(text).toContain("Acme Corp —[serves]→ Project Phoenix");
    // No raw observation/evidence text leaks into the tool result.
    expect(text).not.toMatch(/snippet/i);
  });

  it("returns an explicit no-match message for an empty result", async () => {
    const provider: KnowledgeGraphProvider = {
      search: async () => ({ entities: [], relationships: [] }),
    };
    const { api, tools } = makeFakeApi();
    await toExtensionFactory(createKnowledgeGraphExtension(), {
      knowledgeGraph: provider,
    })(api);

    const result = await getTool(tools, "knowledge_graph_search").execute(
      "call-2",
      { query: "nothing" },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );
    const text = (result.content?.[0] as { text: string }).text;
    expect(text).toBe("No matching entities in the knowledge graph.");
  });

  it("provider failure returns the explicit unavailable result — never throws mid-turn", async () => {
    const errors: Array<{ phase: string }> = [];
    const provider: KnowledgeGraphProvider = {
      search: async () => {
        throw new Error("backend down");
      },
    };
    const { api, tools } = makeFakeApi();
    await toExtensionFactory(
      createKnowledgeGraphExtension({
        onError: (_error, context) => errors.push(context),
      }),
      { knowledgeGraph: provider },
    )(api);

    const result = await getTool(tools, "knowledge_graph_search").execute(
      "call-3",
      { query: "Acme" },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );

    const text = (result.content?.[0] as { text: string }).text;
    expect(text).toBe("Knowledge graph is currently unavailable.");
    expect(errors).toEqual([{ phase: "knowledge_graph_search" }]);
  });

  it("an empty query returns a usage hint instead of throwing", async () => {
    const { provider, searchCalls } = makeFakeGraph();
    const { api, tools } = makeFakeApi();
    await toExtensionFactory(createKnowledgeGraphExtension(), {
      knowledgeGraph: provider,
    })(api);

    const result = await getTool(tools, "knowledge_graph_search").execute(
      "call-4",
      { query: "   " },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );
    const text = (result.content?.[0] as { text: string }).text;
    expect(text).toMatch(/non-empty query/);
    expect(searchCalls).toHaveLength(0);
  });

  it("docstring positions the graph against the user's episodic recall/reflect memory", async () => {
    const { provider } = makeFakeGraph();
    const { api, tools } = makeFakeApi();
    await toExtensionFactory(createKnowledgeGraphExtension(), {
      knowledgeGraph: provider,
    })(api);
    const description = getTool(tools, "knowledge_graph_search").description;
    expect(description).toMatch(/shared knowledge graph/i);
    expect(description).toMatch(/recall/);
    expect(description).toMatch(/reflect/);
  });
});

describe("memory docstring pair stays maintained alongside the graph tool", () => {
  it("recall + reflect both reference knowledge_graph_search and keep the chain contract", async () => {
    const provider = {
      recall: async () => ({ memories: [] }),
      reflect: async () => ({ ok: true }),
    };
    const { api, tools } = makeFakeApi();
    await toExtensionFactory(createMemoryExtension(), { memory: provider })(
      api,
    );

    const recall = getTool(tools, "recall").description;
    const reflect = getTool(tools, "reflect").description;
    expect(recall).toContain("knowledge_graph_search");
    expect(reflect).toContain("knowledge_graph_search");
    // The load-bearing chain contract survives the docstring edit.
    expect(recall).toMatch(/REQUIRED FOLLOW-UP/);
    expect(reflect).toMatch(/AFTER `recall`/);
  });
});
