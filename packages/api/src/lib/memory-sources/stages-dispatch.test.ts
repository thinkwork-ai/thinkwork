/**
 * Family dispatch seam + zero-source regression tests (THINK-193 U5).
 *
 * The registry is mocked with fake adapters so these tests pin the RUNNER's
 * behavior: per-source family dispatch (mixed-family processors), fail-closed
 * handling of unregistered families, the requiresOwnerUser gate, and — the
 * dev dogfood regression (run 929053dd) — a personal processor with ZERO
 * external sources no-oping external stages without invalid FK writes while
 * still compounding the Thread-backed Hindsight bank.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const fakeAdapters: Record<string, unknown> = {};

vi.mock("./adapters/registry.js", () => ({
  getMemorySourceAdapter: (family: string) => fakeAdapters[family] ?? null,
}));
vi.mock("./policy.js", () => {
  class MemoryAuthorizationError extends Error {}
  return {
    requireActiveGrant: vi.fn(async () => ({
      id: "grant-1",
      grant_version: 1,
      boundary: { granted: true },
    })),
    revalidateGrant: vi.fn(async () => undefined),
    assertBoundaryWithin: vi.fn(),
    MemoryAuthorizationError,
  };
});
vi.mock("./evidence.js", () => ({
  listEvidenceForProjection: vi.fn(async () => []),
  recordAcquiredPage: vi.fn(),
  recordDerivation: vi.fn(),
  recordDerivationWithRunItem: vi.fn(),
  recordRunItem: vi.fn(),
}));
vi.mock("./repository.js", () => {
  class CheckpointConflictError extends Error {}
  return {
    CheckpointConflictError,
    ensureCheckpoint: vi.fn(),
    getCheckpoint: vi.fn(),
    advanceCheckpoint: vi.fn(),
    resolveTargetBankId: vi.fn(() => "user_owner-1"),
  };
});
const consolidateBankById = vi.fn();
vi.mock("../memory/index.js", () => ({
  getMemoryServices: () => ({
    adapter: {
      upsertMarkdownMemoryDocument: vi.fn(),
      consolidateBankById,
    },
    config: { engine: "hindsight" },
  }),
}));
const runBrainDreamState = vi.fn();
vi.mock("../brain/dream/runner.js", () => ({
  runBrainDreamState: (...args: unknown[]) => runBrainDreamState(...args),
}));

import { recordRunItem } from "./evidence.js";
import {
  runAcquire,
  runCompound,
  runExtract,
  runProject,
  runResolve,
  runRetain,
  type StageContext,
} from "./stages.js";

const TENANT_ID = "0015953e-aa13-4cab-8398-2e70f73dda63";
const PROCESSOR_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";

function fakeAdapter(family: string, overrides: Record<string, unknown> = {}) {
  return {
    family,
    partitionKey: `${family}-partition`,
    pathSegment: family,
    requiresOwnerUser: false,
    checkReadiness: vi.fn(async () => ({ ready: true, client: { family } })),
    runAcquire: vi.fn(async () => ({
      ok: true,
      summary: { family, fetched: 1 },
    })),
    projectionKeyFor: (id: string) => `${family}:${id}`,
    subjectKeyFor: (id: string) => `${family}:subject:${id}`,
    buildProjection: () => ({ title: "t", markdown: "m" }),
    extractClaims: () => [],
    editionEffectiveFrom: () => null,
    focusLabelFor: (_s: unknown, id: string) => id,
    ...overrides,
  };
}

function source(id: string, family: string) {
  return {
    id,
    tenant_id: TENANT_ID,
    processor_config_id: PROCESSOR_ID,
    source_family: family,
    source_binding_key: `${family}-binding`,
    enabled: true,
    boundary: {},
    erase_generation: 0,
  } as never;
}

function ctxWith(overrides: {
  sources?: unknown[];
  mode?: string;
  targetScope?: string;
  createdBy?: string | null;
  stage?: string;
}): StageContext {
  return {
    db: {} as never,
    event: {
      workflowRunId: "run-1",
      tenantId: TENANT_ID,
      stepId: "step-1",
      iteration: 0,
      stage: overrides.stage ?? "acquire",
      processorConfigId: PROCESSOR_ID,
      sourceConfigId: null,
      options: null,
    },
    processor: {
      id: PROCESSOR_ID,
      tenant_id: TENANT_ID,
      mode: overrides.mode ?? "shared",
      target_scope: overrides.targetScope ?? "tenant",
      target_id: TENANT_ID,
      budget: {},
      created_by_user_id:
        overrides.createdBy === undefined ? USER_ID : overrides.createdBy,
    } as never,
    sources: (overrides.sources ?? []) as never,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(fakeAdapters)) delete fakeAdapters[key];
});

describe("runAcquire family dispatch", () => {
  it("a mixed-family processor runs BOTH adapters in one acquire stage", async () => {
    const twenty = fakeAdapter("twenty");
    const firecrawl = fakeAdapter("firecrawl");
    fakeAdapters.twenty = twenty;
    fakeAdapters.firecrawl = firecrawl;

    const result = await runAcquire(
      ctxWith({
        sources: [source("s-1", "twenty"), source("s-2", "firecrawl")],
      }),
    );

    expect(result.status).toBe("succeeded");
    expect(twenty.runAcquire).toHaveBeenCalledTimes(1);
    expect(firecrawl.runAcquire).toHaveBeenCalledTimes(1);
    expect(
      (result.output as { sources: Record<string, unknown> }).sources,
    ).toEqual({
      "s-1": { family: "twenty", fetched: 1 },
      "s-2": { family: "firecrawl", fetched: 1 },
    });
    // The grant envelope reaches the adapter for mid-loop scope checks.
    expect(
      (firecrawl.runAcquire as ReturnType<typeof vi.fn>).mock.calls[0]![0],
    ).toMatchObject({ grantBoundary: { granted: true } });
  });

  it("an unregistered family fails visibly (fail closed)", async () => {
    fakeAdapters.twenty = fakeAdapter("twenty");
    const result = await runAcquire(
      ctxWith({ sources: [source("s-1", "twenty"), source("s-2", "email")] }),
    );
    expect(result.status).toBe("failed");
    expect((result as { error?: string }).error).toMatch(
      /no registered memory-source adapter/,
    );
  });

  it("requiresOwnerUser families fail visibly without an owning user", async () => {
    fakeAdapters.twenty = fakeAdapter("twenty", { requiresOwnerUser: true });
    const result = await runAcquire(
      ctxWith({ sources: [source("s-1", "twenty")], createdBy: null }),
    );
    expect(result.status).toBe("failed");
    expect((result as { error?: string }).error).toMatch(/owning user/);
  });

  it("families WITHOUT requiresOwnerUser run without an owning user", async () => {
    const firecrawl = fakeAdapter("firecrawl");
    fakeAdapters.firecrawl = firecrawl;
    const result = await runAcquire(
      ctxWith({ sources: [source("s-1", "firecrawl")], createdBy: null }),
    );
    expect(result.status).toBe("succeeded");
    expect(firecrawl.runAcquire).toHaveBeenCalledTimes(1);
  });

  it("an adapter failure outcome fails the stage with its message", async () => {
    fakeAdapters.firecrawl = fakeAdapter("firecrawl", {
      runAcquire: vi.fn(async () => ({ ok: false, error: "scrape broke" })),
    });
    const result = await runAcquire(
      ctxWith({ sources: [source("s-1", "firecrawl")] }),
    );
    expect(result).toMatchObject({ status: "failed", error: "scrape broke" });
  });

  it("a not-ready adapter fails the stage before any acquisition", async () => {
    const firecrawl = fakeAdapter("firecrawl", {
      checkReadiness: vi.fn(async () => ({
        ready: false,
        reason: "web-extract unconfigured",
      })),
    });
    fakeAdapters.firecrawl = firecrawl;
    const result = await runAcquire(
      ctxWith({ sources: [source("s-1", "firecrawl")] }),
    );
    expect(result.status).toBe("failed");
    expect((result as { error?: string }).error).toMatch(
      /web-extract unconfigured/,
    );
    expect(firecrawl.runAcquire).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Zero-source runs (dev regression: run 929053dd FK violation on compound)
// ---------------------------------------------------------------------------

describe("zero-external-source personal run", () => {
  const personal = { mode: "personal", targetScope: "user", sources: [] };

  it("external stages no-op but compound still processes Thread memory in the User Bank", async () => {
    runBrainDreamState.mockResolvedValue({
      banks: [{ status: "applied", runId: "dream-threads", applied: 3 }],
    });
    for (const [stage, run] of [
      ["acquire", runAcquire],
      ["extract", runExtract],
      ["project", runProject],
      ["resolve", runResolve],
      ["retain", runRetain],
    ] as const) {
      const result = await run(ctxWith({ ...personal, stage }));
      expect(result.status, stage).toBe("succeeded");
      expect(result.counts?.noop, stage).toBe(1);
    }

    const compound = await runCompound(
      ctxWith({ ...personal, stage: "compound" }),
    );
    expect(compound.status).toBe("succeeded");
    expect(compound.counts).toEqual({ compounded: 1 });
    expect(runBrainDreamState).toHaveBeenCalledTimes(1);
    expect(runBrainDreamState).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ bankId: "user_owner-1" }),
      }),
    );
    // No external source means no valid memory_run_items FK target. The
    // workflow step output is still the durable execution evidence.
    expect(vi.mocked(recordRunItem)).not.toHaveBeenCalled();
  });

  it("compound with sources still records its run item against a REAL source", async () => {
    runBrainDreamState.mockResolvedValue({
      banks: [{ status: "applied", runId: "dream-1", applied: 1 }],
    });
    const result = await runCompound(
      ctxWith({ stage: "compound", sources: [source("s-1", "twenty")] }),
    );
    expect(result.status).toBe("succeeded");
    expect(vi.mocked(recordRunItem)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sourceConfigId: "s-1", stage: "compound" }),
    );
  });

  it("compound no-ops a zero-source shared processor without touching its empty bank", async () => {
    const result = await runCompound(
      ctxWith({ mode: "shared", stage: "compound", sources: [] }),
    );
    expect(result.status).toBe("succeeded");
    expect(result.counts).toEqual({ noop: 1 });
    expect(runBrainDreamState).not.toHaveBeenCalled();
    expect(vi.mocked(recordRunItem)).not.toHaveBeenCalled();
  });
});
