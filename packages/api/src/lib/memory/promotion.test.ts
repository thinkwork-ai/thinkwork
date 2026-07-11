import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.hoisted(() => vi.fn());
const insertValuesMock = vi.hoisted(() => vi.fn());

vi.mock("@thinkwork/database-pg", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@thinkwork/database-pg")>();
  const handle = () => ({
    execute: executeMock,
    insert: () => ({ values: insertValuesMock }),
  });
  return {
    getDb: handle,
    getHindsightDb: handle,
    resolveHindsightDb: <T,>(primary: T) => primary,
    hindsightSql: actual.hindsightSql,
  };
});

import {
  listTenantBankMemories,
  promoteSpaceMemoriesToTenant,
} from "./promotion.js";

const TENANT_ID = "0015953e-aa13-4cab-8398-2e70f73dda63";
const SPACE_ID = "958bb3f6-1508-4ac9-8ba3-6d5bea586a00";
const MEM_A = "aaaaaaaa-0000-0000-0000-000000000001";
const MEM_B = "aaaaaaaa-0000-0000-0000-000000000002";
const MEM_C = "aaaaaaaa-0000-0000-0000-000000000003";
const ACTOR = "4dee701a-c17b-46fe-9f38-a333d4c3fad0";

function renderedSql(call: unknown[]): string {
  return JSON.stringify(
    (call[0] as { queryChunks?: unknown })?.queryChunks ?? call[0],
  );
}

describe("promoteSpaceMemoriesToTenant", () => {
  beforeEach(() => {
    executeMock.mockReset();
    insertValuesMock.mockReset().mockResolvedValue(undefined);
  });

  it("copies verbatim with provenance, idempotently, and audits", async () => {
    executeMock
      // Source presence: A and B exist, C does not.
      .mockResolvedValueOnce({ rows: [{ id: MEM_A }, { id: MEM_B }] })
      // Already promoted: B.
      .mockResolvedValueOnce({ rows: [{ source_id: MEM_B }] })
      // banks upsert, documents copy, units copy.
      .mockResolvedValue({ rows: [] });

    const result = await promoteSpaceMemoriesToTenant({
      tenantId: TENANT_ID,
      spaceId: SPACE_ID,
      memoryIds: [MEM_A, MEM_B, MEM_C],
      justification: "Corroborated Acme pricing signal",
      actorId: ACTOR,
    });

    expect(result).toEqual({
      promoted: [MEM_A],
      alreadyPromoted: [MEM_B],
      missing: [MEM_C],
    });

    // Statements: presence check, idempotency check, banks upsert,
    // documents copy, units copy.
    expect(executeMock).toHaveBeenCalledTimes(5);
    const statements = executeMock.mock.calls.map(renderedSql);
    expect(statements[2]).toContain("banks");
    expect(statements[3]).toContain("documents");
    expect(statements[4]).toContain("memory_units");
    // The copy preserves the embedding column (verbatim copy, not re-retain)
    // and stamps provenance keys.
    expect(statements[4]).toContain("embedding");
    expect(statements[4]).toContain("sourceBankId");
    expect(statements[4]).toContain("sourceMemoryId");
    expect(statements[4]).toContain("promotedAt");

    // One audit row with actor + justification.
    expect(insertValuesMock).toHaveBeenCalledTimes(1);
    expect(insertValuesMock.mock.calls[0][0]).toMatchObject({
      tenant_id: TENANT_ID,
      actor_id: ACTOR,
      action: "tenant_memory_promotion",
      metadata: expect.objectContaining({
        justification: "Corroborated Acme pricing signal",
        memoryIds: [MEM_A],
      }),
    });
  });

  it("is a no-op (no writes, no audit) when everything is already promoted", async () => {
    executeMock
      .mockResolvedValueOnce({ rows: [{ id: MEM_A }] })
      .mockResolvedValueOnce({ rows: [{ source_id: MEM_A }] });

    const result = await promoteSpaceMemoriesToTenant({
      tenantId: TENANT_ID,
      spaceId: SPACE_ID,
      memoryIds: [MEM_A],
      justification: "re-run",
      actorId: ACTOR,
    });

    expect(result).toEqual({
      promoted: [],
      alreadyPromoted: [MEM_A],
      missing: [],
    });
    expect(executeMock).toHaveBeenCalledTimes(2);
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("rejects a missing justification before touching the database", async () => {
    await expect(
      promoteSpaceMemoriesToTenant({
        tenantId: TENANT_ID,
        spaceId: SPACE_ID,
        memoryIds: [MEM_A],
        justification: "   ",
        actorId: ACTOR,
      }),
    ).rejects.toThrow(/justification/);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("rejects non-UUID memory ids before touching the database", async () => {
    await expect(
      promoteSpaceMemoriesToTenant({
        tenantId: TENANT_ID,
        spaceId: SPACE_ID,
        memoryIds: ["robert'); DROP TABLE memory_units;--"],
        justification: "x",
        actorId: ACTOR,
      }),
    ).rejects.toThrow(/UUID/);
    expect(executeMock).not.toHaveBeenCalled();
  });
});

describe("listTenantBankMemories", () => {
  beforeEach(() => {
    executeMock.mockReset();
  });

  it("returns provenance + access counts from the tenant bank", async () => {
    executeMock.mockResolvedValueOnce({
      rows: [
        {
          id: MEM_A,
          content: "Acme raised pricing concerns",
          fact_type: "world",
          source_bank_id: `space_${SPACE_ID}`,
          source_memory_id: MEM_B,
          source_timestamp: "2026-07-01 00:00:00+00",
          promoted_by: ACTOR,
          promoted_at: "2026-07-11 13:00:00+00",
          justification: "Corroborated",
          access_count: 3,
          created_at: "2026-07-01 00:00:00+00",
        },
      ],
    });

    const rows = await listTenantBankMemories({ tenantId: TENANT_ID });
    expect(rows).toEqual([
      {
        id: MEM_A,
        content: "Acme raised pricing concerns",
        factType: "world",
        sourceBankId: `space_${SPACE_ID}`,
        sourceMemoryId: MEM_B,
        sourceTimestamp: "2026-07-01 00:00:00+00",
        promotedBy: ACTOR,
        promotedAt: "2026-07-11 13:00:00+00",
        justification: "Corroborated",
        accessCount: 3,
        createdAt: "2026-07-01 00:00:00+00",
      },
    ]);
    expect(renderedSql(executeMock.mock.calls[0])).toContain(
      "memory_units",
    );
  });
});
