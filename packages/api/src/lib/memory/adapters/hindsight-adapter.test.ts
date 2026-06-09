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

  it("upserts requester memory markdown as a stable replaceable document", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ memory_units: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HindsightAdapter({
      endpoint: "https://hindsight.example/",
    });
    await adapter.upsertMarkdownMemoryDocument({
      tenantId: TENANT_ID,
      ownerType: "user",
      ownerId: USER_ID,
      path: "memory/MEMORY.md",
      content: "# Durable requester memory",
      documentId: `requester_memory:${USER_ID}:memory/MEMORY.md`,
      context: "thinkwork_requester_memory",
      metadata: {
        runId: "run-1",
        threadId: "thread-1",
        beforeHash: "old",
        afterHash: "new",
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      `https://hindsight.example/v1/default/banks/user_${USER_ID}/memories`,
    );
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      async: true,
      items: [
        {
          content: "# Durable requester memory",
          document_id: `requester_memory:${USER_ID}:memory/MEMORY.md`,
          update_mode: "replace",
          context: "thinkwork_requester_memory",
          metadata: {
            tenantId: TENANT_ID,
            userId: USER_ID,
            path: "memory/MEMORY.md",
            source: "requester_memory_markdown",
            runId: "run-1",
            threadId: "thread-1",
            beforeHash: "old",
            afterHash: "new",
          },
        },
      ],
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

describe("HindsightAdapter bank configuration", () => {
  const DESIRED = {
    observations_mission: "Durable institutional facts about the business",
    enable_observations: true,
    enable_auto_consolidation: true,
  };

  beforeEach(() => {
    executeMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function jsonResponse(body: unknown, ok = true, status = 200) {
    return {
      ok,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  }

  function retainConversationArgs() {
    return {
      tenantId: TENANT_ID,
      ownerType: "user" as const,
      ownerId: USER_ID,
      threadId: "11111111-2222-3333-4444-555555555555",
      messages: [
        {
          role: "user" as const,
          content: "hello",
          timestamp: "2026-06-09T10:00:00.000Z",
        },
      ],
    };
  }

  it("PUTs desired config when the bank has no overrides", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ config: {}, overrides: {} }))
      .mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HindsightAdapter({
      endpoint: "https://hindsight.example",
      bankConfig: DESIRED,
    });
    await adapter.retainConversation(retainConversationArgs());

    const calls = fetchMock.mock.calls;
    expect(String(calls[0]?.[0])).toBe(
      `https://hindsight.example/v1/default/banks/user_${USER_ID}/config`,
    );
    expect(calls[0]?.[1]?.method).toBe("GET");
    expect(calls[1]?.[1]?.method).toBe("PUT");
    expect(JSON.parse(calls[1]?.[1]?.body as string)).toEqual(DESIRED);
    expect(String(calls[2]?.[0])).toContain("/memories");
  });

  it("skips the PUT when overrides already match", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ config: {}, overrides: DESIRED }))
      .mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HindsightAdapter({
      endpoint: "https://hindsight.example",
      bankConfig: DESIRED,
    });
    await adapter.retainConversation(retainConversationArgs());

    const methods = fetchMock.mock.calls.map((c) => c[1]?.method);
    expect(methods).toEqual(["GET", "POST"]);
  });

  it("PUTs when one configured field drifted", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          config: {},
          overrides: { ...DESIRED, observations_mission: "stale mission" },
        }),
      )
      .mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HindsightAdapter({
      endpoint: "https://hindsight.example",
      bankConfig: DESIRED,
    });
    await adapter.retainConversation(retainConversationArgs());

    const methods = fetchMock.mock.calls.map((c) => c[1]?.method);
    expect(methods).toEqual(["GET", "PUT", "POST"]);
  });

  it("proceeds with the write on config failure; cooldown skips immediate re-GET", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init: any) => {
      if (String(url).endsWith("/config")) {
        return Promise.resolve(jsonResponse({ error: "boom" }, false, 500));
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HindsightAdapter({
      endpoint: "https://hindsight.example",
      bankConfig: DESIRED,
    });
    await adapter.retainConversation(retainConversationArgs());
    await adapter.retainConversation(retainConversationArgs());

    const configCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).endsWith("/config"),
    );
    const memoryCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("/memories"),
    );
    // Both writes landed; the failure is not cached as success, but the
    // 60s cooldown prevents re-GETting on the immediately-following write.
    expect(configCalls).toHaveLength(1);
    expect(memoryCalls).toHaveLength(2);
  });

  it("dedupes concurrent ensures into one config GET", async () => {
    let resolveGet: (value: unknown) => void = () => {};
    const gate = new Promise((resolve) => {
      resolveGet = resolve;
    });
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).endsWith("/config")) {
        await gate;
        return jsonResponse({ config: {}, overrides: DESIRED });
      }
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HindsightAdapter({
      endpoint: "https://hindsight.example",
      bankConfig: DESIRED,
    });
    const writes = Promise.all([
      adapter.retainConversation(retainConversationArgs()),
      adapter.retainDailyMemory({
        tenantId: TENANT_ID,
        ownerType: "user",
        ownerId: USER_ID,
        date: "2026-06-09",
        content: "daily digest",
      }),
    ]);
    resolveGet(undefined);
    await writes;

    const configCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).endsWith("/config"),
    );
    expect(configCalls).toHaveLength(1);
  });

  it("treats string-echoed override values as matching (no perpetual PUT)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          config: {},
          overrides: {
            observations_mission: DESIRED.observations_mission,
            enable_observations: "true",
            enable_auto_consolidation: "true",
          },
        }),
      )
      .mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HindsightAdapter({
      endpoint: "https://hindsight.example",
      bankConfig: DESIRED,
    });
    await adapter.retainConversation(retainConversationArgs());

    const methods = fetchMock.mock.calls.map((c) => c[1]?.method);
    expect(methods).toEqual(["GET", "POST"]);
  });

  it("public ensureBankConfigured never throws on a non-UUID owner", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HindsightAdapter({
      endpoint: "https://hindsight.example",
      bankConfig: DESIRED,
    });
    await expect(
      adapter.ensureBankConfigured("not-a-uuid"),
    ).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("caches a configured bank for the container lifetime", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ config: {}, overrides: DESIRED }))
      .mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HindsightAdapter({
      endpoint: "https://hindsight.example",
      bankConfig: DESIRED,
    });
    await adapter.retainConversation(retainConversationArgs());
    await adapter.retainConversation(retainConversationArgs());

    const configCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).endsWith("/config"),
    );
    expect(configCalls).toHaveLength(1);
  });

  it("is a no-op when no bank config is set", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HindsightAdapter({
      endpoint: "https://hindsight.example",
      bankConfig: null,
    });
    await adapter.retainConversation(retainConversationArgs());

    const configCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).endsWith("/config"),
    );
    expect(configCalls).toHaveLength(0);
  });

  it("resolveBankConfigFromEnv reads env lazily and returns null when unset", async () => {
    const { resolveBankConfigFromEnv } = await import("./hindsight-adapter.js");
    expect(resolveBankConfigFromEnv({})).toBeNull();
    expect(
      resolveBankConfigFromEnv({
        HINDSIGHT_BANK_OBSERVATIONS_MISSION: "institutional facts",
        HINDSIGHT_BANK_ENABLE_OBSERVATIONS: "true",
        HINDSIGHT_BANK_ENABLE_AUTO_CONSOLIDATION: "false",
      }),
    ).toEqual({
      observations_mission: "institutional facts",
      enable_observations: true,
      enable_auto_consolidation: false,
    });
  });
});

