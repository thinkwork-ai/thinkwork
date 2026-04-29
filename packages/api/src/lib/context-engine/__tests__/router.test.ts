import { describe, expect, it } from "vitest";
import { createContextEngineRouter } from "../router.js";
import type { ContextProviderDescriptor } from "../types.js";

function provider(
  overrides: Partial<ContextProviderDescriptor> & {
    id: string;
    family: ContextProviderDescriptor["family"];
  },
): ContextProviderDescriptor {
  return {
    displayName: overrides.id,
    defaultEnabled: true,
    query: async () => ({
      hits: [
        {
          id: `${overrides.id}:1`,
          providerId: overrides.id,
          family: overrides.family,
          title: `${overrides.id} hit`,
          snippet: "snippet",
          score: 0.5,
          scope: "auto",
          provenance: { sourceId: `${overrides.id}:1` },
        },
      ],
    }),
    ...overrides,
  };
}

describe("Context Engine router", () => {
  it("queries default providers and returns a stable response envelope", async () => {
    const router = createContextEngineRouter({
      providers: [
        provider({ id: "memory", family: "memory" }),
        provider({ id: "wiki", family: "wiki" }),
      ],
    });

    const result = await router.query({
      query: "Austin",
      caller: { tenantId: "tenant-1", userId: "user-1" },
    });

    expect(result).toMatchObject({
      query: "Austin",
      mode: "results",
      scope: "auto",
      depth: "quick",
    });
    expect(result.hits).toHaveLength(2);
    expect(result.providers.map((status) => status.state)).toEqual([
      "ok",
      "ok",
    ]);
  });

  it("selects providers by family", async () => {
    const router = createContextEngineRouter({
      providers: [
        provider({ id: "memory", family: "memory" }),
        provider({ id: "wiki", family: "wiki" }),
      ],
    });

    const result = await router.query({
      query: "roadmap",
      providers: { families: ["wiki"] },
      caller: { tenantId: "tenant-1", userId: "user-1" },
    });

    expect(result.providers.map((status) => status.providerId)).toEqual([
      "wiki",
    ]);
    expect(result.hits[0]?.providerId).toBe("wiki");
  });

  it("skips default-disabled providers unless explicitly selected", async () => {
    const router = createContextEngineRouter({
      providers: [
        provider({ id: "memory", family: "memory", defaultEnabled: false }),
        provider({ id: "wiki", family: "wiki" }),
      ],
    });

    const defaultResult = await router.query({
      query: "roadmap",
      caller: { tenantId: "tenant-1", userId: "user-1" },
    });
    expect(defaultResult.providers.map((status) => status.providerId)).toEqual([
      "wiki",
    ]);

    const memoryResult = await router.query({
      query: "roadmap",
      providers: { families: ["memory"] },
      caller: { tenantId: "tenant-1", userId: "user-1" },
    });
    expect(memoryResult.providers.map((status) => status.providerId)).toEqual([
      "memory",
    ]);
  });

  it("rejects empty queries before invoking providers", async () => {
    let called = false;
    const router = createContextEngineRouter({
      providers: [
        provider({
          id: "memory",
          family: "memory",
          query: async () => {
            called = true;
            return { hits: [] };
          },
        }),
      ],
    });

    await expect(
      router.query({
        query: "  ",
        caller: { tenantId: "tenant-1", userId: "user-1" },
      }),
    ).rejects.toThrow("query is required");
    expect(called).toBe(false);
  });

  it("returns a provider-local status when one provider fails", async () => {
    const router = createContextEngineRouter({
      providers: [
        provider({ id: "wiki", family: "wiki" }),
        provider({
          id: "kb",
          family: "knowledge-base",
          query: async () => {
            throw new Error("Bedrock throttled");
          },
        }),
      ],
    });

    const result = await router.query({
      query: "pricing",
      caller: { tenantId: "tenant-1", userId: "user-1" },
    });

    expect(result.hits).toHaveLength(1);
    expect(result.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ providerId: "kb", state: "error" }),
        expect.objectContaining({ providerId: "wiki", state: "ok" }),
      ]),
    );
  });

  it("dedupes by provenance source id and keeps the better score", async () => {
    const router = createContextEngineRouter({
      providers: [
        provider({
          id: "memory",
          family: "memory",
          query: async () => ({
            hits: [
              {
                id: "low",
                providerId: "memory",
                family: "memory",
                title: "Same",
                snippet: "same",
                score: 0.2,
                scope: "auto",
                provenance: { sourceId: "shared" },
              },
            ],
          }),
        }),
        provider({
          id: "wiki",
          family: "wiki",
          query: async () => ({
            hits: [
              {
                id: "high",
                providerId: "wiki",
                family: "wiki",
                title: "Same",
                snippet: "same",
                score: 0.8,
                scope: "auto",
                provenance: { sourceId: "shared" },
              },
            ],
          }),
        }),
      ],
    });

    const result = await router.query({
      query: "same",
      caller: { tenantId: "tenant-1", userId: "user-1" },
    });

    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]?.id).toBe("high");
    expect(result.hits[0]?.rank).toBe(1);
  });
});
