import { describe, expect, it } from "vitest";
import { createContextEngineRouter } from "../router.js";
import { createSubAgentContextProvider } from "../providers/sub-agent-base.js";
import { createWikiSourceAgentContextProvider } from "../providers/wiki-source-agent.js";

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
      processModel: "lambda-bedrock-converse",
      toolAllowlist: ["source.read"],
    });
  });

  it("runs the Company Brain page agent through the wiki retrieval seam", async () => {
    const seen: Array<{ tenantId: string; userId: string; query: string }> = [];
    const provider = createWikiSourceAgentContextProvider({
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
    ]);
    expect(result.hits).toEqual([
      expect.objectContaining({
        id: "wiki-agent:page-auberge-bressane",
        providerId: "wiki-source-agent",
        family: "wiki",
        title: "Auberge Bressane",
        provenance: expect.objectContaining({
          metadata: expect.objectContaining({
            retrievalStrategy: "hybrid-lexical",
            toolAllowlist: [
              "company-brain.pages.search",
              "company-brain.pages.read",
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
      }),
    ]);
    expect(provider.subAgent).toMatchObject({
      seamState: "live",
      promptRef: "brain/provider/wiki-source-agent",
      toolAllowlist: [
        "company-brain.pages.search",
        "company-brain.pages.read",
      ],
    });
  });
});
