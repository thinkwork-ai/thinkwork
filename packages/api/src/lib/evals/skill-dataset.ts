/**
 * Per-skill eval dataset seeder (Skill Tests & Evals U1, inert substrate).
 *
 * A skill carries eval cases in its catalog folder (convention:
 * `evals/*.json`, one case per file). On install/update (U2) those files
 * are read and handed here, which materializes them into a per-skill
 * dataset of a new `skill` kind at
 * `tenants/<tenant-slug>/eval-datasets/skill-<skill-slug>/` and syncs the
 * derived index — reusing the THNK-2 dataset substrate (manifest +
 * `cases/<case_id>.json` + `.gitkeep` sentinel + `syncEvalDatasetFromS3`
 * under the per-(tenant,slug) advisory lock) unchanged. No new dataset
 * table, no second scoring path.
 *
 * Invariants honored here:
 *  - **Author content is untrusted.** Each bundled case file is
 *    size-capped, JSON/schema-validated, and its case id is checked
 *    against the dataset-slug regex BEFORE it is used as an S3 key
 *    segment (path-traversal guard). A bad case is skipped with a
 *    diagnostic — never seeded as an empty/partial case, never able to
 *    abort the whole sync (one malformed file can't DOS a skill install).
 *  - **Seeder authority is scoped to bundled cases.** Cases written here
 *    carry the `origin:bundled` tag; the marker records their ids. On
 *    re-sync the seeder reconciles ONLY that set — operator-flagged cases
 *    added to the same dataset later (U8) are never tombstoned by a skill
 *    re-sync, so the compounding eval set survives author updates.
 *  - **Re-sync is idempotent.** A content-sha marker short-circuits an
 *    unchanged bundled set to a no-op (no S3 writes, no index churn);
 *    `syncEvalDatasetFromS3`'s own manifest_sha guard is the second line.
 *  - **Removal tombstones, never deletes.** A bundled case dropped in a
 *    newer skill version is tombstoned (manifest tombstone + S3 payload
 *    deleted + index row flipped enabled=false), so historical
 *    eval_results keep resolving.
 */

import { getConfig } from "@thinkwork/runtime-config";
import { S3Client } from "@aws-sdk/client-s3";
import { db, eq, tenants } from "../../graphql/utils.js";
import {
  archiveEvalDataset,
  assertValidDatasetSlug,
  computeEvalCaseSha,
  createDrizzleDatasetIndexStore,
  createS3DatasetStorage,
  EVAL_DATASET_SLUG_RE,
  evalDatasetCaseKey,
  evalDatasetCasePayloadPrefix,
  evalDatasetManifestKey,
  evalDatasetSentinelKey,
  evalDatasetPrefix,
  parseEvalDatasetManifest,
  serializeEvalDatasetCase,
  serializeEvalDatasetManifest,
  sha256Hex,
  syncEvalDatasetFromS3,
  type DatasetContext,
  type DatasetIndexStore,
  type DatasetStorage,
  type EvalDatasetCaseCore,
  type EvalDatasetManifest,
} from "./dataset-store.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Per-skill datasets live at slug `skill-<skill-slug>`. */
export const SKILL_DATASET_SLUG_PREFIX = "skill-";

/**
 * Tag stamped on every author-bundled case. Distinguishes the seeder's
 * reconciliation set from operator-flagged cases (U8) that share the
 * dataset but must survive a skill re-sync.
 */
export const BUNDLED_CASE_TAG = "origin:bundled";

/** Default category for a bundled skill case that names none. */
export const SKILL_CASE_DEFAULT_CATEGORY = "skill-eval";

/**
 * Convention for where bundled cases live inside a skill folder. A case
 * is `evals/<name>.json` (one case per file). Exported so the U2 install
 * path enumerates the same place.
 */
export const SKILL_EVAL_CASE_DIR = "evals";

/**
 * Hard caps on untrusted author content. A bundled case is a query +
 * rubric (+ optional small assertion list) — kilobytes, not megabytes.
 * Over the byte cap or the count cap, the offending input is skipped with
 * a diagnostic rather than allowed to bloat the dataset.
 */
export const MAX_SKILL_EVAL_CASE_BYTES = 64 * 1024;
export const MAX_SKILL_EVAL_CASES = 200;

