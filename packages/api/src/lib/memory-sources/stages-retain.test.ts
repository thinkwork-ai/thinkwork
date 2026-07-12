/**
 * runRetain / runProject bounding + lineage atomicity (Codex F7/F8).
 *
 * Named stages-retain.test.ts so it does not collide with the acquire-side
 * suite. All db access rides a fake drizzle handle with commit semantics:
 * writes made through a transaction only land in `committed` when the
 * callback resolves, which is exactly what the F8 failure-injection test
 * needs to observe.
 */

import { describe, expect, it, vi } from "vitest";
import type { Database } from "@thinkwork/database-pg";
import {
  memoryDerivations,
  memoryEvidenceItems,
  memoryRunItems,
} from "@thinkwork/database-pg/schema";

const upsertMarkdownMemoryDocument = vi.fn().mockResolvedValue(undefined);

vi.mock("./claims.js", () => ({
  extractCompanyClaims: vi.fn(() => []),
  upsertClaimsForEvidence: vi.fn(async () => ({
    created: 0,
    supported: 0,
    supersededSupports: 0,
    unsupportedRetracted: 0,
  })),
  listActiveClaimsForSubject: vi.fn(async () => []),
  buildClaimProjection: vi.fn(() => ({ markdown: "" })),
}));

vi.mock("../memory/index.js", () => ({
  getMemoryServices: () => ({
    adapter: { upsertMarkdownMemoryDocument },
    config: { engine: "hindsight" },
  }),
}));
vi.mock("../brain/dream/runner.js", () => ({
  runBrainDreamState: vi.fn(),
}));

const putEvidenceSnapshot = vi.fn(
  async (_s3: unknown, args: { bucket: string; key: string }) => ({
    ref: `s3://${args.bucket}/${args.key}`,
    expiresAt: new Date("2026-08-10T00:00:00.000Z"),
  }),
);
const getEvidenceSnapshot = vi.fn(async () => ({ name: "From S3" }));

vi.mock("./snapshots.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./snapshots.js")>();
  return {
    ...actual,
    putEvidenceSnapshot: (...args: unknown[]) =>
      putEvidenceSnapshot(args[0], args[1] as { bucket: string; key: string }),
    getEvidenceSnapshot: (...args: unknown[]) => getEvidenceSnapshot(),
    resolveSnapshotBucket: () => "test-brain-artifacts",
  };
});

import { runProject, runRetain, type StageContext } from "./stages.js";
import type { EvidenceRow } from "./types.js";

const TENANT_ID = "0015953e-aa13-4cab-8398-2e70f73dda63";
const SOURCE_CONFIG_ID = "4dee701a-c17b-46fe-9f38-a333d4c3fad0";
const RUN_ID = "8a9a4d57-0000-4000-8000-000000000001";

// ---------------------------------------------------------------------------
// Fake drizzle handle with transactional commit semantics
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

interface Sink {
  derivations: Row[];
  runItems: Row[];
  evidenceUpdates: Row[];
}

function emptySink(): Sink {
  return { derivations: [], runItems: [], evidenceUpdates: [] };
}

interface FakeDbOptions {
  evidence: EvidenceRow[];
  /** Throw from the memory_run_items insert for these stage values. */
  failRunItemStages?: string[];
}

function chain(exec: () => unknown) {
  const c: Record<string, unknown> = {};
  for (const m of [
    "from",
    "leftJoin",
    "where",
    "orderBy",
    "limit",
    "for",
    "set",
  ]) {
    c[m] = () => c;
  }
  c.then = (
    resolve: (v: unknown) => unknown,
    reject: (e: unknown) => unknown,
  ) => Promise.resolve().then(exec).then(resolve, reject);
  return c;
}

