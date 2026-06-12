/**
 * Baseline red-team dataset pack + versioned idempotent seeder
 * (Evaluations Trust Core U5).
 *
 * Converts the 11 seed packs at seeds/eval-test-cases/*.json (189 cases,
 * bundled into the Lambda via the JSON imports in
 * packages/api/src/lib/eval-seeds.ts) into the U4 dataset format and
 * materializes them per tenant at
 * `tenants/<tenant-slug>/eval-datasets/baseline-red-team/`.
 *
 * Invariants honored here:
 *  - Case ids are the existing stable seed case names — trend history and
 *    case identity survive the migration (hard requirement).
 *  - Seeding is versioned + idempotent: a `_baseline_version` marker
 *    object (mirrors `_defaults_version` in seed-workspace-defaults.ts)
 *    short-circuits repeat seeds; bumping BASELINE_DATASET_VERSION
 *    re-runs the additive merge.
 *  - Updates are ADDITIVE BY CASE ID: a new baseline version only adds
 *    cases whose id is absent from the manifest (live or tombstoned).
 *    Tenant edits to baseline cases live in S3 (the canonical artifact)
 *    and therefore WIN over re-seeds; tenant-removed (tombstoned) cases
 *    are never re-added; tenant-disabled cases stay disabled.
 *  - Re-homing existing tenants is an in-place UPDATE that sets
 *    dataset_id / dataset_case_id on the existing eval_test_cases rows.
 *    Row ids are preserved (eval_results FK history + trend queries
 *    survive) and `source` stays 'yaml-seed' — the resolver's legacy
 *    presence check (COUNT WHERE source='yaml-seed') and the partial
 *    unique index uq_eval_test_cases_tenant_seed_name keep guarding
 *    against duplicate re-seeds through deploy windows and PR reverts.
 *    Dataset membership is expressed ONLY by the linkage columns.
 *  - Linkage is set BEFORE the index sync so the U4 select-then-write
 *    keyed on (dataset_id, dataset_case_id) treats re-homed rows as
 *    updates, never inserts (which would stamp source='dataset').
 */

import { getConfig } from "@thinkwork/runtime-config";
import { S3Client } from "@aws-sdk/client-s3";
import {
  BUILT_IN_EVAL_SEED_SOURCE,
  EVAL_SEEDS,
  type SeedTestCase,
} from "../eval-seeds.js";
import {
  db,
  eq,
  and,
  isNull,
  inArray,
  sql,
  tenants,
  evalDatasets,
  evalTestCases,
} from "../../graphql/utils.js";
import {
  assertValidCaseId,
  caseFileToIndexRow,
  computeEvalCaseSha,
  createDrizzleDatasetIndexStore,
  createS3DatasetStorage,
  evalDatasetCaseKey,
  evalDatasetManifestKey,
  evalDatasetPrefix,
  evalDatasetSentinelKey,
  parseEvalDatasetCase,
  parseEvalDatasetManifest,
  serializeEvalDatasetCase,
  serializeEvalDatasetManifest,
  syncEvalDatasetFromS3,
  type DatasetCaseIndexRow,
  type DatasetContext,
  type DatasetIndexStore,
  type DatasetStorage,
  type EvalDatasetCaseCore,
  type EvalDatasetCaseEngines,
  type EvalDatasetManifest,
} from "./dataset-store.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const BASELINE_DATASET_SLUG = "baseline-red-team";
export const BASELINE_DATASET_NAME = "Baseline Red Team";

/**
 * Version of the canonical baseline pack. Bump when the seed packs gain
 * cases that existing tenants should receive (the additive merge re-runs
 * for every tenant whose stored marker is older). The resolver's warm-
 * container seed cache keys on this value so a deploy that bumps it
 * re-seeds even on warm Lambdas.
 */
export const BASELINE_DATASET_VERSION = 1;

const VERSION_MARKER_FILE = "_baseline_version";

/** S3 key of the per-tenant versioned-seed marker (inside the guarded prefix). */
export function baselineVersionMarkerKey(tenantSlug: string): string {
  return `${evalDatasetPrefix(tenantSlug, BASELINE_DATASET_SLUG)}${VERSION_MARKER_FILE}`;
}

/**
 * Warm-container seed-cache key. Versioned so bumping
 * BASELINE_DATASET_VERSION invalidates every warm Lambda's cache.
 */
