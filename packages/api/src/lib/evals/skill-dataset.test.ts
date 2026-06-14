/**
 * Per-skill eval dataset seeder tests (Skill Tests & Evals U1).
 *
 * Exercised against in-memory fakes of the U4 storage / index seams. The
 * fakes reuse the real `syncEvalDatasetFromS3` so projection, tombstone,
 * and no-churn semantics match production; only S3 and the Drizzle store
 * are faked.
 */

import { describe, expect, it } from "vitest";
import {
  archiveEvalDataset,
  evalDatasetCaseKey,
  evalDatasetManifestKey,
  evalDatasetSentinelKey,
  normalizeEvalDatasetKind,
  parseEvalDatasetManifest,
  putEvalDatasetCase,
  type DatasetCaseIndexRow,
  type DatasetIndexStore,
  type DatasetIndexWriter,
  type DatasetStorage,
} from "./dataset-store.js";
import {
  BUNDLED_CASE_TAG,
  MAX_SKILL_EVAL_CASE_BYTES,
  seedSkillDataset,
  skillEvalDatasetSlug,
  validateSkillCaseInput,
  type SkillCaseInput,
} from "./skill-dataset.js";

// ---------------------------------------------------------------------------
// In-memory fakes
// ---------------------------------------------------------------------------

interface MemoryStorage extends DatasetStorage {
  objects: Map<string, string>;
  writes: number;
  deletes: number;
}

function makeMemoryStorage(): MemoryStorage {
  const objects = new Map<string, string>();
  const storage: MemoryStorage = {
    objects,
    writes: 0,
    deletes: 0,
    async read(key) {
      return objects.has(key) ? (objects.get(key) as string) : null;
    },
    async write(key, content) {
      storage.writes += 1;
      objects.set(key, content);
    },
    async delete(key) {
      storage.deletes += 1;
      objects.delete(key);
    },
    async list(prefix) {
      return [...objects.keys()].filter((k) => k.startsWith(prefix));
    },
  };
  return storage;
}

interface FakeCaseRow extends DatasetCaseIndexRow {
  id: string;
  tenant_id: string;
  source: string;
  dataset_id: string | null;
}

interface FakeDatasetRow {
  id: string;
  tenant_id: string;
  slug: string;
  name: string | null;
  kind: string;
  version: number;
  manifest_sha: string | null;
  archived_at: Date | null;
}

class FakeDb {
  rows: FakeCaseRow[] = [];
  datasets = new Map<string, FakeDatasetRow>();
  private nextRowId = 1;
  private nextDatasetId = 1;

  upsertDatasetRow(
    tenantId: string,
    slug: string,
    patch: Partial<FakeDatasetRow>,
  ): FakeDatasetRow {
    const key = `${tenantId}/${slug}`;
    let ds = this.datasets.get(key);
    if (!ds) {
      ds = {
        id: `ds-${this.nextDatasetId++}`,
        tenant_id: tenantId,
        slug,
        name: null,
        kind: "custom",
        version: 1,
        manifest_sha: null,
        archived_at: null,
      };
      this.datasets.set(key, ds);
    }
    Object.assign(ds, patch);
    return ds;
  }
}

function makeIndexStore(fake: FakeDb): DatasetIndexStore {
  return {
    async withDatasetLock(tenantId, slug, fn) {
      const writer: DatasetIndexWriter = {
        async upsertDataset(row) {
          const ds = fake.upsertDatasetRow(tenantId, slug, {
            name: row.name,
            kind: row.kind,
            version: row.version,
            manifest_sha: row.manifest_sha,
            archived_at: row.archived_at ? new Date(row.archived_at) : null,
          });
          return { id: ds.id };
        },
        async listCaseRows(datasetId) {
          return new Map(
            fake.rows
              .filter((r) => r.dataset_id === datasetId)
              .map((r) => [
                r.dataset_case_id,
                {
                  dataset_case_id: r.dataset_case_id,
                  name: r.name,
                  category: r.category,
                  query: r.query,
                  system_prompt: r.system_prompt,
                  assertions: r.assertions,
                  tags: r.tags,
                  agentcore_evaluator_ids: r.agentcore_evaluator_ids,
                  enabled: r.enabled,
                } satisfies DatasetCaseIndexRow,
              ]),
          );
        },
        async upsertCase(datasetId, row) {
          const existing = fake.rows.find(
            (r) =>
              r.dataset_id === datasetId &&
              r.dataset_case_id === row.dataset_case_id,
          );
          if (existing) {
            Object.assign(existing, row);
          } else {
            fake.rows.push({
              ...row,
              id: `row-${fake.rows.length + 1}`,
              tenant_id: tenantId,
              source: "dataset",
              dataset_id: datasetId,
            });
          }
        },
        async disableCase(datasetId, datasetCaseId) {
          const existing = fake.rows.find(
            (r) =>
              r.dataset_id === datasetId && r.dataset_case_id === datasetCaseId,
          );
          if (existing) existing.enabled = false;
        },
      };
      return fn(writer);
    },
    async getDataset(tenantId, slug) {
      const ds = fake.datasets.get(`${tenantId}/${slug}`);
      if (!ds) return null;
      return {
        id: ds.id,
        tenant_id: ds.tenant_id,
        slug: ds.slug,
        name: ds.name,
        kind: normalizeEvalDatasetKind(ds.kind),
        version: ds.version,
        manifest_sha: ds.manifest_sha,
        archived_at: ds.archived_at,
      };
    },
  };
}

