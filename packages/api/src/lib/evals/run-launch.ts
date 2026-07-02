/**
 * Eval run launch helpers (Evaluations Trust Core U6) — run scope pinning.
 *
 * KTD: "Runs pin their scope at launch by copying, not referencing."
 * Dataset launches resolve the dataset (drift-healing the index against
 * S3), pin dataset id + version + the resolved case-id scope on the run
 * row, and COPY each enabled case's content to the run snapshot prefix
 *
 *   tenants/<tenant-slug>/eval-datasets/.runs/<run-id>/cases/<case_id>.json
 *
 * Workers execute only the run-scoped copy — the live dataset prefix is
 * never read after launch, so a mid-run case edit or deletion cannot
 * change what the run executes. The snapshot lives INSIDE the guarded
 * eval-datasets prefix, so the Pi-role IAM Deny and tenant teardown
 * cover it by construction; deleteEvalRun removes the prefix objects.
 *
 * Copy-target decision (plan left S3-prefix vs run-content DB table to
 * implementation): S3 prefix. Flagged-thread case payloads (U7) carry
 * recorded message history that will exceed comfortable row sizes and
 * the 256KB SQS cap; the guarded prefix already has IAM/teardown
 * coverage and the `.runs/` shape is pinned by the U4 guard tests.
 *
 * Torn-content guard: the copy verifies every fetched case object's
 * content sha against the launch-time manifest. On any mismatch (a
 * concurrent case edit interleaved with the launch) the whole snapshot
 * capture retries once from a fresh manifest read, then fails the
 * launch — a run must never pin content that existed as no version.
 *
 * Flagged-thread payload objects (U8): cases with category
 * "flagged-thread" also get their flag-time payload objects
 * (history/workspace/traces) copied to
 *
 *   tenants/<tenant-slug>/eval-datasets/.runs/<run-id>/cases/<case_id>/payload/<name>.json
 *
 * Payloads are NOT in the dataset manifest, so their integrity contract
 * is launch-computed: the capture hashes the exact bytes it copied and
 * carries the shas on the SQS message (`payloadShas`); the worker
 * verifies its run-prefix fetch against the message sha before replay —
 * the same trust shape as `contentSha` for case files. Payload objects
 * are written once at flag time and only deleted with their case, so
 * there is no mid-launch edit race to retry against.
 */

import { getConfig } from "@thinkwork/runtime-config";
import { S3Client } from "@aws-sdk/client-s3";
import { db, eq, tenants } from "../../graphql/utils.js";
import {
  assertValidDatasetSlug,
  createDrizzleDatasetIndexStore,
  createS3DatasetStorage,
  EVAL_CASE_PAYLOAD_NAMES,
  evalDatasetCaseKey,
  evalDatasetCasePayloadKey,
  evalDatasetManifestKey,
  evalRunSnapshotCaseKey,
  evalCaseQualityState,
  evalRunSnapshotCasePayloadKey,
  evalRunSnapshotPrefix,
  FLAGGED_THREAD_CATEGORY,
  parseEvalDatasetCase,
  parseEvalDatasetManifest,
  readEvalDataset,
  sha256Hex,
  type DatasetContext,
  type DatasetStorage,
  type EvalCasePayloadName,
  type EvalDatasetCaseCore,
  type EvalDatasetCaseEngines,
} from "./dataset-store.js";

// ---------------------------------------------------------------------------
// Production wiring
// ---------------------------------------------------------------------------

/** S3-backed DatasetStorage from runtime config (WORKSPACE_BUCKET). */
export function createEvalDatasetStorageFromConfig(): DatasetStorage {
  const bucket = getConfig("WORKSPACE_BUCKET");
  if (!bucket) {
    throw new Error("WORKSPACE_BUCKET is not configured");
  }
  const client = new S3Client({
    region:
      process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
  });
  return createS3DatasetStorage({ client, bucket });
}

/** Tenant slug is always row-derived, never caller-supplied (U4 KTD). */
export async function loadTenantSlugForEvalRun(
  tenantId: string,
): Promise<string> {
  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  if (!tenant?.slug) {
    throw new Error(`Tenant ${tenantId} has no slug — cannot resolve dataset`);
  }
  return tenant.slug;
}