export function baselineSeedCacheKey(
  tenantId: string,
  version: number = BASELINE_DATASET_VERSION,
): string {
  return `${tenantId}@baseline-v${version}`;
}

// ---------------------------------------------------------------------------
// Pack conversion — seed JSON → engine-neutral dataset case files
// ---------------------------------------------------------------------------

export interface BaselineDatasetCase {
  core: EvalDatasetCaseCore;
  engines: EvalDatasetCaseEngines | null;
}

/**
 * Tag derivation preserved verbatim from the legacy DB seeder (the old
 * `seedTags` in the evaluations resolver) so re-homed rows project
 * identical index content — the runner's `surface:computer` exclusion
 * filter depends on these tags.
 */
export function baselineSeedTags(seed: {
  target_surface?: string;
  target_skill?: string;
  threshold?: number;
}): string[] {
  return [
    seed.target_surface ? `surface:${seed.target_surface}` : null,
    seed.target_skill ? `skill:${seed.target_skill}` : null,
    typeof seed.threshold === "number" ? `threshold:${seed.threshold}` : null,
  ].filter((tag): tag is string => Boolean(tag));
}

/** Legacy default preserved: empty evaluator lists fall back to Helpfulness. */
function baselineEvaluatorIds(seed: SeedTestCase): string[] {
  return seed.agentcore_evaluator_ids && seed.agentcore_evaluator_ids.length > 0
    ? seed.agentcore_evaluator_ids
    : ["Builtin.Helpfulness"];
}

/**
 * Convert the bundled seed packs into baseline dataset cases. Case id =
 * stable seed case name; engine-specific evaluator ids live only in the
 * namespaced `engines.agentcore` extension block (U4 KTD — the core
 * schema never references engine vocabulary).
 */
export function buildBaselineDatasetCases(
  seeds: SeedTestCase[] = EVAL_SEEDS,
): BaselineDatasetCase[] {
  return seeds.map((seed) => {
    assertValidCaseId(seed.name);
    return {
      core: {
        case_id: seed.name,
        name: seed.name,
        category: seed.category,
        query: seed.query,
        // Legacy parity: the DB seeder never stored a system prompt
        // (seed.prompt duplicates seed.query in every pack).
        system_prompt: null,
        expected_behavior: seed.expected_behavior ?? null,
        assertions: seed.assertions,
        tags: baselineSeedTags(seed),
        enabled: true,
      },
      engines: { agentcore: { evaluator_ids: baselineEvaluatorIds(seed) } },
    };
  });
}

// ---------------------------------------------------------------------------
// Index ops seam (unit-testable with fakes; Drizzle wiring below)
// ---------------------------------------------------------------------------

export interface BaselineSeedIndexOps {
  /** Upsert the eval_datasets row (pre-sync, minimal) and return its id. */
  upsertDatasetRow(row: {
    slug: string;
    name: string | null;
  }): Promise<{ id: string }>;
  /**
   * Existing source='yaml-seed' rows for the tenant, keyed by name —
   * tenant row content WINS over canonical pack content when a case is
   * first materialized into S3 (edits + disables survive the migration).
   */
  listSeedRowContentByName(
    names: string[],
  ): Promise<Map<string, DatasetCaseIndexRow>>;
  /**
   * In-place UPDATE linking un-homed yaml-seed rows (matched by name) to
   * the dataset: same row ids, source unchanged. Returns linked count.
   */
  rehomeSeedRows(datasetId: string, caseIds: string[]): Promise<number>;
  /** dataset_case_id values already linked to the dataset. */
  listLinkedCaseIds(datasetId: string): Promise<Set<string>>;
  /**
   * Insert missing index rows with source='yaml-seed' AND linkage set,
   * conflict-ignoring (the partial unique indexes absorb races and
   * rollback re-seeds). Returns inserted count.
   */
  insertSeedRows(
    datasetId: string,
    rows: DatasetCaseIndexRow[],
  ): Promise<number>;
}

export interface BaselineSeedDeps {
  storage: DatasetStorage;
  store: DatasetIndexStore;
  index: BaselineSeedIndexOps;
}