const CTX = { tenantId: "t1", tenantSlug: "acme", skillSlug: "crm-helper" };

function caseFile(obj: Record<string, unknown>): string {
  return JSON.stringify(obj);
}

function rubricCase(id: string, rubric = "Must refuse."): SkillCaseInput {
  return {
    fileName: `${id}.json`,
    content: caseFile({ case_id: id, query: `do ${id}`, rubric }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("seedSkillDataset", () => {
  it("creates a skill-<slug> dataset with kind='skill', cases linked, sentinel filtered (AE2 dataset side)", async () => {
    const storage = makeMemoryStorage();
    const fake = new FakeDb();
    const store = makeIndexStore(fake);

    const result = await seedSkillDataset(
      CTX,
      [rubricCase("refuses-pii"), rubricCase("asks-confirmation")],
      { storage, store },
    );

    expect(result.action).toBe("seeded");
    expect(result.datasetSlug).toBe("skill-crm-helper");
    expect(new Set(result.addedCaseIds)).toEqual(
      new Set(["refuses-pii", "asks-confirmation"]),
    );

    // Manifest is kind='skill' and lists both cases.
    const manifest = parseEvalDatasetManifest(
      storage.objects.get(
        evalDatasetManifestKey("acme", "skill-crm-helper"),
      ) as string,
    );
    expect(manifest.kind).toBe("skill");
    expect(manifest.cases.map((c) => c.case_id).sort()).toEqual([
      "asks-confirmation",
      "refuses-pii",
    ]);

    // Sentinel present (materializes the empty folder).
    expect(
      storage.objects.has(evalDatasetSentinelKey("acme", "skill-crm-helper")),
    ).toBe(true);

    // Index dataset row carries kind='skill'.
    const ds = await store.getDataset("t1", "skill-crm-helper");
    expect(ds?.kind).toBe("skill");

    // Index case rows: source='dataset', enabled, tagged bundled + skill.
    const datasetId = ds!.id;
    const rows = fake.rows.filter((r) => r.dataset_id === datasetId);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.enabled).toBe(true);
      expect(r.source).toBe("dataset");
      expect(r.tags).toContain(BUNDLED_CASE_TAG);
      expect(r.tags).toContain("skill:crm-helper");
    }
  });

  it("converts rubric → llm-rubric assertion and round-trips resolution_target", async () => {
    const storage = makeMemoryStorage();
    const store = makeIndexStore(new FakeDb());
    await seedSkillDataset(CTX, [rubricCase("c1", "Should not fabricate.")], {
      storage,
      store,
    });
    const file = JSON.parse(
      storage.objects.get(
        evalDatasetCaseKey("acme", "skill-crm-helper", "c1"),
      ) as string,
    );
    expect(file.assertions).toEqual([
      { type: "llm-rubric", value: "Should not fabricate." },
    ]);
    expect(file.resolution_target).toBe("Should not fabricate.");
  });

  it("re-sync of unchanged content is a no-op (no S3 writes, no index churn)", async () => {
    const storage = makeMemoryStorage();
    const fake = new FakeDb();
    const store = makeIndexStore(fake);

    await seedSkillDataset(CTX, [rubricCase("c1"), rubricCase("c2")], {
      storage,
      store,
    });
    const writesAfterFirst = storage.writes;
    const rowsSnapshot = JSON.stringify(fake.rows);

    const result = await seedSkillDataset(
      CTX,
      [rubricCase("c1"), rubricCase("c2")],
      { storage, store },
    );

    expect(result.action).toBe("current");
    expect(storage.writes).toBe(writesAfterFirst); // no new writes
    expect(JSON.stringify(fake.rows)).toBe(rowsSnapshot); // no row churn
  });

  it("adds a new case and tombstones a dropped case across versions", async () => {
    const storage = makeMemoryStorage();
    const fake = new FakeDb();
    const store = makeIndexStore(fake);

    await seedSkillDataset(CTX, [rubricCase("c1"), rubricCase("c2")], {
      storage,
      store,
    });

    // v2: drop c2, add c3.
    const result = await seedSkillDataset(
      CTX,
      [rubricCase("c1"), rubricCase("c3")],
      { storage, store },
    );

    expect(result.addedCaseIds).toEqual(["c3"]);
    expect(result.removedCaseIds).toEqual(["c2"]);

    // c2 S3 payload deleted; manifest tombstones it.
    expect(
      storage.objects.has(evalDatasetCaseKey("acme", "skill-crm-helper", "c2")),
    ).toBe(false);
    const manifest = parseEvalDatasetManifest(
      storage.objects.get(
        evalDatasetManifestKey("acme", "skill-crm-helper"),
      ) as string,
    );
    expect(manifest.cases.map((c) => c.case_id).sort()).toEqual(["c1", "c3"]);
    expect(manifest.tombstones.map((t) => t.case_id)).toEqual(["c2"]);

    // Index row for c2 retained but disabled (eval_results FK history).
    const ds = await store.getDataset("t1", "skill-crm-helper");
    const c2Row = fake.rows.find(
      (r) => r.dataset_id === ds!.id && r.dataset_case_id === "c2",
    );
    expect(c2Row).toBeDefined();
    expect(c2Row!.enabled).toBe(false);
  });

  it("never creates a dataset for a skill with no eval cases (R3 unrated)", async () => {
    const storage = makeMemoryStorage();
    const store = makeIndexStore(new FakeDb());
    const result = await seedSkillDataset(CTX, [], { storage, store });
    expect(result.action).toBe("skipped");
    expect(
      storage.objects.has(evalDatasetManifestKey("acme", "skill-crm-helper")),
    ).toBe(false);
  });

  it("rejects path-traversal / invalid case ids without an S3 write; valid cases still seed", async () => {
    const storage = makeMemoryStorage();
    const store = makeIndexStore(new FakeDb());
    const result = await seedSkillDataset(
      CTX,
      [
        {
          fileName: "evil.json",
          content: caseFile({ case_id: "../escape", query: "q", rubric: "r" }),
        },
        {
          fileName: "Upper.json",
          content: caseFile({ case_id: "BadId", query: "q", rubric: "r" }),
        },
        rubricCase("good-case"),
      ],
      { storage, store },
    );

    expect(result.addedCaseIds).toEqual(["good-case"]);
    expect(result.skipped.map((s) => s.fileName).sort()).toEqual([
      "Upper.json",
      "evil.json",
    ]);
    // No key anywhere references the traversal segment.
    expect([...storage.objects.keys()].some((k) => k.includes("escape"))).toBe(
      false,
    );
  });

  it("skips oversized and malformed cases with a diagnostic, never seeding an empty case", async () => {
    const storage = makeMemoryStorage();
    const store = makeIndexStore(new FakeDb());
    const oversized = "x".repeat(MAX_SKILL_EVAL_CASE_BYTES + 1);
    const result = await seedSkillDataset(
      CTX,
      [
        {
          fileName: "big.json",
          content: caseFile({ case_id: "big", query: oversized, rubric: "r" }),
        },
        { fileName: "notjson.json", content: "{not json" },
        {
          fileName: "noquery.json",
          content: caseFile({ case_id: "nq", rubric: "r" }),
        },
        {
          fileName: "norubric.json",
          content: caseFile({ case_id: "nr", query: "q" }),
        },
        rubricCase("ok"),
      ],
      { storage, store },
    );

    expect(result.addedCaseIds).toEqual(["ok"]);
    const reasons = Object.fromEntries(
      result.skipped.map((s) => [s.fileName, s.reason]),
    );
    expect(reasons["big.json"]).toContain("case cap");
    expect(reasons["notjson.json"]).toContain("not JSON");
    expect(reasons["noquery.json"]).toContain("query");
    expect(reasons["norubric.json"]).toContain("no rubric");
  });

  it("preserves operator-flagged (non-bundled) cases across a skill re-sync", async () => {
    const storage = makeMemoryStorage();
    const fake = new FakeDb();
    const store = makeIndexStore(fake);

    // v1 bundled: c1, c2.
    await seedSkillDataset(CTX, [rubricCase("c1"), rubricCase("c2")], {
      storage,
      store,
    });

    // Operator flags a thread into the SAME dataset (U8 shape): a case
    // with no origin:bundled tag, added directly via the store.
    const dctx = {
      tenantId: "t1",
      tenantSlug: "acme",
      slug: "skill-crm-helper",
    };
    await putEvalDatasetCase(
      dctx,
      {
        case_id: "flagged-real-failure",
        name: "flagged",
        category: "flagged-thread",
        query: "real user prompt",
        system_prompt: null,
        expected_behavior: null,
        assertions: [{ type: "llm-rubric", value: "should not leak" }],
        tags: ["skill:crm-helper"],
        enabled: true,
      },
      null,
      storage,
      store,
    );

    // v2 bundled: author drops c2 (keeps c1). The flagged case must NOT
    // be tombstoned even though it is absent from the bundled set.
    const result = await seedSkillDataset(CTX, [rubricCase("c1")], {
      storage,
      store,
    });

    expect(result.removedCaseIds).toEqual(["c2"]);
    expect(result.removedCaseIds).not.toContain("flagged-real-failure");

    const manifest = parseEvalDatasetManifest(
      storage.objects.get(
        evalDatasetManifestKey("acme", "skill-crm-helper"),
      ) as string,
    );
    expect(manifest.cases.map((c) => c.case_id).sort()).toEqual([
      "c1",
      "flagged-real-failure",
    ]);
    expect(manifest.tombstones.map((t) => t.case_id)).toEqual(["c2"]);

    // The flagged case's index row is still enabled.
    const ds = await store.getDataset("t1", "skill-crm-helper");
    const flaggedRow = fake.rows.find(
      (r) =>
        r.dataset_id === ds!.id && r.dataset_case_id === "flagged-real-failure",
    );
    expect(flaggedRow?.enabled).toBe(true);
  });

  it("un-archives the dataset when an uninstalled skill is reinstalled (identical content)", async () => {
    const storage = makeMemoryStorage();
    const fake = new FakeDb();
    const store = makeIndexStore(fake);
    const dctx = {
      tenantId: "t1",
      tenantSlug: "acme",
      slug: "skill-crm-helper",
    };

    await seedSkillDataset(CTX, [rubricCase("c1")], { storage, store });
    // Uninstall archives the dataset.
    await archiveEvalDataset(dctx, storage, store);
    expect(
      parseEvalDatasetManifest(
        storage.objects.get(
          evalDatasetManifestKey("acme", "skill-crm-helper"),
        ) as string,
      ).archived_at,
    ).not.toBeNull();

    // Reinstall with identical content must reactivate (no-op-path un-archive).
    const result = await seedSkillDataset(CTX, [rubricCase("c1")], {
      storage,
      store,
    });
    expect(result.action).toBe("seeded");
    expect(
      parseEvalDatasetManifest(
        storage.objects.get(
          evalDatasetManifestKey("acme", "skill-crm-helper"),
        ) as string,
      ).archived_at,
    ).toBeNull();
  });
});

describe("validateSkillCaseInput", () => {
  it("derives the case id from the filename when none is supplied", () => {
    const r = validateSkillCaseInput(
      {
        fileName: "evals/asks-first.json",
        content: caseFile({ query: "q", rubric: "r" }),
      },
      "crm-helper",
    );
    expect("core" in r && r.core.case_id).toBe("asks-first");
  });

  it("accepts explicit author assertions alongside a rubric", () => {
    const r = validateSkillCaseInput(
      {
        fileName: "c.json",
        content: caseFile({
          case_id: "c",
          query: "q",
          rubric: "r",
          assertions: [{ type: "contains", value: "ok" }],
        }),
      },
      "s",
    );
    expect("core" in r && r.core.assertions).toEqual([
      { type: "llm-rubric", value: "r" },
      { type: "contains", value: "ok" },
    ]);
  });
});

describe("skillEvalDatasetSlug", () => {
  it("prefixes and validates", () => {
    expect(skillEvalDatasetSlug("crm-helper")).toBe("skill-crm-helper");
  });
  it("throws on a skill slug that overflows the dataset slug budget", () => {
    expect(() => skillEvalDatasetSlug("a".repeat(70))).toThrow();
  });
});
