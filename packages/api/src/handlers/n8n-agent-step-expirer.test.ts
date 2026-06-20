import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSweep } = vi.hoisted(() => ({
  mockSweep: vi.fn(),
}));

vi.mock("../lib/n8n-agent-step/resume.js", () => ({
  sweepN8nAgentStepRuns: mockSweep,
}));

import { handler } from "./n8n-agent-step-expirer.js";

beforeEach(() => {
  mockSweep.mockReset();
});

describe("n8n agent-step expirer handler", () => {
  it("delegates scheduler runs to the n8n bridge sweeper", async () => {
    mockSweep.mockResolvedValue({
      resumeAttempted: 2,
      resumed: 1,
      retryScheduled: 1,
      resumeFailed: 0,
      expiredQueued: 3,
    });

    const result = await handler({ limit: "10" });

    expect(mockSweep).toHaveBeenCalledWith({ limit: 10 });
    expect(result).toEqual({
      ok: true,
      resumeAttempted: 2,
      resumed: 1,
      retryScheduled: 1,
      resumeFailed: 0,
      expiredQueued: 3,
    });
  });

  it("falls back to the sweeper default limit for malformed scheduler input", async () => {
    mockSweep.mockResolvedValue({
      resumeAttempted: 0,
      resumed: 0,
      retryScheduled: 0,
      resumeFailed: 0,
      expiredQueued: 0,
    });

    await handler({ limit: "not-a-number" });

    expect(mockSweep).toHaveBeenCalledWith({ limit: undefined });
  });
});
