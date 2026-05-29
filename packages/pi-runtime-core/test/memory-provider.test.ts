import { describe, expect, it } from "vitest";

import type { MemoryItem, MemoryProvider } from "../src/memory-provider.js";

/**
 * In-memory stub that records its call order — proves a host can satisfy
 * recall/reflect with no concrete Hindsight client (the inert-substitutability
 * scenario for U3) and lets us assert the recall→reflect chain contract.
 */
function makeStub(seed: MemoryItem[] = []) {
  const store: MemoryItem[] = [...seed];
  const calls: string[] = [];
  const provider: MemoryProvider = {
    recall: async ({ query, limit }) => {
      calls.push("recall");
      const memories = store
        .filter((m) => m.content.includes(query))
        .slice(0, limit);
      return { memories, usage: { input: 5, output: 0 } };
    },
    reflect: async ({ content }) => {
      calls.push("reflect");
      store.push({ id: `m${store.length}`, content });
      return { ok: true, usage: { input: 0, output: 7 } };
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

  it("reflects, persisting what the turn learned, and reports usage", async () => {
    const { provider, store } = makeStub();
    const result = await provider.reflect({ content: "learned a new fact" });
    expect(result.ok).toBe(true);
    expect(result.usage).toBeDefined();
    expect(store.at(-1)?.content).toBe("learned a new fact");
  });

  it("supports the recall→reflect chain in order within a turn", async () => {
    const { provider, calls } = makeStub([
      { id: "m0", content: "prior context about pi" },
    ]);

    const recalled = await provider.recall({ query: "pi" });
    // The reflect follow-up commits what the turn learned, grounded by recall.
    await provider.reflect({
      content: `turn learned from: ${recalled.memories[0]?.content}`,
    });

    expect(calls).toEqual(["recall", "reflect"]);
  });

  it("recall surfaces a later reflection (chain round-trips through the store)", async () => {
    const { provider } = makeStub();
    await provider.reflect({ content: "thinkwork supersedes maniflow" });
    const result = await provider.recall({ query: "maniflow" });
    expect(result.memories.map((m) => m.content)).toContain(
      "thinkwork supersedes maniflow",
    );
  });
});