/** Marker object recording the last-synced bundled set (no-op short-circuit). */
const VERSION_MARKER_FILE = "_skill_eval";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Skill catalog → dataset slug. Validated (path-traversal / length). */
export function skillEvalDatasetSlug(skillSlug: string): string {
  const slug = `${SKILL_DATASET_SLUG_PREFIX}${skillSlug}`;
  // skill-<slug> must satisfy the dataset slug regex (max 64) — a skill
  // slug that overflows the budget is a real misconfiguration, surfaced
  // loudly rather than silently truncated into a colliding key.
  assertValidDatasetSlug(slug);
  return slug;
}

/**
 * Suffix on the live skill dataset slug for the TRANSIENT candidate
 * staging dataset (Skill Tests & Evals U6). A gated UPDATE scores the
 * candidate version's cases against this staging slug WITHOUT mutating the
 * installed version's `skill-<slug>` dataset or its score — the swap (and
 * promotion of the staging dataset to the live slug) happens only after
 * the gate passes. The suffix keeps the staging dataset inside the guarded
 * `skill-` namespace (`isSkillDatasetSlug` stays true), and the slug is
 * validated (length budget: `skill-` + `-candidate` = 16 chars overhead).
 */
export const SKILL_CANDIDATE_DATASET_SUFFIX = "-candidate";

/** Live skill dataset slug → candidate staging dataset slug. Validated. */
export function skillCandidateDatasetSlug(skillSlug: string): string {
  const slug = `${skillEvalDatasetSlug(skillSlug)}${SKILL_CANDIDATE_DATASET_SUFFIX}`;
  // The candidate slug is also an S3 key segment — guard length/charset.
  assertValidDatasetSlug(slug);
  return slug;
}

/** True for a dataset slug produced by skillEvalDatasetSlug. */
export function isSkillDatasetSlug(slug: string): boolean {
  return slug.startsWith(SKILL_DATASET_SLUG_PREFIX);
}

/** One raw bundled case file as read from the skill folder. */
export interface SkillCaseInput {
  /** File name (e.g. "refuses-destructive-sql.json") — id source + diagnostics. */
  fileName: string;
  /** Raw UTF-8 file content. */
  content: string;
}

export interface SkillDatasetSeedDeps {
  storage: DatasetStorage;
  store: DatasetIndexStore;
}

export interface SkillCaseSkip {
  fileName: string;
  reason: string;
}

export interface SkillDatasetSeedResult {
  action: "seeded" | "current" | "skipped";
  datasetSlug: string;
  /** Bundled case ids added this run. */
  addedCaseIds: string[];
  /** Bundled case ids whose content changed this run. */
  updatedCaseIds: string[];
  /** Bundled case ids tombstoned this run (dropped by the author). */
  removedCaseIds: string[];
  /** Inputs rejected by validation (with reasons) — surfaced, never silent. */
  skipped: SkillCaseSkip[];
  /** Live bundled case count after this run. */
  bundledCaseCount: number;
}

// ---------------------------------------------------------------------------
// Author case-file validation → engine-neutral dataset case
// ---------------------------------------------------------------------------

interface ValidatedCase {
  core: EvalDatasetCaseCore;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function caseIdFromFileName(fileName: string): string {
  // Strip a single trailing .json (case-insensitive) and any directory.
  const base = fileName.split("/").pop() ?? fileName;
  return base.replace(/\.json$/i, "");
}

/** Normalize an author-supplied assertion entry to the strict shape. */
function normalizeAuthorAssertion(raw: unknown): {
  type: string;
  value?: string | null;
  path?: string | null;
} | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.type !== "string" || raw.type.length === 0) return null;
  const out: { type: string; value?: string | null; path?: string | null } = {
    type: raw.type,
  };
  if (typeof raw.value === "string") out.value = raw.value;
  if (typeof raw.path === "string") out.path = raw.path;
  return out;
}

/**
 * Validate one bundled case file. Returns the engine-neutral case on
 * success, or a skip reason. Never throws on author content — the seeder
 * collects skips and keeps going.
 */
