/**
 * Run scope pinning tests (Evaluations Trust Core U6).
 *
 * KTD under test: "Runs pin their scope at launch by copying, not
 * referencing." captureRunSnapshot copies sha-verified case content into
 * the run snapshot prefix (inside the guarded eval-datasets prefix);
 * mid-launch edits retry once from a fresh manifest and then fail —
 * torn content is never pinned.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  computeEvalCaseSha,
  evalDatasetCaseKey,
  evalDatasetCasePayloadKey,
  evalDatasetManifestKey,
  evalRunSnapshotCaseKey,
  evalRunSnapshotCasePayloadKey,
  evalRunSnapshotPrefix,
  isEvalDatasetsKey,
  isEvalRunSnapshotKeyForRun,
  serializeEvalDatasetCase,
  serializeEvalDatasetManifest,
  sha256Hex,
  type DatasetContext,
  type DatasetStorage,
  type EvalDatasetCaseCore,
  type EvalDatasetManifest,
} from "./dataset-store.js";
import { captureRunSnapshot, deleteRunSnapshot } from "./run-launch.js";

// ---------------------------------------------------------------------------
// In-memory storage fake
// ---------------------------------------------------------------------------

interface MemoryStorage extends DatasetStorage {
  objects: Map<string, string>;
  reads: string[];
  /** Hook invoked before every read — lets tests interleave edits. */
  onRead?: (key: string) => void;
}

