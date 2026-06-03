import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  selectQueue,
  updateQueue,
  insertValues,
  deleteTables,
  adminCalls,
  memberCalls,
  state,
  reset,
} = vi.hoisted(() => {
  const selectQueue: unknown[][] = [];
  const updateQueue: unknown[][] = [];
  const insertValues: unknown[] = [];
  const deleteTables: unknown[] = [];
  const adminCalls: unknown[][] = [];
  const memberCalls: unknown[][] = [];
  const state = { adminThrow: false, memberThrow: false };
  return {
    selectQueue,
    updateQueue,
    insertValues,
    deleteTables,
    adminCalls,
    memberCalls,
    state,
    reset: () => {
      selectQueue.length = 0;
      updateQueue.length = 0;
      insertValues.length = 0;
      deleteTables.length = 0;
      adminCalls.length = 0;
      memberCalls.length = 0;
      state.adminThrow = false;
      state.memberThrow = false;
    },
  };
});

vi.mock("../../utils.js", () => {
  const col = (name: string) => ({ name });
  const whereResult = () => ({
    // Awaited directly by most resolvers (consumes one queued select)…
    then: (resolve: (value: unknown) => void) =>
      resolve(selectQueue.shift() ?? []),
    // …or chained with .orderBy() by the list query (same consumption).
    orderBy: () => Promise.resolve(selectQueue.shift() ?? []),
  });
  const selectChain = {
    from: () => ({ where: () => whereResult() }),
  };
  return {
    knowledgeBases: {
      id: col("knowledge_bases.id"),
      tenant_id: col("knowledge_bases.tenant_id"),
      created_at: col("knowledge_bases.created_at"),
    },
    agents: { id: col("agents.id"), tenant_id: col("agents.tenant_id") },
    agentKnowledgeBases: {
      agent_id: col("agent_knowledge_bases.agent_id"),
      knowledge_base_id: col("agent_knowledge_bases.knowledge_base_id"),
    },
    db: {
      select: () => selectChain,
      update: () => ({
        set: () => ({
          where: () => ({
            returning: () => Promise.resolve(updateQueue.shift() ?? []),
          }),
        }),
      }),
      insert: () => ({
        values: (
          values: Record<string, unknown> | Record<string, unknown>[],
        ) => {
          const arr = Array.isArray(values) ? values : [values];
          insertValues.push(arr);
          return {
            returning: () =>
              Promise.resolve(
                arr.map((value, index) => ({ id: `kb-${index}`, ...value })),
              ),
          };
        },
      }),
      delete: (table: unknown) => {
        deleteTables.push(table);
        return { where: () => Promise.resolve() };
      },
    },
    and: (...items: unknown[]) => ({ and: items }),
    eq: (left: unknown, right: unknown) => ({ eq: [left, right] }),
    inArray: (left: unknown, right: unknown) => ({ inArray: [left, right] }),
    desc: (value: unknown) => ({ desc: value }),
    generateSlug: () => "generated-slug",
    getKbManagerFnArn: () => Promise.resolve(null),
    snakeToCamel: (row: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          key.replace(/_([a-z])/g, (_, char) => char.toUpperCase()),
          value,
        ]),
      ),
  };
});

vi.mock("../core/authz.js", () => ({
  requireAdminOrServiceCaller: (...args: unknown[]) => {
    adminCalls.push(args);
    return state.adminThrow
      ? Promise.reject(new Error("forbidden"))
      : Promise.resolve();
  },
  requireTenantMember: (...args: unknown[]) => {
    memberCalls.push(args);
    return state.memberThrow
      ? Promise.reject(new Error("forbidden"))
      : Promise.resolve();
  },
}));

const cognitoCtx = { auth: { authType: "cognito" } } as any;

beforeEach(() => {
  reset();
  vi.resetModules();
});

describe("createKnowledgeBase authz", () => {
  it("gates on the input tenant before inserting", async () => {
    const { createKnowledgeBase } =
      await import("./createKnowledgeBase.mutation.js");
    await createKnowledgeBase(
      null,
      { input: { tenantId: "tenant-1", name: "Policies" } },
      cognitoCtx,
    );
    expect(adminCalls).toHaveLength(1);
    expect(adminCalls[0][1]).toBe("tenant-1");
    expect(insertValues).toHaveLength(1);
  });

  it("rejects and never inserts when the gate throws", async () => {
    state.adminThrow = true;
    const { createKnowledgeBase } =
      await import("./createKnowledgeBase.mutation.js");
    await expect(
      createKnowledgeBase(
        null,
        { input: { tenantId: "tenant-1", name: "Policies" } },
        cognitoCtx,
      ),
    ).rejects.toThrow();
    expect(insertValues).toHaveLength(0);
  });
});

