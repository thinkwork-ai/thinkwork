import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn());
const getMemoryServicesMock = vi.hoisted(() => vi.fn());
const runBrainDreamStateMock = vi.hoisted(() => vi.fn());

vi.mock("@thinkwork/database-pg", () => ({ getDb: getDbMock }));
vi.mock("../lib/memory/index.js", () => ({
  getMemoryServices: getMemoryServicesMock,
}));
vi.mock("../lib/brain/dream/runner.js", () => ({
  runBrainDreamState: runBrainDreamStateMock,
}));

import { handler } from "./brain-dream-state.js";

describe("brain-dream-state handler", () => {
  const priorEnabled = process.env.BRAIN_DREAM_STATE_ENABLED;

  beforeEach(() => {
    delete process.env.BRAIN_DREAM_STATE_ENABLED;
    getDbMock.mockReset().mockReturnValue({ execute: vi.fn() });
    runBrainDreamStateMock
      .mockReset()
      .mockResolvedValue({ ok: true, banks: [] });
    getMemoryServicesMock.mockReset().mockReturnValue({
      adapter: { consolidateBankById: vi.fn() },
      config: { engine: "hindsight" },
    });
  });

  afterEach(() => {
    if (priorEnabled === undefined) delete process.env.BRAIN_DREAM_STATE_ENABLED;
    else process.env.BRAIN_DREAM_STATE_ENABLED = priorEnabled;
  });

  it("is inert unless enabled by env or manual override", async () => {
    const result = await handler({});
    expect(result).toEqual({ ok: true, enabled: false, banks: [] });
    expect(runBrainDreamStateMock).not.toHaveBeenCalled();
  });

  it("manual:true runs even while the env gate is off", async () => {
    const result = await handler({ manual: true, tenantId: "t1", dryRun: true });
    expect(result.enabled).toBe(true);
    expect(runBrainDreamStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ tenantId: "t1", dryRun: true }),
      }),
    );
  });

  it("skips engines without consolidateBankById", async () => {
    getMemoryServicesMock.mockReturnValue({
      adapter: {},
      config: { engine: "agentcore" },
    });
    const result = await handler({ manual: true });
    expect(result).toEqual({ ok: true, enabled: true, banks: [] });
    expect(runBrainDreamStateMock).not.toHaveBeenCalled();
  });

  it("env gate enables scheduled runs", async () => {
    process.env.BRAIN_DREAM_STATE_ENABLED = "true";
    const result = await handler({});
    expect(result.enabled).toBe(true);
    expect(runBrainDreamStateMock).toHaveBeenCalledTimes(1);
  });
});
