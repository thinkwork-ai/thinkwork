import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, threadParticipants, mockResolveCaller, captured } = vi.hoisted(
  () => {
    const cap: {
      table: unknown;
      set: Record<string, unknown> | undefined;
      where: unknown;
      returnRows: { id: string }[];
    } = { table: undefined, set: undefined, where: undefined, returnRows: [] };
    const col = (name: string) => ({ __col: name });
    const db = {
      update: vi.fn((table: unknown) => {
        cap.table = table;
        return {
          set: vi.fn((values: Record<string, unknown>) => {
            cap.set = values;
            return {
              where: vi.fn((cond: unknown) => {
                cap.where = cond;
                return { returning: vi.fn(async () => cap.returnRows) };
              }),
            };
          }),
        };
      }),
    };
    return {
      mockDb: db,
      threadParticipants: {
        __table__: "thread_participants",
        id: col("id"),
        tenant_id: col("tenant_id"),
        participant_type: col("participant_type"),
        user_id: col("user_id"),
        thread_id: col("thread_id"),
        last_read_at: col("last_read_at"),
        updated_at: col("updated_at"),
      },
      mockResolveCaller: vi.fn(
        async () =>
          ({ userId: "user-1", tenantId: "tenant-1" }) as {
            userId: string | null;
            tenantId: string | null;
          },
      ),
      captured: cap,
    };
  },
);

vi.mock("@thinkwork/database-pg", () => ({ getDb: () => mockDb }));
vi.mock("@thinkwork/database-pg/schema", () => ({ threadParticipants }));
vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ __and: conditions }),
  eq: (field: unknown, value: unknown) => ({ __eq: { field, value } }),
  inArray: (field: unknown, values: unknown) => ({
    __inArray: { field, values },
  }),
}));
vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCaller: mockResolveCaller,
}));

import { markThreadsRead } from "./markThreadsRead.mutation.js";

const ctx = { auth: { authType: "cognito" } } as never;

/** Flatten the captured `and(...)` predicate's eq/inArray leaves for assertions. */
function whereLeaves() {
  const conds = (captured.where as { __and: unknown[] }).__and;
  const eqs = new Map<string, unknown>();
  let inArrayValues: unknown;
  for (const c of conds) {
    if (c && typeof c === "object" && "__eq" in c) {
      const { field, value } = (c as { __eq: { field: any; value: unknown } })
        .__eq;
      eqs.set(field.__col, value);
    }
    if (c && typeof c === "object" && "__inArray" in c) {
      inArrayValues = (c as { __inArray: { values: unknown } }).__inArray
        .values;
    }
  }
  return { eqs, inArrayValues };
}

beforeEach(() => {
  captured.table = undefined;
  captured.set = undefined;
  captured.where = undefined;
  captured.returnRows = [];
  mockDb.update.mockClear();
  mockResolveCaller.mockResolvedValue({
    userId: "user-1",
    tenantId: "tenant-1",
  });
});

describe("markThreadsRead", () => {
  it("marks the listed threads read, scoped to the caller's tenant+user, and returns the updated count", async () => {
    captured.returnRows = [{ id: "p-1" }, { id: "p-2" }];

    const result = await markThreadsRead(
      {},
      { input: { threadIds: ["t-1", "t-2"], read: true } },
      ctx,
    );

    expect(result).toEqual({ updated: 2 });
    expect(captured.table).toBe(threadParticipants);
    expect(captured.set?.last_read_at).toBeInstanceOf(Date);
    const { eqs, inArrayValues } = whereLeaves();
    // Tenant + user come from the resolved caller, never the input.
    expect(eqs.get("tenant_id")).toBe("tenant-1");
    expect(eqs.get("user_id")).toBe("user-1");
    expect(eqs.get("participant_type")).toBe("user");
    expect(inArrayValues).toEqual(["t-1", "t-2"]);
  });

  it("marks unread (last_read_at = null) when read:false", async () => {
    captured.returnRows = [{ id: "p-1" }];

    const result = await markThreadsRead(
      {},
      { input: { threadIds: ["t-1"], read: false } },
      ctx,
    );

    expect(result).toEqual({ updated: 1 });
    expect(captured.set?.last_read_at).toBeNull();
  });

  it("defaults to read:true when read is omitted", async () => {
    captured.returnRows = [{ id: "p-1" }];
    await markThreadsRead({}, { input: { threadIds: ["t-1"] } }, ctx);
    expect(captured.set?.last_read_at).toBeInstanceOf(Date);
  });

  it("dedupes thread ids and trims blanks before the write", async () => {
    captured.returnRows = [{ id: "p-1" }, { id: "p-2" }];
    await markThreadsRead(
      {},
      { input: { threadIds: ["t-1", " t-1 ", "t-2", ""], read: true } },
      ctx,
    );
    const { inArrayValues } = whereLeaves();
    expect(inArrayValues).toEqual(["t-1", "t-2"]);
  });

  it("returns updated:0 without touching the db for an empty id list", async () => {
    const result = await markThreadsRead(
      {},
      { input: { threadIds: [], read: true } },
      ctx,
    );
    expect(result).toEqual({ updated: 0 });
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("is a no-op (updated:0) when the caller is not a participant in any listed thread", async () => {
    // The scoped WHERE matches zero rows; no upsert, no error.
    captured.returnRows = [];
    const result = await markThreadsRead(
      {},
      { input: { threadIds: ["t-foreign", "t-not-joined"], read: true } },
      ctx,
    );
    expect(result).toEqual({ updated: 0 });
    const { eqs } = whereLeaves();
    // Still scoped to the caller — a non-participant id can't widen the write.
    expect(eqs.get("user_id")).toBe("user-1");
  });

  it("scopes the write to the RESOLVED tenant, not any client-supplied value", async () => {
    // Google-federated caller resolving to a specific tenant via resolveCaller.
    mockResolveCaller.mockResolvedValue({
      userId: "user-9",
      tenantId: "tenant-9",
    });
    captured.returnRows = [{ id: "p-9" }];
    await markThreadsRead(
      {},
      { input: { threadIds: ["t-1"], read: true } },
      ctx,
    );
    const { eqs } = whereLeaves();
    expect(eqs.get("tenant_id")).toBe("tenant-9");
    expect(eqs.get("user_id")).toBe("user-9");
  });

  it("throws UNAUTHENTICATED and never writes when the caller identity is unresolved", async () => {
    mockResolveCaller.mockResolvedValue({ userId: null, tenantId: null });
    await expect(
      markThreadsRead({}, { input: { threadIds: ["t-1"], read: true } }, ctx),
    ).rejects.toThrow("Caller identity required");
    expect(mockDb.update).not.toHaveBeenCalled();
  });
});
