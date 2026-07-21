import { beforeEach, describe, expect, it, vi } from "vitest";

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

describe("stall monitor", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.execute.mockResolvedValue({ rows: [] });
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

  it("times out a stalled Pi turn, releases checkout, and enqueues a retry", async () => {
    mocks.execute
      .mockResolvedValueOnce({
        rows: [
          {
            id: "turn-1",
            tenant_id: "tenant-1",
            agent_id: "agent-1",
            thread_id: "thread-1",
            runtime_type: "pi",
            retry_attempt: 0,
          },
        ],
      })
      .mockResolvedValue({ rows: [] });
    const { runStallMonitor } = await import("./stall-monitor.js");

    const result = await runStallMonitor({
      processMobileHandoffs: vi.fn(async () => ({
        scanned: 0,
        claimed: 0,
        dispatched: 0,
        failed: 0,
        skipped: 0,
      })),
    });

    expect(result.stalled).toBe(1);
    // select + timed_out update + checkout release + retry enqueue = 4
    expect(mocks.execute).toHaveBeenCalledTimes(4);
    const statements = mocks.execute.mock.calls.map((call) =>
      JSON.stringify(call[0]),
    );
    expect(statements.some((s) => s.includes("retry_queue"))).toBe(true);
  });
});
