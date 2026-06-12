/**
 * Eval dataset store — S3-canonical versioned per-tenant eval datasets
 * (Evaluations Trust Core U4, inert substrate).
 *
 * Layout (workspace bucket, mirrors the skill-catalog trio in
 * workspace-files.ts / catalog-index.ts):
 *
 *   tenants/<tenant-slug>/eval-datasets/<dataset-slug>/
 *     dataset.json          — manifest: slug, name, kind, version,
 *                             updated_at, case index + tombstones
 *     cases/<case_id>.json  — one engine-neutral case file per case
 *     .gitkeep              — sentinel so empty datasets materialize
 *                             (docs/solutions/design-patterns/gitkeep-
 *                             materialization-s3-empty-folders-2026-05-13.md)
 *
 * Invariants honored here:
 *  - S3 is canonical; the DB index (eval_datasets + eval_test_cases) is a
 *    derived projection that must be fully reconstructible from S3 alone.
 *  - Every mutation writes S3 FIRST, then re-syncs full dataset state
 *    (not a delta) into the index under a per-(tenant, slug) advisory
 *    lock (mirrors catalog-index.ts).
 *  - Case removal is a manifest tombstone + enabled=false on the index
 *    row — NEVER a row delete (eval_results FK the rows for trend
 *    history). The S3 case payload object IS deleted.
 *  - Dataset deletion is a soft archive (archived_at in manifest + row);
 *    result history stays intact.
 *  - Core case fields are engine-neutral; engine-specific evaluator
 *    selections live only in the namespaced `engines` extension block
 *    and the core schema parses with that block stripped.
 *
 * Security note: this prefix holds red-team answer keys and (from U7)
 * flagged-thread snapshots. It must never be agent-readable — the
 * enforcement layer is the explicit IAM Deny on
 * `tenants/*\/eval-datasets/*` attached to the Pi runtime role
 * (terraform/modules/app/agentcore-pi/main.tf); the key builders here are
 * the app-level companion and only ever produce keys under the guarded
 * prefix.
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import {
  and,
  db,
  eq,
  evalDatasets,
  evalTestCases,
  sql,
} from "../../graphql/utils.js";

// ---------------------------------------------------------------------------
// Slug / case-id validation
// ---------------------------------------------------------------------------

/**
 * Explicit allowlist regex — precedent: SUB_AGENT_SLUG_RE in
 * packages/api/workspace-files.ts:1398 (same alphabet, longer budget).
 * Rejects traversal (`../escape`), uppercase, and overlong ids by
 * construction; ids are used verbatim as S3 key segments.
 */
export const EVAL_DATASET_SLUG_RE = /^[a-z][a-z0-9-]{0,63}$/;

export function assertValidDatasetSlug(slug: string): void {
  if (!EVAL_DATASET_SLUG_RE.test(slug)) {
    throw new Error(
      `Invalid dataset slug "${slug}": must start with a lowercase letter and contain only a-z, 0-9, and hyphens (max 64 chars).`,
    );
  }
}

export function assertValidCaseId(caseId: string): void {
  if (!EVAL_DATASET_SLUG_RE.test(caseId)) {
    throw new Error(
      `Invalid case id "${caseId}": must start with a lowercase letter and contain only a-z, 0-9, and hyphens (max 64 chars).`,
    );
  }
}

// ---------------------------------------------------------------------------
// Key builders (every key lives under the guarded eval-datasets prefix)
// ---------------------------------------------------------------------------

const SENTINEL_FILE = ".gitkeep";
const MANIFEST_FILE = "dataset.json";

export function evalDatasetsRootPrefix(tenantSlug: string): string {
  return `tenants/${tenantSlug}/eval-datasets/`;
}

export function evalDatasetPrefix(
  tenantSlug: string,
  datasetSlug: string,
): string {
  return `${evalDatasetsRootPrefix(tenantSlug)}${datasetSlug}/`;
}

