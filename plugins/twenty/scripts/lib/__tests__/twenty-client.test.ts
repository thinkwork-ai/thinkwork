import { describe, expect, it, vi } from "vitest";

import {
  BATCH_LIMIT,
  chunk,
  normalizeBaseUrl,
  TwentyClient,
  TwentyGraphqlError,
} from "../twenty-client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("normalizeBaseUrl", () => {
  it("resolves the endpoint from TWENTY_PUBLIC_URL plus path", () => {
    const client = new TwentyClient({
      baseUrl: "https://crm.tei.thinkwork.ai/",
      authToken: "key",
    });
    expect(client.endpoint("/graphql")).toBe(
      "https://crm.tei.thinkwork.ai/graphql",
    );
    expect(client.endpoint("/metadata")).toBe(
      "https://crm.tei.thinkwork.ai/metadata",
    );
  });

  it("rejects non-HTTPS URLs", () => {
    expect(() => normalizeBaseUrl("http://crm.tei.thinkwork.ai")).toThrow(
      /HTTPS/,
    );
  });
});

describe("chunk", () => {
  it("splits 130 records into 3 chunks at the batch limit", () => {
    const chunks = chunk(
      Array.from({ length: 130 }, (_, index) => index),
      BATCH_LIMIT,
    );
    expect(chunks.map((c) => c.length)).toEqual([60, 60, 10]);
  });

  it("rejects a chunk size below 1", () => {
    expect(() => chunk([1], 0)).toThrow(/>= 1/);
  });
});

describe("TwentyClient.requestOnce", () => {
  it("throws with the message when GraphQL returns errors[]", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ errors: [{ message: "Field boom is required" }] }),
    );
    const client = new TwentyClient({
      baseUrl: "https://crm.example.com",
      authToken: "key",
      fetchImpl,
      minRequestIntervalMs: 0,
      rateLimitWaitMs: 1,
    });
    await expect(client.requestOnce("/graphql", "query { x }")).rejects.toThrow(
      /Field boom is required/,
    );
  });

  it("sends the Bearer auth header", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: { ok: true } }));
    const client = new TwentyClient({
      baseUrl: "https://crm.example.com",
      authToken: "secret-key",
      fetchImpl,
      minRequestIntervalMs: 0,
    });
    await client.requestOnce("/graphql", "query { x }");
    const [, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer secret-key",
    );
  });

  it("flags duplicate-key errors", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        errors: [
          { message: 'duplicate key value violates unique constraint "x"' },
        ],
      }),
    );
    const client = new TwentyClient({
      baseUrl: "https://crm.example.com",
      authToken: "key",
      fetchImpl,
      minRequestIntervalMs: 0,
      rateLimitWaitMs: 1,
    });
    const error = await client
      .requestOnce("/graphql", "mutation { y }")
      .catch((e) => e);
    expect(error).toBeInstanceOf(TwentyGraphqlError);
    expect((error as TwentyGraphqlError).isDuplicateError).toBe(true);
  });
});

describe("TwentyClient.requestWithRetry", () => {
  it("retries on 429 with backoff then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(jsonResponse({ data: { ok: true } }));
    const client = new TwentyClient({
      baseUrl: "https://crm.example.com",
      authToken: "key",
      fetchImpl,
      backoffMs: 1,
      minRequestIntervalMs: 0,
      rateLimitWaitMs: 1,
    });
    const data = await client.requestWithRetry<{ ok: boolean }>(
      "/graphql",
      "query { x }",
    );
    expect(data.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry GraphQL validation errors", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ errors: [{ message: "bad query" }] }),
    );
    const client = new TwentyClient({
      baseUrl: "https://crm.example.com",
      authToken: "key",
      fetchImpl,
      backoffMs: 1,
      minRequestIntervalMs: 0,
      rateLimitWaitMs: 1,
    });
    await expect(
      client.requestWithRetry("/graphql", "query { x }"),
    ).rejects.toThrow(/bad query/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("gives up after maxRetries on persistent 5xx", async () => {
    const fetchImpl = vi.fn(async () => new Response("boom", { status: 502 }));
    const client = new TwentyClient({
      baseUrl: "https://crm.example.com",
      authToken: "key",
      fetchImpl,
      backoffMs: 1,
      maxRetries: 2,
      minRequestIntervalMs: 0,
      rateLimitWaitMs: 1,
    });
    await expect(
      client.requestWithRetry("/graphql", "query { x }"),
    ).rejects.toThrow(/502/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe("network errors", () => {
  it("retries socket-level failures on reads", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(jsonResponse({ data: { ok: true } }));
    const client = new TwentyClient({
      baseUrl: "https://crm.example.com",
      authToken: "key",
      fetchImpl,
      backoffMs: 1,
      minRequestIntervalMs: 0,
      rateLimitWaitMs: 1,
    });
    const data = await client.requestWithRetry<{ ok: boolean }>(
      "/graphql",
      "query { x }",
    );
    expect(data.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("wraps network failures with context on requestOnce", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const client = new TwentyClient({
      baseUrl: "https://crm.example.com",
      authToken: "key",
      fetchImpl,
      minRequestIntervalMs: 0,
      rateLimitWaitMs: 1,
    });
    const error = await client
      .requestOnce("/graphql", "mutation { y }")
      .catch((e) => e);
    expect(error).toBeInstanceOf(TwentyGraphqlError);
    expect((error as TwentyGraphqlError).isNetworkError).toBe(true);
    expect((error as TwentyGraphqlError).message).toMatch(/network error/);
  });
});