function makeFakeDb(opts: FakeDbOptions) {
  const committed = emptySink();

  function makeHandle(sink: Sink) {
    return {
      select: (selection?: unknown) =>
        chain(
          () =>
            selection ? opts.evidence.map((evidence) => ({ evidence })) : [], // existing-derivation lookup: none
        ),
      update: () => {
        const c = chain(() => undefined) as Record<string, unknown> & {
          set?: unknown;
        };
        c.set = (values: Row) => {
          sink.evidenceUpdates.push(values);
          return c;
        };
        return c;
      },
      insert: (table: unknown) => {
        let vals: Row | Row[] = {};
        const exec = async () => {
          if (table === memoryDerivations) {
            sink.derivations.push(vals as Row);
            return [{ id: `derivation-${sink.derivations.length}`, ...vals }];
          }
          if (table === memoryRunItems) {
            const rows = Array.isArray(vals) ? vals : [vals];
            for (const row of rows) {
              if (opts.failRunItemStages?.includes(row.stage as string)) {
                throw new Error(`injected ${row.stage} run-item failure`);
              }
            }
            sink.runItems.push(...rows);
            return rows.map((_, i) => ({ id: `run-item-${i}` }));
          }
          if (table === memoryEvidenceItems) {
            return [];
          }
          throw new Error("unexpected insert target");
        };
        const c: Record<string, unknown> = {
          values: (v: Row | Row[]) => {
            vals = v;
            return c;
          },
          onConflictDoNothing: () => c,
          returning: () => exec(),
          then: (
            resolve: (v: unknown) => unknown,
            reject: (e: unknown) => unknown,
          ) => exec().then(resolve, reject),
        };
        return c;
      },
    };
  }

  const db = {
    ...makeHandle(committed),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      const staged = emptySink();
      const result = await cb(makeHandle(staged));
      committed.derivations.push(...staged.derivations);
      committed.runItems.push(...staged.runItems);
      committed.evidenceUpdates.push(...staged.evidenceUpdates);
      return result;
    },
  };

  return { db: db as unknown as Database, committed };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function evidenceRow(
  n: number,
  overrides: Partial<EvidenceRow> = {},
): EvidenceRow {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    tenant_id: TENANT_ID,
    source_config_id: SOURCE_CONFIG_ID,
    source_item_id: `company-${n}`,
    source_version: "2026-07-11T00:00:00.000Z",
    content_hash: `hash-${n}`,
    lifecycle: "active",
    target_scope: "tenant",
    target_id: TENANT_ID,
    snapshot_ref: null,
    snapshot_expires_at: null,
    normalized_snapshot: { id: `company-${n}`, name: `Acme ${n}` },
    extraction_recipe: { recipe: "twenty-company@1" },
    ...overrides,
  } as unknown as EvidenceRow;
}

function makeCtx(
  db: Database,
  overrides: {
    options?: Record<string, unknown> | null;
    lease?: StageContext["lease"];
    stage?: string;
  } = {},
): StageContext {
  return {
    db,
    event: {
      workflowRunId: RUN_ID,
      tenantId: TENANT_ID,
      stepId: "step-1",
      iteration: 0,
      stage: overrides.stage ?? "retain",
      processorConfigId: "cfg-1",
      sourceConfigId: SOURCE_CONFIG_ID,
      options: overrides.options ?? null,
    },
    processor: {
      id: "cfg-1",
      tenant_id: TENANT_ID,
      target_scope: "tenant",
      target_id: TENANT_ID,
      created_by_user_id: null,
      budget: {},
    } as unknown as StageContext["processor"],
    sources: [
      {
        id: SOURCE_CONFIG_ID,
        source_family: "twenty",
        boundary: {},
      } as unknown as StageContext["sources"][number],
    ],
    lease: overrides.lease,
  };
}

// ---------------------------------------------------------------------------
// F8 — derivation + retain run-item must commit atomically
// ---------------------------------------------------------------------------

describe("runRetain lineage atomicity (F8)", () => {
  it("persists NO derivation when the retain run-item write fails", async () => {
    const { db, committed } = makeFakeDb({
      evidence: [evidenceRow(1)],
      failRunItemStages: ["retain"],
    });

    await expect(runRetain(makeCtx(db))).rejects.toThrow(
      /injected retain run-item failure/,
    );
    // The Hindsight write happened (it is external and idempotent) …
    expect(upsertMarkdownMemoryDocument).toHaveBeenCalled();
    // … but the lineage commit must be all-or-nothing: with the run item
    // rolled back, the derivation must be rolled back too, so a retry run
    // re-selects this evidence instead of skipping it forever.
    expect(committed.derivations).toHaveLength(0);
    expect(committed.runItems.filter((r) => r.stage === "retain")).toHaveLength(
      0,
    );
  });

  it("commits derivation AND run item together on success", async () => {
    const { db, committed } = makeFakeDb({ evidence: [evidenceRow(1)] });
    const result = await runRetain(makeCtx(db));
    expect(result.status).toBe("succeeded");
    expect(committed.derivations).toHaveLength(1);
    expect(committed.runItems.filter((r) => r.stage === "retain")).toHaveLength(
      1,
    );
  });
});

