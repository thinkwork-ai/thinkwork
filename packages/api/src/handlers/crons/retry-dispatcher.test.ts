import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    execute: mocks.execute,
  }),
}));

/** Flatten a drizzle sql`` object into a readable string with params inlined. */
function sqlToString(query: unknown): string {
  const chunks =
    (query as { queryChunks?: unknown[] } | undefined)?.queryChunks ?? [];
  return chunks
    .map((chunk) => {
      if (chunk && typeof chunk === "object" && "value" in chunk) {
        const value = (chunk as { value: unknown }).value;
        return Array.isArray(value) ? value.join("") : String(value);
      }
      // Bound params sit in queryChunks as raw primitives.
      return String(chunk);
    })
    .join("");
}

function executedStatements(): string[] {
  return mocks.execute.mock.calls.map((call) => sqlToString(call[0]));
}

const MINUTE = 60_000;

function queueRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    tenant_id: "22222222-2222-2222-2222-222222222222",
    agent_id: "33333333-3333-3333-3333-333333333333",
    thread_id: "44444444-4444-4444-4444-444444444444",
    attempt: 1,
    max_attempts: 5,
    origin_turn_id: "55555555-5555-5555-5555-555555555555",
    scheduled_at: new Date(Date.now() - 2 * MINUTE).toISOString(),
    ...overrides,
  };
}

function originRow(overrides: Record<string, unknown> = {}) {
  return {
    status: "timed_out",
    fresh: false,
    has_successor: false,
    ...overrides,
  };
}

async function runHandler() {
  const { handler } = await import("./retry-dispatcher.js");
  return handler();
}

