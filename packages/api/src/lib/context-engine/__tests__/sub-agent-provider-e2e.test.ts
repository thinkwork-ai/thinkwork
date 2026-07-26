import { describe, expect, it } from "vitest";
import { createContextEngineRouter } from "../router.js";
import { createSubAgentContextProvider } from "../providers/sub-agent-base.js";

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
});
