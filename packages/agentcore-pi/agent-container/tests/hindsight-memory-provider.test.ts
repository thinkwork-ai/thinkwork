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

  it("rejects a non-https endpoint at construction", () => {
    expect(() =>
      createHindsightMemoryProvider({
        ...baseOptions,
        endpoint: "http://hindsight.dev.example.com",
      }),
    ).toThrow(/https/);
  });

  it("recall posts to the user's bank and normalizes memory units", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
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

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(
      "https://hindsight.dev.example.com/v1/default/banks/user_user-1/memories/recall",
    );
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      query: "pi",
      budget: "low",
    });
    expect(result.memories).toEqual([
      { id: "u1", content: "pi is the core runtime", score: 0.9 },
      { id: "unit-1", content: "deploy uses canary.55" },
    ]);
  });

  it("recall honors the limit", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
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
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(new Response("boom", { status: 503 }))
        .mockResolvedValueOnce(
          jsonResponse({ memory_units: [{ text: "ok" }] }),
        );
      const provider = createHindsightMemoryProvider({
        ...baseOptions,
        fetchImpl,
      });
      const promise = provider.recall({ query: "x" });
      // Advance through the first backoff (1s + jitter) so the retry fires.
      await vi.advanceTimersByTimeAsync(5_000);
      const result = await promise;
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(result.memories).toEqual([{ id: "unit-0", content: "ok" }]);
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
    expect(result.memories).toEqual([{ id: "unit-0", content: "a" }]);
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