describe("retry dispatcher guard chain", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.execute.mockResolvedValue({ rows: [] });
  });

  afterEach(() => {
    delete process.env.STALL_THRESHOLD_MINUTES;
  });

  // Generous timeout: the first dynamic import pays the module-graph
  // transform cost for the whole @thinkwork/database-pg chain.
  it(
    "returns zero counts when no rows are due",
    { timeout: 30_000 },
    async () => {
      const result = await runHandler();
      expect(result).toEqual({ dispatched: 0, exhausted: 0, superseded: 0 });
      expect(mocks.execute).toHaveBeenCalledTimes(1);
    },
  );

  it("supersedes a row whose origin turn succeeded, without any wakeup insert (AE1/F2)", async () => {
    mocks.execute
      .mockResolvedValueOnce({ rows: [queueRow()] })
      .mockResolvedValueOnce({ rows: [originRow({ status: "succeeded" })] })
      .mockResolvedValue({ rows: [] });

    const result = await runHandler();

    expect(result).toEqual({ dispatched: 0, exhausted: 0, superseded: 1 });
    const statements = executedStatements();
    expect(statements[2]).toContain("'superseded'");
    expect(statements.some((s) => s.includes("agent_wakeup_requests"))).toBe(
      false,
    );
  });

  it("supersedes a row whose origin turn was cancelled (KTD3)", async () => {
    mocks.execute
      .mockResolvedValueOnce({ rows: [queueRow()] })
      .mockResolvedValueOnce({ rows: [originRow({ status: "cancelled" })] })
      .mockResolvedValue({ rows: [] });

    const result = await runHandler();

    expect(result).toEqual({ dispatched: 0, exhausted: 0, superseded: 1 });
    expect(
      executedStatements().some((s) => s.includes("agent_wakeup_requests")),
    ).toBe(false);
  });

  it("supersedes a 2-hour-stale row without any origin lookup or wakeup (AE2/F3)", async () => {
    mocks.execute
      .mockResolvedValueOnce({
        rows: [
          queueRow({
            scheduled_at: new Date(Date.now() - 120 * MINUTE).toISOString(),
          }),
        ],
      })
      .mockResolvedValue({ rows: [] });

    const result = await runHandler();

    expect(result).toEqual({ dispatched: 0, exhausted: 0, superseded: 1 });
    // Exactly two statements: the claim and the supersede — no origin SELECT.
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect(executedStatements()[1]).toContain("'superseded'");
  });

  it("dispatches a due row whose origin is timed_out with no successor (AE3/F1)", async () => {
    mocks.execute
      .mockResolvedValueOnce({ rows: [queueRow({ attempt: 2 })] })
      .mockResolvedValueOnce({ rows: [originRow()] })
      .mockResolvedValue({ rows: [] });

    const result = await runHandler();

    expect(result).toEqual({ dispatched: 1, exhausted: 0, superseded: 0 });
    const insert = executedStatements().find((s) =>
      s.includes("agent_wakeup_requests"),
    );
    expect(insert).toBeDefined();
    expect(insert).toContain('"retryAttempt":2');
    expect(insert).toContain(
      '"originTurnId":"55555555-5555-5555-5555-555555555555"',
    );
    // Claimed rows stay 'dispatched' — no status rewrite after the insert.
    expect(executedStatements().some((s) => s.includes("'superseded'"))).toBe(
      false,
    );
  });

  it("supersedes when a successor attempt turn already exists (KTD4 successor guard)", async () => {
    mocks.execute
      .mockResolvedValueOnce({ rows: [queueRow()] })
      .mockResolvedValueOnce({ rows: [originRow({ has_successor: true })] })
      .mockResolvedValue({ rows: [] });

    const result = await runHandler();

    expect(result).toEqual({ dispatched: 0, exhausted: 0, superseded: 1 });
    expect(
      executedStatements().some((s) => s.includes("agent_wakeup_requests")),
    ).toBe(false);
  });

  it("supersedes a running origin with fresh activity; dispatches when activity is stale (R3)", async () => {
    // Fresh: the SQL lookup computes freshness server-side and returns true.
    mocks.execute
      .mockResolvedValueOnce({ rows: [queueRow()] })
      .mockResolvedValueOnce({
        rows: [originRow({ status: "running", fresh: true })],
      })
      .mockResolvedValue({ rows: [] });

    expect(await runHandler()).toEqual({
      dispatched: 0,
      exhausted: 0,
      superseded: 1,
    });

    // Stale: same running origin, freshness false → dispatch.
    vi.resetModules();
    vi.clearAllMocks();
    mocks.execute
      .mockResolvedValueOnce({ rows: [queueRow()] })
      .mockResolvedValueOnce({
        rows: [originRow({ status: "running", fresh: false })],
      })
      .mockResolvedValue({ rows: [] });

    expect(await runHandler()).toEqual({
      dispatched: 1,
      exhausted: 0,
      superseded: 0,
    });
  });

  it("reads STALL_THRESHOLD_MINUTES per invocation and passes it to the freshness lookup", async () => {
    process.env.STALL_THRESHOLD_MINUTES = "15";
    mocks.execute
      .mockResolvedValueOnce({ rows: [queueRow()] })
      .mockResolvedValueOnce({ rows: [originRow()] })
      .mockResolvedValue({ rows: [] });

    await runHandler();
    expect(executedStatements()[1]).toContain("make_interval(mins => 15)");

    // Env removed mid-process: the next invocation reverts to the default 5.
    delete process.env.STALL_THRESHOLD_MINUTES;
    vi.clearAllMocks();
    mocks.execute
      .mockResolvedValueOnce({ rows: [queueRow()] })
      .mockResolvedValueOnce({ rows: [originRow()] })
      .mockResolvedValue({ rows: [] });

    await runHandler();
    expect(executedStatements()[1]).toContain("make_interval(mins => 5)");
  });

  it.each(["abc", "0", "-3", "2.5"])(
    "falls back to 5 minutes when STALL_THRESHOLD_MINUTES is %s",
    async (value) => {
      process.env.STALL_THRESHOLD_MINUTES = value;
      mocks.execute
        .mockResolvedValueOnce({ rows: [queueRow()] })
        .mockResolvedValueOnce({ rows: [originRow()] })
        .mockResolvedValue({ rows: [] });

      await runHandler();
      expect(executedStatements()[1]).toContain("make_interval(mins => 5)");
    },
  );

  it("dispatches a recent row whose origin turn is missing (origin guards skipped)", async () => {
    mocks.execute
      .mockResolvedValueOnce({
        rows: [
          queueRow({
            origin_turn_id: null,
            scheduled_at: new Date(Date.now() - 5 * MINUTE).toISOString(),
          }),
        ],
      })
      .mockResolvedValue({ rows: [] });

    const result = await runHandler();

    expect(result).toEqual({ dispatched: 1, exhausted: 0, superseded: 0 });
    // Claim + wakeup insert only — no origin lookup for a null origin.
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect(executedStatements()[1]).toContain("agent_wakeup_requests");
  });

  it("dispatches when the origin lookup returns no row (origin deleted)", async () => {
    mocks.execute
      .mockResolvedValueOnce({ rows: [queueRow()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValue({ rows: [] });

    const result = await runHandler();
    expect(result).toEqual({ dispatched: 1, exhausted: 0, superseded: 0 });
  });

  it("exhausts a guard-passing row at max attempts; a stale row at max attempts is superseded, not exhausted (KTD4 ordering)", async () => {
    mocks.execute
      .mockResolvedValueOnce({
        rows: [queueRow({ attempt: 5, max_attempts: 5 })],
      })
      .mockResolvedValueOnce({ rows: [originRow()] })
      .mockResolvedValue({ rows: [] });

    expect(await runHandler()).toEqual({
      dispatched: 0,
      exhausted: 1,
      superseded: 0,
    });
    expect(executedStatements()[2]).toContain("'exhausted'");

    vi.resetModules();
    vi.clearAllMocks();
    mocks.execute
      .mockResolvedValueOnce({
        rows: [
          queueRow({
            attempt: 5,
            max_attempts: 5,
            scheduled_at: new Date(Date.now() - 120 * MINUTE).toISOString(),
          }),
        ],
      })
      .mockResolvedValue({ rows: [] });

    expect(await runHandler()).toEqual({
      dispatched: 0,
      exhausted: 0,
      superseded: 1,
    });
    expect(executedStatements()[1]).toContain("'superseded'");
  });

  it("tallies a mixed batch: one guarded row + one dispatched row", async () => {
    const guarded = queueRow({
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      origin_turn_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    });
    const dispatchable = queueRow({
      id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      origin_turn_id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
    });
    mocks.execute
      .mockResolvedValueOnce({ rows: [guarded, dispatchable] })
      .mockResolvedValueOnce({ rows: [originRow({ status: "succeeded" })] })
      .mockResolvedValueOnce({ rows: [] }) // supersede UPDATE
      .mockResolvedValueOnce({ rows: [originRow()] })
      .mockResolvedValue({ rows: [] });

    const result = await runHandler();
    expect(result).toEqual({ dispatched: 1, exhausted: 0, superseded: 1 });
  });
});
