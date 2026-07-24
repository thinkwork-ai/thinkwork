/**
 * Identity → twin graph bulk-rebuild lane (THINK-331).
 *
 * Seed-scale full rebuilds go through the Neptune bulk loader instead of
 * the replay lane the loader replaced: read ALL tenant canonicals and
 * tenant-visible mappings from Postgres, emit openCypher CSVs, stage them
 * in the etl-platform load bucket, start a loader job, poll to completion,
 * and fast-forward the tenant cursor to a watermark captured at extract
 * time. The steady-state nudge/cursor lane is untouched — bulk loads are
 * the exception, not a throughput problem.
 *
 * Ordering guarantee (R3): node files and relationship files are distinct,
 * and with `edgeOnlyLoad` left at its default the Neptune loader "first
 * scans all files to determine their contents" and "automatically loads
 * vertex files first, then edge files afterwards" (Neptune Loader Command
 * reference, `edgeOnlyLoad` parameter) — a bare edge endpoint that would
 * mint a label-less ghost node is impossible by construction.
 *
 * Concurrency (KTD-5): a per-tenant CAS fence on the cursor row
 * (`bulk_load_started_at` heartbeat + `bulk_load_id`) makes duplicate
 * invokes return the in-progress loadId instead of re-clearing; stale
 * takeover must first prove the recorded loader job terminal (cancel +
 * confirm) before touching the graph.
 *
 * Cursor safety (KTD-8): the watermark (newest event at extract time) is
 * captured SQL-side and persisted on the fence row BEFORE the Postgres
 * read; the success tail fast-forwards to that watermark, never to a
 * finalize-time newest event — the loadId-resume window is unbounded, so
 * finalize-time selection would silently skip every event committed during
 * the load. Timestamps never round-trip through a JS Date (microsecond
 * truncation re-matches bulk-inserted events forever — live incident,
 * 2026-07-22).
 */

import { randomUUID } from "node:crypto";
import {
  CancelLoaderJobCommand,
  GetLoaderJobStatusCommand,
  NeptunedataClient,
  StartLoaderJobCommand,
  type S3BucketRegion,
} from "@aws-sdk/client-neptunedata";
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getConfig } from "@thinkwork/runtime-config";
import { eq, sql } from "drizzle-orm";
import {
  canonicalEntities,
  entityResolutionEvents,
  entitySourceMappings,
  identityGraphProjectionCursors,
} from "@thinkwork/database-pg/schema";
import { db as defaultDb } from "../db.js";
import {
  buildIdentitySnapshot,
  clearTenantSubgraph,
  entityNodeId,
  safeLabel,
  systemEdgeId,
  systemNodeId,
  uploadIdentitySnapshot,
  type CanonicalRowForSync,
  type MappingRowForSync,
  type NeptuneQueryClient,
} from "./graph-projection.js";

type DbLike = typeof defaultDb;
type StagingS3Client = Pick<S3Client, "send">;

const SLUG_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,62}$/;

// ---------------------------------------------------------------------------
// openCypher CSV builders (pure, I/O-free — U1)
// ---------------------------------------------------------------------------

/** Deterministic staged-object names — resume/cleanup derives keys from
 * these plus the load prefix, so no s3:ListBucket grant is needed. */
export const BULK_CSV_FILE_NAMES = {
  entityNodes: "nodes-entities.csv",
  systemNodes: "nodes-systems.csv",
  edges: "edges.csv",
} as const;

export interface BulkCsvFile {
  name: string;
  content: string;
}

export interface BulkLoadCounts {
  canonicals: number;
  entityNodes: number;
  systemNodes: number;
  externalIdentityEdges: number;
  mergedIntoEdges: number;
}

export interface BulkLoadCsvFiles {
  /** Empty when the tenant has zero canonicals. */
  files: BulkCsvFile[];
  counts: BulkLoadCounts;
}

/** RFC 4180 field quoting (the loader parses openCypher CSVs per RFC 4180). */
function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