export function evalDatasetManifestKey(
  tenantSlug: string,
  datasetSlug: string,
): string {
  return `${evalDatasetPrefix(tenantSlug, datasetSlug)}${MANIFEST_FILE}`;
}

export function evalDatasetSentinelKey(
  tenantSlug: string,
  datasetSlug: string,
): string {
  return `${evalDatasetPrefix(tenantSlug, datasetSlug)}${SENTINEL_FILE}`;
}

export function evalDatasetCaseKey(
  tenantSlug: string,
  datasetSlug: string,
  caseId: string,
): string {
  return `${evalDatasetPrefix(tenantSlug, datasetSlug)}cases/${caseId}.json`;
}

/**
 * True when a bucket key sits inside any tenant's eval-datasets prefix.
 * Used by guard tests: workspace target families (agents/, users/,
 * threads/, skill-catalog/, spaces) must never resolve under it; the IAM
 * Deny on the Pi runtime role is the enforcement layer.
 */
export function isEvalDatasetsKey(key: string): boolean {
  return /^tenants\/[^/]+\/eval-datasets\//.test(key);
}

// ---------------------------------------------------------------------------
// Canonical formats — manifest + case file
// ---------------------------------------------------------------------------

export type EvalDatasetKind = "baseline" | "custom";

export interface EvalDatasetCaseRef {
  case_id: string;
  content_sha: string;
}

export interface EvalDatasetTombstone {
  case_id: string;
  removed_at: string;
}

export interface EvalDatasetManifest {
  slug: string;
  name: string | null;
  kind: EvalDatasetKind;
  version: number;
  updated_at: string;
  archived_at: string | null;
  /** Live case index: stable case ids + content shas. */
  cases: EvalDatasetCaseRef[];
  /**
   * Removed cases. Index rows for these stay (enabled=false) so
   * historical eval_results keep resolving; S3 payloads are deleted.
   */
  tombstones: EvalDatasetTombstone[];
}

/**
 * Engine-neutral core case fields. The canonical format never references
 * engine vocabulary — engine-specific evaluator selections (today's
 * agentcore_evaluator_ids) live only in the `engines` extension block.
 */
export interface EvalDatasetCaseCore {
  case_id: string;
  name: string;
  category: string;
  query: string;
  system_prompt: string | null;
  expected_behavior: string | null;
  assertions: unknown[];
  tags: string[];
  enabled: boolean;
}

export interface EvalDatasetCaseEngines {
  agentcore?: { evaluator_ids?: string[] };
  [engine: string]: unknown;
}

export interface EvalDatasetCaseFile extends EvalDatasetCaseCore {
  engines?: EvalDatasetCaseEngines;
}