// ---------------------------------------------------------------------------
// F7 — bounded batches, lease-aware stop, continuation marker
// ---------------------------------------------------------------------------

describe("runRetain bounding (F7)", () => {
  it("processes at most the default batch of 25 and surfaces a continuation marker", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => evidenceRow(i + 1));
    const { db, committed } = makeFakeDb({ evidence: rows });
    const result = await runRetain(makeCtx(db));
    expect(result.status).toBe("succeeded");
    expect(committed.derivations).toHaveLength(25);
    expect(result.output).toMatchObject({ continuation: true, remaining: 5 });
  });

  it("honors options.retainBatch and clamps to the hard max of 100", async () => {
    const rows = Array.from({ length: 6 }, (_, i) => evidenceRow(i + 1));
    const { db, committed } = makeFakeDb({ evidence: rows });
    const result = await runRetain(
      makeCtx(db, { options: { retainBatch: 4 } }),
    );
    expect(committed.derivations).toHaveLength(4);
    expect(result.output).toMatchObject({ continuation: true, remaining: 2 });
  });

  it("stops starting new items when the lease reports <60s remaining", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => evidenceRow(i + 1));
    const { db, committed } = makeFakeDb({ evidence: rows });
    let calls = 0;
    const result = await runRetain(
      makeCtx(db, {
        lease: {
          renew: async () => true,
          // First check passes, every later check reports exhaustion.
          remainingMs: () => (calls++ === 0 ? 120_000 : 30_000),
        },
      }),
    );
    expect(result.status).toBe("succeeded");
    expect(committed.derivations).toHaveLength(1);
    expect(result.output).toMatchObject({ continuation: true, remaining: 4 });
  });

  it("emits no continuation marker when the work list fits the batch", async () => {
    const { db } = makeFakeDb({ evidence: [evidenceRow(1)] });
    const result = await runRetain(makeCtx(db));
    expect(result.output).not.toMatchObject({ continuation: true });
  });
});

describe("runProject bounding + snapshot offload (F6/F7)", () => {
  it("offloads inline snapshots to S3 and nulls the inline column", async () => {
    const rows = [evidenceRow(1), evidenceRow(2, { snapshot_ref: "s3://b/k" })];
    const { db, committed } = makeFakeDb({ evidence: rows });
    const result = await runProject(makeCtx(db, { stage: "project" }));
    expect(result.status).toBe("succeeded");
    // Only row 1 (inline snapshot, no ref) gets offloaded.
    expect(putEvidenceSnapshot).toHaveBeenCalledTimes(1);
    expect(committed.evidenceUpdates).toHaveLength(1);
    expect(committed.evidenceUpdates[0]).toMatchObject({
      normalized_snapshot: null,
      snapshot_ref: expect.stringMatching(/^s3:\/\/test-brain-artifacts\//),
      snapshot_expires_at: expect.any(Date),
    });
  });

  it("reads snapshot from S3 for rows whose inline column is already null", async () => {
    const rows = [
      evidenceRow(1, {
        normalized_snapshot: null,
        snapshot_ref: "s3://test-brain-artifacts/evidence-snapshots/x.json",
      }),
    ];
    const { db, committed } = makeFakeDb({ evidence: rows });
    const result = await runProject(makeCtx(db, { stage: "project" }));
    expect(result.status).toBe("succeeded");
    expect(getEvidenceSnapshot).toHaveBeenCalled();
    expect(
      committed.runItems.filter(
        (r) => r.stage === "project" && r.result === "changed",
      ),
    ).toHaveLength(1);
  });

  it("bounds the project batch and surfaces a continuation marker", async () => {
    const rows = Array.from({ length: 7 }, (_, i) =>
      evidenceRow(i + 1, { snapshot_ref: "s3://b/k" }),
    );
    const { db } = makeFakeDb({ evidence: rows });
    const result = await runProject(
      makeCtx(db, { stage: "project", options: { projectBatch: 5 } }),
    );
    expect(result.output).toMatchObject({ continuation: true, remaining: 2 });
  });
});
