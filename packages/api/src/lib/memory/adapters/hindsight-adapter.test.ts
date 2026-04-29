import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.hoisted(() => vi.fn());

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    execute: executeMock,
  }),
}));

import { HindsightAdapter } from "./hindsight-adapter.js";

const USER_ID = "4dee701a-c17b-46fe-9f38-a333d4c3fad0";
const TENANT_ID = "0015953e-aa13-4cab-8398-2e70f73dda63";

describe("HindsightAdapter legacy user bank reads", () => {
  beforeEach(() => {
    executeMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses documented recall budget and token fields instead of max_results", async () => {
    executeMock.mockResolvedValueOnce({ rows: [] });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        memory_units: [
          {
            id: "memory-1",
            text: "fast memory",
            combined_score: 0.73,
            created_at: "2026-04-26T10:00:00.000Z",
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HindsightAdapter({
      endpoint: "https://hindsight.example",
    });
    const result = await adapter.recall({
      tenantId: TENANT_ID,
      ownerType: "user",
      ownerId: USER_ID,
      query: "Smoke Tests 27 April 2026",
      limit: 3,
      depth: "quick",
    });

    expect(result[0]?.score).toBe(0.73);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(executeMock).not.toHaveBeenCalled();
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(body).toEqual({
      query: "Smoke Tests 27 April 2026",
      budget: "low",
      max_tokens: 500,
      types: ["world", "experience", "observation"],
      include: { entities: null },
    });
    expect(body).not.toHaveProperty("max_results");
  });

  it("only fans recall out to legacy banks when explicitly requested", async () => {
    executeMock.mockResolvedValueOnce({
      rows: [
        {
          id: "c1e4434f-fa28-4ba2-bdd5-5d47f9d92e2c",
          slug: "fleet-caterpillar-456",
          name: "Marco",
        },
      ],
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ memory_units: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HindsightAdapter({
      endpoint: "https://hindsight.example",
    });
    await adapter.recall({
      tenantId: TENANT_ID,
      ownerType: "user",
      ownerId: USER_ID,
      query: "legacy search",
      hindsight: { includeLegacyBanks: true },
    });

    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      `https://hindsight.example/v1/default/banks/user_${USER_ID}/memories/recall`,
      "https://hindsight.example/v1/default/banks/fleet-caterpillar-456/memories/recall",
      "https://hindsight.example/v1/default/banks/marco/memories/recall",
      "https://hindsight.example/v1/default/banks/c1e4434f-fa28-4ba2-bdd5-5d47f9d92e2c/memories/recall",
      "https://hindsight.example/v1/default/banks/user_c1e4434f-fa28-4ba2-bdd5-5d47f9d92e2c/memories/recall",
    ]);
  });

  it("maps Hindsight reflect responses into a synthesized memory hit", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        text: "Smoke test activity on 27 April 2026 involved Codex and MCP checks.",
        based_on: [{ id: "memory-1" }],
        usage: { total_tokens: 123 },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HindsightAdapter({
      endpoint: "https://hindsight.example",
    });
    const result = await adapter.reflect({
      tenantId: TENANT_ID,
      ownerType: "user",
      ownerId: USER_ID,
      query: "Smoke Tests 27 April 2026",
      depth: "quick",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      `https://hindsight.example/v1/default/banks/user_${USER_ID}/reflect`,
    );
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      query: "Smoke Tests 27 April 2026",
      budget: "low",
      max_tokens: 500,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.record.kind).toBe("reflection");
    expect(result[0]?.record.content.text).toContain("Smoke test activity");
    expect(result[0]?.record.metadata).toMatchObject({
      bankId: `user_${USER_ID}`,
      basedOn: ["memory-1"],
      usage: { total_tokens: 123 },
    });
  });

  it("lists memories from the new user bank and paired legacy agent bank", async () => {
    executeMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: "c1e4434f-fa28-4ba2-bdd5-5d47f9d92e2c",
            slug: "fleet-caterpillar-456",
            name: "Marco",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          row({
            id: "00000000-0000-0000-0000-000000000001",
            bank_id: `user_${USER_ID}`,
            text: "new-bank memory",
            created_at: "2026-04-26T10:00:00.000Z",
          }),
          row({
            id: "00000000-0000-0000-0000-000000000002",
            bank_id: "fleet-caterpillar-456",
            text: "legacy-bank memory",
            created_at: "2026-04-25T10:00:00.000Z",
          }),
        ],
      });

    const adapter = new HindsightAdapter({
      endpoint: "https://hindsight.example",
    });
    const records = await adapter.inspect({
      tenantId: TENANT_ID,
      ownerType: "user",
      ownerId: USER_ID,
    });

    expect(records.map((r) => r.content.text)).toEqual([
      "new-bank memory",
      "legacy-bank memory",
    ]);
    expect(records.map((r) => r.metadata?.bankId)).toEqual([
      `user_${USER_ID}`,
      "fleet-caterpillar-456",
    ]);
  });

  it("feeds legacy bank rows into the wiki compile cursor", async () => {
    executeMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: "c1e4434f-fa28-4ba2-bdd5-5d47f9d92e2c",
            slug: "fleet-caterpillar-456",
            name: "Marco",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          row({
            id: "00000000-0000-0000-0000-000000000003",
            bank_id: "fleet-caterpillar-456",
            text: "compile me",
            created_at: "2026-04-24T10:00:00.000Z",
            updated_at: "2026-04-24T10:00:00.000Z",
            cursor_ts: "2026-04-24T10:00:00.000Z",
          }),
        ],
      });

    const adapter = new HindsightAdapter({
      endpoint: "https://hindsight.example",
    });
    const result = await adapter.listRecordsUpdatedSince?.({
      tenantId: TENANT_ID,
      ownerId: USER_ID,
      limit: 100,
    });

    expect(result?.records).toHaveLength(1);
    expect(result?.records[0]?.metadata?.bankId).toBe("fleet-caterpillar-456");
    expect(result?.nextCursor?.recordId).toBe(
      "00000000-0000-0000-0000-000000000003",
    );
  });
});

function row(overrides: Record<string, unknown>) {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    bank_id: `user_${USER_ID}`,
    text: "memory",
    context: "thinkwork_thread",
    fact_type: "world",
    event_date: null,
    occurred_start: null,
    occurred_end: null,
    mentioned_at: null,
    tags: [],
    access_count: 0,
    proof_count: 0,
    metadata: {},
    created_at: "2026-04-26T10:00:00.000Z",
    updated_at: null,
    ...overrides,
  };
}
