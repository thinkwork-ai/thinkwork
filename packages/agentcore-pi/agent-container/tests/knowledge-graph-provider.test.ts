import { describe, expect, it, vi } from "vitest";

import {
  ApiKnowledgeGraphProviderError,
  createApiKnowledgeGraphProvider,
} from "../src/runtime/providers/knowledge-graph-provider.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const baseOptions = {
  apiUrl: "https://api.dev.example.com",
  apiSecret: "service-secret",
  threadTurnId: "7c1f8a8e-1c1d-4e58-9a8e-0b1c2d3e4f5a",
};

const searchPayload = {
  data: {
    knowledgeGraphSearch: {
      entities: [
        {
          id: "e1",
          label: "Acme Corp",
          typeSlug: "company",
          summary: "Customer.",
          aliases: ["Acme"],
          relationshipCount: 2,
          evidenceCount: 3,
          observationIds: ["obs-1"],
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
    },
  },
};

describe("createApiKnowledgeGraphProvider", () => {
  it("throws at construction when wiring is incomplete (snapshot-at-entry, fail loud)", () => {
    expect(() =>
      createApiKnowledgeGraphProvider({ ...baseOptions, apiUrl: "" }),
    ).toThrow(/apiUrl/);
    expect(() =>
      createApiKnowledgeGraphProvider({ ...baseOptions, apiSecret: "" }),
    ).toThrow(/apiSecret/);
    expect(() =>
      createApiKnowledgeGraphProvider({
        apiUrl: baseOptions.apiUrl,
        apiSecret: baseOptions.apiSecret,
      }),
    ).toThrow(/turn-bound reference/);
  });

  it("posts the GraphQL query to /graphql with the snapshotted bearer + turn-bound header", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(searchPayload));
    const provider = createApiKnowledgeGraphProvider({
      ...baseOptions,
      fetchImpl,
    });

    const result = await provider.search({ query: "Acme", limit: 5 });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.dev.example.com/graphql");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer service-secret");
    expect(headers["x-thread-turn-id"]).toBe(baseOptions.threadTurnId);
    // The provider never asserts a tenant — the API derives it server-side
    // from the turn reference (R15).
    expect(headers["x-tenant-id"]).toBeUndefined();
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.query).toContain("knowledgeGraphSearch");
    expect(body.variables).toEqual({ query: "Acme", limit: 5 });

    expect(result.entities).toEqual([
      {
        id: "e1",
        label: "Acme Corp",
        typeSlug: "company",
        summary: "Customer.",
        aliases: ["Acme"],
        relationshipCount: 2,
        evidenceCount: 3,
        observationIds: ["obs-1"],
      },
    ]);
    expect(result.relationships).toEqual([
      {
        id: "r1",
        label: "serves",
        typeSlug: "serves",
        fromLabel: "Acme Corp",
        toLabel: "Project Phoenix",
      },
    ]);
  });

  it("falls back to the x-thread-id header when no turn id was snapshotted", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(searchPayload));
    const provider = createApiKnowledgeGraphProvider({
      apiUrl: baseOptions.apiUrl,
      apiSecret: baseOptions.apiSecret,
      threadId: "9d2e7b6c-2d3e-4f5a-8b9c-1d2e3f4a5b6c",
      fetchImpl,
    });

    await provider.search({ query: "Acme" });

    const headers = (fetchImpl.mock.calls[0]![1] as RequestInit)
      .headers as Record<string, string>;
    expect(headers["x-thread-id"]).toBe("9d2e7b6c-2d3e-4f5a-8b9c-1d2e3f4a5b6c");
    expect(headers["x-thread-turn-id"]).toBeUndefined();
  });

  it("rejects an empty query without issuing a request", async () => {
    const fetchImpl = vi.fn();
    const provider = createApiKnowledgeGraphProvider({
      ...baseOptions,
      fetchImpl,
    });
    await expect(provider.search({ query: "  " })).rejects.toThrow(
      /empty query/,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("is single-attempt: a transport error throws immediately with no retry", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("socket hang up"));
    const provider = createApiKnowledgeGraphProvider({
      ...baseOptions,
      fetchImpl,
    });

    await expect(provider.search({ query: "Acme" })).rejects.toThrow(
      ApiKnowledgeGraphProviderError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("is single-attempt on timeout: the abort surfaces as a provider error after one call", async () => {
    // The fake fetch hangs until the composed timeout signal aborts it.
    const fetchImpl = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(
              Object.assign(new Error("The operation was aborted."), {
                name: "AbortError",
              }),
            ),
          );
        }),
    );
    const provider = createApiKnowledgeGraphProvider({
      ...baseOptions,
      timeoutMs: 10,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(provider.search({ query: "Acme" })).rejects.toThrow(
      /transport error/,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("a non-2xx response throws with the status", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: "nope" }, 502));
    const provider = createApiKnowledgeGraphProvider({
      ...baseOptions,
      fetchImpl,
    });
    await expect(provider.search({ query: "Acme" })).rejects.toThrow(/502/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("GraphQL-level errors throw (the extension converts to its unavailable result)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        errors: [{ message: "Access denied: tenant mismatch" }],
      }),
    );
    const provider = createApiKnowledgeGraphProvider({
      ...baseOptions,
      fetchImpl,
    });
    await expect(provider.search({ query: "Acme" })).rejects.toThrow(
      /tenant mismatch/,
    );
  });

  it("tolerates a malformed/partial payload by returning empty collections", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { knowledgeGraphSearch: {} } }));
    const provider = createApiKnowledgeGraphProvider({
      ...baseOptions,
      fetchImpl,
    });
    const result = await provider.search({ query: "Acme" });
    expect(result).toEqual({ entities: [], relationships: [] });
  });
});
