import { describe, expect, it, vi } from "vitest";

import { applyDreamRun } from "./applier.js";
import {
  EVAL_FIXTURE_PATTERN,
  JUNK_MEMORY_PATTERN,
  planBankActions,
} from "./planner.js";
import { runBrainDreamState } from "./runner.js";

const TENANT = "0015953e-aa13-4cab-8398-2e70f73dda63";
const BANK = "user_4dee701a-c17b-46fe-9f38-a333d4c3fad0";

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

describe("planner patterns", () => {
  const junkRe = new RegExp(JUNK_MEMORY_PATTERN, "i");
  const fixtureRe = new RegExp(EVAL_FIXTURE_PATTERN, "i");

  it("junk pattern catches engine chatter, spares real memories", () => {
    expect(junkRe.test("No contradictions have been observed.")).toBe(true);
    expect(junkRe.test("no new contradictions observed")).toBe(true);
    expect(junkRe.test("No new information was retained.")).toBe(true);
    // Real memories that merely mention contradictions survive.
    expect(
      junkRe.test("Eric said the Q3 report contradictions were resolved by finance."),
    ).toBe(false);
    expect(junkRe.test("Birdie's favorite toy is Orbit.")).toBe(false);
  });

  it("fixture pattern matches smoke residue only", () => {
    expect(fixtureRe.test("my user orbit checksum 8a9a4d57")).toBe(true);
    expect(fixtureRe.test("UserMarkerff3cbac6")).toBe(true);
    expect(fixtureRe.test("The deploy checksum step passed")).toBe(false);
  });
});

describe("planBankActions", () => {
  it("stages quarantine → forget → consolidate in order", async () => {
    const { db } = routeDb([
      {
        match: "evalTraffic",
        rows: [[{ id: "q1", document_id: "doc-1" }]],
      },
      { match: "btrim(text)", rows: [[{ id: "j1" }]] },
    ]);
    const plan = await planBankActions({ db, bankId: BANK });
    expect(plan.map((a) => a.actionType)).toEqual([
      "quarantine",
      "forget",
      "consolidate",
    ]);
    expect(plan[0]?.target?.memoryUnitIds).toEqual(["q1"]);
    expect(plan[0]?.target?.documentIds).toEqual(["doc-1"]);
    expect(plan.map((a) => a.ordinal)).toEqual([0, 1, 2]);
  });

  it("plans only consolidation for a clean bank", async () => {
    const { db } = routeDb([]);
    const plan = await planBankActions({ db, bankId: BANK });
    expect(plan.map((a) => a.actionType)).toEqual(["consolidate"]);
  });
});