export function validateSkillCaseInput(
  input: SkillCaseInput,
  skillSlug: string,
): ValidatedCase | { skip: string } {
  if (Buffer.byteLength(input.content, "utf8") > MAX_SKILL_EVAL_CASE_BYTES) {
    return { skip: `exceeds ${MAX_SKILL_EVAL_CASE_BYTES}-byte case cap` };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(input.content);
  } catch (e) {
    return { skip: `not JSON (${e instanceof Error ? e.message : e})` };
  }
  if (!isRecord(raw)) return { skip: "not a JSON object" };

  // case_id: author-supplied field wins, else the file stem. Validated
  // against the tighter dataset-slug regex (path-traversal guard) BEFORE
  // it can become an S3 key segment.
  const rawCaseId =
    typeof raw.case_id === "string" && raw.case_id.length > 0
      ? raw.case_id
      : caseIdFromFileName(input.fileName);
  if (!EVAL_DATASET_SLUG_RE.test(rawCaseId)) {
    return {
      skip: `invalid case id "${rawCaseId}" (must match ${EVAL_DATASET_SLUG_RE})`,
    };
  }

  if (typeof raw.query !== "string" || raw.query.trim().length === 0) {
    return { skip: "missing required field: query" };
  }

  // Scoring signal: a rubric (resolution target) → llm-rubric assertion,
  // plus any explicit author assertions. A case with neither is
  // unscorable by the in-house judge — skip rather than seed a no-op case.
  const rubric =
    typeof raw.rubric === "string" && raw.rubric.trim().length > 0
      ? raw.rubric
      : typeof raw.resolution_target === "string" &&
          raw.resolution_target.trim().length > 0
        ? raw.resolution_target
        : null;
  const authorAssertions = Array.isArray(raw.assertions)
    ? raw.assertions
        .map(normalizeAuthorAssertion)
        .filter((a): a is NonNullable<typeof a> => a !== null)
    : [];
  const assertions: unknown[] = [];
  if (rubric) assertions.push({ type: "llm-rubric", value: rubric });
  assertions.push(...authorAssertions);
  if (assertions.length === 0) {
    return { skip: "no rubric/resolution_target and no valid assertions" };
  }

  const authorTags = Array.isArray(raw.tags)
    ? raw.tags.filter((t): t is string => typeof t === "string")
    : [];
  const tags = Array.from(
    new Set([BUNDLED_CASE_TAG, `skill:${skillSlug}`, ...authorTags]),
  );

  const core: EvalDatasetCaseCore = {
    case_id: rawCaseId,
    name:
      typeof raw.name === "string" && raw.name.length > 0
        ? raw.name
        : rawCaseId,
    category:
      typeof raw.category === "string" && raw.category.length > 0
        ? raw.category
        : SKILL_CASE_DEFAULT_CATEGORY,
    query: raw.query,
    system_prompt:
      typeof raw.system_prompt === "string" ? raw.system_prompt : null,
    expected_behavior:
      typeof raw.expected_behavior === "string" ? raw.expected_behavior : null,
    assertions,
    tags,
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
  };
  // Round-trip the rubric as resolution_target so the UI can render what
  // "fixed" means without re-parsing the assertion list.
  if (rubric) core.resolution_target = rubric;

  return { core };
}

// ---------------------------------------------------------------------------
// Marker — records the last-synced bundled set for the no-op short-circuit
// ---------------------------------------------------------------------------

interface SkillEvalMarker {
  cases_sha: string;
  bundled_case_ids: string[];
}

function skillEvalMarkerKey(tenantSlug: string, datasetSlug: string): string {
  return `${evalDatasetPrefix(tenantSlug, datasetSlug)}${VERSION_MARKER_FILE}`;
}

function parseMarker(content: string | null): SkillEvalMarker | null {
  if (content == null) return null;
  try {
    const raw = JSON.parse(content) as Record<string, unknown>;
    if (typeof raw.cases_sha !== "string") return null;
    return {
      cases_sha: raw.cases_sha,
      bundled_case_ids: Array.isArray(raw.bundled_case_ids)
        ? raw.bundled_case_ids.filter((c): c is string => typeof c === "string")
        : [],
    };
  } catch {
    return null;
  }
}

/** Deterministic sha over the validated bundled set (sorted by case id). */
function computeBundledSetSha(cases: ValidatedCase[]): string {
  const entries = cases
    .map((c) => {
      const content = serializeEvalDatasetCase(c.core, null);
      return [c.core.case_id, computeEvalCaseSha(content)] as const;
    })
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return sha256Hex(JSON.stringify(entries));
}

