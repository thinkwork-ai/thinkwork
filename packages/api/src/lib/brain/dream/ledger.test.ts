import { describe, expect, it, vi } from "vitest";

import {
  buildDreamDedupeKey,
  createDreamRun,
  DREAM_DEDUPE_BUCKET_SECONDS,
  nextDreamBucket,
  parseDreamDedupeBucket,
  stageDreamActions,
} from "./ledger.js";

/** Routes db.execute by SQL substring (same pattern as observations-source.test). */
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

const TENANT = "0015953e-aa13-4cab-8398-2e70f73dda63";
const BANK = "user_4dee701a-c17b-46fe-9f38-a333d4c3fad0";

describe("dream dedupe keys", () => {
  it("round-trips build → parse", () => {
    const key = buildDreamDedupeKey(TENANT, BANK, 495123);
    expect(parseDreamDedupeBucket(key)).toBe(495123);
  });

  it("returns null for malformed keys", () => {
    expect(parseDreamDedupeBucket("only-one-part")).toBe(null);
    expect(parseDreamDedupeBucket("a:b:not-a-number")).toBe(null);
    expect(parseDreamDedupeBucket("a:b:c:d")).toBe(null);
  });

  it("parses the next bucket forward from the prior key, never wall-clock alone", () => {
    const now = new Date("2026-07-03T12:00:00.000Z");
    const wallBucket = Math.floor(
      now.getTime() / 1000 / DREAM_DEDUPE_BUCKET_SECONDS,
    );
    // Prior run in the SAME wall bucket: next must still differ (prior + 1).
    const priorKey = buildDreamDedupeKey(TENANT, BANK, wallBucket);
    expect(nextDreamBucket(priorKey, now)).toBe(wallBucket + 1);
    // Prior run far in the past: wall bucket wins (no pinning to the past).
    const staleKey = buildDreamDedupeKey(TENANT, BANK, wallBucket - 500);
    expect(nextDreamBucket(staleKey, now)).toBe(wallBucket);
    // No prior run: seeded from wall clock.
    expect(nextDreamBucket(null, now)).toBe(wallBucket);
    // Malformed prior key: falls back to wall clock.
    expect(nextDreamBucket("garbage", now)).toBe(wallBucket);
  });
});

describe("createDreamRun", () => {
  it("returns null on a dedupe collision (idempotent skip)", async () => {
    const { db } = routeDb([
      {
        match: "ORDER BY created_at DESC",
        rows: [[{ id: "r0", dedupe_key: `${TENANT}:${BANK}:100`, status: "applied" }]],
      },
      // INSERT ... ON CONFLICT DO NOTHING returns no rows on collision.
      { match: "INSERT INTO brain_dream_runs", rows: [[]] },
    ]);
    const run = await createDreamRun({
      db,
      tenantId: TENANT,
      bankId: BANK,
      now: new Date("2026-07-03T12:00:00.000Z"),
    });
    expect(run).toBe(null);
  });

  it("creates a run keyed strictly after the prior run's bucket", async () => {
    const now = new Date("2026-07-03T12:00:00.000Z");
    const wallBucket = Math.floor(
      now.getTime() / 1000 / DREAM_DEDUPE_BUCKET_SECONDS,
    );
    const { db, execute } = routeDb([
      {
        match: "ORDER BY created_at DESC",
        rows: [
          [
            {
              id: "r0",
              dedupe_key: buildDreamDedupeKey(TENANT, BANK, wallBucket),
              status: "applied",
            },
          ],
        ],
      },
      {
        match: "INSERT INTO brain_dream_runs",
        rows: [
          [
            {
              id: "r1",
              tenant_id: TENANT,
              bank_id: BANK,
              dedupe_key: buildDreamDedupeKey(TENANT, BANK, wallBucket + 1),
              status: "planned",
            },
          ],
        ],
      },
    ]);
    const run = await createDreamRun({ db, tenantId: TENANT, bankId: BANK, now });
    expect(run?.id).toBe("r1");
    const insertCall = execute.mock.calls
      .map((call) => JSON.stringify(call[0]?.queryChunks ?? call[0]))
      .find((text) => text.includes("INSERT INTO brain_dream_runs"));
    expect(insertCall).toContain(String(wallBucket + 1));
  });
});

describe("stageDreamActions", () => {
  it("stages with ON CONFLICT DO NOTHING so re-staging after a crash is safe", async () => {
    const { db, execute } = routeDb([]);
    await stageDreamActions(db, "run-1", [
      {
        ordinal: 0,
        actionType: "quarantine",
        target: { memoryUnitIds: ["u1"] },
        reason: "test",
      },
      { ordinal: 1, actionType: "consolidate", target: null, reason: "test" },
    ]);
    const inserts = execute.mock.calls
      .map((call) => JSON.stringify(call[0]?.queryChunks ?? call[0]))
      .filter((text) => text.includes("INSERT INTO brain_dream_actions"));
    expect(inserts).toHaveLength(2);
    for (const insert of inserts) {
      expect(insert).toContain("ON CONFLICT");
    }
  });
});
