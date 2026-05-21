import { beforeEach, describe, expect, it, vi } from "vitest";

const { selectQueue, deleteTables, insertValues, authCalls, resetMocks } =
  vi.hoisted(() => {
    const selectQueue: unknown[][] = [];
    const deleteTables: unknown[] = [];
    const insertValues: unknown[] = [];
    const authCalls: unknown[] = [];
    return {
      selectQueue,
      deleteTables,
      insertValues,
      authCalls,
      resetMocks: () => {
        selectQueue.length = 0;
        deleteTables.length = 0;
        insertValues.length = 0;
        authCalls.length = 0;
      },
    };
  });

vi.mock("../../utils.js", () => {
  const col = (name: string) => ({ name });
  const selectChain = {
    from: () => ({
      where: () => Promise.resolve(selectQueue.shift() ?? []),
    }),
  };
  const tx = {
    delete: (table: unknown) => {
      deleteTables.push(table);
      return {
        where: () => Promise.resolve(),
      };
    },
    insert: () => ({
      values: (values: Record<string, unknown>[]) => {
        insertValues.push(values);
        return {
          returning: () =>
            Promise.resolve(
              values.map((value, index) => ({
                id: `space-kb-${index + 1}`,
                ...value,
                created_at: new Date("2026-05-21T00:00:00Z"),
              })),
            ),
        };
      },
    }),
  };

  return {
    knowledgeBases: {
      id: col("knowledge_bases.id"),
      tenant_id: col("knowledge_bases.tenant_id"),
    },
    spaceKnowledgeBases: {
      tenant_id: col("space_knowledge_bases.tenant_id"),
      space_id: col("space_knowledge_bases.space_id"),
    },
    spaces: { id: col("spaces.id"), tenant_id: col("spaces.tenant_id") },
    db: {
      select: () => selectChain,
      transaction: async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx),
    },
    and: (...items: unknown[]) => ({ and: items }),
    eq: (left: unknown, right: unknown) => ({ eq: [left, right] }),
    inArray: (left: unknown, right: unknown) => ({ inArray: [left, right] }),
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
    authCalls.push(args);
    return Promise.resolve();
  },
}));

vi.mock("./shared.js", () => ({
  toGraphqlSpaceChild: (row: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key.replace(/_([a-z])/g, (_, char) => char.toUpperCase()),
        value,
      ]),
    ),
}));

describe("setSpaceKnowledgeBases", () => {
  beforeEach(() => {
    resetMocks();
    vi.resetModules();
  });

  it("replaces a Space's knowledge-base assignments", async () => {
    selectQueue.push(
      [{ id: "space-1" }],
      [{ id: "kb-1" }, { id: "kb-2" }],
      [
        { id: "kb-1", name: "Runbooks", status: "active" },
        { id: "kb-2", name: "Customer Docs", status: "active" },
      ],
    );
    const { setSpaceKnowledgeBases } = await import(
      "./setSpaceKnowledgeBases.mutation.js"
    );

    const result = await setSpaceKnowledgeBases(
      null,
      {
        input: {
          tenantId: "tenant-1",
          spaceId: "space-1",
          knowledgeBases: [
            { knowledgeBaseId: "kb-1", enabled: true },
            { knowledgeBaseId: "kb-2", enabled: false },
          ],
        },
      },
      { auth: { authType: "cognito" } } as any,
    );

    expect(authCalls[0]).toEqual([
      { auth: { authType: "cognito" } },
      "tenant-1",
      "set_space_knowledge_bases",
    ]);
    expect(deleteTables).toHaveLength(1);
    expect(insertValues[0]).toEqual([
      {
        tenant_id: "tenant-1",
        space_id: "space-1",
        knowledge_base_id: "kb-1",
        enabled: true,
        search_config: null,
      },
      {
        tenant_id: "tenant-1",
        space_id: "space-1",
        knowledge_base_id: "kb-2",
        enabled: false,
        search_config: null,
      },
    ]);
    expect(result).toEqual([
      expect.objectContaining({
        id: "space-kb-1",
        tenantId: "tenant-1",
        spaceId: "space-1",
        knowledgeBaseId: "kb-1",
        enabled: true,
        knowledgeBase: expect.objectContaining({
          id: "kb-1",
          name: "Runbooks",
        }),
      }),
      expect.objectContaining({
        id: "space-kb-2",
        knowledgeBaseId: "kb-2",
        enabled: false,
        knowledgeBase: expect.objectContaining({
          id: "kb-2",
          name: "Customer Docs",
        }),
      }),
    ]);
  });

  it("allows clearing all Space knowledge bases", async () => {
    selectQueue.push([{ id: "space-1" }]);
    const { setSpaceKnowledgeBases } = await import(
      "./setSpaceKnowledgeBases.mutation.js"
    );

    const result = await setSpaceKnowledgeBases(
      null,
      {
        input: {
          tenantId: "tenant-1",
          spaceId: "space-1",
          knowledgeBases: [],
        },
      },
      { auth: { authType: "cognito" } } as any,
    );

    expect(result).toEqual([]);
    expect(deleteTables).toHaveLength(1);
    expect(insertValues).toHaveLength(0);
  });

  it("rejects missing or cross-tenant knowledge bases before writing", async () => {
    selectQueue.push([{ id: "space-1" }], [{ id: "kb-1" }]);
    const { setSpaceKnowledgeBases } = await import(
      "./setSpaceKnowledgeBases.mutation.js"
    );

    await expect(
      setSpaceKnowledgeBases(
        null,
        {
          input: {
            tenantId: "tenant-1",
            spaceId: "space-1",
            knowledgeBases: [
              { knowledgeBaseId: "kb-1" },
              { knowledgeBaseId: "other-tenant-kb" },
            ],
          },
        },
        { auth: { authType: "cognito" } } as any,
      ),
    ).rejects.toThrow("Knowledge base not found for tenant");

    expect(deleteTables).toHaveLength(0);
    expect(insertValues).toHaveLength(0);
  });
});