// ---------------------------------------------------------------------------
// Seeder — validate, reconcile bundled set, sync index
// ---------------------------------------------------------------------------

export async function seedSkillDataset(
  ctx: {
    tenantId: string;
    tenantSlug: string;
    skillSlug: string;
    /**
     * Dataset slug override (Skill Tests & Evals U6). Defaults to the
     * live `skill-<slug>` dataset; the gated-update path passes the
     * candidate staging slug (`skillCandidateDatasetSlug`) so the
     * candidate's cases land in the transient staging dataset WITHOUT
     * touching the installed version's live dataset. Validated as an S3
     * key segment.
     */
    datasetSlug?: string;
  },
  inputs: SkillCaseInput[],
  deps: SkillDatasetSeedDeps,
): Promise<SkillDatasetSeedResult> {
  const datasetSlug = ctx.datasetSlug ?? skillEvalDatasetSlug(ctx.skillSlug);
  assertValidDatasetSlug(datasetSlug);
  const dctx: DatasetContext = {
    tenantId: ctx.tenantId,
    tenantSlug: ctx.tenantSlug,
    slug: datasetSlug,
  };

  // 1. Validate untrusted author content. Collect skips; cap the count.
  const skipped: SkillCaseSkip[] = [];
  const valid: ValidatedCase[] = [];
  const seenIds = new Set<string>();
  for (const input of inputs) {
    if (valid.length >= MAX_SKILL_EVAL_CASES) {
      skipped.push({
        fileName: input.fileName,
        reason: `exceeds ${MAX_SKILL_EVAL_CASES}-case cap`,
      });
      continue;
    }
    const result = validateSkillCaseInput(input, ctx.skillSlug);
    if ("skip" in result) {
      skipped.push({ fileName: input.fileName, reason: result.skip });
      continue;
    }
    if (seenIds.has(result.core.case_id)) {
      skipped.push({
        fileName: input.fileName,
        reason: `duplicate case id "${result.core.case_id}"`,
      });
      continue;
    }
    seenIds.add(result.core.case_id);
    valid.push(result);
  }

  const desired = new Map<string, ValidatedCase>(
    valid.map((c) => [c.core.case_id, c]),
  );
  const casesSha = computeBundledSetSha(valid);

  // 2. Existing manifest + marker.
  const manifestKey = evalDatasetManifestKey(ctx.tenantSlug, datasetSlug);
  const manifestContent = await deps.storage.read(manifestKey);
  const isNewDataset = manifestContent == null;
  const marker = parseMarker(
    await deps.storage.read(skillEvalMarkerKey(ctx.tenantSlug, datasetSlug)),
  );

  // No valid cases AND no existing dataset → unrated, create nothing
  // (R3: unrated is a neutral state, not an empty/broken dataset).
  if (valid.length === 0 && isNewDataset) {
    return {
      action: "skipped",
      datasetSlug,
      addedCaseIds: [],
      updatedCaseIds: [],
      removedCaseIds: [],
      skipped,
      bundledCaseCount: 0,
    };
  }

  // Unchanged bundled set on an existing dataset → no-op, UNLESS the
  // dataset was archived (skill had been uninstalled): a re-install with
  // identical cases must reactivate it.
  if (!isNewDataset && marker && marker.cases_sha === casesSha) {
    const current = parseEvalDatasetManifest(manifestContent);
    if (!current.archived_at) {
      return {
        action: "current",
        datasetSlug,
        addedCaseIds: [],
        updatedCaseIds: [],
        removedCaseIds: [],
        skipped,
        bundledCaseCount: desired.size,
      };
    }
    current.archived_at = null;
    current.version += 1;
    current.updated_at = new Date().toISOString();
    await deps.storage.write(
      manifestKey,
      serializeEvalDatasetManifest(current),
    );
    await syncEvalDatasetFromS3(dctx, deps.storage, deps.store, {
      force: true,
    });
    return {
      action: "seeded",
      datasetSlug,
      addedCaseIds: [],
      updatedCaseIds: [],
      removedCaseIds: [],
      skipped,
      bundledCaseCount: desired.size,
    };
  }

  const manifest: EvalDatasetManifest = isNewDataset
    ? {
        slug: datasetSlug,
        name: `Skill: ${ctx.skillSlug}`,
        kind: "skill",
        version: 0, // bumped on write below
        updated_at: new Date().toISOString(),
        archived_at: null,
        cases: [],
        tombstones: [],
      }
    : parseEvalDatasetManifest(manifestContent);

  const liveById = new Map(manifest.cases.map((c) => [c.case_id, c]));
  // Cases the seeder previously owned. Marker is authoritative; absent
  // marker (first sync over a pre-existing dataset) → own nothing yet, so
  // a stale removal heals on the next sync once the marker exists.
  const prevBundled = new Set(marker?.bundled_case_ids ?? []);

  const addedCaseIds: string[] = [];
  const updatedCaseIds: string[] = [];

  // 3. Add / update each desired bundled case (S3 first).
  for (const [caseId, c] of desired) {
    const content = serializeEvalDatasetCase(c.core, null);
    const contentSha = computeEvalCaseSha(content);
    const existing = liveById.get(caseId);
    if (existing && existing.content_sha === contentSha) continue; // no churn
    await deps.storage.write(
      evalDatasetCaseKey(ctx.tenantSlug, datasetSlug, caseId),
      content,
    );
    if (existing) {
      existing.content_sha = contentSha;
      updatedCaseIds.push(caseId);
    } else {
      manifest.cases.push({ case_id: caseId, content_sha: contentSha });
      addedCaseIds.push(caseId);
    }
    // Re-adding a previously tombstoned bundled case clears its tombstone.
    manifest.tombstones = manifest.tombstones.filter(
      (t) => t.case_id !== caseId,
    );
  }

  // 4. Tombstone bundled cases the author dropped — ONLY ones the seeder
  //    owned (prevBundled). Operator-flagged / non-bundled cases are never
  //    touched here, so the compounding eval set survives skill updates.
  const removedCaseIds: string[] = [];
  for (const caseId of prevBundled) {
    if (desired.has(caseId)) continue;
    if (!liveById.has(caseId)) continue; // already gone
    // S3 first: delete payload(s) then the case object, then tombstone.
    const payloadPrefix = evalDatasetCasePayloadPrefix(
      ctx.tenantSlug,
      datasetSlug,
      caseId,
    );
    for (const key of await deps.storage.list(payloadPrefix)) {
      await deps.storage.delete(key);
    }
    await deps.storage.delete(
      evalDatasetCaseKey(ctx.tenantSlug, datasetSlug, caseId),
    );
    manifest.cases = manifest.cases.filter((c) => c.case_id !== caseId);
    manifest.tombstones = [
      ...manifest.tombstones.filter((t) => t.case_id !== caseId),
      { case_id: caseId, removed_at: new Date().toISOString() },
    ];
    removedCaseIds.push(caseId);
  }

  // 5. Sentinel (empty-folder materialization) + manifest write. A
  //    content-changing (re)install reactivates a previously-archived
  //    (uninstalled) dataset.
  if (isNewDataset) {
    await deps.storage.write(
      evalDatasetSentinelKey(ctx.tenantSlug, datasetSlug),
      "",
    );
  }
  manifest.archived_at = null;
  manifest.version += 1;
  manifest.updated_at = new Date().toISOString();
  await deps.storage.write(manifestKey, serializeEvalDatasetManifest(manifest));

  // 6. Full-state index sync (advisory-locked inside the store).
  await syncEvalDatasetFromS3(dctx, deps.storage, deps.store, { force: true });

  // 7. Marker — records the bundled set so the next re-sync can no-op and
  //    knows exactly which cases it owns for tombstoning.
  const newMarker: SkillEvalMarker = {
    cases_sha: casesSha,
    bundled_case_ids: [...desired.keys()].sort(),
  };
  await deps.storage.write(
    skillEvalMarkerKey(ctx.tenantSlug, datasetSlug),
    JSON.stringify(newMarker),
  );

  return {
    action: "seeded",
    datasetSlug,
    addedCaseIds,
    updatedCaseIds,
    removedCaseIds,
    skipped,
    bundledCaseCount: desired.size,
  };
}