// ---------------------------------------------------------------------------
// Launch-side dataset resolution (called by the startEvalRun mutation)
// ---------------------------------------------------------------------------

/**
 * Resolve a dataset for a run launch: drift-check the index manifest_sha
 * against S3 (readEvalDataset re-syncs on mismatch, so the index the
 * runner fans out from is current), reject archived datasets, and return
 * the index row id the run row pins.
 */
export async function resolveDatasetForLaunch(
  tenantId: string,
  datasetSlug: string,
): Promise<{ id: string; version: number }> {
  assertValidDatasetSlug(datasetSlug);
  const tenantSlug = await loadTenantSlugForEvalRun(tenantId);
  const ctx: DatasetContext = { tenantId, tenantSlug, slug: datasetSlug };
  const storage = createEvalDatasetStorageFromConfig();
  const store = createDrizzleDatasetIndexStore();

  const read = await readEvalDataset(ctx, storage, store);
  if (!read) {
    throw new Error(`Dataset ${datasetSlug} not found.`);
  }
  if (read.manifest.archived_at) {
    throw new Error(`Dataset ${datasetSlug} is archived and cannot be run.`);
  }
  const row = await store.getDataset(tenantId, datasetSlug);
  if (!row) {
    throw new Error(`Dataset ${datasetSlug} did not sync into the index.`);
  }
  return { id: row.id, version: row.version };
}

// ---------------------------------------------------------------------------
// Snapshot capture (called by the eval-runner Lambda before fan-out)
// ---------------------------------------------------------------------------

export interface RunSnapshotCase {
  /** Stable dataset_case_id. */
  caseId: string;
  /** Run-scoped S3 key the workers fetch. */
  snapshotKey: string;
  /** sha256 of the copied content — carried on the SQS message. */
  contentSha: string;
  /**
   * Flagged-thread cases only (U8): sha256 of each payload object
   * (history/workspace/traces) copied into the run snapshot prefix,
   * keyed by payload name. Payload objects are NOT in the dataset
   * manifest (only case files are), so launch-time copy integrity is
   * the same read-once/hash/carry-on-the-SQS-message contract as case
   * files: the launch hashes the exact bytes it copied and the worker
   * verifies the run-prefix fetch against that sha before replay.
   * Names absent from the map were not captured at flag time (the
   * case's completeness badges record the gap).
   */
  payloadShas?: Partial<Record<EvalCasePayloadName, string>>;
  core: EvalDatasetCaseCore;
  engines: EvalDatasetCaseEngines | null;
}

export interface RunSnapshot {
  /** Manifest version the run pins (eval_runs.dataset_version). */
  datasetVersion: number;
  manifestSha: string;
  /** Enabled cases only — the effective pinned scope. */
  cases: RunSnapshotCase[];
}

/**
 * Capture the launch-time snapshot: read the manifest, fetch every live
 * case payload, verify each content sha against the manifest, and copy
 * the enabled cases into the run snapshot prefix. Copies are written
 * only after the WHOLE set verifies — a sha mismatch (concurrent edit)
 * retries the capture once from a fresh manifest read, then fails the
 * launch. Disabled cases — and cases whose curation quality_state is
 * not "active" (U7) — are verified but not copied (they are outside the
 * effective scope).
 */
