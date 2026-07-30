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
 *
 * Memory (THINK-409): the extract is keyset-paginated and the CSVs are
 * streamed to S3 as multipart uploads, so Lambda RSS is flat regardless of
 * tenant size. The previous shape read ALL canonicals + ALL mappings into
 * arrays, built a mappings-by-canonical Map over the whole tenant, and
 * `join("\n")`ed three whole files before uploading them — ~800k canonicals
 * peaked north of 4.5GB, and the McPherson account caps Lambda memory at
 * 3008MB while the tenant heads for many millions of canonicals. Nothing
 * bigger than one page (canonicals + their mappings) plus one ~8MB upload
 * part is ever resident.
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
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getConfig } from "@thinkwork/runtime-config";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
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
  mergedLosersSkipped: number;
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

/** The three staged files, keyed the same way as BULK_CSV_FILE_NAMES. */
export type BulkCsvKind = keyof typeof BULK_CSV_FILE_NAMES;

/** Emission order — node files before the edge file (R3 reads better with
 * the vertex CSVs first, though the loader sorts this out itself). */
const BULK_CSV_KINDS = ["entityNodes", "systemNodes", "edges"] as const;

export const BULK_CSV_HEADERS: Record<BulkCsvKind, string> = {
  entityNodes:
    ":ID,:LABEL,tenantId:String,canonicalId:String,displayName:String,state:String,mergedInto:String",
  systemNodes: ":ID,:LABEL,tenantId:String,systemSlug:String",
  edges:
    ":ID,:START_ID,:END_ID,:TYPE,tenantId:String,externalId:String,namespace:String",
};

/** One CSV data row, tagged with the file it belongs in. */
export interface BulkCsvRow {
  kind: BulkCsvKind;
  line: string;
}

/**
 * Cross-canonical accumulator for the row builder: the ExternalSystem dedup
 * set and the running counts. Shared by the whole-file builder and the
 * streaming stager so both see one `seenSystems` for the entire run.
 */
export interface BulkRowBuilderState {
  seenSystems: Set<string>;
  counts: BulkLoadCounts;
}

export function createBulkRowBuilderState(): BulkRowBuilderState {
  return {
    seenSystems: new Set<string>(),
    counts: {
      canonicals: 0,
      entityNodes: 0,
      systemNodes: 0,
      externalIdentityEdges: 0,
      mergedLosersSkipped: 0,
    },
  };
}

/**
 * The single source of CSV row format — every rule the bulk lane projects
 * lives here, and both the whole-file builder and the streaming stager go
 * through it so the two can never drift.
 *
 * Rules: merged losers are SKIPPED (counted, no node, no edges) — they exist
 * only relationally (merged_into_id chains in Postgres resolve lineage;
 * nothing traverses the graph for it), and projecting them surfaced raw-uuid
 * ghost nodes in the tenant graph view. Only tenant-visible mappings with a
 * valid source-system slug produce edges and ExternalSystem nodes; a
 * malformed entity_type_slug falls back to the generic `Entity` label. Rows
 * for one canonical are bounded by its mapping count, so the return array is
 * safe to materialize at any tenant size.
 *
 * NO securityGroup column, deliberately (THINK-432). The nudge lane stamps
 * the UNASSIGNED sentinel `ON CREATE`, but this lane cannot do the equivalent:
 * the loader runs with `updateSingleCardinalityProperties: true`, so every
 * column present OVERWRITES that property on nodes that already exist. A
 * blanket `securityGroup=UNASSIGNED` would therefore reset the real group on
 * every previously projected node at each rebuild — briefly blanking the
 * whole graph for every scoped key, which is worse than the gap it closes.
 * Omitting the column leaves existing groups untouched and the nodes this
 * lane CREATES unstamped; the platform's hourly sweep resolves those, and its
 * `ungrouped_nodes_found` alarm is what keeps the gap from going quiet again.
 */