const ENTITY_NODES_HEADER =
  ":ID,:LABEL,tenantId:String,canonicalId:String,displayName:String,state:String,mergedInto:String";
const SYSTEM_NODES_HEADER = ":ID,:LABEL,tenantId:String,systemSlug:String";
const EDGES_HEADER =
  ":ID,:START_ID,:END_ID,:TYPE,tenantId:String,externalId:String,namespace:String";

/**
 * Build the node and edge CSV file contents for a tenant's full extract.
 * Byte-compatible with the nudge lane: node/edge ~ids, labels, and
 * property names exactly match what `buildCanonicalResyncOps` MERGEs, so
 * interleaved resyncs and re-runs converge instead of duplicating.
 *
 * Mirrored rules: merged losers carry state='merged' + mergedInto and a
 * merged_into alias edge but NO external-identity edges (the survivor's
 * own row recreates them); only tenant-visible mappings with a valid
 * source-system slug produce edges and ExternalSystem nodes; a malformed
 * entity_type_slug falls back to the generic `Entity` label.
 */
export function buildBulkLoadCsvFiles(args: {
  tenantId: string;
  canonicals: CanonicalRowForSync[];
  mappingsByCanonical: Map<string, MappingRowForSync[]>;
}): BulkLoadCsvFiles {
  const { tenantId } = args;
  const entityRows: string[] = [];
  const systemRows: string[] = [];
  const edgeRows: string[] = [];
  const seenSystems = new Set<string>();
  let externalIdentityEdges = 0;
  let mergedIntoEdges = 0;

  for (const canonical of args.canonicals) {
    const nodeId = entityNodeId(tenantId, canonical.id);
    const label = safeLabel(canonical.entity_type_slug);

    if (canonical.status === "merged" && canonical.merged_into_id) {
      // Loser: retired marker + alias edge, no displayName, no
      // external-identity edges (mirrors the resync loser path).
      entityRows.push(
        [
          csvField(nodeId),
          csvField(label),
          csvField(tenantId),
          csvField(canonical.id),
          "", // displayName — the resync loser path never sets it
          "merged",
          csvField(canonical.merged_into_id),
        ].join(","),
      );
      edgeRows.push(
        [
          csvField(`t#${tenantId}#m#${canonical.id}`),
          csvField(nodeId),
          csvField(entityNodeId(tenantId, canonical.merged_into_id)),
          "merged_into",
          csvField(tenantId),
          "",
          "",
        ].join(","),
      );
      mergedIntoEdges += 1;
      continue;
    }

    entityRows.push(
      [
        csvField(nodeId),
        csvField(label),
        csvField(tenantId),
        csvField(canonical.id),
        csvField(canonical.display_name),
        csvField(canonical.status),
        "", // mergedInto — only merged losers carry it
      ].join(","),
    );

    for (const mapping of args.mappingsByCanonical.get(canonical.id) ?? []) {
      if (mapping.visibility !== "tenant") continue;
      const system = mapping.source_system;
      if (!SLUG_RE.test(system)) continue;
      const sysId = systemNodeId(tenantId, system);
      if (!seenSystems.has(sysId)) {
        seenSystems.add(sysId);
        systemRows.push(
          [
            csvField(sysId),
            "ExternalSystem",
            csvField(tenantId),
            csvField(system),
          ].join(","),
        );
      }
      edgeRows.push(
        [
          csvField(
            systemEdgeId(tenantId, canonical.id, system, mapping.namespace),
          ),
          csvField(nodeId),
          csvField(sysId),
          "external_identity",
          csvField(tenantId),
          csvField(mapping.external_id),
          csvField(mapping.namespace),
        ].join(","),
      );
      externalIdentityEdges += 1;
    }
  }

  const files: BulkCsvFile[] = [];
  if (entityRows.length > 0) {
    files.push({
      name: BULK_CSV_FILE_NAMES.entityNodes,
      content: [ENTITY_NODES_HEADER, ...entityRows].join("\n") + "\n",
    });
  }
  if (systemRows.length > 0) {
    files.push({
      name: BULK_CSV_FILE_NAMES.systemNodes,
      content: [SYSTEM_NODES_HEADER, ...systemRows].join("\n") + "\n",
    });
  }
  if (edgeRows.length > 0) {
    files.push({
      name: BULK_CSV_FILE_NAMES.edges,
      content: [EDGES_HEADER, ...edgeRows].join("\n") + "\n",
    });
  }

  return {
    files,
    counts: {
      canonicals: args.canonicals.length,
      entityNodes: entityRows.length,
      systemNodes: systemRows.length,
      externalIdentityEdges,
      mergedIntoEdges,
    },
  };
}

