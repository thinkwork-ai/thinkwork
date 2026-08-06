/**
 * auth-ticket-sweeper tests.
 *
 * The handler issues raw `sql` DELETEs (Postgres has no DELETE ... LIMIT),
 * so the fake db renders each statement through the real PgDialect and
 * applies the extracted cutoff + LIMIT against an in-memory row set. That
 * keeps the assertions about actual retention semantics — which rows
 * survive — rather than about statement text.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

interface TicketRow {
  id: string;
  expires_at: Date;
  consumed_at: Date | null;
}

interface FakeDbState {
  rows: TicketRow[];
  /** Rendered SQL text of every statement the handler issued. */
  statements: string[];
  /** Cutoff parameter bound by each statement. */
  cutoffs: Date[];
  /** LIMIT parameter bound by each statement. */
  limits: number[];
  /** ms added to the fake clock after each batch resolves. */
  clockAdvancePerBatchMs: number;
}

let state: FakeDbState;
let dialect: PgDialect;

const fakeDb = {
  execute: async (query: unknown) => {
    const { sql: text, params } = dialect.sqlToQuery(query as never);
    state.statements.push(text);
    const cutoff = params[0] as Date;
    const limit = params[1] as number;
    state.cutoffs.push(cutoff);
    state.limits.push(limit);

    const doomed = state.rows
      .filter((r) => r.expires_at.getTime() < cutoff.getTime())
      .slice(0, limit);
    const doomedIds = new Set(doomed.map((r) => r.id));
    state.rows = state.rows.filter((r) => !doomedIds.has(r.id));

    if (state.clockAdvancePerBatchMs > 0) {
      vi.setSystemTime(Date.now() + state.clockAdvancePerBatchMs);
    }
    return { rowCount: doomed.length, rows: [] };
  },
};

vi.mock("@thinkwork/database-pg", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@thinkwork/database-pg")>();
  return { ...actual, getDb: () => fakeDb };
});

import { handler } from "./auth-ticket-sweeper.js";

const HOUR_MS = 60 * 60 * 1000;
const BATCH_SIZE = 25_000;
const SWEEP_AT = Date.parse("2026-08-06T12:00:00.000Z");

function ticket(
  id: string,
  expiresAtOffsetMs: number,
  consumed = false,
): TicketRow {
  const expiresAt = new Date(SWEEP_AT + expiresAtOffsetMs);
  return {
    id,
    expires_at: expiresAt,
    consumed_at: consumed ? expiresAt : null,
  };
}

describe("auth-ticket-sweeper", () => {
  beforeEach(() => {
    dialect = new PgDialect();
    vi.useFakeTimers();
    vi.setSystemTime(SWEEP_AT);
    state = {
      rows: [],
      statements: [],
      cutoffs: [],
      limits: [],
      clockAdvancePerBatchMs: 0,
    };
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("deletes only rows expired past the one-hour grace window", async () => {
    state.rows = [
      // Long dead — the 551k-row backlog shape.
      ticket("ancient", -48 * HOUR_MS),
      // Just past the grace window.
      ticket("past-grace", -HOUR_MS - 60_000),
      // Expired but inside the grace window: a failed handshake an operator
      // may still be staring at. Consumed-but-recent stays too.
      ticket("recent-expired", -10 * 60_000),
      ticket("recent-consumed", -5 * 60_000, true),
      // Live ticket mid-flight.
      ticket("fresh", 45_000),
    ];

    const result = await handler();

    expect(result.deleted).toBe(2);
    expect(result.batches).toBe(1);
    expect(result.exhausted).toBe(true);
    expect(state.rows.map((r) => r.id).sort()).toEqual([
      "fresh",
      "recent-consumed",
      "recent-expired",
    ]);
    // Cutoff is exactly one hour behind the sweep time.
    expect(SWEEP_AT - state.cutoffs[0].getTime()).toBe(HOUR_MS);
    expect(result.cutoff).toBe(new Date(SWEEP_AT - HOUR_MS).toISOString());
    expect(state.limits[0]).toBe(BATCH_SIZE);
    expect(state.statements[0]).toContain(
      "DELETE FROM auth_subscription_tickets",
    );
    expect(state.statements[0]).toContain("ctid");
  });

  it("reports a clean sweep when nothing is eligible", async () => {
    state.rows = [ticket("fresh", 30_000), ticket("recent", -60_000)];

    const result = await handler();

    expect(result).toMatchObject({ deleted: 0, batches: 1, exhausted: true });
    expect(state.rows).toHaveLength(2);
  });

  it("loops until a batch comes back short of the batch size", async () => {
    state.rows = [
      ...Array.from({ length: BATCH_SIZE + 7 }, (_, i) =>
        ticket(`stale-${i}`, -48 * HOUR_MS),
      ),
      ticket("fresh", 30_000),
    ];

    const result = await handler();

    // Batch 1 deletes exactly BATCH_SIZE (full → keep going), batch 2
    // deletes the remaining 7 (short → exhausted).
    expect(result.batches).toBe(2);
    expect(result.deleted).toBe(BATCH_SIZE + 7);
    expect(result.exhausted).toBe(true);
    expect(state.rows.map((r) => r.id)).toEqual(["fresh"]);
  });

  it("stops on the time budget and reports the backlog as not exhausted", async () => {
    // Two full batches' worth of backlog, but the first batch alone burns
    // past the 45s budget.
    state.rows = Array.from({ length: BATCH_SIZE * 2 }, (_, i) =>
      ticket(`stale-${i}`, -48 * HOUR_MS),
    );
    state.clockAdvancePerBatchMs = 50_000;

    const result = await handler();

    expect(result.batches).toBe(1);
    expect(result.deleted).toBe(BATCH_SIZE);
    expect(result.exhausted).toBe(false);
    // Backlog survives for the next hourly tick.
    expect(state.rows).toHaveLength(BATCH_SIZE);
  });
});
