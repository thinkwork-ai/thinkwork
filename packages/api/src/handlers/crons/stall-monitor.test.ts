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
});