// ---------------------------------------------------------------------------
// Loader client seam (KTD-3)
// ---------------------------------------------------------------------------

export interface LoaderStatus {
  /** overallStatus.status, e.g. LOAD_IN_PROGRESS / LOAD_COMPLETED / LOAD_FAILED. */
  status: string;
  /** overallStatus.fullUri — the staged source prefix, used for cleanup on resume. */
  fullUri?: string;
  /** Raw status payload (error feed when requested with errors: true). */
  payload?: unknown;
}

export interface NeptuneLoaderClient {
  startLoad(args: {
    source: string;
    iamRoleArn: string;
    region: string;
  }): Promise<{ loadId: string }>;
  getStatus(loadId: string, opts?: { errors?: boolean }): Promise<LoaderStatus>;
  cancelLoad(loadId: string): Promise<void>;
}

/** Statuses that mean "keep polling"; LOAD_COMPLETED is success; everything
 * else is terminal failure (fail-on-error posture, R7). */
const LOADER_IN_PROGRESS_STATUSES = new Set([
  "LOAD_NOT_STARTED",
  "LOAD_IN_PROGRESS",
  "LOAD_IN_QUEUE",
]);

function parseLoaderStatus(output: {
  status?: string;
  payload?: unknown;
}): LoaderStatus {
  const payload = output.payload as
    | { overallStatus?: { status?: string; fullUri?: string } }
    | undefined;
  return {
    status: payload?.overallStatus?.status ?? output.status ?? "UNKNOWN",
    fullUri: payload?.overallStatus?.fullUri,
    payload: output.payload,
  };
}

export function createNeptuneLoaderClient(args?: {
  endpoint?: string;
  port?: number;
}): NeptuneLoaderClient {
  const endpoint = args?.endpoint ?? getConfig("NEPTUNE_ENDPOINT") ?? "";
  const port = args?.port ?? Number(process.env.NEPTUNE_PORT ?? "8182");
  if (!endpoint) {
    throw new Error("NEPTUNE_ENDPOINT is not configured");
  }
  const client = new NeptunedataClient({
    endpoint: `https://${endpoint}:${port}`,
  });
  return {
    async startLoad({ source, iamRoleArn, region }) {
      const output = await client.send(
        new StartLoaderJobCommand({
          source,
          format: "opencypher",
          s3BucketRegion: region as S3BucketRegion,
          iamRoleArn,
          // Fail-on-error so a partial load surfaces instead of silently
          // fast-forwarding the cursor (R7).
          failOnError: true,
          // HIGH parallelism can deadlock openCypher loads
          // (LOAD_DATA_DEADLOCK) per the loader reference; MEDIUM is the
          // documented openCypher example setting.
          parallelism: "MEDIUM",
          // Deterministic ids converge on re-run (AE3, etl backfill pattern).
          userProvidedEdgeIds: true,
          updateSingleCardinalityProperties: true,
          // Queue behind any concurrent (etl) load instead of failing;
          // LOAD_IN_QUEUE polls like LOAD_IN_PROGRESS.
          queueRequest: true,
        }),
      );
      const loadId = output.payload?.loadId;
      if (!loadId) {
        throw new Error("StartLoaderJob returned no loadId");
      }
      return { loadId };
    },
    async getStatus(loadId, opts) {
      const output = await client.send(
        new GetLoaderJobStatusCommand({
          loadId,
          details: true,
          errors: opts?.errors === true,
        }),
      );
      return parseLoaderStatus(output);
    },
    async cancelLoad(loadId) {
      await client.send(new CancelLoaderJobCommand({ loadId }));
    },
  };
}

