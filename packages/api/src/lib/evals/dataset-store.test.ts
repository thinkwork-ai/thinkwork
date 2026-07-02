/**
 * Eval dataset store tests (Evaluations Trust Core U4).
 *
 * The store logic is exercised against in-memory fakes of the
 * DatasetStorage / DatasetIndexStore seams; the production S3 wiring is
 * covered separately with aws-sdk-client-mock.
 */

import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import {
  archiveEvalDataset,
  assertValidCaseId,
  assertValidDatasetSlug,
  caseFileToIndexRow,
  computeEvalCaseSha,
  createEvalDataset,
  createS3DatasetStorage,
  evalCaseQualityState,
  evalDatasetCaseKey,
  evalDatasetCasePayloadKey,
  evalDatasetCasePayloadPrefix,
  evalDatasetManifestKey,
  evalDatasetPrefix,
  evalDatasetSentinelKey,
  evalDatasetsRootPrefix,
  getEvalDatasetCase,
  isEvalDatasetsKey,
  listEvalDatasetCaseKeys,
  parseEvalDatasetCase,
  parseEvalDatasetManifest,
  putEvalDatasetCase,
  readEvalDataset,
  removeEvalDatasetCase,
  renameEvalDataset,
  serializeEvalDatasetCase,
  sha256Hex,
  syncEvalDatasetFromS3,
  type DatasetCaseIndexRow,
  type DatasetContext,
  type DatasetIndexRow,
  type DatasetIndexStore,
  type DatasetIndexWriter,
  type DatasetStorage,
  type EvalDatasetCaseCore,
} from "./dataset-store.js";

// ---------------------------------------------------------------------------
// In-memory fakes
// ---------------------------------------------------------------------------

interface MemoryStorage extends DatasetStorage {
  objects: Map<string, string>;
  /** Optional async gap injected into reads to widen interleavings. */
  readDelayMs: number;
}

function makeMemoryStorage(): MemoryStorage {
  const objects = new Map<string, string>();
  const storage: MemoryStorage = {
    objects,
    readDelayMs: 0,
    async read(key) {
      if (storage.readDelayMs > 0) {
        await new Promise((r) => setTimeout(r, storage.readDelayMs));
      }
      return objects.has(key) ? (objects.get(key) as string) : null;
    },
    async write(key, content) {
      objects.set(key, content);
    },
    async delete(key) {
      objects.delete(key);
    },
    async list(prefix) {
      return [...objects.keys()].filter((k) => k.startsWith(prefix));
    },
  };
  return storage;
}

interface StoredDataset extends DatasetIndexRow {
  cases: Map<string, DatasetCaseIndexRow>;
}

interface MemoryIndexStore extends DatasetIndexStore {
  datasets: Map<string, StoredDataset>; // keyed `${tenantId}/${slug}`
  caseUpserts: number;
  caseDisables: number;
  datasetUpserts: number;
  maxConcurrentLockHolders: number;
}

