import { beforeEach, describe, expect, it, vi } from "vitest";

const { selectQueue, updateQueue, dispatchCalls, reset } = vi.hoisted(() => {
  const selectQueue: unknown[][] = [];
  const updateQueue: unknown[][] = [];
  const dispatchCalls: unknown[][] = [];
  return {
    selectQueue,
    updateQueue,
    dispatchCalls,
    reset: () => {
      selectQueue.length = 0;
      updateQueue.length = 0;
      dispatchCalls.length = 0;
    },
  };
});

vi.mock("../../utils.js", () => {
  const col = (name: string) => ({ name });
  const whereResult = () => ({
    then: (resolve: (value: unknown) => void) =>
      resolve(selectQueue.shift() ?? []),
    returning: () => Promise.resolve(updateQueue.shift() ?? []),
  });
  return {
    knowledgeBases: {
      id: col("knowledge_bases.id"),
      tenant_id: col("knowledge_bases.tenant_id"),
      chunking_strategy: col("knowledge_bases.chunking_strategy"),
      chunk_size_tokens: col("knowledge_bases.chunk_size_tokens"),
      chunk_overlap_percent: col("knowledge_bases.chunk_overlap_percent"),
    },
    db: {
      select: () => ({ from: () => ({ where: () => whereResult() }) }),
      update: () => ({ set: () => ({ where: () => whereResult() }) }),
    },
    eq: (left: unknown, right: unknown) => ({ eq: [left, right] }),
    snakeToCamel: (row: Record<string, unknown>) => row,
  };
});

vi.mock("../core/authz.js", () => ({
  requireAdminOrServiceCaller: () => Promise.resolve(),
}));

vi.mock("./kb-manager-dispatch.js", () => ({
  dispatchKbManager: (...args: unknown[]) => {
    dispatchCalls.push(args);
    return Promise.resolve();
  },
}));

const ctx = { auth: { authType: "cognito" } } as any;
const existing = {
  tenant_id: "t1",
  chunking_strategy: "FIXED_SIZE",
  chunk_size_tokens: 300,
  chunk_overlap_percent: 20,
};

beforeEach(() => {
  reset();
  vi.resetModules();
});

describe("updateKnowledgeBase re-chunk dispatch (U8)", () => {
  it("dispatches rechunk when a chunking field changes", async () => {
    selectQueue.push([existing]);
    updateQueue.push([{ id: "kb-1", chunk_size_tokens: 500 }]);
    const { updateKnowledgeBase } = await import(
      "./updateKnowledgeBase.mutation.js"
    );
    await updateKnowledgeBase(
      null,
      { id: "kb-1", input: { chunkSizeTokens: 500 } },
      ctx,
    );
    expect(dispatchCalls).toEqual([["rechunk", "kb-1"]]);
  });

  it("does not dispatch for a name-only edit", async () => {
    selectQueue.push([existing]);
    updateQueue.push([{ id: "kb-1", name: "Renamed" }]);
    const { updateKnowledgeBase } = await import(
      "./updateKnowledgeBase.mutation.js"
    );
    await updateKnowledgeBase(
      null,
      { id: "kb-1", input: { name: "Renamed" } },
      ctx,
    );
    expect(dispatchCalls).toHaveLength(0);
  });

  it("does not dispatch when chunking is set to its current value", async () => {
    selectQueue.push([existing]);
    updateQueue.push([{ id: "kb-1" }]);
    const { updateKnowledgeBase } = await import(
      "./updateKnowledgeBase.mutation.js"
    );
    await updateKnowledgeBase(
      null,
      { id: "kb-1", input: { chunkSizeTokens: 300, chunkOverlapPercent: 20 } },
      ctx,
    );
    expect(dispatchCalls).toHaveLength(0);
  });
});
