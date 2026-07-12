/**
 * Unit tests for the acquire stage logic (THINK-193 U1, Codex F2/F4/F5).
 *
 * The adapter, evidence, and repository modules are mocked; these tests
 * exercise the pure helpers (effectiveLimit, no-progress guard) and the
 * runAcquire orchestration (narrow-only limits, backscan recording without
 * checkpoint advance, binding-key plumbing).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./policy.js", () => {
  class MemoryAuthorizationError extends Error {}
  return {
    requireActiveGrant: vi.fn(async () => ({
      id: "grant-1",
      grant_version: 1,
      boundary: {},
    })),
    // U2: runAcquire re-checks the grant before EVERY provider page read.
    revalidateGrant: vi.fn(async () => undefined),
    assertBoundaryWithin: vi.fn(),
    MemoryAuthorizationError,
  };
});

vi.mock("../memory/index.js", () => ({ getMemoryServices: vi.fn() }));
vi.mock("../brain/dream/runner.js", () => ({ runBrainDreamState: vi.fn() }));
vi.mock("./adapters/twenty.js", () => ({
  acquireCompaniesPage: vi.fn(),
  reconcileCompaniesPage: vi.fn(),
  checkTwentyReadiness: vi.fn(),
  buildCompanyDossier: vi.fn(),
  hindsightDocumentIdFor: vi.fn(),
  projectionKeyForCompany: vi.fn(),
}));
vi.mock("./evidence.js", () => ({
  listEvidenceForProjection: vi.fn(),
  recordAcquiredPage: vi.fn(),
  recordDerivation: vi.fn(),
  recordRunItem: vi.fn(),
}));
vi.mock("./repository.js", () => {
  class CheckpointConflictError extends Error {}
  return {
    CheckpointConflictError,
    ensureCheckpoint: vi.fn(),
    getCheckpoint: vi.fn(),
    advanceCheckpoint: vi.fn(),
    resolveTargetBankId: vi.fn(),
  };
});

import {
  acquireCompaniesPage,
  checkTwentyReadiness,
  reconcileCompaniesPage,
} from "./adapters/twenty.js";
import { recordAcquiredPage } from "./evidence.js";
import { MemoryAuthorizationError, revalidateGrant } from "./policy.js";
import { advanceCheckpoint, ensureCheckpoint } from "./repository.js";
import {
  effectiveLimit,
  isNoProgress,
  pageFingerprint,
  runAcquire,
  type StageContext,
} from "./stages.js";
import type { EvidenceUpsert } from "./types.js";

// ---------------------------------------------------------------------------
// effectiveLimit (F2: narrow-only limits)
// ---------------------------------------------------------------------------

describe("effectiveLimit", () => {
  it("falls back to the default when no value is present", () => {
    expect(effectiveLimit([undefined, null, undefined], 200, 1, 2000)).toBe(
      200,
    );
  });

  it("options larger than the saved boundary cannot widen it", () => {
    // boundary=25, budget absent, options=500 → 25 wins.
    expect(effectiveLimit([25, undefined, 500], 200, 1, 2000)).toBe(25);
  });

  it("options smaller than the boundary narrow it", () => {
    expect(effectiveLimit([100, undefined, 10], 200, 1, 2000)).toBe(10);
  });

  it("the processor budget wins when it is the smallest", () => {
    expect(effectiveLimit([100, 5, 50], 200, 1, 2000)).toBe(5);
  });

  it("ignores non-numeric junk but keeps numeric strings", () => {
    expect(effectiveLimit(["junk", "30", undefined], 200, 1, 2000)).toBe(30);
  });

  it("clamps to [min, max]", () => {
    expect(effectiveLimit([0], 200, 1, 2000)).toBe(1);
    expect(effectiveLimit([99999], 200, 1, 2000)).toBe(2000);
    expect(effectiveLimit([], 99999, 1, 2000)).toBe(2000);
  });

  it("floors fractional values", () => {
    expect(effectiveLimit([12.9], 200, 1, 2000)).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// no-progress guard (F5)
// ---------------------------------------------------------------------------

describe("isNoProgress / pageFingerprint", () => {
  it("is false on the first page", () => {
    expect(isNoProgress(null, { token: "t1", fingerprint: "a|b" })).toBe(false);
  });

  it("detects a repeated provider page token", () => {
    expect(
      isNoProgress(
        { token: "t1", fingerprint: "a|b" },
        { token: "t1", fingerprint: "c|d" },
      ),
    ).toBe(true);
  });

  it("detects an identical consecutive id set", () => {
    expect(
      isNoProgress(
        { token: "t1", fingerprint: "a|b" },
        { token: "t2", fingerprint: "a|b" },
      ),
    ).toBe(true);
  });

  it("does not fire on distinct tokens and ids", () => {
    expect(
      isNoProgress(
        { token: "t1", fingerprint: "a|b" },
        { token: "t2", fingerprint: "c|d" },
      ),
    ).toBe(false);
  });

  it("does not treat two token-less pages as no-progress on token alone", () => {
    expect(
      isNoProgress(
        { token: null, fingerprint: "a" },
        { token: null, fingerprint: "b" },
      ),
    ).toBe(false);
  });

  it("does not treat two empty pages as an identical id set", () => {
    expect(
      isNoProgress(
        { token: "t1", fingerprint: "" },
        { token: "t2", fingerprint: "" },
      ),
    ).toBe(false);
  });

  it("pageFingerprint joins ids deterministically", () => {
    expect(pageFingerprint(["a", "b"])).toBe(pageFingerprint(["a", "b"]));
    expect(pageFingerprint(["a", "b"])).not.toBe(pageFingerprint(["b", "a"]));
    expect(pageFingerprint([])).toBe("");
  });
});

// ---------------------------------------------------------------------------
// runAcquire orchestration
// ---------------------------------------------------------------------------

const TENANT_ID = "0015953e-aa13-4cab-8398-2e70f73dda63";
const SOURCE_ID = "11111111-1111-4111-8111-111111111111";
const PROCESSOR_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";

function item(id: string, updatedAt: string | null): EvidenceUpsert {
  return {
    sourceItemId: id,
    sourceVersion: `${updatedAt ?? "na"}#deadbeef0123`,
    sourceTimestamp: updatedAt ? new Date(updatedAt) : null,
    contentHash: "deadbeef".repeat(8),
    normalizedSnapshot: { id },
    extractionRecipe: { source: "twenty" },
    targetScope: "tenant",
    targetId: TENANT_ID,
  };
}

function makeCtx(overrides: {
  boundary?: Record<string, unknown>;
  budget?: Record<string, unknown>;
  options?: Record<string, unknown> | null;
}): StageContext {
  return {
    db: {} as never,
    event: {
      workflowRunId: "run-1",
      tenantId: TENANT_ID,
      stepId: "step-1",
      iteration: 0,
      stage: "acquire",
      processorConfigId: PROCESSOR_ID,
      sourceConfigId: SOURCE_ID,
      options: overrides.options ?? null,
    },
    processor: {
      id: PROCESSOR_ID,
      tenant_id: TENANT_ID,
      mode: "shared",
      target_scope: "tenant",
      target_id: TENANT_ID,
      budget: overrides.budget ?? {},
      created_by_user_id: USER_ID,
    } as never,
    sources: [
      {
        id: SOURCE_ID,
        tenant_id: TENANT_ID,
        processor_config_id: PROCESSOR_ID,
        source_family: "twenty",
        source_binding_key: "twenty",
        enabled: true,
        boundary: overrides.boundary ?? {},
        policy_version: 1,
      } as never,
    ],
  };
}

describe("runAcquire", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkTwentyReadiness).mockResolvedValue({
      ready: true,
      client: {} as never,
    });
    vi.mocked(ensureCheckpoint).mockResolvedValue({
      id: "cp-1",
      tenant_id: TENANT_ID,
      source_config_id: SOURCE_ID,
      partition_key: "companies",
      cursor: {},
      version: 0,
    } as never);
    vi.mocked(recordAcquiredPage).mockImplementation(
      async (_db, args: { items: unknown[] }) =>
        ({
          changed: args.items,
          seen: 0,
          checkpoint: {
            id: "cp-1",
            cursor: {},
            version: 1,
          },
        }) as never,
    );
    vi.mocked(advanceCheckpoint).mockResolvedValue({
      id: "cp-1",
      cursor: {},
      version: 2,
    } as never);
    vi.mocked(reconcileCompaniesPage).mockResolvedValue({
      items: [],
      nextCursor: null,
      rawCount: 0,
      pageToken: null,
    });
  });

  it("passes the source binding key to checkTwentyReadiness", async () => {
    vi.mocked(acquireCompaniesPage).mockResolvedValue({
      items: [],
      nextCursor: null,
      rawCount: 0,
      pageToken: null,
    });
    await runAcquire(makeCtx({}));
    expect(vi.mocked(checkTwentyReadiness).mock.calls[0]![1]).toMatchObject({
      tenantId: TENANT_ID,
      userId: USER_ID,
      bindingKey: "twenty",
    });
  });

  it("F2 end-to-end: options.maxRecords 500 cannot widen boundary.maxRecords 25", async () => {
    // Provider has plenty of data; every page is full with fresh ids.
    let nextId = 0;
    vi.mocked(acquireCompaniesPage).mockImplementation(
      async (_client, args: { pageSize: number }) => {
        const items = Array.from({ length: args.pageSize }, () =>
          item(`c${nextId++}`, "2026-06-01T00:00:00Z"),
        );
        return {
          items,
          nextCursor: { lastUpdatedAt: "2026-06-01T00:00:00Z", lastId: "x" },
          rawCount: args.pageSize,
          pageToken: null,
        };
      },
    );

    const result = await runAcquire(
      makeCtx({
        boundary: { maxRecords: 25, pageSize: 10 },
        options: { maxRecords: 500 },
      }),
    );

    expect(result.status).toBe("succeeded");
    const fetched = vi
      .mocked(acquireCompaniesPage)
      .mock.calls.reduce((sum, call) => sum + call[1].pageSize, 0);
    expect(fetched).toBe(25);
  });

  it("F2: the processor budget narrows below both boundary and options", async () => {
    let nextId = 0;
    vi.mocked(acquireCompaniesPage).mockImplementation(
      async (_client, args: { pageSize: number }) => ({
        items: Array.from({ length: args.pageSize }, () =>
          item(`c${nextId++}`, "2026-06-01T00:00:00Z"),
        ),
        nextCursor: { lastUpdatedAt: "2026-06-01T00:00:00Z", lastId: "x" },
        rawCount: args.pageSize,
        pageToken: null,
      }),
    );
    await runAcquire(
      makeCtx({
        boundary: { maxRecords: 100, pageSize: 10 },
        budget: { maxRecords: 7 },
        options: { maxRecords: 50 },
      }),
    );
    const fetched = vi
      .mocked(acquireCompaniesPage)
      .mock.calls.reduce((sum, call) => sum + call[1].pageSize, 0);
    expect(fetched).toBe(7);
  });

  it("advances the incremental checkpoint from sourceTimestamp, not the hash-bearing sourceVersion", async () => {
    vi.mocked(acquireCompaniesPage).mockResolvedValueOnce({
      items: [item("c1", "2026-06-01T00:00:00.000Z")],
      nextCursor: null,
      rawCount: 1,
      pageToken: null,
    });
    await runAcquire(makeCtx({ boundary: { maxRecords: 1 } }));
    const call = vi.mocked(recordAcquiredPage).mock.calls[0]![1] as {
      nextCursor: Record<string, unknown>;
    };
    expect(call.nextCursor.lastUpdatedAt).toBe("2026-06-01T00:00:00.000Z");
    expect(String(call.nextCursor.lastUpdatedAt)).not.toContain("#");
  });

  it("F4: backscan records pages WITHOUT advancing the incremental checkpoint", async () => {
    // Incremental pass finds nothing new.
    vi.mocked(acquireCompaniesPage).mockResolvedValue({
      items: [],
      nextCursor: null,
      rawCount: 0,
      pageToken: null,
    });
    vi.mocked(reconcileCompaniesPage)
      .mockResolvedValueOnce({
        items: [item("c1", "2026-06-01T00:00:00Z")],
        nextCursor: null,
        rawCount: 1,
        pageToken: "bk-tok-2",
      })
      .mockResolvedValueOnce({
        items: [item("c2", "2026-06-02T00:00:00Z")],
        nextCursor: null,
        rawCount: 1,
        pageToken: null,
      });

    const result = await runAcquire(makeCtx({ boundary: { maxRecords: 10 } }));
    expect(result.status).toBe("succeeded");

    const backscanCalls = vi
      .mocked(recordAcquiredPage)
      .mock.calls.filter(
        (call) =>
          (call[1] as { skipCheckpointAdvance?: boolean })
            .skipCheckpointAdvance === true,
      );
    expect(backscanCalls.length).toBe(2);
    // The sweep position is persisted via a dedicated checkpoint advance…
    expect(vi.mocked(advanceCheckpoint)).toHaveBeenCalled();
    const cursorArg = vi.mocked(advanceCheckpoint).mock.calls.at(-1)![1]
      .cursor as Record<string, unknown>;
    // …and the finished sweep resets the token for the next round-robin pass.
    expect(cursorArg.backscanToken).toBeNull();
  });

  it("F4: an interrupted backscan persists its resume token", async () => {
    vi.mocked(acquireCompaniesPage).mockResolvedValue({
      items: [],
      nextCursor: null,
      rawCount: 0,
      pageToken: null,
    });
    // Budget of 1: first reconcile page consumes it; token must be saved.
    vi.mocked(reconcileCompaniesPage).mockResolvedValueOnce({
      items: [item("c1", "2026-06-01T00:00:00Z")],
      nextCursor: null,
      rawCount: 1,
      pageToken: "bk-resume",
    });
    await runAcquire(makeCtx({ boundary: { maxRecords: 1, pageSize: 1 } }));
    const cursorArg = vi.mocked(advanceCheckpoint).mock.calls.at(-1)![1]
      .cursor as Record<string, unknown>;
    expect(cursorArg.backscanToken).toBe("bk-resume");
  });

  it("F5: fails visibly when the provider repeats a page token (incremental)", async () => {
    vi.mocked(acquireCompaniesPage).mockResolvedValue({
      items: [item("c1", "2026-06-01T00:00:00Z")],
      nextCursor: { lastUpdatedAt: "2026-06-01T00:00:00Z", lastId: "c1" },
      rawCount: 5,
      pageToken: "stuck-token",
    });
    const result = await runAcquire(
      makeCtx({ boundary: { maxRecords: 100, pageSize: 5 } }),
    );
    expect(result.status).toBe("failed");
    expect((result as { error?: string }).error).toMatch(/no.?progress/i);
  });

  it("F5: fails visibly when the backscan repeats an identical id set", async () => {
    vi.mocked(acquireCompaniesPage).mockResolvedValue({
      items: [],
      nextCursor: null,
      rawCount: 0,
      pageToken: null,
    });
    vi.mocked(reconcileCompaniesPage).mockResolvedValue({
      items: [item("c1", "2026-06-01T00:00:00Z")],
      nextCursor: null,
      rawCount: 1,
      pageToken: "bk-1",
    });
    const result = await runAcquire(
      makeCtx({ boundary: { maxRecords: 100, pageSize: 1 } }),
    );
    expect(result.status).toBe("failed");
    expect((result as { error?: string }).error).toMatch(/no.?progress/i);
  });

  it("never regresses the incremental cursor below the stored checkpoint", async () => {
    vi.mocked(ensureCheckpoint).mockResolvedValue({
      id: "cp-1",
      tenant_id: TENANT_ID,
      source_config_id: SOURCE_ID,
      partition_key: "companies",
      cursor: { lastUpdatedAt: "2026-06-15T00:00:00.000Z", lastId: "zz" },
      version: 3,
    } as never);
    // Provider misbehaves: filtered response contains an OLDER record.
    vi.mocked(acquireCompaniesPage).mockResolvedValueOnce({
      items: [item("c0", "2026-01-01T00:00:00.000Z")],
      nextCursor: null,
      rawCount: 1,
      pageToken: null,
    });
    const result = await runAcquire(makeCtx({ boundary: { maxRecords: 1 } }));
    expect(result.status).toBe("succeeded");
    const call = vi.mocked(recordAcquiredPage).mock.calls[0]![1] as {
      nextCursor: Record<string, unknown>;
    };
    expect(call.nextCursor.lastUpdatedAt).toBe("2026-06-15T00:00:00.000Z");
    expect(call.nextCursor.lastId).toBe("zz");
  });

  it("U2: a grant revoked between pages fails the run before the second provider read", async () => {
    // Provider would happily keep serving full pages.
    let nextId = 0;
    vi.mocked(acquireCompaniesPage).mockImplementation(
      async (_client, args: { pageSize: number }) => ({
        items: Array.from({ length: args.pageSize }, () =>
          item(`c${nextId++}`, "2026-06-01T00:00:00Z"),
        ),
        nextCursor: { lastUpdatedAt: "2026-06-01T00:00:00Z", lastId: "x" },
        rawCount: args.pageSize,
        pageToken: null,
      }),
    );
    // The pre-page grant re-check passes for page 1, then the grant is
    // revoked before page 2's read.
    vi.mocked(revalidateGrant)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        new MemoryAuthorizationError(
          "authorization grant grant-1 is revoked — acquisition stopped before the next page",
        ),
      );

    const result = await runAcquire(
      makeCtx({ boundary: { maxRecords: 20, pageSize: 10 } }),
    );

    // Visible failure carrying the authorization message…
    expect(result.status).toBe("failed");
    expect((result as { error?: string }).error).toMatch(/revoked/);
    // …page 2's provider read never happens…
    expect(vi.mocked(acquireCompaniesPage)).toHaveBeenCalledTimes(1);
    // …the checkpoint advanced only for the page that WAS read (page 1)…
    expect(vi.mocked(recordAcquiredPage)).toHaveBeenCalledTimes(1);
    // …and neither the backscan nor its checkpoint write ever start.
    expect(vi.mocked(reconcileCompaniesPage)).not.toHaveBeenCalled();
    expect(vi.mocked(advanceCheckpoint)).not.toHaveBeenCalled();
  });
});