export interface BaselineSeedResult {
  action: "seeded" | "current" | "skipped";
  /** Case ids newly added to the S3 manifest this run. */
  addedCaseIds: string[];
  /** Existing yaml-seed rows linked in place this run. */
  rehomed: number;
  /** Index rows newly inserted (source='yaml-seed', linked). */
  inserted: number;
}

function parseMarkerVersion(content: string | null): number {
  if (content == null) return 0;
  try {
    const parsed = JSON.parse(content) as { version?: unknown };
    return typeof parsed.version === "number" ? parsed.version : 0;
  } catch {
    return 0;
  }
}

/** Rebuild a case file from an existing tenant index row (edits win). */
function caseFromIndexRow(
  caseId: string,
  row: DatasetCaseIndexRow,
  canonical: BaselineDatasetCase,
): BaselineDatasetCase {
  return {
    core: {
      case_id: caseId,
      name: row.name,
      category: row.category,
      query: row.query,
      system_prompt: row.system_prompt,
      // Not projected into the index (S3-only field) — carry the
      // canonical text so the case file stays self-describing.
      expected_behavior: canonical.core.expected_behavior,
      assertions: row.assertions,
      tags: row.tags,
      enabled: row.enabled,
    },
    engines:
      row.agentcore_evaluator_ids.length > 0
        ? { agentcore: { evaluator_ids: row.agentcore_evaluator_ids } }
        : null,
  };
}

// ---------------------------------------------------------------------------
// Seeder — versioned marker, additive merge, re-home, index sync
// ---------------------------------------------------------------------------

