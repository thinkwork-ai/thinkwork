import { describe, expect, it } from "vitest";
import { createContextEngineService } from "../service.js";
import type { ContextProviderDescriptor } from "../types.js";

const provider: ContextProviderDescriptor = {
  id: "memory",
  family: "memory",
  displayName: "Memory",
  defaultEnabled: true,
  query: async (request) => ({
    hits: [
      {
        id: "memory:1",
        providerId: "memory",
        family: "memory",
        title: "Remembered fact",
        snippet: `Fact about ${request.query}`,
        score: 0.9,
        scope: request.scope,
        provenance: { sourceId: "1" },
      },
    ],
  }),
};

describe("ContextEngineService", () => {
  it("returns the same envelope for first-party callers", async () => {
    const service = createContextEngineService({
      providers: [provider],
      validateCaller: async () => true,
    });

    const result = await service.query({
      query: "Austin",
      caller: { tenantId: "tenant-1", userId: "user-1" },
    });

    expect(result.hits[0]).toMatchObject({
      id: "memory:1",
      family: "memory",
      scope: "auto",
    });
    expect(result.providers[0]).toMatchObject({
      providerId: "memory",
      state: "ok",
    });
  });

  it("answer mode cites returned hit ids", async () => {
    const service = createContextEngineService({
      providers: [provider],
      validateCaller: async () => true,
    });

    const result = await service.query({
      query: "pricing",
      mode: "answer",
      caller: { tenantId: "tenant-1", userId: "user-1" },
    });

    expect(result.answer?.hitIds).toEqual(["memory:1"]);
    expect(result.answer?.text).toContain("[1] Remembered fact");
  });

  it("rejects invalid caller scope before providers are called", async () => {
    let called = false;
    const service = createContextEngineService({
      providers: [
        {
          ...provider,
          query: async () => {
            called = true;
            return { hits: [] };
          },
        },
      ],
      validateCaller: async () => false,
    });

    await expect(
      service.query({
        query: "secret",
        caller: { tenantId: "tenant-1", userId: "other" },
      }),
    ).rejects.toThrow("invalid context engine caller");
    expect(called).toBe(false);
  });

  it("loads providers with the resolved caller", async () => {
    const seenTenants: Array<string | undefined> = [];
    const service = createContextEngineService({
      loadProviders: async (caller) => {
        seenTenants.push(caller?.tenantId);
        return [provider];
      },
      validateCaller: async () => true,
    });

    const result = await service.query({
      query: "Codex",
      caller: { tenantId: "tenant-dynamic", userId: "user-1" },
    });
    const listed = await service.listProviders({
      caller: { tenantId: "tenant-dynamic", userId: "user-1" },
    });

    expect(result.hits).toHaveLength(1);
    expect(listed.map((p) => p.id)).toEqual(["memory"]);
    expect(seenTenants).toEqual(["tenant-dynamic", "tenant-dynamic"]);
  });
});
