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
});
