/**
 * approval-override validation tests (THINK-193 U3): the override may only
 * NARROW the saved processor configuration.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  findMemoryProcessorForWorkflow: vi.fn(),
}));
const repoMocks = vi.hoisted(() => ({
  listEnabledSourceConfigs: vi.fn(),
}));

vi.mock("@thinkwork/database-pg", () => ({
  findMemoryProcessorForWorkflow: dbMocks.findMemoryProcessorForWorkflow,
}));
vi.mock("../../../lib/memory-sources/repository.js", () => ({
  listEnabledSourceConfigs: repoMocks.listEnabledSourceConfigs,
}));

import {
  assertOverrideNarrowsSavedConfig,
  overrideInputToProtocol,
} from "./approval-override.js";

const DB = {} as never;
const ARGS = { tenantId: "t1", workflowId: "wf-1" };

function source(id: string, boundary: Record<string, unknown> = {}) {
  return { id, source_family: "twenty", boundary, enabled: true };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.findMemoryProcessorForWorkflow.mockResolvedValue({
    id: "proc-1",
    mode: "personal",
  });
  repoMocks.listEnabledSourceConfigs.mockResolvedValue([
    source("src-1", { maxRecords: 100 }),
    source("src-2"),
  ]);
});

describe("overrideInputToProtocol", () => {
  it("maps flat GraphQL input to the frozen protocol shape", () => {
    expect(
      overrideInputToProtocol({
        sourceConfigIds: ["src-1"],
        timeRangeFrom: "2026-07-01T00:00:00Z",
        maxRecords: 10,
      }),
    ).toEqual({
      sourceConfigIds: ["src-1"],
      timeRange: { from: "2026-07-01T00:00:00Z" },
      maxRecords: 10,
    });
  });

  it("returns null for absent/empty input", () => {
    expect(overrideInputToProtocol(null)).toBeNull();
    expect(overrideInputToProtocol({})).toBeNull();
  });

  it("throws on malformed shapes", () => {
    expect(() => overrideInputToProtocol({ maxRecords: -5 })).toThrow();
    expect(() =>
      overrideInputToProtocol({ timeRangeFrom: "not-a-date" }),
    ).toThrow();
  });
});

describe("assertOverrideNarrowsSavedConfig", () => {
  it("accepts a subset of configured sources with a within-cap maxRecords", async () => {
    await expect(
      assertOverrideNarrowsSavedConfig(DB, {
        ...ARGS,
        override: { sourceConfigIds: ["src-1"], maxRecords: 50 },
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects a source outside the processor's configured set", async () => {
    await expect(
      assertOverrideNarrowsSavedConfig(DB, {
        ...ARGS,
        override: { sourceConfigIds: ["src-somebody-elses"] },
      }),
    ).rejects.toThrow(/only select among already-configured sources/);
  });

  it("rejects maxRecords above the saved boundary cap", async () => {
    await expect(
      assertOverrideNarrowsSavedConfig(DB, {
        ...ARGS,
        override: { sourceConfigIds: ["src-1"], maxRecords: 150 },
      }),
    ).rejects.toThrow(/exceeds the saved boundary cap \(100\)/);
  });

  it("uses the governed schema default when the boundary omits maxRecords", async () => {
    // src-2 has no boundary.maxRecords -> twenty default 200.
    await expect(
      assertOverrideNarrowsSavedConfig(DB, {
        ...ARGS,
        override: { sourceConfigIds: ["src-2"], maxRecords: 200 },
      }),
    ).resolves.toBeUndefined();
    await expect(
      assertOverrideNarrowsSavedConfig(DB, {
        ...ARGS,
        override: { sourceConfigIds: ["src-2"], maxRecords: 201 },
      }),
    ).rejects.toThrow(/exceeds the saved boundary cap/);
  });

  it("rejects overrides on workflows without a memory processor", async () => {
    dbMocks.findMemoryProcessorForWorkflow.mockResolvedValue(null);
    await expect(
      assertOverrideNarrowsSavedConfig(DB, {
        ...ARGS,
        override: { maxRecords: 10 },
      }),
    ).rejects.toThrow(/only applies to managed memory workflows/);
  });
});
