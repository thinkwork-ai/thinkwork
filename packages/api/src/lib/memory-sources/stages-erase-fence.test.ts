/**
 * Erase write-fence external-write compensation (THINK-193 U2, Codex
 * round-6 P1): the S3 snapshot put and the Hindsight document upsert are
 * checked against the erase generation immediately BEFORE and AFTER the
 * call. A generation that moves mid-call triggers DIRECT compensation
 * (exact-version S3 delete with zero-versions proof; Hindsight document
 * delete), with a durable erase-marker reopen as the fallback when direct
 * compensation fails.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const upsertMarkdownMemoryDocument = vi.fn(async () => undefined);
const adapterDeleteDocument = vi.fn(async () => "deleted" as const);

vi.mock("../memory/index.js", () => ({
  getMemoryServices: () => ({
    adapter: {
      upsertMarkdownMemoryDocument,
      deleteDocument: adapterDeleteDocument,
    },
    config: { engine: "hindsight" },
  }),
}));
vi.mock("../brain/dream/runner.js", () => ({ runBrainDreamState: vi.fn() }));
vi.mock("./claims.js", () => ({
  extractCompanyClaims: vi.fn(() => []),
  // U6 email exports pulled in via the adapter registry module graph.
  extractWebPageClaims: vi.fn(() => []),
  extractEmailThreadClaims: vi.fn(() => []),
  subjectKeyForEmailThread: (threadId: string) => `email:thread:${threadId}`,
  boundedInlineText: (value: string) => value,
  upsertClaimsForEvidence: vi.fn(async () => ({
    created: 0,
    supported: 0,
    supersededSupports: 0,
    unsupportedRetracted: 0,
  })),
  listActiveClaimsForSubject: vi.fn(async () => []),
  buildClaimProjection: vi.fn(() => ({ markdown: "" })),
}));
vi.mock("./adapters/twenty.js", () => ({
  acquireCompaniesPage: vi.fn(),
  reconcileCompaniesPage: vi.fn(),
  checkTwentyReadiness: vi.fn(),
  buildCompanyDossier: vi.fn(() => ({ title: "Acme", markdown: "# Acme" })),
  hindsightDocumentIdFor: vi.fn(
    (sourceConfigId: string, key: string) =>
      `external:${sourceConfigId}:${key}`,
  ),
  projectionKeyForCompany: vi.fn((id: string) => `company:${id}`),
}));
vi.mock("./repository.js", () => ({
  CheckpointConflictError: class CheckpointConflictError extends Error {},
  ensureCheckpoint: vi.fn(),
  getCheckpoint: vi.fn(),
  advanceCheckpoint: vi.fn(),
  resolveTargetBankId: vi.fn(
    () => "tenant_0015953e-aa13-4cab-8398-2e70f73dda63",
  ),
}));

const recordDerivation = vi.fn(
  async (..._args: unknown[]) => ({ id: "deriv-1" }) as never,
);
const recordDerivationWithRunItem = vi.fn(
  async (..._args: unknown[]) => ({ id: "deriv-1" }) as never,
);
vi.mock("./evidence.js", () => ({
  listEvidenceForProjection: vi.fn(),
  recordAcquiredPage: vi.fn(),
  recordDerivation: (...args: unknown[]) => recordDerivation(...args),
  recordDerivationWithRunItem: (...args: unknown[]) =>
    recordDerivationWithRunItem(...args),
  recordRunItem: vi.fn(async () => true),
}));

// In-memory versioned S3 world.
const s3World = {
  versions: new Map<string, string[]>(),
  failDirectDelete: false,
};
let putSeq = 0;
vi.mock("./snapshots.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./snapshots.js")>();
  return {
    ...actual,
    resolveSnapshotBucket: () => "test-bucket",
    putEvidenceSnapshot: vi.fn(async (_s3: unknown, args: { key: string }) => {
      const versionId = `v${++putSeq}`;
      s3World.versions.set(args.key, [
        ...(s3World.versions.get(args.key) ?? []),
        versionId,
      ]);
      return {
        ref: `s3://test-bucket/${args.key}`,
        expiresAt: new Date("2026-08-10T00:00:00Z"),
        versionId,
      };
    }),
    deleteEvidenceSnapshotVersion: vi.fn(
      async (_s3: unknown, args: { key: string; versionId: string | null }) => {
        if (s3World.failDirectDelete) {
          throw new Error("s3 delete unavailable");
        }
        s3World.versions.set(
          args.key,
          (s3World.versions.get(args.key) ?? []).filter(
            (v) => v !== args.versionId,
          ),
        );
      },
    ),
    verifyNoSnapshotVersions: vi.fn(
      async (_s3: unknown, args: { key: string }) =>
        (s3World.versions.get(args.key) ?? []).length === 0,
    ),
  };
});

const assertSourceWritable = vi.fn(async () => {});
const rearmEraseCleanup = vi.fn(async () => true);
vi.mock("./erase-fence.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./erase-fence.js")>();
  return {
    ...actual,
    assertSourceWritable: (...args: unknown[]) =>
      assertSourceWritable(...(args as [])),
    rearmEraseCleanup: (...args: unknown[]) =>
      rearmEraseCleanup(...(args as [])),
  };
});

import { listEvidenceForProjection } from "./evidence.js";
import { SourceEraseFencedError } from "./erase-fence.js";
import { offloadSnapshots, runRetain, type StageContext } from "./stages.js";
import type { EvidenceRow } from "./types.js";

const TENANT_ID = "0015953e-aa13-4cab-8398-2e70f73dda63";
const SOURCE_CONFIG_ID = "4dee701a-c17b-46fe-9f38-a333d4c3fad0";

function evidenceRow(n: number): EvidenceRow {
  return {
    id: `ev-${n}`,
    tenant_id: TENANT_ID,
    source_config_id: SOURCE_CONFIG_ID,
    source_item_id: `company-${n}`,
    source_version: "v1",
    content_hash: `hash-${n}`,
    lifecycle: "active",
    target_scope: "tenant",
    target_id: TENANT_ID,
    snapshot_ref: null,
    snapshot_expires_at: null,
    normalized_snapshot: { id: `company-${n}`, name: `Acme ${n}` },
    extraction_recipe: {},
  } as unknown as EvidenceRow;
}

/** Minimal db: records evidence-row updates so tests can assert the ref was
 * never persisted after a fenced write. */