describe("HindsightAdapter observation consumption", () => {
  beforeEach(() => {
    executeMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses freshness and proof signals into record metadata, null when absent", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        memory_units: [
          {
            id: "obs-1",
            text: "consolidated belief",
            score: 0.9,
            fact_type: "observation",
            freshness: "strengthening",
            proof_count: 4,
            created_at: "2026-06-01T00:00:00.000Z",
          },
          {
            id: "raw-1",
            text: "raw fact without signals",
            score: 0.5,
            fact_type: "world",
            created_at: "2026-06-01T00:00:00.000Z",
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HindsightAdapter({
      endpoint: "https://hindsight.example",
      bankConfig: null,
    });
    const result = await adapter.recall({
      tenantId: TENANT_ID,
      ownerType: "user",
      ownerId: USER_ID,
      query: "beliefs",
    });

    const obs = result.find((r) => r.record.id === "obs-1");
    const raw = result.find((r) => r.record.id === "raw-1");
    expect(obs?.record.metadata?.freshness).toBe("strengthening");
    expect(obs?.record.metadata?.proofCount).toBe(4);
    expect(raw?.record.metadata?.freshness).toBeNull();
  });

  it("ranks observations ahead of raw facts at equal score", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        memory_units: [
          {
            id: "raw-1",
            text: "raw fact",
            score: 0.7,
            fact_type: "experience",
            created_at: "2026-06-01T00:00:00.000Z",
          },
          {
            id: "obs-1",
            text: "observation",
            score: 0.7,
            fact_type: "observation",
            created_at: "2026-06-01T00:00:00.000Z",
          },
          {
            id: "raw-2",
            text: "higher raw fact",
            score: 0.9,
            fact_type: "world",
            created_at: "2026-06-01T00:00:00.000Z",
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HindsightAdapter({
      endpoint: "https://hindsight.example",
      bankConfig: null,
    });
    const result = await adapter.recall({
      tenantId: TENANT_ID,
      ownerType: "user",
      ownerId: USER_ID,
      query: "ordering",
    });

    expect(result.map((r) => r.record.id)).toEqual(["raw-2", "obs-1", "raw-1"]);
  });

  it("consolidateBank POSTs the consolidate endpoint and throws on failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
        text: async () => "",
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: async () => ({}),
        text: async () => "unsupported",
      });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HindsightAdapter({
      endpoint: "https://hindsight.example",
      bankConfig: null,
    });
    await adapter.consolidateBank(USER_ID);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      `https://hindsight.example/v1/default/banks/user_${USER_ID}/consolidate`,
    );

    await expect(adapter.consolidateBankById("legacy-bank")).rejects.toThrow(
      /consolidate failed bank=legacy-bank/,
    );
  });
});
