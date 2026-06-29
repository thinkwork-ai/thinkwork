import { describe, expect, it, vi } from "vitest";

import {
  createHindsightMemoryProvider,
  HindsightMemoryProviderError,
} from "../src/runtime/providers/hindsight-memory-provider.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const baseOptions = {
  endpoint: "https://hindsight.dev.example.com",
  tenantId: "tenant-1",
  userId: "user-1",
};

describe("createHindsightMemoryProvider", () => {
  it("throws at construction when identity is incomplete", () => {
    expect(() =>
      createHindsightMemoryProvider({ ...baseOptions, endpoint: "" }),
    ).toThrow(HindsightMemoryProviderError);
    expect(() =>
      createHindsightMemoryProvider({ ...baseOptions, tenantId: "" }),
    ).toThrow(/tenantId/);
    expect(() =>
      createHindsightMemoryProvider({ ...baseOptions, userId: "" }),
    ).toThrow(/userId/);
  });

  it("allows an http endpoint (dev Hindsight is an internal plaintext ELB)", () => {
    expect(() =>
      createHindsightMemoryProvider({
        ...baseOptions,
        endpoint: "http://tw-dev-hindsight.elb.amazonaws.com",
      }),
    ).not.toThrow();
  });

  it("rejects a non-http(s) endpoint scheme at construction", () => {
    expect(() =>
      createHindsightMemoryProvider({
        ...baseOptions,
        endpoint: "file:///etc/passwd",
      }),
    ).toThrow(/http/);
  });

  it("rejects a malformed endpoint URL at construction", () => {
    expect(() =>
      createHindsightMemoryProvider({ ...baseOptions, endpoint: "not a url" }),
    ).toThrow(/not a valid URL/);
  });

  it("recall posts to the user's bank and normalizes memory units", async () => {
    const fetchImpl = vi.fn().mockImplementation(() =>
      jsonResponse({
        memory_units: [
          { id: "u1", text: "pi is the core runtime", score: 0.9 },
          { content: "deploy uses canary.55" },
          { text: "" }, // dropped — no text
        ],
      }),
    );
    const provider = createHindsightMemoryProvider({
      ...baseOptions,
      fetchImpl,
    });

    const result = await provider.recall({ query: "pi" });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]![0]).toBe(
      "https://hindsight.dev.example.com/v1/default/banks/user_user-1/memories/list?q=pi&limit=25&offset=0",
    );
    const [url, init] = fetchImpl.mock.calls[1]!;
    expect(url).toBe(
      "https://hindsight.dev.example.com/v1/default/banks/user_user-1/memories/recall",
    );
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      query: "pi",
      budget: "low",
    });
    expect(result.memories).toEqual([
      {
        id: "u1",
        content: "pi is the core runtime",
        sourceScope: "user",
        score: 0.9,
      },
      { id: "unit-1", content: "deploy uses canary.55", sourceScope: "user" },
    ]);
  });

  it("merges exact list hits ahead of stale semantic recall results", async () => {
    const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.includes("/memories/list")) {
        return jsonResponse({
          items: [
            {
              id: "exact",
              text: "User memory: my user orbit checksum 92102661 is UserMarker92102661.",
              type: "world",
            },
          ],
          total: 1,
          limit: 25,
          offset: 0,
        });
      }
      return jsonResponse({
        memory_units: [
          {
            id: "old",
            text: "User performed a retention probe in April",
            score: 0.95,
          },
        ],
      });
    });
    const provider = createHindsightMemoryProvider({
      ...baseOptions,
      fetchImpl,
    });

    const result = await provider.recall({
      query: "user orbit checksum 92102661",
    });

    expect(result.memories[0]).toEqual({
      id: "exact",
      content: "User memory: my user orbit checksum 92102661 is UserMarker92102661.",
      sourceScope: "user",
      score: 10000,
      factType: "world",
    });
  });

  it("returns exact list hits when semantic recall times out", async () => {
    const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.endsWith("/memories/recall")) {
        throw new DOMException(
          "The operation was aborted due to timeout",
          "TimeoutError",
        );
      }
      if (
        url.includes("/banks/space_space-1/") &&
        url.includes("q=space+orbit+checksum+739b482e")
      ) {
        return jsonResponse({
          items: [
            {
              id: "exact",
              text: "Space memory: the shared space orbit checksum 739b482e is SpaceMarker9db597dc.",
              type: "world",
            },
          ],
          total: 1,
          limit: 25,
          offset: 0,
        });
      }
      return jsonResponse({ items: [], total: 0, limit: 25, offset: 0 });
    });
    const provider = createHindsightMemoryProvider({
      ...baseOptions,
      spaceId: "space-1",
      fetchImpl,
    });

    const result = await provider.recall({
      query: "space orbit checksum 739b482e",
    });

    expect(result.memories[0]).toEqual({
      id: "exact",
      content:
        "Space memory: the shared space orbit checksum 739b482e is SpaceMarker9db597dc.",
      sourceScope: "space",
      score: 10000,
      factType: "world",
    });
  });

  it("lists cleaned direct-memory question variants so exact facts beat stale semantic hits", async () => {
    const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.endsWith("/memories/recall")) {
        return jsonResponse({
          memory_units: [
            {
              id: "old",
              text: "User performed a retention probe in April",
              score: 0.95,
            },
          ],
        });
      }
      if (url.includes("q=user+orbit+checksum+93468972")) {
        return jsonResponse({
          items: [
            {
              id: "exact",
              text: "User memory: my user orbit checksum 93468972 is UserMarker93468972.",
              type: "observation",
            },
          ],
          total: 1,
          limit: 25,
          offset: 0,
        });
      }
      return jsonResponse({ items: [], total: 0, limit: 25, offset: 0 });
    });
    const provider = createHindsightMemoryProvider({
      ...baseOptions,
      fetchImpl,
    });

    const result = await provider.recall({
      query:
        "What do you remember about my user orbit checksum 93468972? Answer with just the marker.",
    });

    expect(result.memories[0]).toMatchObject({
      id: "exact",
      content:
        "User memory: my user orbit checksum 93468972 is UserMarker93468972.",
      sourceScope: "user",
      score: 10000,
      factType: "observation",
    });
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toContain(
      "https://hindsight.dev.example.com/v1/default/banks/user_user-1/memories/list?q=user+orbit+checksum+93468972&limit=25&offset=0",
    );
  });

  it("recall honors the limit", async () => {
    const fetchImpl = vi.fn().mockImplementation(() =>
      jsonResponse({
        memory_units: [{ text: "a" }, { text: "b" }, { text: "c" }],
      }),
    );
    const provider = createHindsightMemoryProvider({
      ...baseOptions,
      fetchImpl,
    });
    const result = await provider.recall({ query: "x", limit: 2 });
    expect(result.memories).toHaveLength(2);
  });

  it("recall sends query_timestamp only when supplied", async () => {
    const fetchImpl = vi.fn().mockImplementation(() =>
      jsonResponse({
        memory_units: [{ text: "temporal result" }],
      }),
    );
    const provider = createHindsightMemoryProvider({
      ...baseOptions,
      fetchImpl,
    });

    await provider.recall({
      query: "team priorities",
      queryTimestamp: "2026-06-27T17:00:00.000Z",
    });
    await provider.recall({ query: "team priorities" });

    expect(
      JSON.parse((fetchImpl.mock.calls[1]![1] as RequestInit).body as string),
    ).toMatchObject({
      query_timestamp: "2026-06-27T17:00:00.000Z",
    });
    expect(
      JSON.parse((fetchImpl.mock.calls[3]![1] as RequestInit).body as string),
    ).not.toHaveProperty("query_timestamp");
  });

  it("recall rejects an empty query without calling fetch", async () => {
    const fetchImpl = vi.fn();
    const provider = createHindsightMemoryProvider({
      ...baseOptions,
      fetchImpl,
    });
    await expect(provider.recall({ query: "  " })).rejects.toThrow(
      /empty query/,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reflect posts to the reflect endpoint and returns the synthesized text", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ text: "a coherent answer about pi" }));
    const provider = createHindsightMemoryProvider({
      ...baseOptions,
      fetchImpl,
    });

    const result = await provider.reflect({ query: "pi" });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(
      "https://hindsight.dev.example.com/v1/default/banks/user_user-1/reflect",
    );
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      query: "pi",
      budget: "mid",
    });
    expect(result.ok).toBe(true);
    expect(result.text).toBe("a coherent answer about pi");
  });

  it("reflect composes surrounding context into the query for Hindsight", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ text: "contextual answer" }));
    const provider = createHindsightMemoryProvider({
      ...baseOptions,
      fetchImpl,
    });

    await provider.reflect({
      query: "What should I do next?",
      context: "The current task is preparing a launch checklist.",
    });

    const [, init] = fetchImpl.mock.calls[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      query:
        "What should I do next?\n\nCurrent turn context:\nThe current task is preparing a launch checklist.",
      budget: "mid",
      include: { facts: {} },
    });
  });

  it("reflect rejects an empty query", async () => {
    const fetchImpl = vi.fn();
    const provider = createHindsightMemoryProvider({
      ...baseOptions,
      fetchImpl,
    });
    await expect(provider.reflect({ query: "" })).rejects.toThrow(
      /empty query/,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("treats 4xx as terminal (no retry)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("bad request", { status: 400 }));
    const provider = createHindsightMemoryProvider({
      ...baseOptions,
      fetchImpl,
    });
    await expect(provider.recall({ query: "x" })).rejects.toThrow(
      HindsightMemoryProviderError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a 5xx and succeeds on a later attempt", async () => {
    vi.useFakeTimers();
    try {
      let recallCalls = 0;
      const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
        const url = String(input);
        if (url.endsWith("/memories/list?q=x&limit=25&offset=0")) {
          return jsonResponse({ items: [], total: 0, limit: 25, offset: 0 });
        }
        recallCalls += 1;
        if (recallCalls === 1) {
          return new Response("boom", { status: 503 });
        }
        return jsonResponse({ memory_units: [{ text: "ok" }] });
      });
      const provider = createHindsightMemoryProvider({
        ...baseOptions,
        fetchImpl,
      });
      const promise = provider.recall({ query: "x" });
      // Advance through the first backoff (1s + jitter) so the retry fires.
      await vi.advanceTimersByTimeAsync(5_000);
      const result = await promise;
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(recallCalls).toBe(2);
      expect(result.memories).toEqual([
        { id: "unit-0", content: "ok", sourceScope: "user" },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries transport errors and throws after exhausting attempts", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
      const provider = createHindsightMemoryProvider({
        ...baseOptions,
        fetchImpl,
      });
      const promise = provider.recall({ query: "x" });
      const assertion = expect(promise).rejects.toThrow(
        HindsightMemoryProviderError,
      );
      // Advance past all backoffs (1s + 3s + 9s).
      await vi.advanceTimersByTimeAsync(15_000);
      await assertion;
      expect(fetchImpl).toHaveBeenCalledTimes(4); // initial + 3 retries
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not call fetch when the caller signal is already aborted", async () => {
    const fetchImpl = vi.fn();
    const provider = createHindsightMemoryProvider({
      ...baseOptions,
      fetchImpl,
    });
    await expect(
      provider.recall({ query: "x" }, AbortSignal.abort()),
    ).rejects.toThrow(/aborted/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("normalizes the `memories` response key (not just memory_units)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ memories: [{ text: "a" }] }));
    const provider = createHindsightMemoryProvider({
      ...baseOptions,
      fetchImpl,
    });
    const result = await provider.recall({ query: "x" });
    expect(result.memories).toEqual([
      { id: "unit-0", content: "a", sourceScope: "user" },
    ]);
  });

  it("extracts reflect text from the `response` key (not just text)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ response: "synth from response key" }));
    const provider = createHindsightMemoryProvider({
      ...baseOptions,
      fetchImpl,
    });
    const result = await provider.reflect({ query: "x" });
    expect(result.text).toBe("synth from response key");
  });
});

describe("observation signal parsing", () => {
  it("surfaces factType, freshness, and proofCount on observation units", async () => {
    const fetchImpl = vi.fn().mockImplementation(() =>
      jsonResponse({
        memory_units: [
          {
            id: "obs-1",
            text: "Alice is a Python-focused developer",
            score: 0.8,
            fact_type: "observation",
            freshness: "strengthening",
            proof_count: 5,
          },
          {
            id: "raw-1",
            text: "Alice mentioned pytest today",
            score: 0.8,
            fact_type: "experience",
          },
        ],
      }),
    );
    const provider = createHindsightMemoryProvider({
      ...baseOptions,
      fetchImpl,
    });

    const result = await provider.recall({ query: "alice" });

    expect(result.memories[0]).toEqual({
      id: "obs-1",
      content: "Alice is a Python-focused developer",
      sourceScope: "user",
      score: 0.8,
      factType: "observation",
      freshness: "strengthening",
      proofCount: 5,
    });
    expect(result.memories[1]).toEqual({
      id: "raw-1",
      content: "Alice mentioned pytest today",
      sourceScope: "user",
      score: 0.8,
      factType: "experience",
    });
  });

  it("tolerates units without observation fields and metadata-carried signals", async () => {
    const fetchImpl = vi.fn().mockImplementation(() =>
      jsonResponse({
        memory_units: [
          { id: "plain", text: "no signals at all" },
          {
            id: "meta",
            text: "signals in metadata",
            metadata: { fact_type: "observation", trend: "stale" },
          },
        ],
      }),
    );
    const provider = createHindsightMemoryProvider({
      ...baseOptions,
      fetchImpl,
    });

    const result = await provider.recall({ query: "anything" });

    expect(result.memories[0]).toEqual({
      id: "plain",
      content: "no signals at all",
      sourceScope: "user",
    });
    expect(result.memories[1]).toEqual({
      id: "meta",
      content: "signals in metadata",
      sourceScope: "user",
      factType: "observation",
      freshness: "stale",
    });
  });
});

describe("deployed recall wire format (Hindsight 0.5.0)", () => {
  it("parses `type` and `source_fact_ids` observation signals", async () => {
    const fetchImpl = vi.fn().mockImplementation(() =>
      jsonResponse({
        memory_units: [
          {
            id: "obs-wire",
            text: "consolidated belief",
            type: "observation",
            source_fact_ids: ["f1", "f2"],
            metadata: {},
          },
        ],
      }),
    );
    const provider = createHindsightMemoryProvider({
      ...baseOptions,
      fetchImpl,
    });

    const result = await provider.recall({ query: "wire" });

    expect(result.memories[0]).toEqual({
      id: "obs-wire",
      content: "consolidated belief",
      sourceScope: "user",
      factType: "observation",
      proofCount: 2,
      evidence: {
        sourceFactIds: ["f1", "f2"],
      },
    });
  });

  it("preserves redacted source-fact evidence when recall includes source_facts", async () => {
    const fetchImpl = vi.fn().mockImplementation(() =>
      jsonResponse({
        memory_units: [
          {
            id: "obs-evidence",
            text: "Alice prefers concise summaries",
            type: "observation",
            source_fact_ids: ["fact-1"],
          },
        ],
        source_facts: {
          "fact-1": {
            id: "fact-1",
            type: "experience",
            context: "thinkwork_thread",
            document_id: "thread-1",
            chunk_id: "chunk-1",
            tags: ["source:thread"],
            text: "raw source fact text must not leak",
            metadata: {
              role: "user",
              content: "raw content must not leak",
              safe_id: "msg-1",
            },
          },
        },
      }),
    );
    const provider = createHindsightMemoryProvider({
      ...baseOptions,
      fetchImpl,
    });

    const result = await provider.recall({ query: "alice" });
    const [, init] = fetchImpl.mock.calls[1]!;
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      include: { entities: null, source_facts: {} },
    });
    expect(result.memories[0].evidence).toEqual({
      sourceFactIds: ["fact-1"],
      sourceFacts: [
        {
          id: "fact-1",
          type: "experience",
          context: "thinkwork_thread",
          documentId: "thread-1",
          chunkId: "chunk-1",
          tags: ["source:thread"],
          metadata: { role: "user", safe_id: "msg-1" },
        },
      ],
    });
    expect(JSON.stringify(result.memories[0].evidence)).not.toContain(
      "raw source",
    );
    expect(JSON.stringify(result.memories[0].evidence)).not.toContain(
      "raw content",
    );
  });

  it("recalls from user and current Space banks and labels each result", async () => {
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/banks/space_space-1/")) {
        return Promise.resolve(
          jsonResponse({
            memory_units: [{ id: "space-hit", text: "Shared rollout plan", score: 0.95 }],
          }),
        );
      }
      return Promise.resolve(
        jsonResponse({
          memory_units: [{ id: "user-hit", text: "Personal preference", score: 0.7 }],
        }),
      );
    });
    const provider = createHindsightMemoryProvider({
      ...baseOptions,
      spaceId: "space-1",
      fetchImpl,
    });

    const result = await provider.recall({ query: "rollout", limit: 5 });

    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(fetchImpl.mock.calls.map((call) => String(call[0]))).toEqual(
      expect.arrayContaining([
        "https://hindsight.dev.example.com/v1/default/banks/user_user-1/memories/recall",
        "https://hindsight.dev.example.com/v1/default/banks/user_user-1/memories/list?q=rollout&limit=25&offset=0",
        "https://hindsight.dev.example.com/v1/default/banks/space_space-1/memories/recall",
        "https://hindsight.dev.example.com/v1/default/banks/space_space-1/memories/list?q=rollout&limit=25&offset=0",
      ]),
    );
    expect(result.memories).toEqual([
      {
        id: "space-hit",
        content: "Shared rollout plan",
        sourceScope: "space",
        score: 0.95,
      },
      {
        id: "user-hit",
        content: "Personal preference",
        sourceScope: "user",
        score: 0.7,
      },
    ]);
  });

  it("preserves reflect based_on evidence and usage without raw fact text", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        text: "Use the launch checklist.",
        usage: { input_tokens: 10, output_tokens: 5 },
        trace: { request_id: "trace-1" },
        based_on: {
          memory_ids: ["mem-1"],
          mental_model_ids: ["model-1"],
          directive_ids: ["dir-1"],
          memories: [
            {
              id: "mem-1",
              context: "thinkwork_thread",
              text: "raw memory text must not leak",
              metadata: { safe_id: "msg-1", body: "raw body must not leak" },
            },
          ],
        },
      }),
    );
    const provider = createHindsightMemoryProvider({
      ...baseOptions,
      fetchImpl,
    });

    const result = await provider.reflect({ query: "launch" });
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      include: { facts: {} },
    });
    expect(result).toMatchObject({
      ok: true,
      text: "Use the launch checklist.",
      usage: { input_tokens: 10, output_tokens: 5 },
      trace: { request_id: "trace-1" },
      evidence: {
        basedOn: {
          memoryIds: ["mem-1"],
          mentalModelIds: ["model-1"],
          directiveIds: ["dir-1"],
          memories: [
            {
              id: "mem-1",
              context: "thinkwork_thread",
              metadata: { safe_id: "msg-1" },
            },
          ],
        },
      },
    });
    expect(JSON.stringify(result.evidence)).not.toContain("raw memory");
    expect(JSON.stringify(result.evidence)).not.toContain("raw body");
  });
});