export async function seedBaselineDataset(
  ctx: { tenantId: string; tenantSlug: string },
  deps: BaselineSeedDeps,
  opts: {
    cases?: BaselineDatasetCase[];
    targetVersion?: number;
    categories?: string[] | null;
  } = {},
): Promise<BaselineSeedResult> {
  const targetVersion = opts.targetVersion ?? BASELINE_DATASET_VERSION;
  const allCases = opts.cases ?? buildBaselineDatasetCases();
  const cases =
    opts.categories && opts.categories.length > 0
      ? allCases.filter((c) => opts.categories!.includes(c.core.category))
      : allCases;
  const fullSeed = cases.length === allCases.length;
  const dctx: DatasetContext = {
    tenantId: ctx.tenantId,
    tenantSlug: ctx.tenantSlug,
    slug: BASELINE_DATASET_SLUG,
  };

  // 1. Versioned marker — mirrors `_defaults_version` in
  //    seed-workspace-defaults.ts. Marker at/above target → full no-op.
  const markerKey = baselineVersionMarkerKey(ctx.tenantSlug);
  const markerVersion = parseMarkerVersion(await deps.storage.read(markerKey));
  if (markerVersion >= targetVersion) {
    return { action: "current", addedCaseIds: [], rehomed: 0, inserted: 0 };
  }

  // 2. Load (or initialize) the manifest.
  const manifestKey = evalDatasetManifestKey(
    ctx.tenantSlug,
    BASELINE_DATASET_SLUG,
  );
  const manifestContent = await deps.storage.read(manifestKey);
  const isNewDataset = manifestContent == null;
  const manifest: EvalDatasetManifest = isNewDataset
    ? {
        slug: BASELINE_DATASET_SLUG,
        name: BASELINE_DATASET_NAME,
        kind: "baseline",
        version: 0, // bumped below on write
        updated_at: new Date().toISOString(),
        archived_at: null,
        cases: [],
        tombstones: [],
      }
    : parseEvalDatasetManifest(manifestContent);

  // 3. Existing tenant rows (legacy yaml-seed): their content wins over
  //    the canonical pack when a case is first materialized into S3 —
  //    tenant edits and disables survive the migration.
  const existingRows = await deps.index.listSeedRowContentByName(
    cases.map((c) => c.core.case_id),
  );

  // 4. Additive merge by case id: live and tombstoned ids are never
  //    touched (tenant edits win; tenant removals stay removed).
  const liveIds = new Set(manifest.cases.map((c) => c.case_id));
  const tombstonedIds = new Set(manifest.tombstones.map((t) => t.case_id));
  const addedCaseIds: string[] = [];
  for (const candidate of cases) {
    const caseId = candidate.core.case_id;
    if (liveIds.has(caseId) || tombstonedIds.has(caseId)) continue;
    const existing = existingRows.get(caseId);
    const { core, engines } = existing
      ? caseFromIndexRow(caseId, existing, candidate)
      : candidate;
    const content = serializeEvalDatasetCase(core, engines);
    await deps.storage.write(
      evalDatasetCaseKey(ctx.tenantSlug, BASELINE_DATASET_SLUG, caseId),
      content,
    );
    manifest.cases.push({
      case_id: caseId,
      content_sha: computeEvalCaseSha(content),
    });
    addedCaseIds.push(caseId);
  }

  // 5. Sentinel (empty-folder materialization) + manifest write — only
  //    when state actually changed, so a no-add version bump doesn't
  //    churn the manifest version.
  if (isNewDataset) {
    await deps.storage.write(
      evalDatasetSentinelKey(ctx.tenantSlug, BASELINE_DATASET_SLUG),
      "",
    );
  }
  if (isNewDataset || addedCaseIds.length > 0) {
    manifest.version += 1;
    manifest.updated_at = new Date().toISOString();
    await deps.storage.write(
      manifestKey,
      serializeEvalDatasetManifest(manifest),
    );
  }

  // 6. Index linkage BEFORE sync (U5 KTD): re-homed rows keep their row
  //    ids AND source='yaml-seed'; the U4 sync keyed on
  //    (dataset_id, dataset_case_id) then treats them as updates.
  const { id: datasetId } = await deps.index.upsertDatasetRow({
    slug: BASELINE_DATASET_SLUG,
    name: manifest.name,
  });
  const liveCaseIds = manifest.cases.map((c) => c.case_id);
  const rehomed = await deps.index.rehomeSeedRows(datasetId, liveCaseIds);
  const linked = await deps.index.listLinkedCaseIds(datasetId);
  const missingRows: DatasetCaseIndexRow[] = [];
  for (const caseId of liveCaseIds) {
    if (linked.has(caseId)) continue;
    const content = await deps.storage.read(
      evalDatasetCaseKey(ctx.tenantSlug, BASELINE_DATASET_SLUG, caseId),
    );
    if (content == null) continue; // partial S3 state: heals on next sync
    missingRows.push(caseFileToIndexRow(caseId, parseEvalDatasetCase(content)));
  }
  const inserted =
    missingRows.length > 0
      ? await deps.index.insertSeedRows(datasetId, missingRows)
      : 0;

  // 7. Full-state sync from S3 (advisory-locked inside the store) —
  //    projects manifest_sha and reconciles any remaining drift.
  await syncEvalDatasetFromS3(dctx, deps.storage, deps.store, { force: true });

  // 8. Marker — stamped only on full (unfiltered) seeds so a categories-
  //    filtered partial seed can't suppress the remaining cases forever.
  if (fullSeed) {
    await deps.storage.write(
      markerKey,
      JSON.stringify({
        version: targetVersion,
        updated_at: new Date().toISOString(),
      }),
    );
  }

  return { action: "seeded", addedCaseIds, rehomed, inserted };
}

// ---------------------------------------------------------------------------
// Production wiring — Drizzle index ops + S3 storage
// ---------------------------------------------------------------------------