export async function captureRunSnapshot(
  ctx: DatasetContext,
  runId: string,
  storage: DatasetStorage,
  opts: { maxAttempts?: number } = {},
): Promise<RunSnapshot> {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 2);
  let lastMismatch = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const manifestContent = await storage.read(
      evalDatasetManifestKey(ctx.tenantSlug, ctx.slug),
    );
    if (manifestContent == null) {
      throw new Error(`Dataset ${ctx.slug} has no manifest in S3.`);
    }
    const manifest = parseEvalDatasetManifest(manifestContent);
    const manifestSha = sha256Hex(manifestContent);

    const verified: Array<{
      caseId: string;
      content: string;
      contentSha: string;
    }> = [];
    let torn = false;
    for (const ref of manifest.cases) {
      const content = await storage.read(
        evalDatasetCaseKey(ctx.tenantSlug, ctx.slug, ref.case_id),
      );
      if (content == null) {
        torn = true;
        lastMismatch = `case ${ref.case_id} is missing from S3`;
        break;
      }
      const contentSha = sha256Hex(content);
      if (contentSha !== ref.content_sha) {
        torn = true;
        lastMismatch = `case ${ref.case_id} content sha does not match the manifest`;
        break;
      }
      verified.push({ caseId: ref.case_id, content, contentSha });
    }
    if (torn) continue; // re-read manifest + cases once, then fail below

    // Whole set verified against one manifest: copy the enabled cases
    // into the run snapshot prefix and return the pinned scope.
    const cases: RunSnapshotCase[] = [];
    for (const entry of verified) {
      const parsed = parseEvalDatasetCase(entry.content);
      if (!parsed.core.enabled) continue;
      // Curation exclusion (U7 / KTD8): retired and needs-revision cases
      // keep their history but never dispatch — only active cases enter
      // the pinned scope. The reconciler reconstructs from the pinned
      // scope (pinned_case_ids / pinned_trial_plan), so it inherits this
      // filter for dataset runs by construction.
      if (evalCaseQualityState(parsed.core) !== "active") continue;
      const snapshotKey = evalRunSnapshotCaseKey(
        ctx.tenantSlug,
        runId,
        entry.caseId,
      );
      await storage.write(snapshotKey, entry.content);
      // Flagged-thread cases (U8): copy the flag-time payload objects
      // alongside the case file so replay reads ONLY the run prefix.
      // A payload missing here (flag-time gap, or deleted between flag
      // and launch) is skipped — the worker degrades or records
      // error/infra_other per payload, exactly like a missing object.
      let payloadShas: Partial<Record<EvalCasePayloadName, string>> | undefined;
      if (parsed.core.category === FLAGGED_THREAD_CATEGORY) {
        payloadShas = {};
        for (const name of EVAL_CASE_PAYLOAD_NAMES) {
          const payloadContent = await storage.read(
            evalDatasetCasePayloadKey(
              ctx.tenantSlug,
              ctx.slug,
              entry.caseId,
              name,
            ),
          );
          if (payloadContent == null) continue;
          await storage.write(
            evalRunSnapshotCasePayloadKey(
              ctx.tenantSlug,
              runId,
              entry.caseId,
              name,
            ),
            payloadContent,
          );
          payloadShas[name] = sha256Hex(payloadContent);
        }
      }
      cases.push({
        caseId: entry.caseId,
        snapshotKey,
        contentSha: entry.contentSha,
        ...(payloadShas && Object.keys(payloadShas).length > 0
          ? { payloadShas }
          : {}),
        core: parsed.core,
        engines: parsed.engines,
      });
    }
    return { datasetVersion: manifest.version, manifestSha, cases };
  }

  throw new Error(
    `Dataset ${ctx.slug} changed while the run was launching (${lastMismatch}); ` +
      `launch aborted so the run never pins torn content. Retry the run.`,
  );
}

// ---------------------------------------------------------------------------
// Snapshot deletion (deleteEvalRun + run retention)
// ---------------------------------------------------------------------------

/** Delete every object under the run's snapshot prefix. */
export async function deleteRunSnapshot(
  tenantSlug: string,
  runId: string,
  storage: DatasetStorage,
): Promise<number> {
  const prefix = evalRunSnapshotPrefix(tenantSlug, runId);
  const keys = await storage.list(prefix);
  for (const key of keys) {
    await storage.delete(key);
  }
  return keys.length;
}

/**
 * Production entry point for deleteEvalRun: resolve the tenant slug
 * (row-derived) and sweep the run's snapshot prefix. Slugless tenants
 * have no S3 namespace — nothing to delete.
 */
export async function deleteRunSnapshotForTenant(
  tenantId: string,
  runId: string,
): Promise<number> {
  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  if (!tenant?.slug) return 0;
  const storage = createEvalDatasetStorageFromConfig();
  return deleteRunSnapshot(tenant.slug, runId, storage);
}
