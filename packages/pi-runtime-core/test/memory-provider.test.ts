import { describe, expect, it } from "vitest";

import type { MemoryItem, MemoryProvider } from "../src/memory-provider.js";

/**
 * In-memory stub that records its call order — proves a host can satisfy the
 * read-synthesis recall/reflect chain with no concrete Hindsight client (the
 * inert-substitutability scenario for U3) and lets us assert the recall→reflect
 * chain contract. `reflect` synthesizes over what `recall` surfaced; it does NOT
 * persist (persistence is the host's end-of-turn retain path — see
 * memory-provider.ts).
 */
function makeStub(seed: MemoryItem[] = []) {
  const store: MemoryItem[] = [...seed];
  const calls: string[] = [];
  let lastRecalled: MemoryItem[] = [];
  const provider: MemoryProvider = {
    recall: async ({ query, limit }) => {
      calls.push("recall");
      const memories = store
        .filter((m) => m.content.includes(query))
        .slice(0, limit);
      lastRecalled = memories;
      return { memories, usage: { input: 5, output: 0 } };
    },
    reflect: async ({ query }) => {
      calls.push("reflect");
      // Synthesize: reason over the units the preceding recall surfaced for the
      // same query. Returns text, never mutates the store.
      const text = lastRecalled.length
        ? `For "${query}": ${lastRecalled.map((m) => m.content).join("; ")}`
        : `For "${query}": no prior memory.`;
      return { ok: true, text, usage: { input: 0, output: 7 } };
    },
  };
  return { provider, calls, store };
}

describe("MemoryProvider contract", () => {
  it("recalls memories matching the query and reports usage", async () => {
    const { provider } = makeStub([
      { id: "m0", content: "deploy uses canary.55" },
      { id: "m1", content: "unrelated note" },
    ]);
    const result = await provider.recall({ query: "canary" });
    expect(result.memories).toHaveLength(1);
    expect(result.memories[0]?.content).toContain("canary.55");
    expect(result.usage).toBeDefined();
  });

  it("reflects by synthesizing recalled units into an answer and reports usage", async () => {
    const { provider } = makeStub([
      { id: "m0", content: "pi is the core runtime" },
    ]);
    await provider.recall({ query: "pi" });
    const result = await provider.reflect({ query: "pi" });
    expect(result.ok).toBe(true);
    expect(result.text).toContain("pi is the core runtime");
    expect(result.usage).toBeDefined();
  });

  it("does not persist on reflect — the read-synthesis chain leaves the store unchanged", async () => {
    const { provider, store } = makeStub([{ id: "m0", content: "seed" }]);
    const before = store.length;
    await provider.recall({ query: "seed" });
    await provider.reflect({ query: "seed" });
    expect(store).toHaveLength(before);
  });

  it("supports the recall→reflect chain in order within a turn", async () => {
    const { provider, calls } = makeStub([
      { id: "m0", content: "prior context about pi" },
    ]);

    await provider.recall({ query: "pi" });
    // The reflect follow-up synthesizes over what recall surfaced.
    await provider.reflect({ query: "pi" });

    expect(calls).toEqual(["recall", "reflect"]);
  });
});
