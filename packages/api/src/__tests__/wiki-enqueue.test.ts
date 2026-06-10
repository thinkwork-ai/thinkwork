/**
 * Unit tests for the graph wiki-compile enqueue helper (U11 cutover state:
 * the planner-era post-turn enqueue is gone; the graph enqueue is
 * unconditional apart from the tenant kill switch).
 *
 * Covers the decision matrix in lib/wiki/enqueue.ts:
 * - skipped when tenant missing / flag off / tenant not found
 * - deduped when a bucket already has a job
 * - successful enqueue path (invoke success + invoke failure)
 * - error swallowed when repository blows up
 *
 * Also covers the pure helpers in lib/wiki/repository.ts that don't need a
 * live DB: normalizeAlias, buildCompileDedupeKey, renderBodyMarkdown.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mock state so vi.mock factories can see the handles ─────────────

const { mockTenantRows, mockGraphEnqueue, mockInvoke } = vi.hoisted(() => {
  return {
    mockTenantRows: vi.fn<() => Promise<Array<{ enabled: boolean }>>>(),
    mockGraphEnqueue: vi.fn(),
    mockInvoke: vi.fn(),
  };
});

// Minimal drizzle query-builder stub — the chain `db.select({}).from(...).where(...).limit(n)`
// resolves to whatever mockTenantRows returns.
vi.mock("../lib/db.js", () => {
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => mockTenantRows()),
      })),
    })),
  }));
  return { db: { select } };
});

vi.mock("@thinkwork/database-pg/schema", () => ({
  tenants: {
    id: "tenants.id",
    wiki_compile_enabled: "tenants.wiki_compile_enabled",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ __eq: [a, b] }),
}));

vi.mock("../lib/wiki/repository.js", async (importOriginal) => {
  const actual =
    (await importOriginal()) as typeof import("../lib/wiki/repository.js");
  return {
    ...actual,
    // Only swap the DB-touching helper — keep the pure functions real.
    enqueueGraphCompileJob: mockGraphEnqueue,
  };
});

// @aws-sdk/client-lambda is imported dynamically inside invokeWikiCompile; we
// mock the module so the Lambda invoke is inspectable.
vi.mock("@aws-sdk/client-lambda", () => ({
  LambdaClient: vi.fn().mockImplementation(() => ({
    send: mockInvoke,
  })),
  InvokeCommand: vi.fn().mockImplementation((input: unknown) => ({ input })),
}));

import { maybeEnqueueGraphWikiCompile } from "../lib/wiki/enqueue.js";
import {
  buildCompileDedupeKey,
  parseCompileDedupeBucket,
  normalizeAlias,
  renderBodyMarkdown,
} from "../lib/wiki/repository.js";

// ─── Reset + env between tests ───────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.STAGE;
  delete process.env.WIKI_COMPILE_FN;
});

// ─── Pure helpers (no mocks needed) ──────────────────────────────────────────

describe("normalizeAlias", () => {
  it("lowercases, strips punctuation, collapses whitespace", () => {
    expect(normalizeAlias("Café  Mocha!")).toBe("café mocha");
  });

  it("preserves internal hyphens and apostrophes", () => {
    expect(normalizeAlias("O'Hara's Pub-House")).toBe("o'hara's pub-house");
  });

  it("returns empty for punctuation-only input", () => {
    expect(normalizeAlias("!!! ... ???")).toBe("");
  });
});

describe("buildCompileDedupeKey", () => {
  it("uses tenant, owner, and 5-min bucket", () => {
    const key = buildCompileDedupeKey({
      tenantId: "t1",
      ownerId: "a1",
      nowEpochSeconds: 600, // bucket 2
    });
    expect(key).toBe("t1:a1:2");
  });

  it("same bucket for two timestamps within 5 minutes", () => {
    const a = buildCompileDedupeKey({
      tenantId: "t",
      ownerId: "o",
      nowEpochSeconds: 1000,
    });
    const b = buildCompileDedupeKey({
      tenantId: "t",
      ownerId: "o",
      nowEpochSeconds: 1000 + 60, // +60s still inside 300s bucket
    });
    expect(a).toBe(b);
  });

  it("different buckets across a 5-min boundary", () => {
    const a = buildCompileDedupeKey({
      tenantId: "t",
      ownerId: "o",
      nowEpochSeconds: 299,
    });
    const b = buildCompileDedupeKey({
      tenantId: "t",
      ownerId: "o",
      nowEpochSeconds: 300,
    });
    expect(a).not.toBe(b);
  });
});

describe("parseCompileDedupeBucket", () => {
  it("extracts the bucket number from a compiler-built key", () => {
    const key = buildCompileDedupeKey({
      tenantId: "t1",
      ownerId: "a1",
      nowEpochSeconds: 600,
    });
    expect(parseCompileDedupeBucket(key)).toBe(2);
  });

  it("returns null for manually-seeded keys that don't match", () => {
    expect(parseCompileDedupeBucket("marco-rebuild-1776700207")).toBeNull();
  });

  it("returns null when the last segment isn't a whole number", () => {
    expect(parseCompileDedupeBucket("t:a:abc")).toBeNull();
    expect(parseCompileDedupeBucket("t:a:3.5")).toBeNull();
  });

  it("returns null when the key has the wrong arity", () => {
    expect(parseCompileDedupeBucket("t:a")).toBeNull();
    expect(parseCompileDedupeBucket("t:a:b:c")).toBeNull();
  });

  it("round-trips with buildCompileDedupeKey — continuation invariant", () => {
    // This is the guarantee the continuation path depends on: a job
    // enqueued at `nowEpochSeconds = N * 300` must produce a key whose
    // parsed bucket is `N`, so `parentBucket + 1` gives the
    // next-strictly-later bucket.
    const key = buildCompileDedupeKey({
      tenantId: "t",
      ownerId: "o",
      nowEpochSeconds: 5922342 * 300,
    });
    expect(parseCompileDedupeBucket(key)).toBe(5922342);
  });
});

describe("renderBodyMarkdown", () => {
  it("renders sections ordered by position with H2 headings", () => {
    const out = renderBodyMarkdown([
      { heading: "Second", body_md: "b2", position: 2 },
      { heading: "First", body_md: "b1", position: 1 },
    ]);
    expect(out).toBe("## First\n\nb1\n\n## Second\n\nb2");
  });

  it("is deterministic (same input → same output)", () => {
    const input = [
      { heading: "One", body_md: "a", position: 1 },
      { heading: "Two", body_md: "b", position: 2 },
    ];
    expect(renderBodyMarkdown(input)).toBe(renderBodyMarkdown(input));
  });
});

// ─── maybeEnqueueGraphWikiCompile branches (plan 2026-06-09-004 U10/U11) ─────

describe("maybeEnqueueGraphWikiCompile", () => {
  it("returns skipped_missing_inputs when tenant absent", async () => {
    const r = await maybeEnqueueGraphWikiCompile({ tenantId: "" });
    expect(r.status).toBe("skipped_missing_inputs");
    expect(mockGraphEnqueue).not.toHaveBeenCalled();
  });

  it("returns skipped_tenant_not_found when tenant row is missing", async () => {
    mockTenantRows.mockResolvedValueOnce([]);
    const r = await maybeEnqueueGraphWikiCompile({ tenantId: "t" });
    expect(r.status).toBe("skipped_tenant_not_found");
    expect(mockGraphEnqueue).not.toHaveBeenCalled();
  });

  it("honors the tenant wiki_compile_enabled kill switch", async () => {
    mockTenantRows.mockResolvedValueOnce([{ enabled: false }]);
    const r = await maybeEnqueueGraphWikiCompile({ tenantId: "t" });
    expect(r.status).toBe("skipped_flag_off");
    expect(mockGraphEnqueue).not.toHaveBeenCalled();
  });

  it("enqueues a tenant-keyed graph job and invokes wiki-compile (STAGE resolves fn name)", async () => {
    process.env.STAGE = "dev";
    mockTenantRows.mockResolvedValueOnce([{ enabled: true }]);
    mockGraphEnqueue.mockResolvedValueOnce({
      inserted: true,
      job: { id: "graph-job-1" },
    });
    mockInvoke.mockResolvedValueOnce({});

    const r = await maybeEnqueueGraphWikiCompile({ tenantId: "t" });

    expect(r).toEqual({ status: "enqueued", jobId: "graph-job-1" });
    expect(mockGraphEnqueue).toHaveBeenCalledWith({
      tenantId: "t",
      trigger: "graph_materialize",
    });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    const invokeArg = mockInvoke.mock.calls[0][0] as { input: any };
    expect(invokeArg.input.FunctionName).toBe("thinkwork-dev-api-wiki-compile");
    expect(invokeArg.input.InvocationType).toBe("Event");
  });

  it("prefers WIKI_COMPILE_FN env override when set", async () => {
    process.env.WIKI_COMPILE_FN = "override-fn-arn";
    process.env.STAGE = "dev";
    mockTenantRows.mockResolvedValueOnce([{ enabled: true }]);
    mockGraphEnqueue.mockResolvedValueOnce({
      inserted: true,
      job: { id: "graph-job-1" },
    });
    mockInvoke.mockResolvedValueOnce({});

    await maybeEnqueueGraphWikiCompile({ tenantId: "t" });
    const invokeArg = mockInvoke.mock.calls[0][0] as { input: any };
    expect(invokeArg.input.FunctionName).toBe("override-fn-arn");
  });

  it("skips invoke (without failing) when no STAGE / no WIKI_COMPILE_FN", async () => {
    mockTenantRows.mockResolvedValueOnce([{ enabled: true }]);
    mockGraphEnqueue.mockResolvedValueOnce({
      inserted: true,
      job: { id: "graph-job-1" },
    });

    const r = await maybeEnqueueGraphWikiCompile({ tenantId: "t" });

    expect(r.status).toBe("enqueued");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("returns enqueued_invoke_failed when Lambda invoke throws", async () => {
    process.env.STAGE = "dev";
    mockTenantRows.mockResolvedValueOnce([{ enabled: true }]);
    mockGraphEnqueue.mockResolvedValueOnce({
      inserted: true,
      job: { id: "graph-job-1" },
    });
    mockInvoke.mockRejectedValueOnce(new Error("ResourceNotFoundException"));

    const r = await maybeEnqueueGraphWikiCompile({ tenantId: "t" });

    expect(r.status).toBe("enqueued_invoke_failed");
    expect(r.jobId).toBe("graph-job-1");
    expect(r.error).toContain("ResourceNotFoundException");
  });

  it("dedupes against an existing job in the bucket", async () => {
    mockTenantRows.mockResolvedValueOnce([{ enabled: true }]);
    mockGraphEnqueue.mockResolvedValueOnce({
      inserted: false,
      job: { id: "graph-job-existing" },
    });

    const r = await maybeEnqueueGraphWikiCompile({ tenantId: "t" });

    expect(r).toEqual({ status: "deduped", jobId: "graph-job-existing" });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("returns error (never throws) when the repository blows up", async () => {
    mockTenantRows.mockRejectedValueOnce(new Error("DB down"));
    const r = await maybeEnqueueGraphWikiCompile({ tenantId: "t" });
    expect(r.status).toBe("error");
    expect(r.error).toBe("DB down");
  });
});