function makeMemoryStorage(): MemoryStorage {
  const objects = new Map<string, string>();
  const storage: MemoryStorage = {
    objects,
    reads: [],
    async read(key) {
      storage.onRead?.(key);
      storage.reads.push(key);
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

// ---------------------------------------------------------------------------
// Dataset fixture helpers
// ---------------------------------------------------------------------------

const ctx: DatasetContext = {
  tenantId: "tenant-1",
  tenantSlug: "acme",
  slug: "baseline-red-team",
};
const RUN_ID = "0c8f8e62-1111-4444-aaaa-1234567890ab";

function makeCore(
  caseId: string,
  overrides: Partial<EvalDatasetCaseCore> = {},
): EvalDatasetCaseCore {
  return {
    case_id: caseId,
    name: caseId,
    category: "red-team",
    query: `query for ${caseId}`,
    system_prompt: null,
    expected_behavior: null,
    assertions: [{ type: "icontains", value: "refuse" }],
    tags: [],
    enabled: true,
    ...overrides,
  };
}

function seedDataset(
  storage: MemoryStorage,
  cases: EvalDatasetCaseCore[],
  version = 3,
): EvalDatasetManifest {
  const manifest: EvalDatasetManifest = {
    slug: ctx.slug,
    name: "Baseline Red Team",
    kind: "baseline",
    version,
    updated_at: new Date().toISOString(),
    archived_at: null,
    cases: [],
    tombstones: [],
  };
  for (const core of cases) {
    const content = serializeEvalDatasetCase(core, {
      agentcore: { evaluator_ids: ["Builtin.Helpfulness"] },
    });
    storage.objects.set(
      evalDatasetCaseKey(ctx.tenantSlug, ctx.slug, core.case_id),
      content,
    );
    manifest.cases.push({
      case_id: core.case_id,
      content_sha: computeEvalCaseSha(content),
    });
  }
  storage.objects.set(
    evalDatasetManifestKey(ctx.tenantSlug, ctx.slug),
    serializeEvalDatasetManifest(manifest),
  );
  return manifest;
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = makeMemoryStorage();
});

// ---------------------------------------------------------------------------
// Snapshot key shape — guarded prefix by construction
// ---------------------------------------------------------------------------

describe("run snapshot keys", () => {
  it("every snapshot key sits inside the guarded eval-datasets prefix", () => {
    const prefix = evalRunSnapshotPrefix("acme", RUN_ID);
    const caseKey = evalRunSnapshotCaseKey("acme", RUN_ID, "case-a");
    expect(prefix).toBe(`tenants/acme/eval-datasets/.runs/${RUN_ID}/`);
    expect(caseKey).toBe(
      `tenants/acme/eval-datasets/.runs/${RUN_ID}/cases/case-a.json`,
    );
    expect(isEvalDatasetsKey(prefix)).toBe(true);
    expect(isEvalDatasetsKey(caseKey)).toBe(true);
  });

  it("accepts only this run's well-formed case keys", () => {
    const good = evalRunSnapshotCaseKey("acme", RUN_ID, "case-a");
    expect(isEvalRunSnapshotKeyForRun(good, "acme", RUN_ID)).toBe(true);
  });

  it("rejects keys outside the run's guarded tenant prefix", () => {
    const rejected = [
      // Another tenant's snapshot.
      evalRunSnapshotCaseKey("evil-corp", RUN_ID, "case-a"),
      // Another run's snapshot.
      evalRunSnapshotCaseKey("acme", "other-run", "case-a"),
      // The live dataset prefix — never readable after launch.
      evalDatasetCaseKey("acme", "baseline-red-team", "case-a"),
      // Workspace families.
      "tenants/acme/agents/marco/AGENTS.md",
      // Traversal / malformed shapes inside the prefix.
      `tenants/acme/eval-datasets/.runs/${RUN_ID}/cases/../../../secrets.json`,
      `tenants/acme/eval-datasets/.runs/${RUN_ID}/cases/UPPER.json`,
      `tenants/acme/eval-datasets/.runs/${RUN_ID}/manifest.json`,
      `tenants/acme/eval-datasets/.runs/${RUN_ID}/cases/case-a.txt`,
      "",
    ];
    for (const key of rejected) {
      expect(isEvalRunSnapshotKeyForRun(key, "acme", RUN_ID)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// captureRunSnapshot
// ---------------------------------------------------------------------------

describe("captureRunSnapshot", () => {
  it("copies enabled cases into the run prefix and pins the manifest version", async () => {
    seedDataset(storage, [
      makeCore("case-a"),
      makeCore("case-b"),
      makeCore("case-disabled", { enabled: false }),
    ]);

    const snapshot = await captureRunSnapshot(ctx, RUN_ID, storage);

    expect(snapshot.datasetVersion).toBe(3);
    expect(snapshot.cases.map((c) => c.caseId).sort()).toEqual([
      "case-a",
      "case-b",
    ]);
    for (const c of snapshot.cases) {
      // The copy is byte-identical to the source and sha-stamped.
      const copied = storage.objects.get(c.snapshotKey);
      const source = storage.objects.get(
        evalDatasetCaseKey(ctx.tenantSlug, ctx.slug, c.caseId),
      );
      expect(copied).toBe(source);
      expect(sha256Hex(copied as string)).toBe(c.contentSha);
      expect(isEvalRunSnapshotKeyForRun(c.snapshotKey, "acme", RUN_ID)).toBe(
        true,
      );
      // Engine evaluator ids ride the extension block of the copy.
      expect(c.engines).toEqual({
        agentcore: { evaluator_ids: ["Builtin.Helpfulness"] },
      });
    }
    // The disabled case is outside the pinned scope: not copied.
    expect(
      storage.objects.has(
        evalRunSnapshotCaseKey(ctx.tenantSlug, RUN_ID, "case-disabled"),
      ),
    ).toBe(false);
  });

  it("editing or deleting a dataset case after capture leaves the run copy intact", async () => {
    seedDataset(storage, [makeCore("case-a"), makeCore("case-b")]);
    const snapshot = await captureRunSnapshot(ctx, RUN_ID, storage);
    const pinnedA = storage.objects.get(snapshot.cases[0].snapshotKey);

    // Mid-run: case-a edited, case-b's S3 object deleted entirely.
    storage.objects.set(
      evalDatasetCaseKey(ctx.tenantSlug, ctx.slug, "case-a"),
      serializeEvalDatasetCase(
        makeCore("case-a", { query: "EDITED mid-run" }),
        null,
      ),
    );
    storage.objects.delete(
      evalDatasetCaseKey(ctx.tenantSlug, ctx.slug, "case-b"),
    );

    // The run-scoped copies still serve the launch-time content.
    expect(storage.objects.get(snapshot.cases[0].snapshotKey)).toBe(pinnedA);
    expect(storage.objects.get(snapshot.cases[1].snapshotKey)).toContain(
      "query for case-b",
    );
    expect(
      sha256Hex(storage.objects.get(snapshot.cases[1].snapshotKey) as string),
    ).toBe(snapshot.cases[1].contentSha);
  });

  it("copies flagged-thread payload objects into the run prefix with launch-computed shas (U8)", async () => {
    const historyContent = JSON.stringify({
      messages: [
        { id: "m1", role: "user", content: "hello", parts: null },
        { id: "m2", role: "user", content: "flagged", parts: null },
      ],
      dropped_oldest_count: 0,
      flagged_message_id: "m2",
    });
    const workspaceContent = JSON.stringify({ files: [] });
    seedDataset(storage, [
      makeCore("flagged-aaaa-bbbb", {
        category: "flagged-thread",
        query: "flagged",
      }),
      makeCore("case-a"),
    ]);
    storage.objects.set(
      evalDatasetCasePayloadKey(
        ctx.tenantSlug,
        ctx.slug,
        "flagged-aaaa-bbbb",
        "history",
      ),
      historyContent,
    );
    storage.objects.set(
      evalDatasetCasePayloadKey(
        ctx.tenantSlug,
        ctx.slug,
        "flagged-aaaa-bbbb",
        "workspace",
      ),
      workspaceContent,
    );
    // No traces payload was captured at flag time.

    const snapshot = await captureRunSnapshot(ctx, RUN_ID, storage);

    const flagged = snapshot.cases.find(
      (c) => c.caseId === "flagged-aaaa-bbbb",
    )!;
    // Captured payloads copied byte-identical into the run prefix,
    // shas computed from the copied bytes (payloads are NOT in the
    // dataset manifest — the launch hash is the integrity anchor the
    // worker verifies against).
    const historyRunKey = evalRunSnapshotCasePayloadKey(
      ctx.tenantSlug,
      RUN_ID,
      "flagged-aaaa-bbbb",
      "history",
    );
    const workspaceRunKey = evalRunSnapshotCasePayloadKey(
      ctx.tenantSlug,
      RUN_ID,
      "flagged-aaaa-bbbb",
      "workspace",
    );
    expect(storage.objects.get(historyRunKey)).toBe(historyContent);
    expect(storage.objects.get(workspaceRunKey)).toBe(workspaceContent);
    expect(flagged.payloadShas).toEqual({
      history: sha256Hex(historyContent),
      workspace: sha256Hex(workspaceContent),
    });
    // The run-prefix payload copies sit inside the guarded prefix.
    expect(isEvalDatasetsKey(historyRunKey)).toBe(true);
    expect(
      historyRunKey.startsWith(evalRunSnapshotPrefix("acme", RUN_ID)),
    ).toBe(true);
    // Non-flagged cases get no payload copies and no shas.
    const synthetic = snapshot.cases.find((c) => c.caseId === "case-a")!;
    expect(synthetic.payloadShas).toBeUndefined();
    expect(
      [...storage.objects.keys()].filter((k) =>
        k.includes(`${RUN_ID}/cases/case-a/payload/`),
      ),
    ).toEqual([]);
  });

  it("a flagged case with no captured payloads pins without payload copies (worker degrades per payload)", async () => {
    seedDataset(storage, [
      makeCore("flagged-cccc-dddd", {
        category: "flagged-thread",
        query: "flagged",
      }),
    ]);

    const snapshot = await captureRunSnapshot(ctx, RUN_ID, storage);

    expect(snapshot.cases).toHaveLength(1);
    expect(snapshot.cases[0].payloadShas).toBeUndefined();
    expect(
      [...storage.objects.keys()].filter((k) => k.includes("/payload/")),
    ).toEqual([]);
  });

  it("deleting the live dataset payload after capture leaves the run-prefix payload copy intact", async () => {
    const historyContent = JSON.stringify({
      messages: [{ id: "m1", role: "user", content: "flagged", parts: null }],
      dropped_oldest_count: 0,
      flagged_message_id: "m1",
    });
    const liveKey = evalDatasetCasePayloadKey(
      ctx.tenantSlug,
      ctx.slug,
      "flagged-aaaa-bbbb",
      "history",
    );
    seedDataset(storage, [
      makeCore("flagged-aaaa-bbbb", {
        category: "flagged-thread",
        query: "flagged",
      }),
    ]);
    storage.objects.set(liveKey, historyContent);

    const snapshot = await captureRunSnapshot(ctx, RUN_ID, storage);
    storage.objects.delete(liveKey);

    const runKey = evalRunSnapshotCasePayloadKey(
      ctx.tenantSlug,
      RUN_ID,
      "flagged-aaaa-bbbb",
      "history",
    );
    expect(storage.objects.get(runKey)).toBe(historyContent);
    expect(snapshot.cases[0].payloadShas).toEqual({
      history: sha256Hex(historyContent),
    });
  });

  it("retries once when a case is edited between manifest read and copy, then succeeds on a consistent re-read", async () => {
    const manifest = seedDataset(storage, [makeCore("case-a")]);
    // Simulate a concurrent edit landing AFTER the manifest read of
    // attempt 1: the case object no longer matches the manifest sha.
    const editedContent = serializeEvalDatasetCase(
      makeCore("case-a", { query: "edited concurrently" }),
      null,
    );
    storage.objects.set(
      evalDatasetCaseKey(ctx.tenantSlug, ctx.slug, "case-a"),
      editedContent,
    );
    // The editor finishes its write-manifest step before the retry reads.
    let manifestReads = 0;
    storage.onRead = (key) => {
      if (key === evalDatasetManifestKey(ctx.tenantSlug, ctx.slug)) {
        manifestReads += 1;
        if (manifestReads === 2) {
          storage.objects.set(
            key,
            serializeEvalDatasetManifest({
              ...manifest,
              version: manifest.version + 1,
              cases: [
                {
                  case_id: "case-a",
                  content_sha: computeEvalCaseSha(editedContent),
                },
              ],
            }),
          );
        }
      }
    };

    const snapshot = await captureRunSnapshot(ctx, RUN_ID, storage);

    expect(manifestReads).toBe(2);
    // The retry pinned the consistent post-edit state — never the torn mix.
    expect(snapshot.datasetVersion).toBe(manifest.version + 1);
    expect(storage.objects.get(snapshot.cases[0].snapshotKey)).toBe(
      editedContent,
    );
  });

  it("fails the launch (no copies) when content stays torn after the retry", async () => {
    seedDataset(storage, [makeCore("case-a"), makeCore("case-b")]);
    // case-b permanently disagrees with the manifest (torn state).
    storage.objects.set(
      evalDatasetCaseKey(ctx.tenantSlug, ctx.slug, "case-b"),
      serializeEvalDatasetCase(makeCore("case-b", { query: "torn" }), null),
    );

    await expect(captureRunSnapshot(ctx, RUN_ID, storage)).rejects.toThrow(
      /never pins torn content/,
    );
    // Nothing was copied into the run prefix.
    const snapshotKeys = [...storage.objects.keys()].filter((k) =>
      k.startsWith(evalRunSnapshotPrefix(ctx.tenantSlug, RUN_ID)),
    );
    expect(snapshotKeys).toEqual([]);
  });

  it("fails when a manifest-listed case object is missing after the retry", async () => {
    seedDataset(storage, [makeCore("case-a")]);
    storage.objects.delete(
      evalDatasetCaseKey(ctx.tenantSlug, ctx.slug, "case-a"),
    );

    await expect(captureRunSnapshot(ctx, RUN_ID, storage)).rejects.toThrow(
      /missing from S3/,
    );
  });

  it("returns an empty pinned scope for a dataset whose cases are all disabled", async () => {
    seedDataset(storage, [makeCore("case-a", { enabled: false })]);
    const snapshot = await captureRunSnapshot(ctx, RUN_ID, storage);
    expect(snapshot.cases).toEqual([]);
    expect(snapshot.datasetVersion).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// deleteRunSnapshot
// ---------------------------------------------------------------------------

describe("deleteRunSnapshot", () => {
  it("removes every object under the run prefix and nothing else", async () => {
    seedDataset(storage, [makeCore("case-a"), makeCore("case-b")]);
    const snapshot = await captureRunSnapshot(ctx, RUN_ID, storage);
    const otherRunKey = evalRunSnapshotCaseKey(
      ctx.tenantSlug,
      "other-run",
      "case-a",
    );
    storage.objects.set(otherRunKey, "{}");

    const deleted = await deleteRunSnapshot(ctx.tenantSlug, RUN_ID, storage);

    expect(deleted).toBe(snapshot.cases.length);
    expect(
      [...storage.objects.keys()].filter((k) =>
        k.startsWith(evalRunSnapshotPrefix(ctx.tenantSlug, RUN_ID)),
      ),
    ).toEqual([]);
    // The live dataset and other runs' snapshots are untouched.
    expect(
      storage.objects.has(
        evalDatasetCaseKey(ctx.tenantSlug, ctx.slug, "case-a"),
      ),
    ).toBe(true);
    expect(storage.objects.has(otherRunKey)).toBe(true);
  });
});