// ---------------------------------------------------------------------------
// Orchestrator (U2)
// ---------------------------------------------------------------------------

export type BulkRebuildResult =
  | {
      ok: true;
      status: "completed";
      tenantId: string;
      /** Null when the tenant was empty and no loader job was needed. */
      loadId: string | null;
      counts: BulkLoadCounts | null;
      cursor: string;
    }
  | {
      ok: false;
      status: "in_progress";
      tenantId: string;
      /** Null while a concurrent run holds the fence but its loader has not
       * started yet — re-invoke without loadId once it surfaces one. */
      loadId: string | null;
    }
  | {
      ok: false;
      status: "failed";
      tenantId: string;
      error: string;
      /** Phase reached when a pre-start deadline trip released the fence. */
      phase?: string;
      loaderStatus?: string;
      loaderErrors?: unknown;
    };

export interface BulkRebuildArgs {
  tenantId: string;
  /** Id-prefix-fenced clear before loading (R4/F2 recovery form). */
  clear?: boolean;
  /** Resume polling a load a previous invoke started (KTD-4). */
  loadId?: string;
  db?: DbLike;
  neptune?: NeptuneQueryClient;
  s3?: StagingS3Client;
  loader?: NeptuneLoaderClient;
  loadBucket?: string;
  loaderRoleArn?: string;
  region?: string;
  /** Lambda's context.getRemainingTimeInMillis; defaults to no deadline. */
  getRemainingTimeMs?: () => number;
  deadlineMarginMs?: number;
  staleFenceMs?: number;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: Date;
}

const DEFAULT_DEADLINE_MARGIN_MS = 90_000;
const DEFAULT_STALE_FENCE_MS = 30 * 60_000;
const DEFAULT_POLL_INTERVAL_MS = 5_000;

const STAGE_PREFIX_ROOT = "thinkwork-identity";

function stagingPrefix(tenantId: string, token: string): string {
  return `${STAGE_PREFIX_ROOT}/${tenantId}/${token}/`;
}

/** Derive the staged-object prefix back out of the loader's fullUri
 * (`s3://bucket/prefix/`) so resume-path cleanup needs no ListBucket. */