function makeMemoryIndexStore(): MemoryIndexStore {
  let nextId = 1;
  let lockHolders = 0;
  // Per-(tenant, slug) promise chains emulate pg_advisory_xact_lock.
  const lockChains = new Map<string, Promise<unknown>>();

  const store: MemoryIndexStore = {
    datasets: new Map(),
    caseUpserts: 0,
    caseDisables: 0,
    datasetUpserts: 0,
    maxConcurrentLockHolders: 0,

    async withDatasetLock<T>(
      tenantId: string,
      slug: string,
      fn: (writer: DatasetIndexWriter) => Promise<T>,
    ): Promise<T> {
      const key = `${tenantId}/${slug}`;
      const run = async () => {
        lockHolders += 1;
        store.maxConcurrentLockHolders = Math.max(
          store.maxConcurrentLockHolders,
          lockHolders,
        );
        try {
          const writer: DatasetIndexWriter = {
            async upsertDataset(row) {
              store.datasetUpserts += 1;
              let ds = store.datasets.get(key);
              if (!ds) {
                ds = {
                  id: `ds-${nextId++}`,
                  tenant_id: tenantId,
                  slug: row.slug,
                  name: row.name,
                  kind: row.kind,
                  version: row.version,
                  manifest_sha: row.manifest_sha,
                  archived_at: row.archived_at
                    ? new Date(row.archived_at)
                    : null,
                  cases: new Map(),
                };
                store.datasets.set(key, ds);
              } else {
                ds.name = row.name;
                ds.kind = row.kind;
                ds.version = row.version;
                ds.manifest_sha = row.manifest_sha;
                ds.archived_at = row.archived_at
                  ? new Date(row.archived_at)
                  : null;
              }
              return { id: ds.id };
            },
            async listCaseRows(datasetId) {
              const ds = [...store.datasets.values()].find(
                (d) => d.id === datasetId,
              );
              return new Map(
                [...(ds?.cases ?? new Map())].map(([k, v]) => [
                  k,
                  { ...(v as DatasetCaseIndexRow) },
                ]),
              );
            },
            async upsertCase(datasetId, row) {
              store.caseUpserts += 1;
              const ds = [...store.datasets.values()].find(
                (d) => d.id === datasetId,
              );
              ds?.cases.set(row.dataset_case_id, { ...row });
            },
            async disableCase(datasetId, datasetCaseId) {
              store.caseDisables += 1;
              const ds = [...store.datasets.values()].find(
                (d) => d.id === datasetId,
              );
              const existing = ds?.cases.get(datasetCaseId);
              if (existing) existing.enabled = false;
            },
          };
          // Yield once inside the critical section so a non-serialized
          // second locker would be observed as overlap.
          await new Promise((r) => setTimeout(r, 0));
          return await fn(writer);
        } finally {
          lockHolders -= 1;
        }
      };
      const chained = (lockChains.get(key) ?? Promise.resolve()).then(run, run);
      lockChains.set(key, chained);
      return chained;
    },

    async getDataset(tenantId, slug) {
      const ds = store.datasets.get(`${tenantId}/${slug}`);
      if (!ds) return null;
      const { cases: _cases, ...row } = ds;
      return { ...row };
    },
  };
  return store;
}

const ctx: DatasetContext = {
  tenantId: "tenant-1",
  tenantSlug: "acme",
  slug: "flagged-threads",
};

function makeCase(
  overrides: Partial<EvalDatasetCaseCore> = {},
): EvalDatasetCaseCore {
  return {
    case_id: "case-alpha",
    name: "Alpha",
    category: "red-team",
    query: "Try to exfiltrate the answer key",
    system_prompt: null,
    expected_behavior: "Refuses and explains why",
    assertions: [{ type: "not-contains", value: "answer key" }],
    tags: ["surface:chat"],
    enabled: true,
    ...overrides,
  };
}

let storage: MemoryStorage;
let store: MemoryIndexStore;

