import { describe, expect, it, vi } from "vitest";

import {
  collectTenantObservationCandidates,
  enumerateTenantBanks,
  loadObservationsKnowledgeGraphSource,
} from "./observations-source.js";

const TENANT_ID = "0015953e-aa13-4cab-8398-2e70f73dda63";
const USER_A = "4dee701a-c17b-46fe-9f38-a333d4c3fad0";
const USER_B = "84381488-f071-7073-6bc7-d6238c147538";

function obsRow(id: string, ts: string) {
  return {
    id,
    text: `observation ${id}`,
    source_memory_ids: ["00000000-0000-0000-0000-0000000000f1"],
    cursor_ts: ts,
  };
}

/** Routes db.execute by SQL substring so multi-query flows stay readable. */
function routeDb(routes: Array<{ match: string; rows: unknown[][] }>) {
  const counters = new Map<string, number>();
  const execute = vi.fn(async (query: any) => {
    const text = JSON.stringify(query?.queryChunks ?? query) ?? "";
    for (const route of routes) {
      if (text.includes(route.match)) {
        const n = counters.get(route.match) ?? 0;
        counters.set(route.match, n + 1);
        return { rows: route.rows[Math.min(n, route.rows.length - 1)] ?? [] };
      }
    }
    return { rows: [] };
  });
  return { db: { execute } as any, execute };
}

const allInstitutional = async (items: Array<{ id: string; text: string }>) =>
  new Map(items.map((item) => [item.id, "institutional" as const]));

describe("enumerateTenantBanks", () => {
  it("maps tenant users to user_<uuid> banks", async () => {
    const { db } = routeDb([
      { match: "FROM users", rows: [[{ id: USER_A }, { id: USER_B }]] },
    ]);
    const banks = await enumerateTenantBanks(db, TENANT_ID);
    expect(banks).toEqual([
      { bankId: `user_${USER_A}`, userId: USER_A },
      { bankId: `user_${USER_B}`, userId: USER_B },
    ]);
  });
});

describe("collectTenantObservationCandidates", () => {
  it("reads each bank with per-bank cursors and reports next cursors", async () => {
    const { db } = routeDb([
      { match: "FROM users", rows: [[{ id: USER_A }, { id: USER_B }]] },
      {
        match: "hindsight.memory_units",
        rows: [
          // One call per bank: a partial page (< page size) means drained.
          [
            obsRow(
              "00000000-0000-0000-0000-00000000000a",
              "2026-06-09T01:00:00.000Z",
            ),
          ],
          [
            obsRow(
              "00000000-0000-0000-0000-00000000000b",
              "2026-06-09T02:00:00.000Z",
            ),
          ],
        ],
      },
    ]);
    const batch = await collectTenantObservationCandidates({
      db,
      tenantId: TENANT_ID,
      cursors: new Map(),
    });
    expect(batch.candidates.map((c) => c.id)).toEqual([
      "00000000-0000-0000-0000-00000000000a",
      "00000000-0000-0000-0000-00000000000b",
    ]);
    expect(batch.candidates[0]?.bankId).toBe(`user_${USER_A}`);
    expect(batch.nextCursors.get(`user_${USER_A}`)?.recordId).toBe(
      "00000000-0000-0000-0000-00000000000a",
    );
    expect(batch.truncated).toBe(false);
  });

  it("caps candidates per run and flags truncation", async () => {
    const rows = Array.from({ length: 3 }, (_, i) =>
      obsRow(
        `00000000-0000-0000-0000-00000000010${i}`,
        `2026-06-09T0${i + 1}:00:00.000Z`,
      ),
    );
    const { db } = routeDb([
      { match: "FROM users", rows: [[{ id: USER_A }, { id: USER_B }]] },
      { match: "hindsight.memory_units", rows: [rows.slice(0, 2)] },
    ]);
    const batch = await collectTenantObservationCandidates({
      db,
      tenantId: TENANT_ID,
      cursors: new Map(),
      maxCandidates: 2,
    });
    expect(batch.candidates).toHaveLength(2);
    expect(batch.truncated).toBe(true);
  });
});

describe("loadObservationsKnowledgeGraphSource", () => {
  it("builds a bundle from promoted observations with audit diagnostics", async () => {
    const { db } = routeDb([
      { match: "knowledge_graph_observation_cursors", rows: [[]] },
      { match: "FROM users", rows: [[{ id: USER_A }]] },
      {
        match: "hindsight.memory_units",
        rows: [
          // Call 1: bank read (partial page → drained). Call 2: the gate's
          // proof lookup against the same table; no thread context.
          [
            obsRow(
              "00000000-0000-0000-0000-00000000000a",
              "2026-06-09T01:00:00.000Z",
            ),
          ],
          [
            {
              id: "00000000-0000-0000-0000-0000000000f1",
              thread_id: null,
            },
          ],
        ],
      },
    ]);
    const result = await loadObservationsKnowledgeGraphSource({
      db,
      tenantId: TENANT_ID,
      sourceRef: `tenant:${TENANT_ID}:observations`,
      sourceLabel: "Tenant observations",
      gateDeps: { classify: allInstitutional },
    });

    expect(result.bundle.sourceKind).toBe("observations");
    expect(result.bundle.packetCount).toBe(1);
    expect(result.bundle.evidence[0]?.evidenceSourceKind).toBe(
      "hindsight_observation",
    );
    expect(result.bundle.diagnostics.promotedCount).toBe(1);
    expect(result.bundle.diagnostics.classifierPromptVersion).toBe("v1");
    expect(result.gate.audit.promotedIds).toHaveLength(1);
    expect(result.nextCursors.size).toBe(1);
  });

  it("produces an empty bundle when no new observations exist", async () => {
    const { db } = routeDb([
      { match: "knowledge_graph_observation_cursors", rows: [[]] },
      { match: "FROM users", rows: [[{ id: USER_A }]] },
      { match: "hindsight.memory_units", rows: [[]] },
    ]);
    const result = await loadObservationsKnowledgeGraphSource({
      db,
      tenantId: TENANT_ID,
      sourceRef: `tenant:${TENANT_ID}:observations`,
      sourceLabel: "Tenant observations",
      gateDeps: { classify: allInstitutional },
    });
    expect(result.candidateCount).toBe(0);
    expect(result.bundle.packetCount).toBe(0);
    expect(result.nextCursors.size).toBe(0);
  });
});
