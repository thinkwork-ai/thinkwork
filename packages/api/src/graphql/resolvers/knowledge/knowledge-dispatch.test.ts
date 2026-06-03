import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateSets, deleteTables, updateQueue, state, reset } = vi.hoisted(
  () => {
    const updateSets: Record<string, unknown>[] = [];
    const deleteTables: string[] = [];
    const updateQueue: unknown[][] = [];
    const state = { dispatchThrow: false };
    return {
      updateSets,
      deleteTables,
      updateQueue,
      state,
      reset: () => {
        updateSets.length = 0;
        deleteTables.length = 0;
        updateQueue.length = 0;
        state.dispatchThrow = false;
      },
    };
  },
);

vi.mock("../../utils.js", () => {
  const col = (name: string) => ({ name });
  const named = (name: string) => ({ table: name });
  const whereResult = () => ({
    then: (resolve: (value: unknown) => void) => resolve([{ tenant_id: "t1" }]),
    returning: () => Promise.resolve(updateQueue.shift() ?? [{ id: "kb-0" }]),
  });
  return {
    knowledgeBases: Object.assign(named("knowledge_bases"), {
      id: col("knowledge_bases.id"),
      tenant_id: col("knowledge_bases.tenant_id"),
    }),
    agentKnowledgeBases: Object.assign(named("agent_knowledge_bases"), {
      knowledge_base_id: col("agent_knowledge_bases.knowledge_base_id"),
    }),
    spaceKnowledgeBases: Object.assign(named("space_knowledge_bases"), {
      knowledge_base_id: col("space_knowledge_bases.knowledge_base_id"),
    }),
    db: {
      select: () => ({ from: () => ({ where: () => whereResult() }) }),
      insert: () => ({
        values: (v: Record<string, unknown>) => ({
          returning: () => Promise.resolve([{ id: "kb-0", ...v }]),
        }),
      }),
      update: () => ({
        set: (obj: Record<string, unknown>) => {
          updateSets.push(obj);
          return { where: () => whereResult() };
        },
      }),
      delete: (table: { table: string }) => {
        deleteTables.push(table.table);
        return { where: () => Promise.resolve() };
      },
    },
    eq: (left: unknown, right: unknown) => ({ eq: [left, right] }),
    generateSlug: () => "slug",
    snakeToCamel: (row: Record<string, unknown>) => row,
  };
});

vi.mock("../core/authz.js", () => ({
  requireAdminOrServiceCaller: () => Promise.resolve(),
}));

vi.mock("./kb-manager-dispatch.js", () => ({
  dispatchKbManager: () =>
    state.dispatchThrow
      ? Promise.reject(new Error("no arn"))
      : Promise.resolve(),
}));

const ctx = { auth: { authType: "cognito" } } as any;

beforeEach(() => {
  reset();
  vi.resetModules();
});

describe("createKnowledgeBase dispatch surfacing (U6)", () => {
  it("marks the KB failed and throws when dispatch fails", async () => {
    state.dispatchThrow = true;
    const { createKnowledgeBase } =
      await import("./createKnowledgeBase.mutation.js");
    await expect(
      createKnowledgeBase(
        null,
        { input: { tenantId: "t1", name: "Policies" } },
        ctx,
      ),
    ).rejects.toThrow(/provisioning/i);
    // The recovery state: status flipped to failed with a reason (U9 retry).
    expect(updateSets.some((s) => s.status === "failed")).toBe(true);
    expect(updateSets.some((s) => typeof s.error_message === "string")).toBe(
      true,
    );
  });
});

describe("syncKnowledgeBase dispatch surfacing (U6)", () => {
  it("rolls back to active with FAILED sync status and throws", async () => {
    state.dispatchThrow = true;
    updateQueue.push([{ id: "kb-0", status: "syncing" }]); // the syncing update
    const { syncKnowledgeBase } =
      await import("./syncKnowledgeBase.mutation.js");
    await expect(syncKnowledgeBase(null, { id: "kb-0" }, ctx)).rejects.toThrow(
      /sync/i,
    );
    const failure = updateSets.find((s) => s.last_sync_status === "FAILED");
    expect(failure).toBeTruthy();
    expect(failure?.status).toBe("active");
  });
});

describe("deleteKnowledgeBase teardown (U6)", () => {
  it("clears both agent and space bindings", async () => {
    const { deleteKnowledgeBase } =
      await import("./deleteKnowledgeBase.mutation.js");
    const result = await deleteKnowledgeBase(null, { id: "kb-0" }, ctx);
    expect(result).toBe(true);
    expect(deleteTables).toContain("agent_knowledge_bases");
    expect(deleteTables).toContain("space_knowledge_bases");
  });

  it("returns true even when Bedrock teardown dispatch fails", async () => {
    state.dispatchThrow = true;
    const { deleteKnowledgeBase } =
      await import("./deleteKnowledgeBase.mutation.js");
    await expect(deleteKnowledgeBase(null, { id: "kb-0" }, ctx)).resolves.toBe(
      true,
    );
    expect(deleteTables).toContain("space_knowledge_bases");
  });
});
