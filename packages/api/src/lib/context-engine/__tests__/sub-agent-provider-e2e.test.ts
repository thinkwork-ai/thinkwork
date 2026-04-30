import { describe, expect, it } from "vitest";
import { createContextEngineRouter } from "../router.js";
import { createSubAgentContextProvider } from "../providers/sub-agent-base.js";
import {
  createWikiSourceAgentContextProvider,
  planWikiSourceAgentQueries,
} from "../providers/wiki-source-agent.js";

describe("Context Engine sub-agent provider E2E seam", () => {
  it("routes an explicit sub-agent provider through its live seam and returns normalized hits", async () => {
    const seen: Array<{ query: string; providerId: string }> = [];
    const provider = createSubAgentContextProvider({
      id: "scout-style-source",
      displayName: "Scout-style Source Agent",
      promptRef: "brain/provider/scout-style-source",
      toolAllowlist: ["source.read"],
      depthCap: 2,
      defaultEnabled: false,
      seamState: "live",
      seam: async (request, config) => {
        seen.push({ query: request.query, providerId: config.id });
        return {
          state: "ok",
          freshness: {
            asOf: "2026-04-30T00:00:00.000Z",
            ttlSeconds: 300,
          },
          hits: [
            {
              id: "source:paris-restaurant",
              providerId: config.id,
              family: "sub-agent",
              title: "Paris restaurant source answer",
              snippet:
                "The source agent navigated its allowed tool surface and returned a cited result.",
              score: 0.99,
              scope: request.scope,
              provenance: {
                label: config.displayName,
                sourceId: "source:paris-restaurant",
                metadata: {
                  promptRef: config.promptRef,
                  tools: config.toolAllowlist,
                },
              },
            },
          ],
        };
      },
    });

    const router = createContextEngineRouter({ providers: [provider] });
    const result = await router.query({
      query: "favorite restaurant in paris",
      providers: { ids: ["scout-style-source"] },
      caller: { tenantId: "tenant-1", userId: "user-1" },
    });

    expect(seen).toEqual([
      {
        query: "favorite restaurant in paris",
        providerId: "scout-style-source",
      },
    ]);
    expect(result.hits).toEqual([
      expect.objectContaining({
        id: "source:paris-restaurant",
        providerId: "scout-style-source",
        family: "sub-agent",
        rank: 1,
      }),
    ]);
    expect(result.providers).toEqual([
      expect.objectContaining({
        providerId: "scout-style-source",
        family: "sub-agent",
        state: "ok",
        hitCount: 1,
        freshness: {
          asOf: "2026-04-30T00:00:00.000Z",
          ttlSeconds: 300,
        },
      }),
    ]);
    expect(provider.subAgent).toMatchObject({
      seamState: "live",
      processModel: "deterministic-retrieval",
      toolAllowlist: ["source.read"],
    });
  });

  it("plans multiple wiki navigation paths instead of issuing one top-k search", () => {
    expect(planWikiSourceAgentQueries("favorite restarant in Paris")).toEqual([
      {
        query: "favorite restarant in Paris",
        purpose: "original",
      },
      {
        query: "favorite restaurant in Paris",
        purpose: "repaired",
        repairs: [{ from: "restarant", to: "restaurant" }],
      },
      {
        query: "favorite restaurant paris",
        purpose: "focused",
      },
    ]);
  });

	it("runs the Company Brain page agent through the wiki retrieval seam", async () => {
		const seen: Array<{ tenantId: string; userId: string; query: string }> = [];
		const provider = createWikiSourceAgentContextProvider({
			runtimeMode: "deterministic",
			search: async (args) => {
				seen.push({
          tenantId: args.tenantId,
          userId: args.userId,
          query: args.query,
        });
        return [
          {
            score: 0.9,
            matchedAlias: null,
            page: {
              id: "page-auberge-bressane",
              tenantId: args.tenantId,
              userId: args.userId,
              ownerId: args.userId,
              type: "ENTITY",
              slug: "auberge-bressane",
              title: "Auberge Bressane",
              summary: "Paris restaurant known for souffle.",
              bodyMd: "Auberge Bressane is a favorite restaurant in Paris.",
              status: "ACTIVE",
              aliases: [],
              sections: [],
              lastCompiledAt: null,
              createdAt: "2026-04-30T00:00:00.000Z",
              updatedAt: "2026-04-30T00:00:00.000Z",
            },
          },
        ];
      },
    });

    const router = createContextEngineRouter({ providers: [provider] });
    const result = await router.query({
      query: "favorite restarant in Paris",
      providers: { ids: ["wiki-source-agent"] },
      caller: { tenantId: "tenant-1", userId: "user-1" },
    });

    expect(seen).toEqual([
      {
        tenantId: "tenant-1",
        userId: "user-1",
        query: "favorite restarant in Paris",
      },
      {
        tenantId: "tenant-1",
        userId: "user-1",
        query: "favorite restaurant in Paris",
      },
      {
        tenantId: "tenant-1",
        userId: "user-1",
        query: "favorite restaurant paris",
      },
    ]);
    expect(result.hits).toEqual([
      expect.objectContaining({
        id: "wiki-agent:page-auberge-bressane",
        providerId: "wiki-source-agent",
        family: "wiki",
        title: "Auberge Bressane",
        provenance: expect.objectContaining({
          metadata: expect.objectContaining({
            retrievalStrategy: "agentic-hybrid-wiki-navigation",
            sourceQuery: "favorite restaurant in Paris",
            sourceQueryPurpose: "repaired",
            toolAllowlist: [
              "company-brain.pages.search",
              "company-brain.pages.read",
            ],
          }),
        }),
        metadata: expect.objectContaining({
          sourceAgent: expect.objectContaining({
            retrievalStrategy: "agentic-hybrid-wiki-navigation",
            processModel: "deterministic-retrieval",
            inspectedPageCount: 1,
            plan: [
              { query: "favorite restarant in Paris", purpose: "original" },
              {
                query: "favorite restaurant in Paris",
                purpose: "repaired",
                repairs: [{ from: "restarant", to: "restaurant" }],
              },
              { query: "favorite restaurant paris", purpose: "focused" },
            ],
          }),
        }),
      }),
    ]);
    expect(result.providers).toEqual([
      expect.objectContaining({
        providerId: "wiki-source-agent",
        family: "sub-agent",
        state: "ok",
        hitCount: 1,
        reason: "searched 3 query paths; inspected 1 compiled page",
      }),
    ]);
    expect(provider.subAgent).toMatchObject({
      seamState: "live",
      processModel: "deterministic-retrieval",
      promptRef: "brain/provider/wiki-source-agent",
      toolAllowlist: [
        "company-brain.pages.search",
        "company-brain.pages.read",
      ],
    });
  });

  it("runs the Company Brain page agent as a model-backed source-agent loop with cited pages", async () => {
    const seen: Array<{ tenantId: string; userId: string; query: string }> = [];
    const modelTurns = [
      JSON.stringify({
        tool_calls: [
          {
            id: "search-1",
            tool: "company-brain.pages.search",
            input: { query: "favorite restaurant in Paris", limit: 5 },
          },
        ],
      }),
      JSON.stringify({
        final: {
          answer: "Auberge Bressane is the cited page.",
          results: [
            {
              page_id: "page-auberge-bressane",
              title: "Auberge Bressane",
              summary:
                "Compiled page says Auberge Bressane is a favorite restaurant in Paris.",
              confidence: 0.94,
              source_tool_call_ids: ["search-1"],
            },
          ],
        },
      }),
    ];
    const provider = createWikiSourceAgentContextProvider({
      runtimeMode: "model",
      model: async () => ({
        text: modelTurns.shift() ?? "{}",
        modelId: "test-source-agent-model",
        inputTokens: 20,
        outputTokens: 10,
        stopReason: "end_turn",
      }),
      search: async (args) => {
        seen.push({
          tenantId: args.tenantId,
          userId: args.userId,
          query: args.query,
        });
        return [
          {
            score: 0.9,
            matchedAlias: null,
            page: {
              id: "page-auberge-bressane",
              tenantId: args.tenantId,
              userId: args.userId,
              ownerId: args.userId,
              type: "ENTITY",
              slug: "auberge-bressane",
              title: "Auberge Bressane",
              summary: "Paris restaurant known for souffle.",
              bodyMd: "Auberge Bressane is a favorite restaurant in Paris.",
              status: "ACTIVE",
              aliases: [],
              sections: [],
              lastCompiledAt: null,
              createdAt: "2026-04-30T00:00:00.000Z",
              updatedAt: "2026-04-30T00:00:00.000Z",
            },
          },
        ];
      },
    });

    const router = createContextEngineRouter({ providers: [provider] });
    const result = await router.query({
      query: "favorite restarant in Paris",
      providers: { ids: ["wiki-source-agent"] },
      caller: { tenantId: "tenant-1", userId: "user-1" },
    });

    expect(seen).toEqual([
      {
        tenantId: "tenant-1",
        userId: "user-1",
        query: "favorite restaurant in Paris",
      },
    ]);
    expect(result.hits).toEqual([
      expect.objectContaining({
        id: "wiki-agent:page-auberge-bressane",
        providerId: "wiki-source-agent",
        family: "wiki",
        title: "Auberge Bressane",
        snippet:
          "Compiled page says Auberge Bressane is a favorite restaurant in Paris.",
        provenance: expect.objectContaining({
          metadata: expect.objectContaining({
            retrievalStrategy: "source-agent-tool-loop",
            sourceToolCallIds: ["search-1"],
          }),
        }),
        metadata: expect.objectContaining({
          sourceAgent: expect.objectContaining({
            processModel: "lambda-bedrock-converse",
            retrievalStrategy: "source-agent-tool-loop",
            toolCallCount: 1,
            observedSourceIds: ["page-auberge-bressane"],
          }),
        }),
      }),
    ]);
    expect(result.providers).toEqual([
      expect.objectContaining({
        providerId: "wiki-source-agent",
        family: "sub-agent",
        state: "ok",
        hitCount: 1,
        reason:
          "source agent ran 2 model turns, 1 tool call; cited 1 compiled page",
        metadata: expect.objectContaining({
          sourceAgent: expect.objectContaining({
            processModel: "lambda-bedrock-converse",
            toolCallCount: 1,
            trace: expect.arrayContaining([
              expect.objectContaining({ type: "model", status: "ok" }),
              expect.objectContaining({
                type: "tool",
                status: "ok",
                tool: "company-brain.pages.search",
              }),
              expect.objectContaining({ type: "final", status: "ok" }),
            ]),
          }),
        }),
      }),
    ]);
    expect(provider.subAgent).toMatchObject({
      seamState: "live",
      processModel: "lambda-bedrock-converse",
      promptRef: "brain/provider/wiki-source-agent",
      toolAllowlist: [
        "company-brain.pages.search",
        "company-brain.pages.read",
      ],
    });
  });
});