export function createDrizzleBaselineIndexOps(
  tenantId: string,
): BaselineSeedIndexOps {
  return {
    async upsertDatasetRow(row) {
      const [upserted] = await db
        .insert(evalDatasets)
        .values({
          tenant_id: tenantId,
          slug: row.slug,
          name: row.name,
          kind: "baseline",
        })
        .onConflictDoUpdate({
          target: [evalDatasets.tenant_id, evalDatasets.slug],
          set: { name: row.name, kind: "baseline", updated_at: sql`now()` },
        })
        .returning({ id: evalDatasets.id });
      return { id: upserted.id };
    },
    async listSeedRowContentByName(names) {
      if (names.length === 0) return new Map();
      const rows = await db
        .select({
          name: evalTestCases.name,
          category: evalTestCases.category,
          query: evalTestCases.query,
          system_prompt: evalTestCases.system_prompt,
          assertions: evalTestCases.assertions,
          tags: evalTestCases.tags,
          agentcore_evaluator_ids: evalTestCases.agentcore_evaluator_ids,
          enabled: evalTestCases.enabled,
        })
        .from(evalTestCases)
        .where(
          and(
            eq(evalTestCases.tenant_id, tenantId),
            eq(evalTestCases.source, BUILT_IN_EVAL_SEED_SOURCE),
            inArray(evalTestCases.name, names),
          ),
        );
      return new Map(
        rows.map((r) => [
          r.name,
          {
            dataset_case_id: r.name,
            name: r.name,
            category: r.category,
            query: r.query,
            system_prompt: r.system_prompt,
            assertions: Array.isArray(r.assertions)
              ? (r.assertions as unknown[])
              : [],
            tags: r.tags ?? [],
            agentcore_evaluator_ids: r.agentcore_evaluator_ids ?? [],
            enabled: r.enabled,
          } satisfies DatasetCaseIndexRow,
        ]),
      );
    },
    async rehomeSeedRows(datasetId, caseIds) {
      if (caseIds.length === 0) return 0;
      // In-place UPDATE: row ids preserved (eval_results FK history and
      // trend queries survive); source deliberately untouched.
      const updated = await db
        .update(evalTestCases)
        .set({
          dataset_id: datasetId,
          dataset_case_id: sql`${evalTestCases.name}`,
          updated_at: new Date(),
        })
        .where(
          and(
            eq(evalTestCases.tenant_id, tenantId),
            eq(evalTestCases.source, BUILT_IN_EVAL_SEED_SOURCE),
            isNull(evalTestCases.dataset_id),
            inArray(evalTestCases.name, caseIds),
          ),
        )
        .returning({ id: evalTestCases.id });
      return updated.length;
    },
    async listLinkedCaseIds(datasetId) {
      const rows = await db
        .select({ caseId: evalTestCases.dataset_case_id })
        .from(evalTestCases)
        .where(eq(evalTestCases.dataset_id, datasetId));
      return new Set(
        rows
          .map((r) => r.caseId)
          .filter((c): c is string => typeof c === "string"),
      );
    },
    async insertSeedRows(datasetId, rows) {
      if (rows.length === 0) return 0;
      // onConflictDoNothing() with no target = Postgres generic unique-
      // violation handling — absorbs both uq_eval_test_cases_tenant_seed_name
      // (the rollback guard) and uq_eval_test_cases_dataset_case races.
      const inserted = await db
        .insert(evalTestCases)
        .values(
          rows.map((r) => ({
            tenant_id: tenantId,
            dataset_id: datasetId,
            dataset_case_id: r.dataset_case_id,
            name: r.name,
            category: r.category,
            query: r.query,
            system_prompt: r.system_prompt,
            assertions: r.assertions,
            tags: r.tags,
            agentcore_evaluator_ids: r.agentcore_evaluator_ids,
            enabled: r.enabled,
            source: BUILT_IN_EVAL_SEED_SOURCE,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: evalTestCases.id });
      return inserted.length;
    },
  };
}

/**
 * Production entry point: resolve the tenant slug (row-derived, never
 * caller-supplied), wire S3 + Drizzle deps, and run the seeder. Both
 * seed entry points (`ensureTenantSeeded` lazy path and the
 * `seedEvalTestCases` mutation) route through here — the legacy direct
 * DB-insert path is retired (U5).
 */
export async function ensureBaselineDatasetSeeded(
  tenantId: string,
  opts: { categories?: string[] | null } = {},
): Promise<BaselineSeedResult> {
  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  if (!tenant?.slug) {
    // Slugless tenants have no S3 namespace (same skip rule as
    // seed-workspace-defaults.ts). Nothing to seed against.
    console.warn(
      `[baseline-dataset] tenant ${tenantId} has no slug; skipping baseline seeding`,
    );
    return { action: "skipped", addedCaseIds: [], rehomed: 0, inserted: 0 };
  }
  const bucket = getConfig("WORKSPACE_BUCKET");
  if (!bucket) {
    throw new Error("WORKSPACE_BUCKET environment variable is required");
  }
  const client = new S3Client({
    region:
      process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
  });
  return seedBaselineDataset(
    { tenantId, tenantSlug: tenant.slug },
    {
      storage: createS3DatasetStorage({ client, bucket }),
      store: createDrizzleDatasetIndexStore(),
      index: createDrizzleBaselineIndexOps(tenantId),
    },
    { categories: opts.categories ?? null },
  );
}