// ---------------------------------------------------------------------------
// Production wiring — resolve tenant slug, wire S3 + Drizzle deps
// ---------------------------------------------------------------------------

/**
 * Production entry point. The caller (U2 install/update path) reads the
 * skill folder's `evals/*.json` files and passes them as `inputs`; this
 * resolves the tenant slug (row-derived, never caller-supplied), wires S3
 * + Drizzle, and runs the seeder. A slugless tenant has no S3 namespace —
 * same skip rule as the baseline seeder.
 */
export async function ensureSkillDatasetSeeded(
  tenantId: string,
  skillSlug: string,
  inputs: SkillCaseInput[],
  /**
   * Dataset slug override (Skill Tests & Evals U6) — defaults to the live
   * `skill-<slug>` dataset. The gated-update path passes the candidate
   * staging slug so the candidate's cases are scored without mutating the
   * installed version's live dataset.
   */
  datasetSlug: string = skillEvalDatasetSlug(skillSlug),
): Promise<SkillDatasetSeedResult> {
  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  if (!tenant?.slug) {
    console.warn(
      `[skill-dataset] tenant ${tenantId} has no slug; skipping skill eval seeding for ${skillSlug}`,
    );
    return {
      action: "skipped",
      datasetSlug,
      addedCaseIds: [],
      updatedCaseIds: [],
      removedCaseIds: [],
      skipped: [],
      bundledCaseCount: 0,
    };
  }
  const bucket = getConfig("WORKSPACE_BUCKET");
  if (!bucket) {
    throw new Error("WORKSPACE_BUCKET environment variable is required");
  }
  const client = new S3Client({
    region:
      process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
  });
  return seedSkillDataset(
    { tenantId, tenantSlug: tenant.slug, skillSlug, datasetSlug },
    inputs,
    {
      storage: createS3DatasetStorage({ client, bucket }),
      store: createDrizzleDatasetIndexStore(),
    },
  );
}