describe("updateKnowledgeBase authz", () => {
  it("derives the tenant pin from the row, then gates", async () => {
    selectQueue.push([{ tenant_id: "tenant-9" }]); // existing row lookup
    updateQueue.push([{ id: "kb-1", tenant_id: "tenant-9", name: "New" }]);
    const { updateKnowledgeBase } =
      await import("./updateKnowledgeBase.mutation.js");
    await updateKnowledgeBase(
      null,
      { id: "kb-1", input: { name: "New" } },
      cognitoCtx,
    );
    expect(adminCalls[0][1]).toBe("tenant-9");
  });

  it("throws on missing KB without calling the gate", async () => {
    selectQueue.push([]); // no existing row
    const { updateKnowledgeBase } =
      await import("./updateKnowledgeBase.mutation.js");
    await expect(
      updateKnowledgeBase(null, { id: "missing", input: {} }, cognitoCtx),
    ).rejects.toThrow();
    expect(adminCalls).toHaveLength(0);
  });
});

describe("deleteKnowledgeBase authz", () => {
  it("does not mutate when the gate throws", async () => {
    state.adminThrow = true;
    selectQueue.push([{ tenant_id: "tenant-3" }]);
    const { deleteKnowledgeBase } =
      await import("./deleteKnowledgeBase.mutation.js");
    await expect(
      deleteKnowledgeBase(null, { id: "kb-1" }, cognitoCtx),
    ).rejects.toThrow();
    expect(adminCalls).toHaveLength(1); // gate ran…
    expect(deleteTables).toHaveLength(0); // …and the mutation never proceeded
  });
});

describe("syncKnowledgeBase authz", () => {
  it("gates on the row tenant before kicking off ingestion", async () => {
    selectQueue.push([{ tenant_id: "tenant-7" }]);
    updateQueue.push([
      { id: "kb-1", tenant_id: "tenant-7", status: "syncing" },
    ]);
    const { syncKnowledgeBase } =
      await import("./syncKnowledgeBase.mutation.js");
    await syncKnowledgeBase(null, { id: "kb-1" }, cognitoCtx);
    expect(adminCalls[0][1]).toBe("tenant-7");
  });
});

describe("setAgentKnowledgeBases authz", () => {
  it("rejects a KB id from another tenant and never deletes bindings", async () => {
    selectQueue.push([{ tenant_id: "tenant-1" }]); // agent lookup
    selectQueue.push([]); // tenant KB validation — none match (foreign id)
    const { setAgentKnowledgeBases } =
      await import("./setAgentKnowledgeBases.mutation.js");
    await expect(
      setAgentKnowledgeBases(
        null,
        {
          agentId: "agent-1",
          knowledgeBases: [{ knowledgeBaseId: "foreign" }],
        },
        cognitoCtx,
      ),
    ).rejects.toThrow(/tenant/i);
    expect(adminCalls).toHaveLength(1);
    expect(deleteTables).toHaveLength(0); // validation precedes the delete
  });

  it("throws on a missing agent without deleting bindings", async () => {
    selectQueue.push([]); // agent lookup — none
    const { setAgentKnowledgeBases } =
      await import("./setAgentKnowledgeBases.mutation.js");
    await expect(
      setAgentKnowledgeBases(
        null,
        { agentId: "missing", knowledgeBases: [] },
        cognitoCtx,
      ),
    ).rejects.toThrow();
    expect(adminCalls).toHaveLength(0);
    expect(deleteTables).toHaveLength(0);
  });
});

describe("knowledge base read queries are tenant-scoped", () => {
  it("knowledgeBases_ requires membership of the requested tenant", async () => {
    state.memberThrow = true;
    const { knowledgeBases_ } = await import("./knowledgeBases.query.js");
    await expect(
      knowledgeBases_(null, { tenantId: "other-tenant" }, cognitoCtx),
    ).rejects.toThrow();
    expect(memberCalls[0][1]).toBe("other-tenant");
  });

  it("knowledgeBase checks membership against the row's tenant", async () => {
    selectQueue.push([{ id: "kb-1", tenant_id: "tenant-5" }]);
    const { knowledgeBase } = await import("./knowledgeBase.query.js");
    await knowledgeBase(null, { id: "kb-1" }, cognitoCtx);
    expect(memberCalls[0][1]).toBe("tenant-5");
  });

  it("knowledgeBase returns null for a missing row without a membership check", async () => {
    selectQueue.push([]);
    const { knowledgeBase } = await import("./knowledgeBase.query.js");
    const result = await knowledgeBase(null, { id: "missing" }, cognitoCtx);
    expect(result).toBeNull();
    expect(memberCalls).toHaveLength(0);
  });
});
