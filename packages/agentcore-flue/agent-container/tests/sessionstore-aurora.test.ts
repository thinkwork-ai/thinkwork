/**
 * Plan §005 U4 — AuroraSessionStore tests.
 *
 * Persists Flue's `SessionData` blobs against `threads.session_data` via the
 * AWS RDS Data API. The store is constructed per-invocation with the agent
 * runtime's tenantId snapshot, so every save/load/delete carries an explicit
 * `tenant_id = $tenantId` predicate — fail-closed if the snapshot is empty.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  RDSDataClient,
  ExecuteStatementCommand,
} from "@aws-sdk/client-rds-data";
import { AuroraSessionStore } from "../src/sessionstore-aurora.js";
import type { SessionData } from "../src/flue-session-types.js";

const RDS = mockClient(RDSDataClient);

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";
const AGENT_X = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const AGENT_Y = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const THREAD_S = "33333333-3333-3333-3333-333333333333";
const CLUSTER_ARN = "arn:aws:rds:us-east-1:000000000000:cluster:thinkwork-test-db";
const SECRET_ARN = "arn:aws:secretsmanager:us-east-1:000000000000:secret:thinkwork-test-db";

function sampleData(overrides: Partial<SessionData> = {}): SessionData {
  return {
    version: 2,
    entries: [
      {
        type: "message",
        id: "e1",
        parentId: null,
        timestamp: "2026-05-03T20:00:00.000Z",
        message: { role: "user", content: "hello" } as never,
      },
    ],
    leafId: "e1",
    metadata: {},
    createdAt: "2026-05-03T20:00:00.000Z",
    updatedAt: "2026-05-03T20:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  RDS.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AuroraSessionStore.save → load (happy path)", () => {
  it("writes a session and reads it back under the same (tenantId, threadId)", async () => {
    const stored: SessionData[] = [];

    RDS.on(ExecuteStatementCommand).callsFake((input) => {
      const sql = (input as { sql?: string }).sql ?? "";
      const params = ((input as { parameters?: unknown[] }).parameters ?? []) as Array<{
        name?: string;
        value?: { stringValue?: string };
      }>;
      const get = (name: string) =>
        params.find((p) => p.name === name)?.value?.stringValue ?? null;

      if (sql.startsWith("UPDATE threads") && sql.includes("SET session_data")) {
        const data = JSON.parse(get("session_data") ?? "null") as SessionData;
        stored.push(data);
        return { numberOfRecordsUpdated: 1 };
      }
      if (sql.startsWith("SELECT session_data")) {
        const last = stored[stored.length - 1];
        return {
          records: last
            ? [[{ stringValue: JSON.stringify(last) }]]
            : [[{ isNull: true }]],
        };
      }
      throw new Error(`unmocked SQL: ${sql}`);
    });

    const store = new AuroraSessionStore({
      tenantId: TENANT_A,
      agentId: AGENT_X,
      clusterArn: CLUSTER_ARN,
      secretArn: SECRET_ARN,
    });

    const data = sampleData();
    await store.save(THREAD_S, data);

    const loaded = await store.load(THREAD_S);
    expect(loaded).toEqual(data);
  });

  it("preserves entry ordering across two save() calls (multi-message append)", async () => {
    const updates: SessionData[] = [];
    RDS.on(ExecuteStatementCommand).callsFake((input) => {
      const sql = (input as { sql?: string }).sql ?? "";
      const params = ((input as { parameters?: unknown[] }).parameters ?? []) as Array<{
        name?: string;
        value?: { stringValue?: string };
      }>;
      const get = (name: string) =>
        params.find((p) => p.name === name)?.value?.stringValue ?? null;
      if (sql.startsWith("UPDATE threads")) {
        updates.push(JSON.parse(get("session_data") ?? "null") as SessionData);
        return { numberOfRecordsUpdated: 1 };
      }
      if (sql.startsWith("SELECT session_data")) {
        const last = updates[updates.length - 1];
        return {
          records: last ? [[{ stringValue: JSON.stringify(last) }]] : [[{ isNull: true }]],
        };
      }
      throw new Error(`unmocked SQL: ${sql}`);
    });

    const store = new AuroraSessionStore({
      tenantId: TENANT_A,
      agentId: AGENT_X,
      clusterArn: CLUSTER_ARN,
      secretArn: SECRET_ARN,
    });

    const first = sampleData({
      entries: [
        { type: "message", id: "e1", parentId: null, timestamp: "t1", message: { role: "user", content: "first" } as never },
      ],
      leafId: "e1",
    });
    await store.save(THREAD_S, first);

    const second: SessionData = {
      ...first,
      entries: [
        ...first.entries,
        { type: "message", id: "e2", parentId: "e1", timestamp: "t2", message: { role: "assistant", content: "ack" } as never },
        { type: "message", id: "e3", parentId: "e2", timestamp: "t3", message: { role: "user", content: "third" } as never },
      ],
      leafId: "e3",
      updatedAt: "t3",
    };
    await store.save(THREAD_S, second);

    const loaded = await store.load(THREAD_S);
    expect(loaded?.entries.map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
    expect(loaded?.leafId).toBe("e3");
  });
});

describe("AuroraSessionStore — fail-closed missing tenantId", () => {
  it("throws synchronously from the constructor when tenantId is empty", () => {
    expect(
      () =>
        new AuroraSessionStore({
          tenantId: "",
          clusterArn: CLUSTER_ARN,
          secretArn: SECRET_ARN,
        }),
    ).toThrow(/tenantId/i);
  });

  it("throws when tenantId is null", () => {
    expect(
      () =>
        new AuroraSessionStore({
          tenantId: null as unknown as string,
          clusterArn: CLUSTER_ARN,
          secretArn: SECRET_ARN,
        }),
    ).toThrow(/tenantId/i);
  });

  it("throws when clusterArn is empty (Terraform comment promises this)", () => {
    expect(
      () =>
        new AuroraSessionStore({
          tenantId: TENANT_A,
      agentId: AGENT_X,
          clusterArn: "",
          secretArn: SECRET_ARN,
        }),
    ).toThrow(/clusterArn/i);
  });

  it("throws when secretArn is empty", () => {
    expect(
      () =>
        new AuroraSessionStore({
          tenantId: TENANT_A,
      agentId: AGENT_X,
          clusterArn: CLUSTER_ARN,
          secretArn: "",
        }),
    ).toThrow(/secretArn/i);
  });
});

describe("AuroraSessionStore — cross-tenant isolation (FR-4a)", () => {
  it("(tenantA, threadS) cannot read a session written under (tenantB, threadS)", async () => {
    // Simulate the database having TENANT_B's row for THREAD_S. The store
    // for TENANT_A must surface NULL because its WHERE clause includes
    // `tenant_id = TENANT_A`, which filters out TENANT_B's row.
    RDS.on(ExecuteStatementCommand).callsFake((input) => {
      const sql = (input as { sql?: string }).sql ?? "";
      const params = ((input as { parameters?: unknown[] }).parameters ?? []) as Array<{
        name?: string;
        value?: { stringValue?: string };
      }>;
      const get = (name: string) =>
        params.find((p) => p.name === name)?.value?.stringValue ?? null;
      const tenantId = get("tenant_id");
      if (sql.startsWith("SELECT session_data")) {
        if (tenantId === TENANT_B) {
          return {
            records: [
              [{ stringValue: JSON.stringify(sampleData({ leafId: "tenantB-leaf" })) }],
            ],
          };
        }
        // Anyone else (TENANT_A in this test) gets a row-not-found.
        return { records: [] };
      }
      throw new Error(`unmocked SQL: ${sql}`);
    });

    const storeA = new AuroraSessionStore({
      tenantId: TENANT_A,
      agentId: AGENT_X,
      clusterArn: CLUSTER_ARN,
      secretArn: SECRET_ARN,
    });
    const storeB = new AuroraSessionStore({
      tenantId: TENANT_B,
      agentId: AGENT_X,
      clusterArn: CLUSTER_ARN,
      secretArn: SECRET_ARN,
    });

    const fromA = await storeA.load(THREAD_S);
    const fromB = await storeB.load(THREAD_S);

    expect(fromA).toBeNull();
    expect(fromB?.leafId).toBe("tenantB-leaf");
  });

  it("save() includes tenant_id in the WHERE predicate so cross-tenant writes are no-ops", async () => {
    let lastUpdate: { tenant_id: string | null; thread_id: string | null } | null = null;
    RDS.on(ExecuteStatementCommand).callsFake((input) => {
      const sql = (input as { sql?: string }).sql ?? "";
      const params = ((input as { parameters?: unknown[] }).parameters ?? []) as Array<{
        name?: string;
        value?: { stringValue?: string };
      }>;
      const get = (name: string) =>
        params.find((p) => p.name === name)?.value?.stringValue ?? null;
      if (sql.startsWith("UPDATE threads")) {
        lastUpdate = {
          tenant_id: get("tenant_id"),
          thread_id: get("thread_id"),
        };
        // Simulate `numberOfRecordsUpdated = 0` for a cross-tenant write
        // attempt (no row matches the WHERE clause).
        if (get("tenant_id") === TENANT_A) return { numberOfRecordsUpdated: 0 };
        return { numberOfRecordsUpdated: 1 };
      }
      throw new Error(`unmocked SQL: ${sql}`);
    });

    const storeA = new AuroraSessionStore({
      tenantId: TENANT_A,
      agentId: AGENT_X,
      clusterArn: CLUSTER_ARN,
      secretArn: SECRET_ARN,
    });

    // Save attempt from TENANT_A's store — UPDATE matches zero rows
    // (the row is owned by TENANT_B in this fixture), so save() throws.
    await expect(storeA.save(THREAD_S, sampleData())).rejects.toThrow(/no thread/i);
    expect(lastUpdate).toMatchObject({ tenant_id: TENANT_A, thread_id: THREAD_S });
  });
});

describe("AuroraSessionStore — agent reassignment isolation (adv-001)", () => {
  it("agent_X cannot load a session that was written when threads.agent_id = agent_Y", async () => {
    // Simulate threads.agent_id = AGENT_Y in the DB (e.g. an
    // escalateThread mutation reassigned the thread). A store bound to
    // AGENT_X must see "no session" because the predicate filters out
    // the row.
    RDS.on(ExecuteStatementCommand).callsFake((input) => {
      const sql = (input as { sql?: string }).sql ?? "";
      const params = ((input as { parameters?: unknown[] }).parameters ?? []) as Array<{
        name?: string;
        value?: { stringValue?: string };
      }>;
      const get = (name: string) =>
        params.find((p) => p.name === name)?.value?.stringValue ?? null;
      if (sql.startsWith("SELECT session_data")) {
        if (get("agent_id") === AGENT_Y) {
          return {
            records: [
              [{ stringValue: JSON.stringify(sampleData({ leafId: "agentY-leaf" })) }],
            ],
          };
        }
        // AGENT_X (or anyone else) gets row-not-found.
        return { records: [] };
      }
      throw new Error(`unmocked SQL: ${sql}`);
    });

    const storeX = new AuroraSessionStore({
      tenantId: TENANT_A,
      agentId: AGENT_X,
      clusterArn: CLUSTER_ARN,
      secretArn: SECRET_ARN,
    });
    const storeY = new AuroraSessionStore({
      tenantId: TENANT_A,
      agentId: AGENT_Y,
      clusterArn: CLUSTER_ARN,
      secretArn: SECRET_ARN,
    });

    expect(await storeX.load(THREAD_S)).toBeNull();
    expect((await storeY.load(THREAD_S))?.leafId).toBe("agentY-leaf");
  });

  it("save() throws when the thread has been reassigned to a different agent mid-flight", async () => {
    let lastUpdate: { tenant_id: string | null; agent_id: string | null; thread_id: string | null } | null = null;
    RDS.on(ExecuteStatementCommand).callsFake((input) => {
      const sql = (input as { sql?: string }).sql ?? "";
      const params = ((input as { parameters?: unknown[] }).parameters ?? []) as Array<{
        name?: string;
        value?: { stringValue?: string };
      }>;
      const get = (name: string) =>
        params.find((p) => p.name === name)?.value?.stringValue ?? null;
      if (sql.startsWith("UPDATE threads")) {
        lastUpdate = {
          tenant_id: get("tenant_id"),
          thread_id: get("thread_id"),
          agent_id: get("agent_id"),
        };
        // The thread now belongs to AGENT_Y; AGENT_X's UPDATE matches zero rows.
        return { numberOfRecordsUpdated: get("agent_id") === AGENT_Y ? 1 : 0 };
      }
      throw new Error(`unmocked SQL: ${sql}`);
    });

    const storeX = new AuroraSessionStore({
      tenantId: TENANT_A,
      agentId: AGENT_X,
      clusterArn: CLUSTER_ARN,
      secretArn: SECRET_ARN,
    });

    await expect(storeX.save(THREAD_S, sampleData())).rejects.toThrow(/different agent/i);
    expect(lastUpdate).toMatchObject({
      tenant_id: TENANT_A,
      agent_id: AGENT_X,
      thread_id: THREAD_S,
    });
  });
});

describe("AuroraSessionStore — load returns null for missing rows", () => {
  it("returns null when the thread has no session_data yet", async () => {
    RDS.on(ExecuteStatementCommand).resolves({ records: [] });
    const store = new AuroraSessionStore({
      tenantId: TENANT_A,
      agentId: AGENT_X,
      clusterArn: CLUSTER_ARN,
      secretArn: SECRET_ARN,
    });
    const loaded = await store.load(THREAD_S);
    expect(loaded).toBeNull();
  });

  it("returns null when the row exists but session_data is NULL", async () => {
    RDS.on(ExecuteStatementCommand).resolves({
      records: [[{ isNull: true }]],
    });
    const store = new AuroraSessionStore({
      tenantId: TENANT_A,
      agentId: AGENT_X,
      clusterArn: CLUSTER_ARN,
      secretArn: SECRET_ARN,
    });
    const loaded = await store.load(THREAD_S);
    expect(loaded).toBeNull();
  });

  it("treats the jsonb literal `null` as 'no session yet' (not as a SessionData of null shape)", async () => {
    // Some out-of-band writer could store the jsonb literal `null` (vs SQL
    // NULL). RDS Data API returns it as the string "null", which JSON.parse
    // resolves to JS null. Without the defensive guard, the caller would
    // see a non-null cell pass through and try to access SessionData fields
    // on a null reference. The guard maps it back to "no session yet".
    RDS.on(ExecuteStatementCommand).resolves({
      records: [[{ stringValue: "null" }]],
    });
    const store = new AuroraSessionStore({
      tenantId: TENANT_A,
      agentId: AGENT_X,
      clusterArn: CLUSTER_ARN,
      secretArn: SECRET_ARN,
    });
    const loaded = await store.load(THREAD_S);
    expect(loaded).toBeNull();
  });
});

describe("AuroraSessionStore.delete", () => {
  it("clears session_data without removing the thread row", async () => {
    let lastSql = "";
    RDS.on(ExecuteStatementCommand).callsFake((input) => {
      lastSql = (input as { sql?: string }).sql ?? "";
      return { numberOfRecordsUpdated: 1 };
    });

    const store = new AuroraSessionStore({
      tenantId: TENANT_A,
      agentId: AGENT_X,
      clusterArn: CLUSTER_ARN,
      secretArn: SECRET_ARN,
    });
    await store.delete(THREAD_S);

    // The contract is "set session_data to NULL" — leave thread metadata
    // and message history intact so the admin UI's thread view still
    // renders. A future caller can re-save() if Flue resumes the thread.
    expect(lastSql).toMatch(/UPDATE threads/);
    expect(lastSql).toMatch(/SET session_data\s*=\s*NULL/);
    expect(lastSql).not.toMatch(/DELETE FROM threads/);
  });

  it("includes tenant_id in the WHERE predicate (FR-4a parity with save/load)", async () => {
    let lastSql = "";
    let lastTenantParam: string | null = null;
    RDS.on(ExecuteStatementCommand).callsFake((input) => {
      lastSql = (input as { sql?: string }).sql ?? "";
      const params = ((input as { parameters?: unknown[] }).parameters ?? []) as Array<{
        name?: string;
        value?: { stringValue?: string };
      }>;
      lastTenantParam =
        params.find((p) => p.name === "tenant_id")?.value?.stringValue ?? null;
      return { numberOfRecordsUpdated: 1 };
    });

    const store = new AuroraSessionStore({
      tenantId: TENANT_A,
      agentId: AGENT_X,
      clusterArn: CLUSTER_ARN,
      secretArn: SECRET_ARN,
    });
    await store.delete(THREAD_S);

    // A future refactor that drops the predicate would erase another
    // tenant's session_data — this assertion locks the predicate in
    // place even if the surrounding SQL changes.
    expect(lastSql).toMatch(/WHERE\s+id\s*=\s*CAST\(:thread_id\s+AS\s+uuid\)\s+AND\s+tenant_id\s*=\s*CAST\(:tenant_id\s+AS\s+uuid\)/);
    expect(lastTenantParam).toBe(TENANT_A);
  });
});

describe("AuroraSessionStore — error path", () => {
  it("surfaces RDS Data API errors as a typed Aurora session error", async () => {
    RDS.on(ExecuteStatementCommand).rejects(new Error("BadRequestException: cluster paused"));

    const store = new AuroraSessionStore({
      tenantId: TENANT_A,
      agentId: AGENT_X,
      clusterArn: CLUSTER_ARN,
      secretArn: SECRET_ARN,
    });

    await expect(store.load(THREAD_S)).rejects.toThrow(/cluster paused/);
  });
});

describe("AuroraSessionStore — interface conformance", () => {
  it("structurally matches Flue's SessionStore interface (save/load/delete)", () => {
    const store = new AuroraSessionStore({
      tenantId: TENANT_A,
      agentId: AGENT_X,
      clusterArn: CLUSTER_ARN,
      secretArn: SECRET_ARN,
    });
    expect(typeof store.save).toBe("function");
    expect(typeof store.load).toBe("function");
    expect(typeof store.delete).toBe("function");
    expect(store.save.length).toBe(2); // (id, data)
    expect(store.load.length).toBe(1); // (id)
    expect(store.delete.length).toBe(1); // (id)
  });
});