function makeDb() {
  const updates: Array<Record<string, unknown>> = [];
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "leftJoin", "where", "orderBy", "limit"]) {
    chain[m] = () => chain;
  }
  chain.then = (resolve: (v: unknown[]) => unknown) =>
    Promise.resolve().then(() => resolve([]));
  return {
    updates,
    db: {
      select: () => chain,
      update: () => ({
        set: (values: Record<string, unknown>) => {
          updates.push(values);
          return chain;
        },
      }),
      transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}),
    } as never,
  };
}

const FENCE = {
  tenantId: TENANT_ID,
  sourceConfigId: SOURCE_CONFIG_ID,
  expectedEraseGeneration: 0,
};

function fencedError() {
  return new SourceEraseFencedError(
    "generation_advanced",
    "erase generation advanced (0 → 1) — an erase is in progress, aborting write",
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  s3World.versions.clear();
  s3World.failDirectDelete = false;
  putSeq = 0;
});

describe("offloadSnapshots erase-fence compensation (S3, round-6 P1)", () => {
  it("erase completes between precheck and PutObject: the exact written version is deleted and ZERO versions remain for the key", async () => {
    // Pre-check passes; post-check discovers the moved generation (the
    // erase marker may even be terminal by now — direct compensation must
    // still remove the object).
    assertSourceWritable
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(fencedError());
    const { db, updates } = makeDb();

    await expect(
      offloadSnapshots(db, undefined, {
        items: [evidenceRow(1)],
        eraseFence: FENCE,
      }),
    ).rejects.toThrow(/erase is in progress/);

    // Zero current/noncurrent versions and zero delete markers remain.
    const allVersions = [...s3World.versions.values()].flat();
    expect(allVersions).toHaveLength(0);
    // Direct compensation sufficed — no marker reopen needed.
    expect(rearmEraseCleanup).not.toHaveBeenCalled();
    // The evidence row never keeps the dangling ref.
    expect(updates).toHaveLength(0);
  });

  it("direct-delete failure leaves a durably reopened erase marker (drainer re-sweeps)", async () => {
    assertSourceWritable
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(fencedError());
    s3World.failDirectDelete = true;
    const { db, updates } = makeDb();

    await expect(
      offloadSnapshots(db, undefined, {
        items: [evidenceRow(1)],
        eraseFence: FENCE,
      }),
    ).rejects.toThrow(/erase is in progress/);

    expect(rearmEraseCleanup).toHaveBeenCalledExactlyOnceWith(db, {
      tenantId: TENANT_ID,
      sourceConfigId: SOURCE_CONFIG_ID,
    });
    expect(updates).toHaveLength(0);
  });

  it("a clean fence persists the ref normally", async () => {
    const { db, updates } = makeDb();
    const offloaded = await offloadSnapshots(db, undefined, {
      items: [evidenceRow(1)],
      eraseFence: FENCE,
    });
    expect(offloaded).toBe(1);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ normalized_snapshot: null });
  });
});

