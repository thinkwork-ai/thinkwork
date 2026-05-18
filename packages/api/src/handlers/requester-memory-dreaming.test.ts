import { beforeEach, describe, expect, it, vi } from "vitest";

const { runRequesterMemoryDreaming } = vi.hoisted(() => ({
  runRequesterMemoryDreaming: vi.fn(),
}));

vi.mock("../lib/requester-memory/dreaming.js", () => ({
  runRequesterMemoryDreaming,
}));

import { handler } from "./requester-memory-dreaming.js";

describe("requester-memory-dreaming handler", () => {
  beforeEach(() => {
    runRequesterMemoryDreaming.mockReset();
    delete process.env.REQUESTER_MEMORY_DREAMING_ENABLED;
  });

  it("no-ops scheduled events when dreaming is disabled", async () => {
    const result = await handler({ runId: "dream-1" });

    expect(result).toMatchObject({
      ok: true,
      runId: "dream-1",
      status: "no_change",
      users: [],
    });
    expect(runRequesterMemoryDreaming).not.toHaveBeenCalled();
  });

  it("delegates when the feature flag is enabled", async () => {
    process.env.REQUESTER_MEMORY_DREAMING_ENABLED = "true";
    runRequesterMemoryDreaming.mockResolvedValue({
      ok: true,
      runId: "dream-1",
      status: "changed",
      users: [{ tenantId: "tenant-1", userId: "user-1", changedFiles: [] }],
      budget: {
        usersConsidered: 1,
        usersProcessed: 1,
        llmCalls: 1,
        memoryWrites: 0,
        dryRun: false,
      },
    });

    const result = await handler({ runId: "dream-1", tenantId: "tenant-1" });

    expect(result.status).toBe("changed");
    expect(runRequesterMemoryDreaming).toHaveBeenCalledWith({
      runId: "dream-1",
      tenantId: "tenant-1",
    });
  });

  it("allows manual runs even when scheduled dreaming is disabled", async () => {
    runRequesterMemoryDreaming.mockResolvedValue({
      ok: true,
      runId: "manual-1",
      status: "no_change",
      users: [],
      budget: {
        usersConsidered: 0,
        usersProcessed: 0,
        llmCalls: 0,
        memoryWrites: 0,
        dryRun: true,
      },
    });

    await handler({ runId: "manual-1", manual: true, dryRun: true });

    expect(runRequesterMemoryDreaming).toHaveBeenCalledWith({
      runId: "manual-1",
      manual: true,
      dryRun: true,
    });
  });
});