export interface ParsedEvalDatasetCase {
  core: EvalDatasetCaseCore;
  engines: EvalDatasetCaseEngines | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse a case file into core + extension block. The core schema must
 * parse with the `engines` block stripped — engine concepts never leak
 * into core types (U10's boundary test extends this guarantee).
 */
export function parseEvalDatasetCase(content: string): ParsedEvalDatasetCase {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (e) {
    throw new Error(
      `Invalid case file: not JSON (${e instanceof Error ? e.message : e})`,
    );
  }
  if (!isRecord(raw)) throw new Error("Invalid case file: not an object");

  const { engines, ...rest } = raw as Record<string, unknown>;

  for (const field of ["case_id", "name", "category", "query"] as const) {
    if (typeof rest[field] !== "string" || rest[field].length === 0) {
      throw new Error(`Invalid case file: missing required field ${field}`);
    }
  }

  const core: EvalDatasetCaseCore = {
    case_id: rest.case_id as string,
    name: rest.name as string,
    category: rest.category as string,
    query: rest.query as string,
    system_prompt:
      typeof rest.system_prompt === "string" ? rest.system_prompt : null,
    expected_behavior:
      typeof rest.expected_behavior === "string"
        ? rest.expected_behavior
        : null,
    assertions: Array.isArray(rest.assertions) ? rest.assertions : [],
    tags: Array.isArray(rest.tags)
      ? rest.tags.filter((t): t is string => typeof t === "string")
      : [],
    enabled: typeof rest.enabled === "boolean" ? rest.enabled : true,
  };

  return {
    core,
    engines: isRecord(engines) ? (engines as EvalDatasetCaseEngines) : null,
  };
}

export function serializeEvalDatasetCase(
  core: EvalDatasetCaseCore,
  engines: EvalDatasetCaseEngines | null,
): string {
  const file: EvalDatasetCaseFile = { ...core };
  if (engines && Object.keys(engines).length > 0) file.engines = engines;
  return JSON.stringify(file, null, 2);
}

export function serializeEvalDatasetManifest(
  manifest: EvalDatasetManifest,
): string {
  // Stable field order: serialize through an explicit shape so the
  // manifest sha is deterministic for identical logical content.
  const ordered: EvalDatasetManifest = {
    slug: manifest.slug,
    name: manifest.name,
    kind: manifest.kind,
    version: manifest.version,
    updated_at: manifest.updated_at,
    archived_at: manifest.archived_at,
    cases: [...manifest.cases]
      .sort((a, b) => (a.case_id < b.case_id ? -1 : 1))
      .map((c) => ({ case_id: c.case_id, content_sha: c.content_sha })),
    tombstones: [...manifest.tombstones]
      .sort((a, b) => (a.case_id < b.case_id ? -1 : 1))
      .map((t) => ({ case_id: t.case_id, removed_at: t.removed_at })),
  };
  return JSON.stringify(ordered, null, 2);
}

export function parseEvalDatasetManifest(content: string): EvalDatasetManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (e) {
    throw new Error(
      `Invalid dataset manifest: not JSON (${e instanceof Error ? e.message : e})`,
    );
  }
  if (!isRecord(raw))
    throw new Error("Invalid dataset manifest: not an object");
  if (typeof raw.slug !== "string" || !raw.slug) {
    throw new Error("Invalid dataset manifest: missing slug");
  }
  const kind = raw.kind === "baseline" ? "baseline" : "custom";
  return {
    slug: raw.slug,
    name: typeof raw.name === "string" ? raw.name : null,
    kind,
    version: typeof raw.version === "number" ? raw.version : 1,
    updated_at:
      typeof raw.updated_at === "string"
        ? raw.updated_at
        : new Date(0).toISOString(),
    archived_at: typeof raw.archived_at === "string" ? raw.archived_at : null,
    cases: Array.isArray(raw.cases)
      ? raw.cases.filter(
          (c): c is EvalDatasetCaseRef =>
            isRecord(c) &&
            typeof c.case_id === "string" &&
            typeof c.content_sha === "string",
        )
      : [],
    tombstones: Array.isArray(raw.tombstones)
      ? raw.tombstones.filter(
          (t): t is EvalDatasetTombstone =>
            isRecord(t) && typeof t.case_id === "string",
        )
      : [],
  };
}

// ---------------------------------------------------------------------------
// Content sha helpers (mirror computeCatalogSkillSha in catalog-skill-sha.ts)
// ---------------------------------------------------------------------------

export function sha256Hex(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Content sha of one case payload — stamped into the manifest case index. */
export function computeEvalCaseSha(content: string): string {
  return sha256Hex(content);
}

/** Sha of the serialized manifest — the index drift detector's key. */
export function computeEvalDatasetManifestSha(
  manifest: EvalDatasetManifest,
): string {
  return sha256Hex(serializeEvalDatasetManifest(manifest));
}

// ---------------------------------------------------------------------------
// Storage + index interfaces (unit-testable with fakes; production wiring
// below uses S3Client + Drizzle, mirroring catalog-index.ts)
// ---------------------------------------------------------------------------

/** Object-store surface for the dataset prefix. Keys are absolute bucket keys. */
export interface DatasetStorage {
  read(key: string): Promise<string | null>;
  write(key: string, content: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

/** eval_datasets projection row. */
export interface DatasetIndexRow {
  id: string;
  tenant_id: string;
  slug: string;
  name: string | null;
  kind: EvalDatasetKind;
  version: number;
  manifest_sha: string | null;
  archived_at: Date | null;
}

/**
 * eval_test_cases projection of one dataset case. Note: the case file's
 * `expected_behavior` lives only in S3 (the canonical artifact) — the
 * index table has no column for it, so it is deliberately NOT projected
 * (projecting a phantom field would defeat the no-churn idempotency
 * check on every re-sync).
 */
export interface DatasetCaseIndexRow {
  dataset_case_id: string;
  name: string;
  category: string;
  query: string;
  system_prompt: string | null;
  assertions: unknown[];
  tags: string[];
  agentcore_evaluator_ids: string[];
  enabled: boolean;
}

/** Write surface handed to the locked sync callback. */
export interface DatasetIndexWriter {
  upsertDataset(row: {
    slug: string;
    name: string | null;
    kind: EvalDatasetKind;
    version: number;
    manifest_sha: string;
    archived_at: string | null;
  }): Promise<{ id: string }>;
  /** Existing case rows for the dataset, keyed by dataset_case_id. */
  listCaseRows(datasetId: string): Promise<Map<string, DatasetCaseIndexRow>>;
  upsertCase(datasetId: string, row: DatasetCaseIndexRow): Promise<void>;
  /** Tombstone path: flip enabled off, keep the row (results FK it). */
  disableCase(datasetId: string, datasetCaseId: string): Promise<void>;
}

export interface DatasetIndexStore {
  /** Run `fn` under a per-(tenant, slug) advisory lock so concurrent
   *  same-dataset syncs serialize (mirrors catalog-index.ts). */
  withDatasetLock<T>(
    tenantId: string,
    slug: string,
    fn: (writer: DatasetIndexWriter) => Promise<T>,
  ): Promise<T>;
  getDataset(tenantId: string, slug: string): Promise<DatasetIndexRow | null>;
}

// ---------------------------------------------------------------------------
// Sync — full-state, idempotent, reconstructible from S3 alone
// ---------------------------------------------------------------------------

export interface DatasetContext {
  tenantId: string;
  tenantSlug: string;
  slug: string;
}

export type SyncAction = "synced" | "unchanged";

function caseRowsEqual(
  a: DatasetCaseIndexRow,
  b: DatasetCaseIndexRow,
): boolean {
  return (
    a.name === b.name &&
    a.category === b.category &&
    a.query === b.query &&
    a.system_prompt === b.system_prompt &&
    a.enabled === b.enabled &&
    JSON.stringify(a.assertions) === JSON.stringify(b.assertions) &&
    JSON.stringify(a.tags) === JSON.stringify(b.tags) &&
    JSON.stringify(a.agentcore_evaluator_ids) ===
      JSON.stringify(b.agentcore_evaluator_ids)
  );
}

function caseFileToIndexRow(
  caseId: string,
  parsed: ParsedEvalDatasetCase,
): DatasetCaseIndexRow {
  const agentcoreIds = parsed.engines?.agentcore?.evaluator_ids;
  return {
    dataset_case_id: caseId,
    name: parsed.core.name,
    category: parsed.core.category,
    query: parsed.core.query,
    system_prompt: parsed.core.system_prompt,
    assertions: parsed.core.assertions,
    tags: parsed.core.tags,
    agentcore_evaluator_ids: Array.isArray(agentcoreIds) ? agentcoreIds : [],
    enabled: parsed.core.enabled,
  };
}

/**
 * Full-state sync of one dataset from S3 into the index.
 *
 * Idempotent: when the index row's manifest_sha already matches the S3
 * manifest (and `force` is not set) the sync is a no-op — no row churn.
 * With `force`, or after any mutation (sha changed), the index is
 * rebuilt from S3 state: live cases upserted (diff-checked), tombstoned
 * or vanished cases flipped enabled=false (never deleted).
 */
export async function syncEvalDatasetFromS3(
  ctx: DatasetContext,
  storage: DatasetStorage,
  store: DatasetIndexStore,
  opts: { force?: boolean } = {},
): Promise<{ action: SyncAction; manifest: EvalDatasetManifest }> {
  const manifestContent = await storage.read(
    evalDatasetManifestKey(ctx.tenantSlug, ctx.slug),
  );
  if (manifestContent == null) {
    throw new Error(
      `Dataset ${ctx.slug} has no manifest in S3 — nothing to sync.`,
    );
  }
  const manifest = parseEvalDatasetManifest(manifestContent);
  const manifestSha = sha256Hex(manifestContent);

  if (!opts.force) {
    const existing = await store.getDataset(ctx.tenantId, ctx.slug);
    if (existing && existing.manifest_sha === manifestSha) {
      return { action: "unchanged", manifest };
    }
  }

  // Read every live case payload (outside the lock — pure S3 reads).
  const desired = new Map<string, DatasetCaseIndexRow>();
  for (const ref of manifest.cases) {
    const content = await storage.read(
      evalDatasetCaseKey(ctx.tenantSlug, ctx.slug, ref.case_id),
    );
    if (content == null) continue; // mid-write partial state: skip, heal next sync
    desired.set(
      ref.case_id,
      caseFileToIndexRow(ref.case_id, parseEvalDatasetCase(content)),
    );
  }
  await store.withDatasetLock(ctx.tenantId, ctx.slug, async (writer) => {
    const { id: datasetId } = await writer.upsertDataset({
      slug: manifest.slug,
      name: manifest.name,
      kind: manifest.kind,
      version: manifest.version,
      manifest_sha: manifestSha,
      archived_at: manifest.archived_at,
    });

    const existingRows = await writer.listCaseRows(datasetId);
    for (const [caseId, row] of desired) {
      const existing = existingRows.get(caseId);
      if (existing && caseRowsEqual(existing, row)) continue; // no churn
      await writer.upsertCase(datasetId, row);
    }
    // Tombstoned cases AND rows no longer present in the manifest at all:
    // flip enabled off, keep the row (eval_results history FKs it).
    for (const [caseId, existing] of existingRows) {
      if (desired.has(caseId)) continue;
      if (existing.enabled) {
        await writer.disableCase(datasetId, caseId);
      }
    }
  });

  return { action: "synced", manifest };
}

// ---------------------------------------------------------------------------
// Mutations — S3 first, then index sync
// ---------------------------------------------------------------------------

async function readManifestOrThrow(
  ctx: DatasetContext,
  storage: DatasetStorage,
): Promise<EvalDatasetManifest> {
  const content = await storage.read(
    evalDatasetManifestKey(ctx.tenantSlug, ctx.slug),
  );
  if (content == null) {
    throw new Error(`Dataset ${ctx.slug} not found in S3.`);
  }
  return parseEvalDatasetManifest(content);
}

async function writeManifestAndSync(
  ctx: DatasetContext,
  manifest: EvalDatasetManifest,
  storage: DatasetStorage,
  store: DatasetIndexStore,
): Promise<EvalDatasetManifest> {
  const bumped: EvalDatasetManifest = {
    ...manifest,
    version: manifest.version + 1,
    updated_at: new Date().toISOString(),
  };
  await storage.write(
    evalDatasetManifestKey(ctx.tenantSlug, ctx.slug),
    serializeEvalDatasetManifest(bumped),
  );
  await syncEvalDatasetFromS3(ctx, storage, store, { force: true });
  return bumped;
}

export async function createEvalDataset(
  ctx: DatasetContext,
  input: { name?: string | null; kind?: EvalDatasetKind },
  storage: DatasetStorage,
  store: DatasetIndexStore,
): Promise<EvalDatasetManifest> {
  assertValidDatasetSlug(ctx.slug);
  const existing = await storage.read(
    evalDatasetManifestKey(ctx.tenantSlug, ctx.slug),
  );
  if (existing != null) {
    throw new Error(`Dataset ${ctx.slug} already exists.`);
  }
  const manifest: EvalDatasetManifest = {
    slug: ctx.slug,
    name: input.name ?? null,
    kind: input.kind === "baseline" ? "baseline" : "custom",
    version: 1,
    updated_at: new Date().toISOString(),
    archived_at: null,
    cases: [],
    tombstones: [],
  };
  // S3 first: sentinel (so the empty folder materializes) then manifest.
  await storage.write(evalDatasetSentinelKey(ctx.tenantSlug, ctx.slug), "");
  await storage.write(
    evalDatasetManifestKey(ctx.tenantSlug, ctx.slug),
    serializeEvalDatasetManifest(manifest),
  );
  await syncEvalDatasetFromS3(ctx, storage, store, { force: true });
  return manifest;
}

export async function renameEvalDataset(
  ctx: DatasetContext,
  name: string | null,
  storage: DatasetStorage,
  store: DatasetIndexStore,
): Promise<EvalDatasetManifest> {
  const manifest = await readManifestOrThrow(ctx, storage);
  return writeManifestAndSync(ctx, { ...manifest, name }, storage, store);
}

/**
 * Soft archive — datasets are never hard-deleted while runs/results
 * reference them. Archived state lives in the manifest (S3 stays the
 * single reconstruction source) and projects to eval_datasets.archived_at.
 */
export async function archiveEvalDataset(
  ctx: DatasetContext,
  storage: DatasetStorage,
  store: DatasetIndexStore,
): Promise<EvalDatasetManifest> {
  const manifest = await readManifestOrThrow(ctx, storage);
  if (manifest.archived_at) return manifest;
  return writeManifestAndSync(
    ctx,
    { ...manifest, archived_at: new Date().toISOString() },
    storage,
    store,
  );
}

export async function putEvalDatasetCase(
  ctx: DatasetContext,
  core: EvalDatasetCaseCore,
  engines: EvalDatasetCaseEngines | null,
  storage: DatasetStorage,
  store: DatasetIndexStore,
): Promise<EvalDatasetManifest> {
  assertValidCaseId(core.case_id);
  const manifest = await readManifestOrThrow(ctx, storage);

  const content = serializeEvalDatasetCase(core, engines);
  const contentSha = computeEvalCaseSha(content);

  // S3 first: case payload, then the manifest pointing at it.
  await storage.write(
    evalDatasetCaseKey(ctx.tenantSlug, ctx.slug, core.case_id),
    content,
  );

  const cases = manifest.cases.filter((c) => c.case_id !== core.case_id);
  cases.push({ case_id: core.case_id, content_sha: contentSha });
  // Re-adding a previously removed case clears its tombstone.
  const tombstones = manifest.tombstones.filter(
    (t) => t.case_id !== core.case_id,
  );

  return writeManifestAndSync(
    ctx,
    { ...manifest, cases, tombstones },
    storage,
    store,
  );
}

export async function getEvalDatasetCase(
  ctx: DatasetContext,
  caseId: string,
  storage: DatasetStorage,
): Promise<ParsedEvalDatasetCase | null> {
  const content = await storage.read(
    evalDatasetCaseKey(ctx.tenantSlug, ctx.slug, caseId),
  );
  return content == null ? null : parseEvalDatasetCase(content);
}

/**
 * Case removal = manifest tombstone + enabled=false on the index row
 * (never a row delete — eval_results history FKs the case). The S3
 * payload object IS deleted.
 */
export async function removeEvalDatasetCase(
  ctx: DatasetContext,
  caseId: string,
  storage: DatasetStorage,
  store: DatasetIndexStore,
): Promise<EvalDatasetManifest> {
  const manifest = await readManifestOrThrow(ctx, storage);
  if (!manifest.cases.some((c) => c.case_id === caseId)) {
    throw new Error(`Case ${caseId} not found in dataset ${ctx.slug}.`);
  }

  // S3 first: delete the payload, then tombstone it in the manifest.
  await storage.delete(evalDatasetCaseKey(ctx.tenantSlug, ctx.slug, caseId));

  const cases = manifest.cases.filter((c) => c.case_id !== caseId);
  const tombstones = [
    ...manifest.tombstones.filter((t) => t.case_id !== caseId),
    { case_id: caseId, removed_at: new Date().toISOString() },
  ];
  return writeManifestAndSync(
    ctx,
    { ...manifest, cases, tombstones },
    storage,
    store,
  );
}

/**
 * Read path with drift detection: compare the index row's manifest_sha
 * against S3 and re-sync on mismatch so a quiet tenant heals on next
 * access. Returns null when the dataset has no S3 manifest.
 */
export async function readEvalDataset(
  ctx: DatasetContext,
  storage: DatasetStorage,
  store: DatasetIndexStore,
): Promise<{ manifest: EvalDatasetManifest; resynced: boolean } | null> {
  const content = await storage.read(
    evalDatasetManifestKey(ctx.tenantSlug, ctx.slug),
  );
  if (content == null) return null;
  const manifest = parseEvalDatasetManifest(content);
  const manifestSha = sha256Hex(content);
  const indexed = await store.getDataset(ctx.tenantId, ctx.slug);
  if (indexed && indexed.manifest_sha === manifestSha) {
    return { manifest, resynced: false };
  }
  await syncEvalDatasetFromS3(ctx, storage, store, { force: true });
  return { manifest, resynced: true };
}

/** List live case ids from S3 (sentinel + manifest filtered out). */
export async function listEvalDatasetCaseKeys(
  ctx: DatasetContext,
  storage: DatasetStorage,
): Promise<string[]> {
  const prefix = evalDatasetPrefix(ctx.tenantSlug, ctx.slug);
  const keys = await storage.list(prefix);
  return keys.filter((key) => {
    const rel = key.slice(prefix.length);
    if (rel === SENTINEL_FILE || rel === MANIFEST_FILE) return false;
    return rel.startsWith("cases/") && rel.endsWith(".json");
  });
}

// ---------------------------------------------------------------------------
// Production wiring — S3 storage
// ---------------------------------------------------------------------------

export function createS3DatasetStorage(opts: {
  client: S3Client;
  bucket: string;
}): DatasetStorage {
  const { client, bucket } = opts;
  return {
    async read(key) {
      try {
        const resp = await client.send(
          new GetObjectCommand({ Bucket: bucket, Key: key }),
        );
        return (await resp.Body?.transformToString()) ?? null;
      } catch (e) {
        const name = (e as { name?: string }).name;
        const status = (e as { $metadata?: { httpStatusCode?: number } })
          .$metadata?.httpStatusCode;
        if (name === "NoSuchKey" || name === "NotFound" || status === 404) {
          return null;
        }
        throw e;
      }
    },
    async write(key, content) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: content,
          ContentType: key.endsWith(".json")
            ? "application/json"
            : "application/octet-stream",
        }),
      );
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    async list(prefix) {
      const keys: string[] = [];
      let continuationToken: string | undefined;
      do {
        const resp = await client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          }),
        );
        for (const obj of resp.Contents ?? []) {
          if (obj.Key) keys.push(obj.Key);
        }
        continuationToken = resp.IsTruncated
          ? resp.NextContinuationToken
          : undefined;
      } while (continuationToken);
      return keys;
    },
  };
}