describe("applyDreamRun", () => {
  it("applies only staged rows and marks each applied (no double-apply on resume)", async () => {
    const consolidate = vi.fn().mockResolvedValue(undefined);
    // Simulates a resumed run: quarantine was already applied in the crashed
    // attempt (not returned as staged); only forget + consolidate remain.
    const { db, execute } = routeDb([
      {
        match: "status = 'staged'",
        rows: [
          [
            {
              id: "a2",
              ordinal: 1,
              action_type: "forget",
              target: { memoryUnitIds: ["u1", "u2"] },
              reason: "junk",
            },
            {
              id: "a3",
              ordinal: 2,
              action_type: "consolidate",
              target: null,
              reason: "native",
            },
          ],
        ],
      },
    ]);

    const result = await applyDreamRun({
      db,
      consolidator: { consolidateBankById: consolidate },
      runId: "run-1",
      bankId: BANK,
    });

    expect(result).toEqual({ applied: 2, skipped: 0, failed: false });
    expect(consolidate).toHaveBeenCalledWith(BANK);
    const texts = execute.mock.calls.map((call) =>
      JSON.stringify(call[0]?.queryChunks ?? call[0]),
    );
    // One delete (forget), two applied markers, no quarantine delete.
    expect(texts.filter((t) => t.includes("DELETE FROM hindsight.memory_units"))).toHaveLength(1);
    expect(texts.filter((t) => t.includes("status = 'applied', applied_at"))).toHaveLength(2);
    expect(texts.filter((t) => t.includes("hindsight.documents"))).toHaveLength(0);
    // Run completes.
    expect(texts.some((t) => t.includes("status = 'applied',") && t.includes("finished_at"))).toBe(true);
  });

  it("fails the run when consolidation fails, after recording earlier applies", async () => {
    const consolidate = vi.fn().mockRejectedValue(new Error("hindsight down"));
    const { db, execute } = routeDb([
      {
        match: "status = 'staged'",
        rows: [
          [
            {
              id: "a1",
              ordinal: 0,
              action_type: "forget",
              target: { memoryUnitIds: ["u1"] },
              reason: "junk",
            },
            {
              id: "a2",
              ordinal: 1,
              action_type: "consolidate",
              target: null,
              reason: "native",
            },
          ],
        ],
      },
    ]);

    const result = await applyDreamRun({
      db,
      consolidator: { consolidateBankById: consolidate },
      runId: "run-1",
      bankId: BANK,
    });

    expect(result.failed).toBe(true);
    expect(result.applied).toBe(1);
    const texts = execute.mock.calls.map((call) =>
      JSON.stringify(call[0]?.queryChunks ?? call[0]),
    );
    expect(texts.some((t) => t.includes("status = 'failed'"))).toBe(true);
  });

  it("quarantine deletes units and orphaned documents", async () => {
    const consolidate = vi.fn().mockResolvedValue(undefined);
    const { db, execute } = routeDb([
      {
        match: "status = 'staged'",
        rows: [
          [
            {
              id: "a1",
              ordinal: 0,
              action_type: "quarantine",
              target: { memoryUnitIds: ["u1"], documentIds: ["doc-1"] },
              reason: "eval residue",
            },
          ],
        ],
      },
    ]);

    const result = await applyDreamRun({
      db,
      consolidator: { consolidateBankById: consolidate },
      runId: "run-1",
      bankId: BANK,
    });

    expect(result.applied).toBe(1);
    const texts = execute.mock.calls.map((call) =>
      JSON.stringify(call[0]?.queryChunks ?? call[0]),
    );
    expect(texts.some((t) => t.includes("DELETE FROM hindsight.memory_units"))).toBe(true);
    expect(texts.some((t) => t.includes("DELETE FROM hindsight.documents"))).toBe(true);
    // Consolidate was not staged, so the engine call never fires.
    expect(consolidate).not.toHaveBeenCalled();
  });
});

describe("runBrainDreamState", () => {
  it("resumes an unfinished run instead of creating a new one", async () => {
    const consolidate = vi.fn().mockResolvedValue(undefined);
    const { db, execute } = routeDb([
      {
        match: "status IN ('planned', 'applying')",
        rows: [
          [
            {
              id: "stale-run",
              tenant_id: TENANT,
              bank_id: BANK,
              dedupe_key: `${TENANT}:${BANK}:100`,
              status: "applying",
            },
          ],
        ],
      },
      {
        match: "status = 'staged'",
        rows: [
          [
            {
              id: "a9",
              ordinal: 2,
              action_type: "consolidate",
              target: null,
              reason: "native",
            },
          ],
        ],
      },
    ]);

    const result = await runBrainDreamState({
      db,
      consolidator: { consolidateBankById: consolidate },
      input: { tenantId: TENANT, bankId: BANK },
    });

    expect(result.ok).toBe(true);
    expect(result.banks).toEqual([
      expect.objectContaining({
        runId: "stale-run",
        status: "resumed_applied",
        applied: 1,
      }),
    ]);
    // No new run row was created.
    const texts = execute.mock.calls.map((call) =>
      JSON.stringify(call[0]?.queryChunks ?? call[0]),
    );
    expect(texts.some((t) => t.includes("INSERT INTO brain_dream_runs"))).toBe(false);
  });

  it("dry run plans without staging or mutating", async () => {
    const consolidate = vi.fn();
    const { db, execute } = routeDb([]);
    const result = await runBrainDreamState({
      db,
      consolidator: { consolidateBankById: consolidate },
      input: { tenantId: TENANT, bankId: BANK, dryRun: true },
    });
    expect(result.banks[0]).toMatchObject({ status: "dry_run", planned: 1 });
    const texts = execute.mock.calls.map((call) =>
      JSON.stringify(call[0]?.queryChunks ?? call[0]),
    );
    expect(texts.some((t) => t.includes("INSERT INTO"))).toBe(false);
    expect(texts.some((t) => t.includes("DELETE"))).toBe(false);
    expect(consolidate).not.toHaveBeenCalled();
  });
});