/**
 * Soft-archive a skill's eval dataset when the skill is uninstalled
 * (history intact — never hard-deleted; a later re-install reactivates
 * it). No-op when the dataset doesn't exist (unrated skill) or is already
 * archived.
 *
 * One-agent assumption: skill datasets are tenant+skill scoped while skill
 * install/uninstall is per-agent. The current product runs a single
 * shared platform agent per tenant, so an uninstall means the tenant no
 * longer uses the skill. If multi-agent-per-tenant ever returns, this
 * must first check whether any OTHER agent still has the skill installed
 * before archiving.
 */
export async function archiveSkillDatasetIfExists(
  tenantId: string,
  skillSlug: string,
  /**
   * Dataset slug override (Skill Tests & Evals U6) — defaults to the live
   * `skill-<slug>` dataset. The gated-update path passes the candidate
   * staging slug to archive the TRANSIENT staging dataset once a held
   * update is applied/promoted (or abandoned) without touching the live
   * dataset.
   */
  datasetSlug: string = skillEvalDatasetSlug(skillSlug),
): Promise<{ action: "archived" | "absent" | "already-archived" }> {
  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  if (!tenant?.slug) return { action: "absent" };
  const bucket = getConfig("WORKSPACE_BUCKET");
  if (!bucket) {
    throw new Error("WORKSPACE_BUCKET environment variable is required");
  }
  const client = new S3Client({
    region:
      process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
  });
  const storage = createS3DatasetStorage({ client, bucket });
  const store = createDrizzleDatasetIndexStore();
  const manifestContent = await storage.read(
    evalDatasetManifestKey(tenant.slug, datasetSlug),
  );
  if (manifestContent == null) return { action: "absent" };
  if (parseEvalDatasetManifest(manifestContent).archived_at) {
    return { action: "already-archived" };
  }
  await archiveEvalDataset(
    { tenantId, tenantSlug: tenant.slug, slug: datasetSlug },
    storage,
    store,
  );
  return { action: "archived" };
}

/**
 * Archive a skill's TRANSIENT candidate staging dataset (Skill Tests &
 * Evals U6). Thin wrapper passing the candidate slug to
 * `archiveSkillDatasetIfExists` — used by the apply path to retire the
 * staging dataset once the held update is promoted, and defensively after
 * a gated launch so an abandoned candidate doesn't linger as a live row.
 */
export async function archiveSkillCandidateDataset(
  tenantId: string,
  skillSlug: string,
): Promise<{ action: "archived" | "absent" | "already-archived" }> {
  return archiveSkillDatasetIfExists(
    tenantId,
    skillSlug,
    skillCandidateDatasetSlug(skillSlug),
  );
}