// ---------------------------------------------------------------------------
// Production wiring — Drizzle index store
// ---------------------------------------------------------------------------

const DATASET_LOCK_NAMESPACE = "eval-dataset:";

function rowToIndexRow(row: typeof evalDatasets.$inferSelect): DatasetIndexRow {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    slug: row.slug,
    name: row.name,
    kind: row.kind === "baseline" ? "baseline" : "custom",
    version: row.version,
    manifest_sha: row.manifest_sha,
    archived_at: row.archived_at,
  };
}

export function createDrizzleDatasetIndexStore(): DatasetIndexStore {
  return {
    async withDatasetLock(tenantId, slug, fn) {
      return db.transaction(async (tx) => {
        // Two-int advisory lock keyed on (tenant, namespaced slug);
        // released at txn end. The namespace prefix keeps eval-dataset
        // locks from colliding with skill-catalog locks on the same slug.
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${DATASET_LOCK_NAMESPACE + slug}))`,
        );
        const writer: DatasetIndexWriter = {
          async upsertDataset(row) {
            const [upserted] = await tx
              .insert(evalDatasets)
              .values({
                tenant_id: tenantId,
                slug: row.slug,
                name: row.name,
                kind: row.kind,
                version: row.version,
                manifest_sha: row.manifest_sha,
                archived_at: row.archived_at ? new Date(row.archived_at) : null,
              })
              .onConflictDoUpdate({
                target: [evalDatasets.tenant_id, evalDatasets.slug],
                set: {
                  name: row.name,
                  kind: row.kind,
                  version: row.version,
                  manifest_sha: row.manifest_sha,
                  archived_at: row.archived_at
                    ? new Date(row.archived_at)
                    : null,
                  updated_at: sql`now()`,
                },
              })
              .returning({ id: evalDatasets.id });
            return { id: upserted.id };
          },
          async listCaseRows(datasetId) {
            const rows = await tx
              .select({
                dataset_case_id: evalTestCases.dataset_case_id,
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
              .where(eq(evalTestCases.dataset_id, datasetId));
            return new Map(
              rows
                .filter(
                  (r): r is typeof r & { dataset_case_id: string } =>
                    typeof r.dataset_case_id === "string",
                )
                .map((r) => [
                  r.dataset_case_id,
                  {
                    dataset_case_id: r.dataset_case_id,
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
          async upsertCase(datasetId, row) {
            // The (dataset_id, dataset_case_id) unique index is partial
            // (WHERE dataset_id IS NOT NULL), which drizzle's onConflict
            // target inference can't express — and we're already
            // serialized under the advisory lock, so select-then-write
            // is race-free here.
            const [existing] = await tx
              .select({ id: evalTestCases.id })
              .from(evalTestCases)
              .where(
                and(
                  eq(evalTestCases.dataset_id, datasetId),
                  eq(evalTestCases.dataset_case_id, row.dataset_case_id),
                ),
              );
            if (existing) {
              await tx
                .update(evalTestCases)
                .set({
                  name: row.name,
                  category: row.category,
                  query: row.query,
                  system_prompt: row.system_prompt,
                  assertions: row.assertions,
                  tags: row.tags,
                  agentcore_evaluator_ids: row.agentcore_evaluator_ids,
                  enabled: row.enabled,
                  updated_at: new Date(),
                })
                .where(eq(evalTestCases.id, existing.id));
            } else {
              await tx.insert(evalTestCases).values({
                tenant_id: tenantId,
                dataset_id: datasetId,
                dataset_case_id: row.dataset_case_id,
                name: row.name,
                category: row.category,
                query: row.query,
                system_prompt: row.system_prompt,
                assertions: row.assertions,
                tags: row.tags,
                agentcore_evaluator_ids: row.agentcore_evaluator_ids,
                enabled: row.enabled,
                source: "dataset",
              });
            }
          },
          async disableCase(datasetId, datasetCaseId) {
            await tx
              .update(evalTestCases)
              .set({ enabled: false, updated_at: new Date() })
              .where(
                and(
                  eq(evalTestCases.dataset_id, datasetId),
                  eq(evalTestCases.dataset_case_id, datasetCaseId),
                ),
              );
          },
        };
        return fn(writer);
      });
    },
    async getDataset(tenantId, slug) {
      const [row] = await db
        .select()
        .from(evalDatasets)
        .where(
          and(
            eq(evalDatasets.tenant_id, tenantId),
            eq(evalDatasets.slug, slug),
          ),
        );
      return row ? rowToIndexRow(row) : null;
    },
  };
}