describe("runRetain erase-fence compensation (Hindsight, round-6 P1)", () => {
  function makeCtx(db: never): StageContext {
    return {
      db,
      event: {
        workflowRunId: "run-1",
        tenantId: TENANT_ID,
        stepId: "step-1",
        iteration: 0,
        stage: "retain",
        processorConfigId: "cfg-1",
        sourceConfigId: SOURCE_CONFIG_ID,
        options: null,
      },
      processor: {
        id: "cfg-1",
        tenant_id: TENANT_ID,
        target_scope: "tenant",
        target_id: TENANT_ID,
        budget: {},
      } as never,
      sources: [
        {
          id: SOURCE_CONFIG_ID,
          source_family: "twenty",
          boundary: {},
          erase_generation: 0,
        } as never,
      ],
    };
  }

  beforeEach(() => {
    vi.mocked(listEvidenceForProjection).mockResolvedValue([
      evidenceRow(1),
    ] as never);
  });

  it("post-upsert fence movement compensates with a DIRECT document delete and fails the stage; no derivation is recorded", async () => {
    // pre-upsert check ok, post-upsert check fenced.
    assertSourceWritable
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(fencedError());
    const { db } = makeDb();

    const result = await runRetain(makeCtx(db as never));
    expect(result.status).toBe("failed");
    expect(upsertMarkdownMemoryDocument).toHaveBeenCalledTimes(1);
    expect(adapterDeleteDocument).toHaveBeenCalledExactlyOnceWith({
      tenantId: TENANT_ID,
      ownerType: "tenant",
      ownerId: TENANT_ID,
      documentId: `external:${SOURCE_CONFIG_ID}:company:company-1`,
    });
    expect(recordDerivationWithRunItem).not.toHaveBeenCalled();
    expect(rearmEraseCleanup).not.toHaveBeenCalled();
  });

  it("compensation-delete failure records the derivation (a fresh erase child will target the doc) AND reopens the marker", async () => {
    assertSourceWritable
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(fencedError());
    adapterDeleteDocument.mockRejectedValueOnce(
      new Error("hindsight unreachable") as never,
    );
    const { db } = makeDb();

    const result = await runRetain(makeCtx(db as never));
    expect(result.status).toBe("failed");
    expect(recordDerivation).toHaveBeenCalledTimes(1);
    expect(recordDerivation.mock.calls[0]![1]).toMatchObject({
      tenantId: TENANT_ID,
      sourceConfigId: SOURCE_CONFIG_ID,
      hindsightDocumentId: `external:${SOURCE_CONFIG_ID}:company:company-1`,
    });
    expect(rearmEraseCleanup).toHaveBeenCalledTimes(1);
    expect(recordDerivationWithRunItem).not.toHaveBeenCalled();
  });
});

describe("rearmEraseCleanup reopen-or-create (real implementation)", () => {
  async function runReal(script: {
    rearmMatches: boolean;
    sourceRow: { erase_generation: number } | null;
  }) {
    const { rearmEraseCleanup: real } = (await vi.importActual(
      "./erase-fence.js",
    )) as typeof import("./erase-fence.js");
    const inserted: Array<Record<string, unknown>> = [];
    const chainFor = (rows: unknown[]) => {
      const chain: Record<string, unknown> = {};
      for (const m of ["from", "where", "orderBy", "limit"]) {
        chain[m] = () => chain;
      }
      chain.then = (resolve: (v: unknown[]) => unknown) =>
        Promise.resolve().then(() => resolve(rows));
      return chain;
    };
    const db = {
      update: () => ({
        set: () => ({
          where: () => ({
            returning: async () =>
              script.rearmMatches ? [{ id: "marker-1" }] : [],
          }),
        }),
      }),
      select: () => chainFor(script.sourceRow ? [script.sourceRow] : []),
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          inserted.push(v);
          return { onConflictDoNothing: async () => [] };
        },
      }),
    } as never;
    const result = await real(db, {
      tenantId: TENANT_ID,
      sourceConfigId: SOURCE_CONFIG_ID,
    });
    return { result, inserted };
  }

  it("re-arms a surviving non-terminal marker without creating a new one", async () => {
    const { result, inserted } = await runReal({
      rearmMatches: true,
      sourceRow: { erase_generation: 2 },
    });
    expect(result).toBe(true);
    expect(inserted).toHaveLength(0);
  });

  it("creates a fresh marker at the source's CURRENT generation when the prior marker is terminal", async () => {
    const { result, inserted } = await runReal({
      rearmMatches: false,
      sourceRow: { erase_generation: 3 },
    });
    expect(result).toBe(true);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      scope: "erase",
      erase_generation: 3,
      status: "queued",
    });
  });

  it("returns false only when the source config row no longer exists", async () => {
    const { result, inserted } = await runReal({
      rearmMatches: false,
      sourceRow: null,
    });
    expect(result).toBe(false);
    expect(inserted).toHaveLength(0);
  });
});