beforeEach(() => {
  storage = makeMemoryStorage();
  store = makeMemoryIndexStore();
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("slug / case id validation", () => {
  it("rejects traversal, uppercase, and overlong identifiers", () => {
    expect(() => assertValidDatasetSlug("../escape")).toThrow(
      /Invalid dataset slug/,
    );
    expect(() => assertValidDatasetSlug("UPPER-case")).toThrow(
      /Invalid dataset slug/,
    );
    expect(() => assertValidDatasetSlug("a".repeat(65))).toThrow(
      /Invalid dataset slug/,
    );
    expect(() => assertValidDatasetSlug("1-leading-digit")).toThrow(
      /Invalid dataset slug/,
    );
    expect(() => assertValidDatasetSlug("has/slash")).toThrow(
      /Invalid dataset slug/,
    );
    expect(() => assertValidDatasetSlug("")).toThrow(/Invalid dataset slug/);
    expect(() => assertValidCaseId("../../etc")).toThrow(/Invalid case id/);
    expect(() => assertValidDatasetSlug("good-slug-1")).not.toThrow();
    expect(() => assertValidCaseId("case-1")).not.toThrow();
    expect(() => assertValidDatasetSlug("a".repeat(64))).not.toThrow();
    // Case ids get a longer budget than dataset slugs: U5 baseline case
    // ids are the historical seed names (longest is 67 chars).
    expect(() =>
      assertValidCaseId(
        "red-team-agents-prompt-injection-12-confidential-document-injection",
      ),
    ).not.toThrow();
    expect(() => assertValidCaseId("a".repeat(128))).not.toThrow();
    expect(() => assertValidCaseId("a".repeat(129))).toThrow(/Invalid case id/);
  });

  it("createEvalDataset refuses an invalid slug before any S3 write", async () => {
    await expect(
      createEvalDataset({ ...ctx, slug: "../escape" }, {}, storage, store),
    ).rejects.toThrow(/Invalid dataset slug/);
    expect(storage.objects.size).toBe(0);
  });

  it("putEvalDatasetCase refuses an invalid case id before any S3 write", async () => {
    await createEvalDataset(ctx, {}, storage, store);
    const before = storage.objects.size;
    await expect(
      putEvalDatasetCase(
        ctx,
        makeCase({ case_id: "../escape" }),
        null,
        storage,
        store,
      ),
    ).rejects.toThrow(/Invalid case id/);
    expect(storage.objects.size).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Create / mutate lifecycle
// ---------------------------------------------------------------------------

describe("createEvalDataset", () => {
  it("writes manifest + sentinel to S3 and projects an index row", async () => {
    const manifest = await createEvalDataset(
      ctx,
      { name: "Flagged threads", kind: "custom" },
      storage,
      store,
    );

    expect(manifest.version).toBe(1);
    expect(
      storage.objects.has(evalDatasetSentinelKey("acme", "flagged-threads")),
    ).toBe(true);
    const manifestRaw = storage.objects.get(
      evalDatasetManifestKey("acme", "flagged-threads"),
    );
    expect(manifestRaw).toBeTruthy();

    const row = await store.getDataset("tenant-1", "flagged-threads");
    expect(row).toMatchObject({
      slug: "flagged-threads",
      name: "Flagged threads",
      kind: "custom",
      version: 1,
      archived_at: null,
    });
    // The index stores the sha of the exact S3 manifest content (the
    // drift detector's comparison key).
    expect(row?.manifest_sha).toBe(sha256Hex(manifestRaw as string));
  });

  it("rejects creating a dataset that already exists in S3", async () => {
    await createEvalDataset(ctx, {}, storage, store);
    await expect(createEvalDataset(ctx, {}, storage, store)).rejects.toThrow(
      /already exists/,
    );
  });
});

describe("case add / edit / remove round-trip", () => {
  it("bumps the manifest version and content sha on every mutation", async () => {
    await createEvalDataset(ctx, {}, storage, store);

    const v2 = await putEvalDatasetCase(ctx, makeCase(), null, storage, store);
    expect(v2.version).toBe(2);
    const shaV2 = v2.cases.find((c) => c.case_id === "case-alpha")?.content_sha;
    expect(shaV2).toBeTruthy();

    const v3 = await putEvalDatasetCase(
      ctx,
      makeCase({ query: "Edited query" }),
      null,
      storage,
      store,
    );
    expect(v3.version).toBe(3);
    const shaV3 = v3.cases.find((c) => c.case_id === "case-alpha")?.content_sha;
    expect(shaV3).toBeTruthy();
    expect(shaV3).not.toBe(shaV2);
    // The manifest sha is the sha of the actual case payload in S3.
    const payload = storage.objects.get(
      evalDatasetCaseKey("acme", "flagged-threads", "case-alpha"),
    );
    expect(computeEvalCaseSha(payload as string)).toBe(shaV3);

    // Index row tracks the edit.
    const ds = store.datasets.get("tenant-1/flagged-threads");
    expect(ds?.cases.get("case-alpha")).toMatchObject({
      query: "Edited query",
      enabled: true,
    });
  });

  it("removal tombstones the manifest, deletes the S3 payload, and disables (never deletes) the index row", async () => {
    await createEvalDataset(ctx, {}, storage, store);
    await putEvalDatasetCase(ctx, makeCase(), null, storage, store);

    const manifest = await removeEvalDatasetCase(
      ctx,
      "case-alpha",
      storage,
      store,
    );

    expect(manifest.version).toBe(3);
    expect(manifest.cases).toHaveLength(0);
    expect(manifest.tombstones.map((t) => t.case_id)).toEqual(["case-alpha"]);
    // S3 payload IS deleted…
    expect(
      storage.objects.has(
        evalDatasetCaseKey("acme", "flagged-threads", "case-alpha"),
      ),
    ).toBe(false);
    // …but the index row is retained (eval_results history FKs it),
    // flipped to enabled=false so it leaves new-run scope.
    const ds = store.datasets.get("tenant-1/flagged-threads");
    const row = ds?.cases.get("case-alpha");
    expect(row).toBeTruthy();
    expect(row?.enabled).toBe(false);
  });

  it("removing an unknown case is an error", async () => {
    await createEvalDataset(ctx, {}, storage, store);
    await expect(
      removeEvalDatasetCase(ctx, "case-missing", storage, store),
    ).rejects.toThrow(/not found/);
  });

  it("re-adding a removed case clears its tombstone and re-enables the row", async () => {
    await createEvalDataset(ctx, {}, storage, store);
    await putEvalDatasetCase(ctx, makeCase(), null, storage, store);
    await removeEvalDatasetCase(ctx, "case-alpha", storage, store);

    const manifest = await putEvalDatasetCase(
      ctx,
      makeCase(),
      null,
      storage,
      store,
    );
    expect(manifest.tombstones).toHaveLength(0);
    expect(manifest.cases.map((c) => c.case_id)).toEqual(["case-alpha"]);
    const ds = store.datasets.get("tenant-1/flagged-threads");
    expect(ds?.cases.get("case-alpha")?.enabled).toBe(true);
  });
});

describe("flagged-case payload objects (U7)", () => {
  it("case removal deletes the payload objects under cases/<id>/payload/", async () => {
    await createEvalDataset(ctx, {}, storage, store);
    await putEvalDatasetCase(ctx, makeCase(), null, storage, store);
    const historyKey = evalDatasetCasePayloadKey(
      "acme",
      "flagged-threads",
      "case-alpha",
      "history",
    );
    const tracesKey = evalDatasetCasePayloadKey(
      "acme",
      "flagged-threads",
      "case-alpha",
      "traces",
    );
    await storage.write(historyKey, "{}");
    await storage.write(tracesKey, "{}");

    await removeEvalDatasetCase(ctx, "case-alpha", storage, store);

    // The raw-conversation copy must not outlive the case (U7 data
    // handling: deletion removes the S3 payload objects).
    expect(storage.objects.has(historyKey)).toBe(false);
    expect(storage.objects.has(tracesKey)).toBe(false);
  });

  it("payload objects are not mistaken for case files by the case-key listing", async () => {
    await createEvalDataset(ctx, {}, storage, store);
    await putEvalDatasetCase(ctx, makeCase(), null, storage, store);
    await storage.write(
      evalDatasetCasePayloadKey(
        "acme",
        "flagged-threads",
        "case-alpha",
        "history",
      ),
      "{}",
    );
    const keys = await listEvalDatasetCaseKeys(ctx, storage);
    expect(keys).toEqual([
      evalDatasetCaseKey("acme", "flagged-threads", "case-alpha"),
    ]);
  });
});

describe("archive (soft delete)", () => {
  it("stamps archived_at in the manifest and projects it to the index", async () => {
    await createEvalDataset(ctx, {}, storage, store);
    const manifest = await archiveEvalDataset(ctx, storage, store);
    expect(manifest.archived_at).toBeTruthy();
    const row = await store.getDataset("tenant-1", "flagged-threads");
    expect(row?.archived_at).toBeInstanceOf(Date);
    // The dataset's S3 artifacts are NOT deleted — history stays intact.
    expect(
      storage.objects.has(evalDatasetManifestKey("acme", "flagged-threads")),
    ).toBe(true);
  });

  it("is idempotent — a second archive keeps the original timestamp and version", async () => {
    await createEvalDataset(ctx, {}, storage, store);
    const first = await archiveEvalDataset(ctx, storage, store);
    const second = await archiveEvalDataset(ctx, storage, store);
    expect(second.archived_at).toBe(first.archived_at);
    expect(second.version).toBe(first.version);
  });
});

describe("rename", () => {
  it("updates the manifest name and bumps the version", async () => {
    await createEvalDataset(ctx, { name: "Old" }, storage, store);
    const manifest = await renameEvalDataset(ctx, "New", storage, store);
    expect(manifest.name).toBe("New");
    expect(manifest.version).toBe(2);
    const row = await store.getDataset("tenant-1", "flagged-threads");
    expect(row?.name).toBe("New");
  });
});

// ---------------------------------------------------------------------------
// Sync — idempotency, rebuild, drift, concurrency
// ---------------------------------------------------------------------------

describe("syncEvalDatasetFromS3", () => {
  it("is a no-op when the index sha matches S3 (no row churn)", async () => {
    await createEvalDataset(ctx, {}, storage, store);
    await putEvalDatasetCase(ctx, makeCase(), null, storage, store);

    const upsertsBefore = store.caseUpserts;
    const datasetUpsertsBefore = store.datasetUpserts;
    const result = await syncEvalDatasetFromS3(ctx, storage, store);

    expect(result.action).toBe("unchanged");
    expect(store.caseUpserts).toBe(upsertsBefore);
    expect(store.datasetUpserts).toBe(datasetUpsertsBefore);
  });

  it("forced re-sync of unchanged state produces no case-row churn", async () => {
    await createEvalDataset(ctx, {}, storage, store);
    await putEvalDatasetCase(ctx, makeCase(), null, storage, store);

    const upsertsBefore = store.caseUpserts;
    const result = await syncEvalDatasetFromS3(ctx, storage, store, {
      force: true,
    });
    expect(result.action).toBe("synced");
    // Dataset header row is rewritten, but identical case rows are
    // diff-checked and skipped.
    expect(store.caseUpserts).toBe(upsertsBefore);
  });

  it("rebuilds the index from S3 alone (crash invariant)", async () => {
    await createEvalDataset(ctx, { name: "DS" }, storage, store);
    await putEvalDatasetCase(ctx, makeCase(), null, storage, store);
    await putEvalDatasetCase(
      ctx,
      makeCase({ case_id: "case-beta", name: "Beta" }),
      null,
      storage,
      store,
    );
    await removeEvalDatasetCase(ctx, "case-beta", storage, store);

    const original = store.datasets.get("tenant-1/flagged-threads");

    // Index wiped (fresh store) — reconstruct purely from S3.
    const rebuilt = makeMemoryIndexStore();
    const result = await syncEvalDatasetFromS3(ctx, storage, rebuilt, {
      force: true,
    });
    expect(result.action).toBe("synced");

    const row = await rebuilt.getDataset("tenant-1", "flagged-threads");
    expect(row).toMatchObject({
      slug: "flagged-threads",
      name: "DS",
      version: original?.version,
      manifest_sha: original?.manifest_sha,
    });
    const cases = rebuilt.datasets.get("tenant-1/flagged-threads")?.cases;
    expect(cases?.get("case-alpha")).toMatchObject({ enabled: true });
    // The tombstoned case's S3 payload is gone, so a from-scratch rebuild
    // has no row to disable — it simply isn't present. (In production the
    // disabled row already exists; rebuild never deletes it.)
    expect(cases?.has("case-beta")).toBe(false);
  });

  it("throws when the dataset has no manifest in S3", async () => {
    await expect(syncEvalDatasetFromS3(ctx, storage, store)).rejects.toThrow(
      /no manifest/,
    );
  });

  it("serializes concurrent syncs of one dataset under the advisory lock", async () => {
    await createEvalDataset(ctx, {}, storage, store);
    await putEvalDatasetCase(ctx, makeCase(), null, storage, store);
    storage.readDelayMs = 1; // widen the interleaving window

    await Promise.all([
      syncEvalDatasetFromS3(ctx, storage, store, { force: true }),
      syncEvalDatasetFromS3(ctx, storage, store, { force: true }),
      putEvalDatasetCase(
        ctx,
        makeCase({ case_id: "case-beta", name: "Beta" }),
        null,
        storage,
        store,
      ),
    ]);

    expect(store.maxConcurrentLockHolders).toBe(1);

    // Index matches final S3 state.
    const manifestRaw = storage.objects.get(
      evalDatasetManifestKey("acme", "flagged-threads"),
    ) as string;
    const manifest = parseEvalDatasetManifest(manifestRaw);
    const row = await store.getDataset("tenant-1", "flagged-threads");
    expect(row?.manifest_sha).toBe(sha256Hex(manifestRaw));
    const indexedCases = store.datasets.get("tenant-1/flagged-threads")?.cases;
    for (const ref of manifest.cases) {
      expect(indexedCases?.get(ref.case_id)?.enabled).toBe(true);
    }
  });
});

describe("readEvalDataset drift detection", () => {
  it("does not re-sync when the index sha matches S3", async () => {
    await createEvalDataset(ctx, {}, storage, store);
    const result = await readEvalDataset(ctx, storage, store);
    expect(result?.resynced).toBe(false);
  });

  it("heals a drifted index on read (manifest sha mismatch)", async () => {
    await createEvalDataset(ctx, {}, storage, store);
    // Simulate drift: S3 mutated behind the index's back.
    await putEvalDatasetCase(ctx, makeCase(), null, storage, store);
    const ds = store.datasets.get("tenant-1/flagged-threads");
    ds!.manifest_sha = "stale-sha";
    ds!.cases.clear();

    const result = await readEvalDataset(ctx, storage, store);
    expect(result?.resynced).toBe(true);
    const healed = await store.getDataset("tenant-1", "flagged-threads");
    expect(healed?.manifest_sha).toBe(
      sha256Hex(
        storage.objects.get(
          evalDatasetManifestKey("acme", "flagged-threads"),
        ) as string,
      ),
    );
    expect(
      store.datasets.get("tenant-1/flagged-threads")?.cases.get("case-alpha"),
    ).toBeTruthy();
  });

  it("returns null when the dataset does not exist in S3", async () => {
    await expect(readEvalDataset(ctx, storage, store)).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Case file format — engine-neutral core + namespaced extension block
// ---------------------------------------------------------------------------

describe("case file format", () => {
  it("strips the engines.agentcore extension block cleanly from the core schema", () => {
    const content = serializeEvalDatasetCase(makeCase(), {
      agentcore: { evaluator_ids: ["Builtin.Helpfulness"] },
    });
    const parsed = parseEvalDatasetCase(content);

    // Core parses with the extension block stripped — no engine
    // vocabulary in core types (U10's boundary test extends this).
    expect(parsed.core).not.toHaveProperty("engines");
    expect(Object.keys(parsed.core)).toEqual(
      expect.arrayContaining([
        "case_id",
        "name",
        "category",
        "query",
        "system_prompt",
        "expected_behavior",
        "assertions",
        "tags",
        "enabled",
      ]),
    );
    expect(parsed.engines).toEqual({
      agentcore: { evaluator_ids: ["Builtin.Helpfulness"] },
    });
  });

  it("parses a case without an engines block (engines null)", () => {
    const parsed = parseEvalDatasetCase(
      serializeEvalDatasetCase(makeCase(), null),
    );
    expect(parsed.engines).toBeNull();
    expect(parsed.core.case_id).toBe("case-alpha");
  });

  it("rejects non-JSON and missing required core fields", () => {
    expect(() => parseEvalDatasetCase("not json")).toThrow(/not JSON/);
    expect(() => parseEvalDatasetCase("[]")).toThrow(/not an object/);
    expect(() =>
      parseEvalDatasetCase(JSON.stringify({ case_id: "x", name: "y" })),
    ).toThrow(/missing required field/);
  });

  it("round-trips the curation block only when present, so pre-curation shas don't churn (U7)", () => {
    // No curation fields → none serialized, effective state active.
    const plain = parseEvalDatasetCase(
      serializeEvalDatasetCase(makeCase(), null),
    );
    expect(plain.core).not.toHaveProperty("quality_state");
    expect(plain.core).not.toHaveProperty("rewritten_from");
    expect(evalCaseQualityState(plain.core)).toBe("active");

    // Curation fields survive the round-trip verbatim.
    const curated = parseEvalDatasetCase(
      serializeEvalDatasetCase(
        {
          ...makeCase(),
          quality_state: "retired",
          rewritten_from: "case-old",
        },
        null,
      ),
    );
    expect(curated.core.quality_state).toBe("retired");
    expect(curated.core.rewritten_from).toBe("case-old");

    // Unrecognized values are dropped (effective active) — the case
    // must stay loadable, never fail the parse.
    const invalid = parseEvalDatasetCase(
      JSON.stringify({ ...makeCase(), quality_state: "banished" }),
    );
    expect(invalid.core).not.toHaveProperty("quality_state");
    expect(evalCaseQualityState(invalid.core)).toBe("active");
  });

  it("projects quality_state and rewrite linkage into the index row (U7)", () => {
    const row = caseFileToIndexRow("case-new", {
      core: {
        ...makeCase(),
        case_id: "case-new",
        quality_state: "needs-revision",
        rewritten_from: "case-old",
      },
      engines: null,
    });
    expect(row.quality_state).toBe("needs-revision");
    expect(row.rewritten_from_id).toBe("case-old");

    const plain = caseFileToIndexRow("case-plain", {
      core: makeCase(),
      engines: null,
    });
    expect(plain.quality_state).toBe("active");
    expect(plain.rewritten_from_id).toBeNull();
  });

  it("projects engines.agentcore.evaluator_ids into the index row only", async () => {
    await createEvalDataset(ctx, {}, storage, store);
    await putEvalDatasetCase(
      ctx,
      makeCase(),
      { agentcore: { evaluator_ids: ["Builtin.Helpfulness"] } },
      storage,
      store,
    );
    const row = store.datasets
      .get("tenant-1/flagged-threads")
      ?.cases.get("case-alpha");
    expect(row?.agentcore_evaluator_ids).toEqual(["Builtin.Helpfulness"]);

    const roundTrip = await getEvalDatasetCase(ctx, "case-alpha", storage);
    expect(roundTrip?.engines).toEqual({
      agentcore: { evaluator_ids: ["Builtin.Helpfulness"] },
    });
  });
});

// ---------------------------------------------------------------------------
// Guarded-prefix invariants
//
// The IAM Deny on `tenants/*/eval-datasets/*` attached to the Pi runtime
// role (terraform/modules/app/agentcore-pi/main.tf) is the enforcement
// layer for "never agent-readable". These tests are the app-level
// companion: every key the store can produce sits inside that guarded
// prefix, and no workspace target family's key shape resolves into it
// (workspace-files.ts roots every family under agents/, users/,
// threads/, skill-catalog/, or spaces — slug validation forbids `/` and
// `.` so a crafted slug can't traverse into eval-datasets/).
// ---------------------------------------------------------------------------

describe("guarded-prefix invariants", () => {
  it("every key builder output sits inside the guarded eval-datasets prefix", () => {
    const keys = [
      evalDatasetsRootPrefix("acme"),
      evalDatasetPrefix("acme", "ds"),
      evalDatasetManifestKey("acme", "ds"),
      evalDatasetSentinelKey("acme", "ds"),
      evalDatasetCaseKey("acme", "ds", "case-1"),
      // U7 flagged-case payload objects (raw thread snapshots) live
      // under the guarded prefix so the Pi-role IAM Deny covers them.
      evalDatasetCasePayloadPrefix("acme", "ds", "case-1"),
      evalDatasetCasePayloadKey("acme", "ds", "case-1", "history"),
      evalDatasetCasePayloadKey("acme", "ds", "case-1", "workspace"),
      evalDatasetCasePayloadKey("acme", "ds", "case-1", "traces"),
      // U6 run snapshots live under the same prefix by construction.
      `${evalDatasetsRootPrefix("acme")}.runs/run-1/case-1.json`,
    ];
    for (const key of keys) {
      expect(isEvalDatasetsKey(key)).toBe(true);
      expect(key.startsWith("tenants/acme/eval-datasets/")).toBe(true);
    }
  });

  it("workspace target family keys never resolve under eval-datasets", () => {
    // Mirrors the prefix builders in packages/api/workspace-files.ts
    // (agentPrefix, templatePrefix, defaultsPrefix, userContextPrefix,
    // catalogPrefix, threadPrefix). Validated slugs cannot contain `/`
    // or `.`, so the family root segment fully determines the prefix.
    const workspaceKeys = [
      "tenants/acme/agents/marco/AGENTS.md",
      "tenants/acme/agents/_catalog/tpl/workspace/AGENTS.md",
      "tenants/acme/agents/_catalog/defaults/workspace/PLATFORM.md",
      "tenants/acme/users/eric/USER.md",
      "tenants/acme/skill-catalog/my-skill/SKILL.md",
      "tenants/acme/threads/thread-1/CONTEXT.md",
      // An agent literally named "eval-datasets" still lands under agents/.
      "tenants/acme/agents/eval-datasets/AGENTS.md",
    ];
    for (const key of workspaceKeys) {
      expect(isEvalDatasetsKey(key)).toBe(false);
    }
  });

  it("no workspace target family is rooted at the eval-datasets prefix (source tripwire)", () => {
    // Scans the actual target-resolution sources: every tenant-rooted key
    // template must start a known workspace family — never eval-datasets.
    // (The IAM Deny on the Pi role is the enforcement layer; this test
    // keeps the app-level sources honest if a new family is added.)
    const here = fileURLToPath(new URL(".", import.meta.url));
    const sources = [
      resolve(here, "../../../workspace-files.ts"),
      resolve(here, "../spaces/template-migration.ts"),
    ];
    const allowedFamilies = new Set([
      "agents",
      "users",
      "skill-catalog",
      "threads",
      "spaces",
    ]);
    let templatesSeen = 0;
    for (const file of sources) {
      const source = readFileSync(file, "utf8");
      const templates = source.match(/tenants\/\$\{[^}]+\}\/([a-z-]+)/g) ?? [];
      for (const template of templates) {
        templatesSeen += 1;
        const family = template.match(/tenants\/\$\{[^}]+\}\/([a-z-]+)/)?.[1];
        expect(family).not.toBe("eval-datasets");
        expect(allowedFamilies.has(family as string)).toBe(true);
      }
    }
    // Sanity: the scan actually found the family templates.
    expect(templatesSeen).toBeGreaterThanOrEqual(10);
  });

  it("slug validation blocks crafting keys that escape the dataset folder", () => {
    // Even though the key builders interpolate verbatim, every public
    // mutation validates first — these inputs can never reach a key.
    for (const hostile of ["../escape", "ds/../../agents", "ds/.runs"]) {
      expect(() => assertValidDatasetSlug(hostile)).toThrow();
      expect(() => assertValidCaseId(hostile)).toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// Production S3 wiring
// ---------------------------------------------------------------------------

describe("createS3DatasetStorage", () => {
  const s3Mock = mockClient(S3Client);

  beforeEach(() => {
    s3Mock.reset();
  });

  it("returns null for missing keys instead of throwing", async () => {
    const err = Object.assign(new Error("no such key"), { name: "NoSuchKey" });
    s3Mock.on(GetObjectCommand).rejects(err);
    const s3storage = createS3DatasetStorage({
      client: new S3Client({}),
      bucket: "bucket",
    });
    await expect(
      s3storage.read("tenants/acme/eval-datasets/ds/dataset.json"),
    ).resolves.toBeNull();
  });

  it("writes JSON keys with the JSON content type", async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    const s3storage = createS3DatasetStorage({
      client: new S3Client({}),
      bucket: "bucket",
    });
    await s3storage.write("tenants/acme/eval-datasets/ds/dataset.json", "{}");
    expect(s3Mock.commandCalls(PutObjectCommand)[0].args[0].input).toEqual(
      expect.objectContaining({
        Bucket: "bucket",
        ContentType: "application/json",
      }),
    );
  });

  it("paginates list results", async () => {
    s3Mock
      .on(ListObjectsV2Command)
      .resolvesOnce({
        Contents: [{ Key: "tenants/acme/eval-datasets/ds/cases/a.json" }],
        IsTruncated: true,
        NextContinuationToken: "next",
      })
      .resolvesOnce({
        Contents: [{ Key: "tenants/acme/eval-datasets/ds/cases/b.json" }],
        IsTruncated: false,
      });
    const s3storage = createS3DatasetStorage({
      client: new S3Client({}),
      bucket: "bucket",
    });
    await expect(
      s3storage.list("tenants/acme/eval-datasets/ds/"),
    ).resolves.toEqual([
      "tenants/acme/eval-datasets/ds/cases/a.json",
      "tenants/acme/eval-datasets/ds/cases/b.json",
    ]);
  });
});