export function bulkCsvRowsForCanonical(args: {
  tenantId: string;
  canonical: CanonicalRowForSync;
  mappings: MappingRowForSync[];
  state: BulkRowBuilderState;
}): BulkCsvRow[] {
  const { tenantId, canonical, state } = args;
  const counts = state.counts;
  counts.canonicals += 1;

  if (canonical.status === "merged") {
    // Loser: not projected. Merge lineage lives in Postgres
    // (merged_into_id); the graph carries only surviving entities.
    counts.mergedLosersSkipped += 1;
    return [];
  }

  const nodeId = entityNodeId(tenantId, canonical.id);
  const label = safeLabel(canonical.entity_type_slug);
  const rows: BulkCsvRow[] = [
    {
      kind: "entityNodes",
      line: [
        csvField(nodeId),
        csvField(label),
        csvField(tenantId),
        csvField(canonical.id),
        csvField(canonical.display_name),
        csvField(canonical.status),
        "", // mergedInto — only merged losers carry it
      ].join(","),
    },
  ];
  counts.entityNodes += 1;

  for (const mapping of args.mappings) {
    if (mapping.visibility !== "tenant") continue;
    const system = mapping.source_system;
    if (!SLUG_RE.test(system)) continue;
    const sysId = systemNodeId(tenantId, system);
    if (!state.seenSystems.has(sysId)) {
      state.seenSystems.add(sysId);
      rows.push({
        kind: "systemNodes",
        line: [
          csvField(sysId),
          "ExternalSystem",
          csvField(tenantId),
          csvField(system),
        ].join(","),
      });
      counts.systemNodes += 1;
    }
    rows.push({
      kind: "edges",
      line: [
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
    });
    counts.externalIdentityEdges += 1;
  }

  return rows;
}

/**
 * Build the node and edge CSV file contents for a tenant's full extract.
 * Byte-compatible with the nudge lane: node/edge ~ids, labels, and
 * property names exactly match what `buildCanonicalResyncOps` MERGEs, so
 * interleaved resyncs and re-runs converge instead of duplicating.
 *
 * Whole-tenant, in-memory form: fine for tests and small extracts, but the
 * bulk-rebuild orchestrator streams through `bulkCsvRowsForCanonical`
 * instead (see the module doc on memory). Both share the row builder, so
 * this file's bytes and the streamed object's bytes are identical.
 */
export function buildBulkLoadCsvFiles(args: {
  tenantId: string;
  canonicals: CanonicalRowForSync[];
  mappingsByCanonical: Map<string, MappingRowForSync[]>;
}): BulkLoadCsvFiles {
  const state = createBulkRowBuilderState();
  const rowsByKind: Record<BulkCsvKind, string[]> = {
    entityNodes: [],
    systemNodes: [],
    edges: [],
  };

  for (const canonical of args.canonicals) {
    const rows = bulkCsvRowsForCanonical({
      tenantId: args.tenantId,
      canonical,
      mappings: args.mappingsByCanonical.get(canonical.id) ?? [],
      state,
    });
    for (const row of rows) {
      rowsByKind[row.kind].push(row.line);
    }
  }

  const files: BulkCsvFile[] = [];
  for (const kind of BULK_CSV_KINDS) {
    const rows = rowsByKind[kind];
    if (rows.length === 0) continue;
    files.push({
      name: BULK_CSV_FILE_NAMES[kind],
      content: [BULK_CSV_HEADERS[kind], ...rows].join("\n") + "\n",
    });
  }

  return { files, counts: state.counts };
}

// ---------------------------------------------------------------------------
// Streaming CSV stager (THINK-409) — one object, bounded memory
// ---------------------------------------------------------------------------

/** S3 multipart minimum part size is 5MB (the last part is exempt); 8MB
 * keeps part counts low without meaningfully moving Lambda RSS. */
const MULTIPART_PART_BYTES = 8 * 1024 * 1024;

/**
 * Writes one CSV to S3 without ever holding the whole file: rows accumulate
 * into a ~8MB buffer that is flushed as a multipart part. A file small
 * enough to never fill a part is written with a plain PutObject — no
 * multipart bookkeeping for the (always tiny) ExternalSystem node file, and
 * one round trip instead of three for small tenants.
 *
 * Byte-compatible with `buildBulkLoadCsvFiles`: header line, rows joined by
 * "\n", trailing "\n". A stager that never saw a row stages NOTHING — the
 * loader must not see an empty file, and the orchestrator's empty-tenant
 * path keys off the staged count.
 */
export class StreamingCsvStager {
  private buffer: string[] = [];
  private bufferBytes = 0;
  private uploadId: string | null = null;
  private parts: Array<{ ETag: string; PartNumber: number }> = [];
  private rows = 0;

  constructor(
    private readonly opts: {
      s3: StagingS3Client;
      bucket: string;
      key: string;
      header: string;
      partBytes?: number;
    },
  ) {}

  get rowCount(): number {
    return this.rows;
  }

  /** True once a multipart upload exists and must be completed or aborted. */
  get isMultipart(): boolean {
    return this.uploadId !== null;
  }

  async writeRow(line: string): Promise<void> {
    if (this.rows === 0) this.append(`${this.opts.header}\n`);
    this.rows += 1;
    this.append(`${line}\n`);
    if (this.bufferBytes >= (this.opts.partBytes ?? MULTIPART_PART_BYTES)) {
      await this.flushPart();
    }
  }

  /** Finish the object. Returns whether anything was staged at all. */
  async finish(): Promise<boolean> {
    if (this.rows === 0) return false;
    if (this.uploadId === null) {
      const body = this.takeBuffer();
      await this.opts.s3.send(
        new PutObjectCommand({
          Bucket: this.opts.bucket,
          Key: this.opts.key,
          Body: body,
          ContentType: "text/csv",
        }),
      );
      return true;
    }
    if (this.bufferBytes > 0) await this.flushPart();
    await this.opts.s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.opts.bucket,
        Key: this.opts.key,
        UploadId: this.uploadId,
        MultipartUpload: { Parts: this.parts },
      }),
    );
    return true;
  }

  /** Best-effort teardown of an in-flight multipart upload — an abandoned
   * upload keeps billable parts around until the bucket lifecycle reaps it. */
  async abort(): Promise<void> {
    if (this.uploadId === null) return;
    const uploadId = this.uploadId;
    this.uploadId = null;
    this.buffer = [];
    this.bufferBytes = 0;
    try {
      await this.opts.s3.send(
        new AbortMultipartUploadCommand({
          Bucket: this.opts.bucket,
          Key: this.opts.key,
          UploadId: uploadId,
        }),
      );
    } catch (err) {
      console.warn("[bulk-rebuild] multipart abort failed (harmless)", {
        key: this.opts.key,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private append(chunk: string): void {
    this.buffer.push(chunk);
    this.bufferBytes += Buffer.byteLength(chunk);
  }

  private takeBuffer(): string {
    const body = this.buffer.join("");
    this.buffer = [];
    this.bufferBytes = 0;
    return body;
  }

  private async flushPart(): Promise<void> {
    if (this.uploadId === null) {
      const created = (await this.opts.s3.send(
        new CreateMultipartUploadCommand({
          Bucket: this.opts.bucket,
          Key: this.opts.key,
          ContentType: "text/csv",
        }),
      )) as { UploadId?: string };
      if (!created.UploadId) {
        throw new Error(
          `CreateMultipartUpload returned no UploadId for ${this.opts.key}`,
        );
      }
      this.uploadId = created.UploadId;
    }
    const partNumber = this.parts.length + 1;
    const uploaded = (await this.opts.s3.send(
      new UploadPartCommand({
        Bucket: this.opts.bucket,
        Key: this.opts.key,
        UploadId: this.uploadId,
        PartNumber: partNumber,
        Body: this.takeBuffer(),
      }),
    )) as { ETag?: string };
    this.parts.push({ ETag: uploaded.ETag ?? "", PartNumber: partNumber });
  }
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
  /** Canonicals per keyset page during extract (tests use tiny pages). */
  extractPageSize?: number;
  /** Bytes buffered before a multipart part is flushed (tests use tiny parts). */
  uploadPartBytes?: number;
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
/** Keyset page size for the canonical extract. Big enough that the page
 * round trips don't dominate a multi-million-row tenant, small enough that
 * a page plus its mappings is a rounding error against Lambda memory. */
const DEFAULT_EXTRACT_PAGE_SIZE = 5_000;

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

    // Extract + stage as one streaming pass (THINK-409): canonicals are read
    // a keyset page at a time, each page's mappings are fetched and grouped
    // for that page only, and rows go straight into the S3 stagers. Peak
    // residency is one page plus one upload part — flat at any tenant size.
    phase = "extract";
    if (deadlineNear()) throw new Error("deadline reached before extract");
    const pageSize = args.extractPageSize ?? DEFAULT_EXTRACT_PAGE_SIZE;
    const prefix = stagingPrefix(tenantId, randomUUID());
    const stagers = Object.fromEntries(
      BULK_CSV_KINDS.map((kind) => [
        kind,
        new StreamingCsvStager({
          s3,
          bucket: loadBucket,
          key: `${prefix}${BULK_CSV_FILE_NAMES[kind]}`,
          header: BULK_CSV_HEADERS[kind],
          partBytes: args.uploadPartBytes,
        }),
      ]),
    ) as Record<BulkCsvKind, StreamingCsvStager>;
    const rowState = createBulkRowBuilderState();
    const counts = rowState.counts;
    let stagedFiles = 0;

    try {
      let afterId: string | null = null;
      for (;;) {
        const page = (await db
          .select({
            id: canonicalEntities.id,
            entity_type_slug: canonicalEntities.entity_type_slug,
            display_name: canonicalEntities.display_name,
            status: canonicalEntities.status,
            merged_into_id: canonicalEntities.merged_into_id,
          })
          .from(canonicalEntities)
          .where(
            afterId === null
              ? eq(canonicalEntities.tenant_id, tenantId)
              : and(
                  eq(canonicalEntities.tenant_id, tenantId),
                  gt(canonicalEntities.id, afterId),
                ),
          )
          .orderBy(asc(canonicalEntities.id))
          .limit(pageSize)) as CanonicalRowForSync[];
        if (page.length === 0) break;
        afterId = page[page.length - 1].id;

        // Mappings for THIS page only. `seenSystems` lives in rowState, so
        // ExternalSystem dedup still spans the whole run.
        const mappingRows = await db
          .select({
            canonical_entity_id: entitySourceMappings.canonical_entity_id,
            source_system: entitySourceMappings.source_system,
            namespace: entitySourceMappings.namespace,
            external_id: entitySourceMappings.external_id,
            visibility: entitySourceMappings.visibility,
          })
          .from(entitySourceMappings)
          .where(
            and(
              eq(entitySourceMappings.tenant_id, tenantId),
              inArray(
                entitySourceMappings.canonical_entity_id,
                page.map((row) => row.id),
              ),
            ),
          );
        const mappingsByCanonical = new Map<string, MappingRowForSync[]>();
        for (const row of mappingRows) {
          const list = mappingsByCanonical.get(row.canonical_entity_id) ?? [];
          list.push(row);
          mappingsByCanonical.set(row.canonical_entity_id, list);
        }

        for (const canonical of page) {
          const rows = bulkCsvRowsForCanonical({
            tenantId,
            canonical,
            mappings: mappingsByCanonical.get(canonical.id) ?? [],
            state: rowState,
          });
          for (const row of rows) {
            await stagers[row.kind].writeRow(row.line);
          }
        }

        if (page.length < pageSize) break;
        // Between pages only — a trip here throws so the catch below aborts
        // the in-flight multipart uploads and the outer catch releases the
        // fence (nothing has started on the loader side yet).
        if (deadlineNear()) throw new Error("deadline reached during extract");
      }

      phase = "upload";
      for (const kind of BULK_CSV_KINDS) {
        if (deadlineNear()) throw new Error("deadline reached during upload");
        if (await stagers[kind].finish()) stagedFiles += 1;
      }
    } catch (err) {
      await Promise.all(BULK_CSV_KINDS.map((kind) => stagers[kind].abort()));
      throw err;
    }

    if (stagedFiles === 0) {
      // Empty tenant: nothing staged, nothing to load — success tail
      // without a loader job.
      return await finalizeSuccess(null, null, counts);
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
