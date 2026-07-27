import { describe, expect, it, vi } from "vitest";

import {
  ApiSearchProviderError,
  createApiSearchProvider,
} from "../src/runtime/providers/search-provider.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const baseOptions = {
  apiUrl: "https://api.dev.example.com",
  apiSecret: "service-secret",
  tenantId: "0015953e-aa13-4cab-8398-2e70f73dda63",
  threadTurnId: "7c1f8a8e-1c1d-4e58-9a8e-0b1c2d3e4f5a",
};

const searchPayload = {
  data: {
    search: {
      queryId: "q1",
      legs: [
        {
          source: "THREADS",
          status: "OK",
          threadHits: [{ title: "Acme SOW", identifier: "TH-1" }],
          entityHits: [],
          memoryHits: [],
        },
        {
          source: "ENTITIES",
          status: "OK",
          threadHits: [],
          entityHits: [
            {
              label: "Acme",
              ontologyTypeSlug: "company",
              summary: "Customer.",
            },
          ],
          memoryHits: [],
        },
        {
          source: "MEMORY",
          status: "TIMEOUT",
          threadHits: [],
          entityHits: [],
          memoryHits: [],
        },
      ],
    },
  },
};

describe("createApiSearchProvider", () => {
  it("throws at construction when wiring is incomplete (snapshot-at-entry, fail loud)", () => {
    expect(() =>
      createApiSearchProvider({ ...baseOptions, apiUrl: "" }),
    ).toThrow(/apiUrl/);
    expect(() =>
      createApiSearchProvider({ ...baseOptions, apiSecret: "" }),
    ).toThrow(/apiSecret/);
    expect(() =>
      createApiSearchProvider({ ...baseOptions, tenantId: "" }),
    ).toThrow(/tenantId/);
    expect(() =>
      createApiSearchProvider({
        apiUrl: baseOptions.apiUrl,
        apiSecret: baseOptions.apiSecret,
        tenantId: baseOptions.tenantId,
      }),
    ).toThrow(/turn-bound reference/);
  });

  it("posts the search query with the bearer + turn-bound header and no asserted tenant header", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(searchPayload));
    const provider = createApiSearchProvider({ ...baseOptions, fetchImpl });

    const result = await provider.search({
      query: "Acme",
      sources: ["THREADS", "ENTITIES"],
      limit: 5,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.dev.example.com/graphql");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer service-secret");
    expect(headers["x-thread-turn-id"]).toBe(baseOptions.threadTurnId);
    // No caller-asserted tenant travels with the request — the API derives
    // tenant AND user server-side from the turn reference.
    expect(headers["x-tenant-id"]).toBeUndefined();
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.query).toContain("search(");
    expect(body.variables).toEqual({
      tenantId: baseOptions.tenantId,
      query: "Acme",
      sources: ["THREADS", "ENTITIES"],
      limit: 5,
    });

    // Legs are flattened to source-tagged lines; a degraded leg keeps its
    // status and empty lines so the extension renders it as unavailable.
    expect(result.legs).toEqual([
      { source: "THREADS", status: "OK", lines: ["Acme SOW [TH-1]"] },
      {
        source: "ENTITIES",
        status: "OK",
        lines: ["Acme (company) — Customer."],
      },
      { source: "MEMORY", status: "TIMEOUT", lines: [] },
    ]);
  });

  it("falls back to x-thread-id when no turn id is supplied", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(searchPayload));
    const provider = createApiSearchProvider({
      apiUrl: baseOptions.apiUrl,
      apiSecret: baseOptions.apiSecret,
      tenantId: baseOptions.tenantId,
      threadId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      fetchImpl,
    });
    await provider.search({ query: "Acme" });
    const headers = (fetchImpl.mock.calls[0]![1] as RequestInit)
      .headers as Record<string, string>;
    expect(headers["x-thread-id"]).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(headers["x-thread-turn-id"]).toBeUndefined();
  });

  it("surfaces GraphQL errors as a provider error (never a silent empty result)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ errors: [{ message: "tenant mismatch" }] }),
      );
    const provider = createApiSearchProvider({ ...baseOptions, fetchImpl });
    await expect(provider.search({ query: "Acme" })).rejects.toThrow(
      /tenant mismatch/,
    );
  });

  it("throws on an empty query without hitting the network", async () => {
    const fetchImpl = vi.fn();
    const provider = createApiSearchProvider({ ...baseOptions, fetchImpl });
    await expect(provider.search({ query: "  " })).rejects.toBeInstanceOf(
      ApiSearchProviderError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