function prefixFromFullUri(fullUri: string, bucket: string): string | null {
  const head = `s3://${bucket}/`;
  if (!fullUri.startsWith(head)) return null;
  const prefix = fullUri.slice(head.length);
  return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

async function deleteStagedObjects(args: {
  s3: StagingS3Client;
  bucket: string;
  prefix: string;
}): Promise<void> {
  // Best-effort: staged CSVs must not persist tenant identity exports in
  // the shared bucket, but a delete failure never fails the run — the
  // bucket lifecycle policy is the backstop.
  for (const name of Object.values(BULK_CSV_FILE_NAMES)) {
    try {
      await args.s3.send(
        new DeleteObjectCommand({
          Bucket: args.bucket,
          Key: `${args.prefix}${name}`,
        }),
      );
    } catch (err) {
      console.warn("[bulk-rebuild] staged CSV delete failed (harmless)", {
        key: `${args.prefix}${name}`,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

interface CursorFenceRow {
  tenant_id: string;
  bulk_load_id: string | null;
  bulk_load_started_at: Date | null;
  bulk_watermark_created_at: Date | null;
  bulk_watermark_event_id: string | null;
}

async function readCursorRow(
  db: DbLike,
  tenantId: string,
): Promise<CursorFenceRow | undefined> {
  const [row] = await db
    .select({
      tenant_id: identityGraphProjectionCursors.tenant_id,
      bulk_load_id: identityGraphProjectionCursors.bulk_load_id,
      bulk_load_started_at: identityGraphProjectionCursors.bulk_load_started_at,
      bulk_watermark_created_at:
        identityGraphProjectionCursors.bulk_watermark_created_at,
      bulk_watermark_event_id:
        identityGraphProjectionCursors.bulk_watermark_event_id,
    })
    .from(identityGraphProjectionCursors)
    .where(eq(identityGraphProjectionCursors.tenant_id, tenantId))
    .limit(1);
  return row as CursorFenceRow | undefined;
}

async function releaseFence(db: DbLike, tenantId: string, now: Date) {
  await db
    .update(identityGraphProjectionCursors)
    .set({
      bulk_load_id: null,
      bulk_load_started_at: null,
      bulk_watermark_created_at: null,
      bulk_watermark_event_id: null,
      updated_at: now,
    })
    .where(eq(identityGraphProjectionCursors.tenant_id, tenantId));
}

async function refreshHeartbeat(db: DbLike, tenantId: string, now: Date) {
  await db
    .update(identityGraphProjectionCursors)
    .set({ bulk_load_started_at: now, updated_at: now })
    .where(eq(identityGraphProjectionCursors.tenant_id, tenantId));
}

/**
 * Bulk-rebuild a tenant's twin graph through the Neptune bulk loader.
 * See the module doc for the fence/watermark/deadline design; the flow is
 * F1 in docs/plans/2026-07-22-004-feat-identity-projector-bulk-rebuild-plan.md.
 */
export async function bulkRebuildTenantGraph(
  args: BulkRebuildArgs,
): Promise<BulkRebuildResult> {
  const { tenantId } = args;
  const db = args.db ?? defaultDb;
  const loadBucket = args.loadBucket ?? getConfig("NEPTUNE_LOAD_BUCKET") ?? "";
  const loaderRoleArn =
    args.loaderRoleArn ?? getConfig("NEPTUNE_LOADER_ROLE_ARN") ?? "";
  const failed = (
    error: string,
    extra?: Partial<Extract<BulkRebuildResult, { status: "failed" }>>,
  ): BulkRebuildResult => ({
    ok: false,
    status: "failed",
    tenantId,
    error,
    ...extra,
  });
  if (!loadBucket || !loaderRoleArn) {
    return failed(
      "bulk-rebuild is not configured (NEPTUNE_LOAD_BUCKET / NEPTUNE_LOADER_ROLE_ARN empty)",
    );
  }
  const region = args.region ?? process.env.AWS_REGION ?? "us-east-1";
  const loader = args.loader ?? createNeptuneLoaderClient();
  const s3 = args.s3 ?? new S3Client({});
  const getRemainingTimeMs =
    args.getRemainingTimeMs ?? (() => Number.POSITIVE_INFINITY);
  const deadlineMarginMs = args.deadlineMarginMs ?? DEFAULT_DEADLINE_MARGIN_MS;
  const deadlineNear = () => getRemainingTimeMs() < deadlineMarginMs;
  const staleFenceMs = args.staleFenceMs ?? DEFAULT_STALE_FENCE_MS;
  const pollIntervalMs = args.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const sleep =
    args.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const stamp = () => args.now ?? new Date();

  // -------------------------------------------------------------------------
  // Success / failure tails shared by the fresh and resume paths.
  // -------------------------------------------------------------------------

  const cleanupStaged = async (
    prefix: string | null,
    status?: LoaderStatus,
  ) => {
    const resolved =
      prefix ??
      (status?.fullUri ? prefixFromFullUri(status.fullUri, loadBucket) : null);
    if (resolved) {
      await deleteStagedObjects({ s3, bucket: loadBucket, prefix: resolved });
    }
  };

  const finalizeSuccess = async (
    loadId: string | null,
    stagedPrefix: string | null,
    counts: BulkLoadCounts | null,
    status?: LoaderStatus,
  ): Promise<BulkRebuildResult> => {
    const row = await readCursorRow(db, tenantId);
    const watermarkEventId = row?.bulk_watermark_event_id ?? null;
    const watermarkCreatedAt = row?.bulk_watermark_created_at ?? null;
    const cursor =
      watermarkEventId && watermarkCreatedAt
        ? `${watermarkCreatedAt.toISOString()}#${watermarkEventId}`
        : "bulk-rebuild#empty";
    const snapshot = await buildIdentitySnapshot({
      tenantId,
      cursor,
      db,
      now: args.now,
    });
    await uploadIdentitySnapshot({ snapshot, s3 });
    // Fast-forward to the EXTRACT-TIME watermark (KTD-8). The timestamp is
    // re-read SQL-side from the event row — never the JS Date round-trip,
    // which truncates Postgres microseconds and re-matches bulk-inserted
    // events forever.
    const watermarkCreatedAtExact = watermarkEventId
      ? (sql`(SELECT created_at FROM identity.entity_resolution_events WHERE id = ${watermarkEventId})` as unknown as Date)
      : undefined;
    await db
      .update(identityGraphProjectionCursors)
      .set({
        ...(watermarkEventId
          ? {
              last_event_created_at: watermarkCreatedAtExact,
              last_event_id: watermarkEventId,
            }
          : {}),
        last_snapshot_cursor: cursor,
        bulk_load_id: null,
        bulk_load_started_at: null,
        bulk_watermark_created_at: null,
        bulk_watermark_event_id: null,
        updated_at: stamp(),
      })
      .where(eq(identityGraphProjectionCursors.tenant_id, tenantId));
    await cleanupStaged(stagedPrefix, status);
    return { ok: true, status: "completed", tenantId, loadId, counts, cursor };
  };

  const finalizeFailure = async (
    loadId: string,
    status: LoaderStatus,
    stagedPrefix: string | null,
  ): Promise<BulkRebuildResult> => {
    let errorFeed: unknown = status.payload;
    try {
      errorFeed = (await loader.getStatus(loadId, { errors: true })).payload;
    } catch {
      // keep the terminal status payload we already have
    }
    await cleanupStaged(stagedPrefix, status);
    await releaseFence(db, tenantId, stamp());
    // Cursor untouched (AE4): the failure surfaces to the invoker.
    return failed(`loader job ${loadId} ended ${status.status}`, {
      loaderStatus: status.status,
      loaderErrors: errorFeed,
    });
  };

  const pollToCompletion = async (
    loadId: string,
    stagedPrefix: string | null,
    counts: BulkLoadCounts | null,
  ): Promise<BulkRebuildResult> => {
    for (;;) {
      const status = await loader.getStatus(loadId);
      await refreshHeartbeat(db, tenantId, stamp());
      if (status.status === "LOAD_COMPLETED") {
        return finalizeSuccess(loadId, stagedPrefix, counts, status);
      }
      if (!LOADER_IN_PROGRESS_STATUSES.has(status.status)) {
        return finalizeFailure(loadId, status, stagedPrefix);
      }
      if (deadlineNear()) {
        // Fence stays held, cursor untouched — re-invoke with this loadId
        // to resume polling (KTD-4).
        return { ok: false, status: "in_progress", tenantId, loadId };
      }
      await sleep(pollIntervalMs);
    }
  };

  // -------------------------------------------------------------------------
  // Resume path: validate the supplied loadId against the fence (KTD-4).
  // -------------------------------------------------------------------------

  if (args.loadId) {
    const row = await readCursorRow(db, tenantId);
    if (!row || row.bulk_load_started_at == null) {
      return failed(
        `no bulk load in progress for tenant ${tenantId} — nothing to resume`,
      );
    }
    if (row.bulk_load_id !== args.loadId) {
      return failed(
        `loadId ${args.loadId} does not match the in-progress load ` +
          `${row.bulk_load_id ?? "(not started)"} for tenant ${tenantId}`,
      );
    }
    return pollToCompletion(args.loadId, null, null);
  }

  // -------------------------------------------------------------------------
  // Fence claim (KTD-5).
  // -------------------------------------------------------------------------

  const existing = await readCursorRow(db, tenantId);
  let takeoverHeartbeat: Date | null = null;
  if (existing?.bulk_load_started_at != null) {
    const age = stamp().getTime() - existing.bulk_load_started_at.getTime();
    if (age < staleFenceMs) {
      // A live run holds the fence — hand back its loadId, touch nothing.
      return {
        ok: false,
        status: "in_progress",
        tenantId,
        loadId: existing.bulk_load_id,
      };
    }
    // Stale takeover: the age window alone justifies takeover only when the
    // recorded loader job is provably terminal — cancel and confirm first.
    if (existing.bulk_load_id) {
      let status = await loader.getStatus(existing.bulk_load_id);
      if (LOADER_IN_PROGRESS_STATUSES.has(status.status)) {
        await loader.cancelLoad(existing.bulk_load_id);
        status = await loader.getStatus(existing.bulk_load_id);
        if (LOADER_IN_PROGRESS_STATUSES.has(status.status)) {
          return failed(
            `stale fence for tenant ${tenantId}: loader job ` +
              `${existing.bulk_load_id} is still ${status.status} after cancel`,
          );
        }
      }
      // Clean the dead run's staged prefix while we know its fullUri.
      await cleanupStaged(null, status);
    }
    takeoverHeartbeat = existing.bulk_load_started_at;
  }

  // CAS claim: insert-or-update guarded so only an unfenced (or verified-
  // stale) row is claimed. An empty RETURNING means another invoke won the
  // race — report in-progress rather than proceeding to clear.
  const staleBefore = takeoverHeartbeat
    ? new Date(stamp().getTime() - staleFenceMs)
    : null;
  const claimWhere = staleBefore
    ? sql`${identityGraphProjectionCursors.bulk_load_started_at} IS NULL OR ${identityGraphProjectionCursors.bulk_load_started_at} <= ${staleBefore}`
    : sql`${identityGraphProjectionCursors.bulk_load_started_at} IS NULL`;
  const claimed = await db
    .insert(identityGraphProjectionCursors)
    .values({
      tenant_id: tenantId,
      bulk_load_id: null,
      bulk_load_started_at: stamp(),
      bulk_watermark_created_at: null,
      bulk_watermark_event_id: null,
      updated_at: stamp(),
    })
    .onConflictDoUpdate({
      target: [identityGraphProjectionCursors.tenant_id],
      set: {
        bulk_load_id: null,
        bulk_load_started_at: stamp(),
        bulk_watermark_created_at: null,
        bulk_watermark_event_id: null,
        updated_at: stamp(),
      },
      setWhere: claimWhere,
    })
    .returning({ tenant_id: identityGraphProjectionCursors.tenant_id });
  if (!claimed || claimed.length === 0) {
    return { ok: false, status: "in_progress", tenantId, loadId: null };
  }

  // -------------------------------------------------------------------------
  // Pre-start phases — deadline-guarded; a trip releases the fence with a
  // phase-named error (KTD-4). Unexpected pre-start exceptions release too:
  // the loader has not started, so nothing is lost by unwinding.
  // -------------------------------------------------------------------------

  let phase = "watermark";
  try {
    // Extract-time watermark, captured SQL-side BEFORE the read (KTD-8).
    const [newest] = await db
      .select({
        id: entityResolutionEvents.id,
        created_at: entityResolutionEvents.created_at,
      })
      .from(entityResolutionEvents)
      .where(eq(entityResolutionEvents.tenant_id, tenantId))
      .orderBy(
        sql`${entityResolutionEvents.created_at} DESC`,
        sql`${entityResolutionEvents.id} DESC`,
      )
      .limit(1);
    if (newest) {
      await db
        .update(identityGraphProjectionCursors)
        .set({
          bulk_watermark_created_at:
            sql`(SELECT created_at FROM identity.entity_resolution_events WHERE id = ${newest.id})` as unknown as Date,
          bulk_watermark_event_id: newest.id,
          updated_at: stamp(),
        })
        .where(eq(identityGraphProjectionCursors.tenant_id, tenantId));
    }

    if (args.clear) {
      phase = "clear";
      const { cleared } = await clearTenantSubgraph({
        tenantId,
        neptune: args.neptune,
        shouldStop: deadlineNear,
      });
      if (!cleared) {
        throw new Error("deadline reached during clear");
      }
    }

    phase = "extract";
    if (deadlineNear()) throw new Error("deadline reached before extract");
    const canonicals = (await db
      .select({
        id: canonicalEntities.id,
        entity_type_slug: canonicalEntities.entity_type_slug,
        display_name: canonicalEntities.display_name,
        status: canonicalEntities.status,
        merged_into_id: canonicalEntities.merged_into_id,
      })
      .from(canonicalEntities)
      .where(
        eq(canonicalEntities.tenant_id, tenantId),
      )) as CanonicalRowForSync[];
    const mappingRows = await db
      .select({
        canonical_entity_id: entitySourceMappings.canonical_entity_id,
        source_system: entitySourceMappings.source_system,
        namespace: entitySourceMappings.namespace,
        external_id: entitySourceMappings.external_id,
        visibility: entitySourceMappings.visibility,
      })
      .from(entitySourceMappings)
      .where(eq(entitySourceMappings.tenant_id, tenantId));
    const mappingsByCanonical = new Map<string, MappingRowForSync[]>();
    for (const row of mappingRows) {
      const list = mappingsByCanonical.get(row.canonical_entity_id) ?? [];
      list.push(row);
      mappingsByCanonical.set(row.canonical_entity_id, list);
    }

    const { files, counts } = buildBulkLoadCsvFiles({
      tenantId,
      canonicals,
      mappingsByCanonical,
    });

    if (files.length === 0) {
      // Empty tenant: nothing to load — success tail without a loader job.
      return await finalizeSuccess(null, null, counts);
    }

    phase = "upload";
    const prefix = stagingPrefix(tenantId, randomUUID());
    for (const file of files) {
      if (deadlineNear()) throw new Error("deadline reached during upload");
      await s3.send(
        new PutObjectCommand({
          Bucket: loadBucket,
          Key: `${prefix}${file.name}`,
          Body: file.content,
          ContentType: "text/csv",
        }),
      );
    }

    phase = "start";
    if (deadlineNear()) throw new Error("deadline reached before loader start");
    // Full bucket-relative prefix — the loader's "AccessDenied …
    // s3:ListBucket" failure is a disguised 404 for a wrong key (KTD-7).
    const { loadId } = await loader.startLoad({
      source: `s3://${loadBucket}/${prefix}`,
      iamRoleArn: loaderRoleArn,
      region,
    });
    // Loader is live from here — never release the fence on an exception
    // past this point; the heartbeat-stale takeover (with its terminal
    // check) or a loadId resume owns recovery instead.
    phase = "poll";
    await db
      .update(identityGraphProjectionCursors)
      .set({
        bulk_load_id: loadId,
        bulk_load_started_at: stamp(),
        updated_at: stamp(),
      })
      .where(eq(identityGraphProjectionCursors.tenant_id, tenantId));

    return await pollToCompletion(loadId, prefix, counts);
  } catch (err) {
    if (phase !== "poll") {
      await releaseFence(db, tenantId, stamp());
    }
    const message = err instanceof Error ? err.message : String(err);
    return failed(`bulk-rebuild failed during ${phase}: ${message}`, { phase });
  }
}
