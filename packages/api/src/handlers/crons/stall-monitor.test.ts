import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    execute: mocks.execute,
  }),
}));

vi.mock("../../lib/mobile-turns/managed-dispatch.js", () => ({
  processStaleMobileHandoffs: vi.fn(),
}));

const noMobileHandoffs = () =>
  vi.fn(async () => ({
    scanned: 0,
    claimed: 0,
    dispatched: 0,
    failed: 0,
    skipped: 0,
  }));

// Flattens a drizzle SQL object (queryChunks of StringChunk / nested SQL)
// into its static text, ignoring bound params — enough to assert on the
// interval and error strings the handler builds via sql.raw.
function sqlText(query: unknown): string {
  const q = query as { queryChunks?: unknown[]; value?: unknown };
  if (Array.isArray(q?.queryChunks)) {
    return q.queryChunks.map(sqlText).join("");
  }
  if (Array.isArray(q?.value)) {
    return q.value.join("");
  }
  return "";
}

describe("stall monitor", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.STALL_THRESHOLD_MINUTES;
    mocks.execute.mockResolvedValue({ rows: [] });
  });

  afterEach(() => {
    delete process.env.STALL_THRESHOLD_MINUTES;
  });

  it("runs mobile handoff processing before generic five-minute timeout handling", async () => {
    const calls: string[] = [];
    const { runStallMonitor } = await import("./stall-monitor.js");

    await runStallMonitor({
      processMobileHandoffs: vi.fn(async () => {
        calls.push("mobile");
        return {
          scanned: 1,
          claimed: 1,
          dispatched: 1,
          failed: 0,
          skipped: 0,
        };
      }),
    });
    calls.push("after");

    expect(calls).toEqual(["mobile", "after"]);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it("uses the 5-minute default interval when STALL_THRESHOLD_MINUTES is unset", async () => {
    const { runStallMonitor } = await import("./stall-monitor.js");

    await runStallMonitor({ processMobileHandoffs: noMobileHandoffs() });

    expect(sqlText(mocks.execute.mock.calls[0][0])).toContain(
      "INTERVAL '5 minutes'",
    );
  });

  it("reads STALL_THRESHOLD_MINUTES per invocation and threads it through all SQL strings", async () => {
    const { runStallMonitor } = await import("./stall-monitor.js");

    process.env.STALL_THRESHOLD_MINUTES = "15";
    mocks.execute.mockResolvedValueOnce({
      rows: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          tenant_id: "22222222-2222-2222-2222-222222222222",
          agent_id: "33333333-3333-3333-3333-333333333333",
          thread_id: "44444444-4444-4444-4444-444444444444",
          retry_attempt: 0,
        },
      ],
    });

    await runStallMonitor({ processMobileHandoffs: noMobileHandoffs() });

    // SELECT + timed_out UPDATE + checkout release + retry_queue INSERT
    expect(mocks.execute).toHaveBeenCalledTimes(4);
    expect(sqlText(mocks.execute.mock.calls[0][0])).toContain(
      "INTERVAL '15 minutes'",
    );
    expect(sqlText(mocks.execute.mock.calls[1][0])).toContain(
      "Stall detected: no activity for 15 minutes",
    );
    expect(sqlText(mocks.execute.mock.calls[3][0])).toContain(
      "Stall detected after 15 minutes",
    );

    // Same module instance, env removed → back to 5: proves the value is
    // read inside the invocation, not captured at module load.
    delete process.env.STALL_THRESHOLD_MINUTES;
    mocks.execute.mockClear();
    mocks.execute.mockResolvedValue({ rows: [] });

    await runStallMonitor({ processMobileHandoffs: noMobileHandoffs() });

    expect(sqlText(mocks.execute.mock.calls[0][0])).toContain(
      "INTERVAL '5 minutes'",
    );
  });

  it.each(["abc", "0", "-3", "2.5", "5x", ""])(
    "falls back to the 5-minute default for invalid value %j",
    async (value) => {
      const { runStallMonitor } = await import("./stall-monitor.js");

      process.env.STALL_THRESHOLD_MINUTES = value;
      await runStallMonitor({ processMobileHandoffs: noMobileHandoffs() });

      const text = sqlText(mocks.execute.mock.calls[0][0]);
      expect(text).toContain("INTERVAL '5 minutes'");
      expect(text).not.toMatch(/NaN|Infinity/);
    },
  );
});
