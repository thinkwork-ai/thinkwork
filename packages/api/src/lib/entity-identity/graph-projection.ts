/**
 * Identity → twin graph projector (Company Brain U5 / KTD-4).
 *
 * Every identity write (create, link/confirm, merge, split, revoke) reaches
 * the Neptune twin through this durable, replayable, per-tenant-serialized
 * consumer of the append-only `identity.entity_resolution_events` stream.
 * The relational store stays the identity system of record; the graph is a
 * read surface, rebuildable at any time.
 *
 * Convergent-by-construction: events are TRIGGERS, not payload-authoritative
 * — for each affected canonical entity the projector re-reads the CURRENT
 * relational rows (canonical + its source mappings) and upserts the graph to
 * match, deleting graph edges the relational store no longer holds. Replay
 * from a zeroed cursor therefore reproduces the same graph, and a missed
 * nudge is harmless (the cursor is the source of truth; the invoke is only
 * latency).
 *
 * Deterministic IDs (KTD-1, mirrored by the etl twin projection):
 *
 *     entity node   t#<tenant>#e#<canonicalId>     label = entity type slug
 *     system node   t#<tenant>#sys#<systemSlug>    label = ExternalSystem
 *     system edge   t#<tenant>#x#<canonicalId>#<systemSlug>#<namespace>
 *                   type = external_identity, carries externalId (R1/R7)
 *
 * Merge (KTD-4): the loser node is DETACH DELETEd — merge lineage stays
 * relational (merged_into_id chains in Postgres; matcher and GraphQL
 * resolve them there) and projected losers were raw-uuid ghosts in the
 * tenant graph view. The identity-mapping snapshot this module cuts
 * (KTD-3) carries the loser→survivor redirect so the etl facet-upsert
 * path lands on the survivor instead of resurrecting the deleted node.
 *
 * The snapshot (`identity-mapping-snapshot/v1`) is cut off the same cursor
 * after each projection pass, to the brain-artifacts bucket at
 * `twin-identity/<tenantId>/latest.json` — the ONLY identity input the etl
 * twin projection reads (node IDs never derive from natural keys).
 */

import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { getConfig } from "@thinkwork/runtime-config";
import {
  ExecuteOpenCypherQueryCommand,
  NeptunedataClient,
} from "@aws-sdk/client-neptunedata";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  canonicalEntities,
  entityResolutionEvents,
  entitySourceMappings,
  identityGraphProjectionCursors,
} from "@thinkwork/database-pg/schema";
import { db as defaultDb } from "../db.js";

type DbLike = typeof defaultDb;

export const IDENTITY_SNAPSHOT_FORMAT = "identity-mapping-snapshot/v1";

/**
 * The security group a writer stamps when it creates a node WITHOUT knowing
 * the entity type's real assignment — this lane's case (THINK-432).
 *
 * Mirrors `UNASSIGNED_SECURITY_GROUP` in the platform repo
 * (etl-platform/pipelines/mapspec/neptune_target.py), which is where it is
 * enforced: no spec, mapping export or registry entry may assign it, so no
 * API key can ever be granted it.
 *
 * Deliberately NOT "PUBLIC". PUBLIC is fail-OPEN the moment an entity type is
 * restricted — a newly minted node would be visible to every key until the
 * platform's projection restamped it. A node on the sentinel is exactly as
 * invisible as an unstamped one, while being findable, countable and
 * alarmable, which a missing property is not. The platform's hourly sweep
 * resolves it to the real group.
 */
const UNASSIGNED_SECURITY_GROUP = "UNASSIGNED";

const EVENT_PAGE_SIZE = 200;
const RESYNC_CHUNK = 50;
const SLUG_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,62}$/;

/** Injectable Neptune seam — the writer-IAM neptunedata client in prod. */
export interface NeptuneQueryClient {
  execute(query: string, parameters: Record<string, unknown>): Promise<unknown>;
}

export function createNeptuneClient(args?: {
  endpoint?: string;
  port?: number;
}): NeptuneQueryClient {
  const endpoint = args?.endpoint ?? getConfig("NEPTUNE_ENDPOINT") ?? "";
  const port = args?.port ?? Number(process.env.NEPTUNE_PORT ?? "8182");
  if (!endpoint) {
    throw new Error("NEPTUNE_ENDPOINT is not configured");
  }
  const client = new NeptunedataClient({
    endpoint: `https://${endpoint}:${port}`,
  });
  return {
    async execute(query, parameters) {
      return client.send(
        new ExecuteOpenCypherQueryCommand({
          openCypherQuery: query,
          parameters: JSON.stringify(parameters),
        }),
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Deterministic IDs (keep in lock-step with the etl twin projection)
// ---------------------------------------------------------------------------

export function entityNodeId(tenantId: string, canonicalId: string): string {
  return `t#${tenantId}#e#${canonicalId}`;
}

export function systemNodeId(tenantId: string, systemSlug: string): string {
  return `t#${tenantId}#sys#${systemSlug}`;
}

export function systemEdgeId(
  tenantId: string,
  canonicalId: string,
  systemSlug: string,
  namespace: string,
): string {
  return `t#${tenantId}#x#${canonicalId}#${systemSlug}${namespace ? `#${namespace}` : ""}`;
}

export function safeLabel(slug: string): string {
  if (!SLUG_RE.test(slug)) {
    // Governed slugs should never hit this; a malformed one must not reach
    // query text. Fall back to the generic label rather than fail identity
    // projection outright.
    return "Entity";
  }
  return slug;
}

// ---------------------------------------------------------------------------
// Pure op builders (unit-tested without I/O)
// ---------------------------------------------------------------------------

export interface GraphOp {
  query: string;
  parameters: Record<string, unknown>;
}

export interface CanonicalRowForSync {
  id: string;
  entity_type_slug: string;
  display_name: string;
  status: string;
  merged_into_id: string | null;
}

export interface MappingRowForSync {
  source_system: string;
  namespace: string;
  external_id: string;
  visibility: string;
}

/**
 * Ops that make the graph match one canonical entity's current relational
 * state: upsert the entity node, upsert system nodes + external_identity
 * edges for every current tenant-visible mapping, drop stale
 * external_identity edges, and DETACH DELETE merged losers (lineage stays
 * relational; the graph carries only surviving entities).
 */
export function buildCanonicalResyncOps(args: {
  tenantId: string;
  canonical: CanonicalRowForSync;
  mappings: MappingRowForSync[];
}): GraphOp[] {
  const { tenantId, canonical } = args;
  const nodeId = entityNodeId(tenantId, canonical.id);
  const label = safeLabel(canonical.entity_type_slug);
  const ops: GraphOp[] = [];

  if (canonical.status === "merged") {
    // The loser leaves the graph entirely. Merge lineage stays relational
    // (merged_into_id chains in Postgres; matcher/GraphQL resolve them
    // there) — projected loser nodes were raw-uuid ghosts in the tenant
    // graph view with nothing traversing their alias edge. DETACH also
    // drops the external_identity edges the relational merge repointed;
    // the survivor's own resync recreates its set. MATCH (not MERGE) so a
    // loser already absent — e.g. loaded after this rule — is a no-op
    // rather than a mint-then-delete.
    ops.push({
      query: "MATCH (n {`~id`: $nodeId}) DETACH DELETE n",
      parameters: { nodeId },
    });
    return ops;
  }

  ops.push({
    query:
      `MERGE (n:${label} {\`~id\`: $nodeId}) ` +
      // The Brain's query guard filters every node pattern to the calling
      // key's granted security groups plus PUBLIC, and a node with no group
      // matches nothing — so an unstamped node is invisible to every scoped
      // key. That is silent data loss, not a leak, which is why it went
      // unnoticed until TEI had accumulated 12,129 of them (THINK-432).
      //
      // This lane cannot know the real group: the assignment lives in the
      // platform's twin-mapping export, per entity type, and reading it from
      // this hot path would couple the two repos through an artifact that has
      // already proven it can go stale. So it stamps the sentinel and the
      // platform's projection resolves it to the real group on its next pass.
      //
      // ON CREATE, never on match: once the projection has stamped the real
      // group, a resync must not push the node back to UNASSIGNED. The rest
      // of this statement stays an unconditional SET — display name and state
      // ARE this lane's to own.
      `ON CREATE SET n.securityGroup = '${UNASSIGNED_SECURITY_GROUP}' ` +
      "SET n.tenantId = $tenantId, n.canonicalId = $canonicalId, " +
      "n.displayName = $displayName, n.state = $state " +
      "REMOVE n.mergedInto",
    parameters: {
      nodeId,
      tenantId,
      canonicalId: canonical.id,
      displayName: canonical.display_name,
      state: canonical.status,
    },
  });

  const tenantMappings = args.mappings.filter(
    (mapping) => mapping.visibility === "tenant",
  );
  const edgeIds: string[] = [];
  for (const mapping of tenantMappings) {
    const system = mapping.source_system;
    if (!SLUG_RE.test(system)) continue;
    const sysId = systemNodeId(tenantId, system);
    const edgeId = systemEdgeId(
      tenantId,
      canonical.id,
      system,
      mapping.namespace,
    );
    edgeIds.push(edgeId);
    ops.push({
      query:
        "MERGE (sys:ExternalSystem {`~id`: $sysId}) " +
        // Same reasoning as the entity node above: an ExternalSystem node
        // with no group is invisible to every scoped key, which would break
        // provenance traversal rather than protect anything (THINK-432).
        `ON CREATE SET sys.securityGroup = '${UNASSIGNED_SECURITY_GROUP}' ` +
        "SET sys.tenantId = $tenantId, sys.systemSlug = $system " +
        "WITH sys MATCH (n {`~id`: $nodeId}) " +
        "MERGE (n)-[x:external_identity {`~id`: $edgeId}]->(sys) " +
        "SET x.tenantId = $tenantId, x.externalId = $externalId, " +
        "x.namespace = $namespace",
      parameters: {
        sysId,
        tenantId,
        system,
        nodeId,
        edgeId,
        externalId: mapping.external_id,
        namespace: mapping.namespace,
      },
    });
  }

  // Convergence: drop external_identity edges the relational store no
  // longer holds (revoke/split repoints land here).
  ops.push({
    query:
      "MATCH (n {`~id`: $nodeId})-[r:external_identity]->() " +
      "WHERE NOT r.`~id` IN $keepIds DELETE r",
    parameters: { nodeId, keepIds: edgeIds },
  });

  return ops;
}

// ---------------------------------------------------------------------------
// Snapshot cutting (KTD-3)
// ---------------------------------------------------------------------------

export interface IdentitySnapshotDoc {
  format: typeof IDENTITY_SNAPSHOT_FORMAT;
  tenantId: string;
  cursor: string;
  cutAt: string;
  mappings: Array<{
    sourceSystem: string;
    externalId: string;
    canonicalEntityId: string;
    entityTypeSlug: string;
  }>;
  redirects: Array<{
    fromCanonicalEntityId: string;
    toCanonicalEntityId: string;
  }>;
}

export async function buildIdentitySnapshot(args: {
  tenantId: string;
  cursor: string;
  db?: DbLike;
  now?: Date;
}): Promise<IdentitySnapshotDoc> {
  const db = args.db ?? defaultDb;

  const mappingRows = await db
    .select({
      source_system: entitySourceMappings.source_system,
      external_id: entitySourceMappings.external_id,
      canonical_entity_id: entitySourceMappings.canonical_entity_id,
      visibility: entitySourceMappings.visibility,
      entity_type_slug: canonicalEntities.entity_type_slug,
      status: canonicalEntities.status,
      merged_into_id: canonicalEntities.merged_into_id,
    })
    .from(entitySourceMappings)
    .innerJoin(
      canonicalEntities,
      eq(entitySourceMappings.canonical_entity_id, canonicalEntities.id),
    )
    .where(eq(entitySourceMappings.tenant_id, args.tenantId));

  const redirectRows = await db
    .select({
      id: canonicalEntities.id,
      merged_into_id: canonicalEntities.merged_into_id,
    })
    .from(canonicalEntities)
    .where(
      and(
        eq(canonicalEntities.tenant_id, args.tenantId),
        eq(canonicalEntities.status, "merged"),
      ),
    );

  return {
    format: IDENTITY_SNAPSHOT_FORMAT,
    tenantId: args.tenantId,
    cursor: args.cursor,
    cutAt: (args.now ?? new Date()).toISOString(),
    mappings: mappingRows
      .filter((row) => row.visibility === "tenant" && row.status !== "archived")
      .map((row) => ({
        sourceSystem: row.source_system,
        externalId: row.external_id,
        canonicalEntityId: row.canonical_entity_id,
        entityTypeSlug: row.entity_type_slug,
      })),
    redirects: redirectRows
      .filter((row) => row.merged_into_id != null)
      .map((row) => ({
        fromCanonicalEntityId: row.id,
        toCanonicalEntityId: row.merged_into_id as string,
      })),
  };
}

type SnapshotS3Client = Pick<S3Client, "send">;

/** S3 multipart minimum part size is 5MB (the last part is exempt); 8MB
 * matches the bulk-rebuild CSV stager and keeps part counts low. */
const SNAPSHOT_PART_BYTES = 8 * 1024 * 1024;

/**
 * Serializes the snapshot as compact JSON in pieces, ONE ROW AT A TIME.
 *
 * The document emitted here is byte-identical to `JSON.stringify(snapshot)`
 * for a snapshot whose keys are in declaration order: the twin writer
 * `json.loads`es it and the schema must not move.
 */
export function* iterateIdentitySnapshotJson(
  snapshot: IdentitySnapshotDoc,
): Generator<string> {
  yield (
    `{"format":${JSON.stringify(snapshot.format)},` +
    `"tenantId":${JSON.stringify(snapshot.tenantId)},` +
    `"cursor":${JSON.stringify(snapshot.cursor)},` +
    `"cutAt":${JSON.stringify(snapshot.cutAt)},` +
    `"mappings":[`
  );
  for (let i = 0; i < snapshot.mappings.length; i += 1) {
    yield (i === 0 ? "" : ",") + JSON.stringify(snapshot.mappings[i]);
  }
  yield `],"redirects":[`;
  for (let i = 0; i < snapshot.redirects.length; i += 1) {
    yield (i === 0 ? "" : ",") + JSON.stringify(snapshot.redirects[i]);
  }
  yield "]}";
}

/**
 * Write the identity snapshot to S3 WITHOUT ever holding the whole document
 * as a single JavaScript string.
 *
 * History, because the ceiling here moves with tenant size and the next
 * person will otherwise re-learn it the hard way: this call used to be
 * `JSON.stringify(snapshot, null, 2)`, which blew V8's maximum string length
 * (~512MB) once TEI reached ~800k canonicals. Dropping the pretty-print
 * (#4157) roughly halved the string and bought headroom — but only headroom.
 * When TEI's identity registration then grew by ~1.36M order_item mappings,
 * the COMPACT string exceeded the cap too and every bulk-rebuild died with
 * "Invalid string length" again (24s in, 2.8GB of an 8GB heap — memory was
 * never the constraint; the single-string cap was).
 *
 * So the document is streamed: `iterateIdentitySnapshotJson` stringifies each
 * mapping/redirect row on its own (a few hundred characters, never anywhere
 * near the cap), pieces accumulate into a ~8MB buffer, and each full buffer
 * is flushed as an S3 multipart part. Nothing scales with tenant size except
 * the number of parts. Snapshots small enough never to fill a part take a
 * plain PutObject — one round trip instead of three, and no multipart
 * bookkeeping for the tenants that are the common case.
 *
 * The row ARRAYS still materialize in `buildIdentitySnapshot`; that is fine
 * (2.8GB of 8GB at TEI scale) and deliberately left alone.
 */
export async function uploadIdentitySnapshot(args: {
  snapshot: IdentitySnapshotDoc;
  s3?: SnapshotS3Client;
  bucket?: string;
  /** Bytes buffered before a multipart part is flushed (tests use tiny parts). */
  partBytes?: number;
}): Promise<{ uploaded: boolean; key?: string }> {
  const bucket = args.bucket ?? getConfig("BRAIN_ARTIFACTS_BUCKET") ?? null;
  if (!bucket) return { uploaded: false };
  const s3 = args.s3 ?? new S3Client({});
  const key = `twin-identity/${args.snapshot.tenantId}/latest.json`;
  const partBytes = args.partBytes ?? SNAPSHOT_PART_BYTES;
  const contentType = "application/json";
  const metadata = { identity_snapshot_cursor: args.snapshot.cursor };

  let buffer: string[] = [];
  let bufferBytes = 0;
  let uploadId: string | null = null;
  const parts: Array<{ ETag: string; PartNumber: number }> = [];

  const takeBuffer = (): string => {
    const body = buffer.join("");
    buffer = [];
    bufferBytes = 0;
    return body;
  };

  const flushPart = async (): Promise<void> => {
    if (uploadId === null) {
      const created = (await s3.send(
        new CreateMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          ContentType: contentType,
          Metadata: metadata,
        }),
      )) as { UploadId?: string };
      if (!created.UploadId) {
        throw new Error(`CreateMultipartUpload returned no UploadId for ${key}`);
      }
      uploadId = created.UploadId;
    }
    const partNumber = parts.length + 1;
    const uploaded = (await s3.send(
      new UploadPartCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
        Body: takeBuffer(),
      }),
    )) as { ETag?: string };
    parts.push({ ETag: uploaded.ETag ?? "", PartNumber: partNumber });
  };

  try {
    for (const chunk of iterateIdentitySnapshotJson(args.snapshot)) {
      buffer.push(chunk);
      bufferBytes += Buffer.byteLength(chunk);
      if (bufferBytes >= partBytes) await flushPart();
    }

    if (uploadId === null) {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: takeBuffer(),
          ContentType: contentType,
          Metadata: metadata,
        }),
      );
      return { uploaded: true, key };
    }

    if (bufferBytes > 0) await flushPart();
    await s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
      }),
    );
    return { uploaded: true, key };
  } catch (err) {
    // An abandoned multipart upload keeps billable parts around until the
    // bucket lifecycle reaps it. Best-effort teardown, then rethrow.
    if (uploadId !== null) {
      try {
        await s3.send(
          new AbortMultipartUploadCommand({
            Bucket: bucket,
            Key: key,
            UploadId: uploadId,
          }),
        );
      } catch (abortErr) {
        console.warn("[identity-graph-projector] snapshot abort failed", {
          key,
          error: abortErr instanceof Error ? abortErr.message : String(abortErr),
        });
      }
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Projection pass
// ---------------------------------------------------------------------------

export interface ProjectionPassResult {
  tenantId: string;
  processedEvents: number;
  resyncedCanonicals: number;
  cursor: string | null;
  snapshotUploaded: boolean;
  drained: boolean;
}

/**
 * Process pending resolution events for one tenant: page events after the
 * cursor, resync every affected canonical, advance the cursor, cut + upload
 * the identity snapshot. Serialized per tenant by the caller (the Lambda
 * handler processes tenants sequentially; concurrent invokes are safe —
 * resyncs are idempotent and the cursor only moves forward).
 */
export async function projectPendingIdentityEvents(args: {
  tenantId: string;
  db?: DbLike;
  neptune?: NeptuneQueryClient;
  s3?: SnapshotS3Client;
  maxEvents?: number;
  now?: Date;
}): Promise<ProjectionPassResult> {
  const db = args.db ?? defaultDb;
  const neptune = args.neptune ?? createNeptuneClient();
  const maxEvents = args.maxEvents ?? EVENT_PAGE_SIZE;

  const [cursorRow] = await db
    .select()
    .from(identityGraphProjectionCursors)
    .where(eq(identityGraphProjectionCursors.tenant_id, args.tenantId))
    .limit(1);

  const afterCreatedAt = cursorRow?.last_event_created_at ?? null;

  // The (created_at, id) comparison stays ENTIRELY in SQL. Postgres stores
  // microseconds; a JS Date only carries milliseconds, so round-tripping the
  // cursor timestamp through a query parameter truncates it to strictly
  // BEFORE every event it was cut from. With bulk-inserted events (one
  // transaction ⇒ identical created_at) that re-matched the same first page
  // forever — seen live on the 2026-07-22 TEI seed (3,751 events, cursor
  // pinned, 20 passes × 200 events per invoke, never drained).
  const events = await db
    .select({
      id: entityResolutionEvents.id,
      event_type: entityResolutionEvents.event_type,
      canonical_entity_id: entityResolutionEvents.canonical_entity_id,
      payload: entityResolutionEvents.payload,
      created_at: entityResolutionEvents.created_at,
    })
    .from(entityResolutionEvents)
    .where(
      afterCreatedAt
        ? and(
            eq(entityResolutionEvents.tenant_id, args.tenantId),
            sql`(${entityResolutionEvents.created_at}, ${entityResolutionEvents.id}) > (
              SELECT c.last_event_created_at,
                     COALESCE(c.last_event_id, '00000000-0000-0000-0000-000000000000'::uuid)
              FROM identity.graph_projection_cursors c
              WHERE c.tenant_id = ${args.tenantId}
            )`,
          )
        : eq(entityResolutionEvents.tenant_id, args.tenantId),
    )
    .orderBy(
      asc(entityResolutionEvents.created_at),
      asc(entityResolutionEvents.id),
    )
    .limit(maxEvents);

  if (events.length === 0) {
    return {
      tenantId: args.tenantId,
      processedEvents: 0,
      resyncedCanonicals: 0,
      cursor: cursorRow?.last_snapshot_cursor ?? null,
      snapshotUploaded: false,
      drained: true,
    };
  }

  // Collect affected canonicals. defer/reject touch no graph state.
  const canonicalIds = new Set<string>();
  for (const event of events) {
    if (event.event_type === "defer" || event.event_type === "reject") continue;
    if (event.canonical_entity_id) canonicalIds.add(event.canonical_entity_id);
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    for (const key of ["loserId", "survivorId", "entityAId", "entityBId"]) {
      const value = payload[key];
      if (typeof value === "string" && value) canonicalIds.add(value);
    }
  }

  let resynced = 0;
  const idList = [...canonicalIds];
  for (let i = 0; i < idList.length; i += RESYNC_CHUNK) {
    const chunkIds = idList.slice(i, i + RESYNC_CHUNK);
    const canonicalRows = await db
      .select({
        id: canonicalEntities.id,
        entity_type_slug: canonicalEntities.entity_type_slug,
        display_name: canonicalEntities.display_name,
        status: canonicalEntities.status,
        merged_into_id: canonicalEntities.merged_into_id,
      })
      .from(canonicalEntities)
      .where(
        and(
          eq(canonicalEntities.tenant_id, args.tenantId),
          inArray(canonicalEntities.id, chunkIds),
        ),
      );
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
          eq(entitySourceMappings.tenant_id, args.tenantId),
          inArray(entitySourceMappings.canonical_entity_id, chunkIds),
        ),
      );
    const mappingsByCanonical = new Map<string, MappingRowForSync[]>();
    for (const row of mappingRows) {
      const list = mappingsByCanonical.get(row.canonical_entity_id) ?? [];
      list.push(row);
      mappingsByCanonical.set(row.canonical_entity_id, list);
    }

    for (const canonical of canonicalRows) {
      const ops = buildCanonicalResyncOps({
        tenantId: args.tenantId,
        canonical,
        mappings: mappingsByCanonical.get(canonical.id) ?? [],
      });
      for (const op of ops) {
        await neptune.execute(op.query, op.parameters);
      }
      resynced += 1;
    }
  }

  const last = events[events.length - 1];
  const cursor = `${last.created_at.toISOString()}#${last.id}`;

  const snapshot = await buildIdentitySnapshot({
    tenantId: args.tenantId,
    cursor,
    db,
    now: args.now,
  });
  const upload = await uploadIdentitySnapshot({ snapshot, s3: args.s3 });

  // Persist the timestamp from the event ROW, not the JS Date — the Date is
  // already truncated to milliseconds (see the page-query comment above).
  const lastCreatedAtExact = sql`(SELECT created_at FROM identity.entity_resolution_events WHERE id = ${last.id})`;
  await db
    .insert(identityGraphProjectionCursors)
    .values({
      tenant_id: args.tenantId,
      last_event_created_at: lastCreatedAtExact as unknown as Date,
      last_event_id: last.id,
      last_snapshot_cursor: cursor,
      updated_at: args.now ?? new Date(),
    })
    .onConflictDoUpdate({
      target: [identityGraphProjectionCursors.tenant_id],
      set: {
        last_event_created_at: lastCreatedAtExact as unknown as Date,
        last_event_id: last.id,
        last_snapshot_cursor: cursor,
        updated_at: args.now ?? new Date(),
      },
    });

  return {
    tenantId: args.tenantId,
    processedEvents: events.length,
    resyncedCanonicals: resynced,
    cursor,
    snapshotUploaded: upload.uploaded,
    drained: events.length < maxEvents,
  };
}

/**
 * First numeric leaf in a Neptune openCypher result — count reads must not
 * depend on the SDK's exact envelope shape (verify-wire-format rule). A
 * shape we can't read returns null, which the clear loop treats as "keep
 * going" rather than a premature break.
 */
export function readSingleCount(result: unknown): number | null {
  if (typeof result === "number") return result;
  if (!result || typeof result !== "object") return null;
  const record = result as Record<string, unknown>;
  // Scope to the query payload when present — the SDK envelope carries
  // $metadata.httpStatusCode, which a blind numeric walk would return.
  const scope = "results" in record ? record.results : record;
  if (typeof scope === "number") return scope;
  if (!scope || typeof scope !== "object") return null;
  for (const [key, value] of Object.entries(scope as Record<string, unknown>)) {
    if (key.startsWith("$")) continue;
    const found = readSingleCount(value);
    if (found !== null) return found;
  }
  return null;
}

/**
 * Drop a tenant's ENTIRE twin subgraph. Batched DETACH DELETE, fenced by
 * the tenant's deterministic ~id PREFIX rather than a property match: the
 * pre-label-fix loser path minted survivor nodes with NO properties at
 * all, and a {tenantId: …} match walks straight past those ghosts (which
 * is how the first clearing rebuild still collided). The id prefix is the
 * tenant firewall by construction.
 *
 * Destroys etl-synced facet properties — the etl twin_batch ledger is
 * skip-on-hit, so cleared facets stay gone until NEW batches arrive; pair
 * clear-rebuilds with a facet re-sync. Shared machinery kept from the
 * retired replay rebuild (THINK-331 KTD-2); the only caller today is the
 * bulk-rebuild lane's `clear: true` path.
 *
 * `shouldStop` is the caller's deadline guard — checked before each batch;
 * a trip returns { cleared: false } with the remaining subgraph intact.
 */
export async function clearTenantSubgraph(args: {
  tenantId: string;
  neptune?: NeptuneQueryClient;
  shouldStop?: () => boolean;
}): Promise<{ cleared: boolean }> {
  const neptune = args.neptune ?? createNeptuneClient();
  const idPrefix = `t#${args.tenantId}#`;
  for (let round = 0; round < 200; round += 1) {
    if (args.shouldStop?.()) return { cleared: false };
    await neptune.execute(
      "MATCH (n) WHERE id(n) STARTS WITH $idPrefix " +
        "WITH n LIMIT 2000 DETACH DELETE n",
      { idPrefix },
    );
    const remaining = await neptune.execute(
      "MATCH (n) WHERE id(n) STARTS WITH $idPrefix RETURN count(n) AS c",
      { idPrefix },
    );
    if (readSingleCount(remaining) === 0) break;
  }
  return { cleared: true };
}

// ---------------------------------------------------------------------------
// Nudge (fire-and-forget; cursor makes missed nudges harmless)
// ---------------------------------------------------------------------------

let lambdaClient: LambdaClient | null = null;

/**
 * Best-effort Event invoke of the projector Lambda after an identity write
 * commits. NEVER throws and never blocks the caller — projection failure
 * must not fail the relational write (KTD-4). Mirrors the wiki-compile
 * enqueue posture: the cursor row is the recovery path.
 */
export async function nudgeIdentityGraphProjector(
  tenantId: string,
): Promise<void> {
  try {
    const stage = process.env.STAGE ?? "";
    if (!stage || !getConfig("NEPTUNE_ENDPOINT")) return; // twin not deployed
    lambdaClient ??= new LambdaClient({});
    await lambdaClient.send(
      new InvokeCommand({
        FunctionName: `thinkwork-${stage}-api-identity-graph-projector`,
        InvocationType: "Event",
        Payload: Buffer.from(JSON.stringify({ tenantId, mode: "nudge" })),
      }),
    );
  } catch (err) {
    console.warn("[identity-graph-projector] nudge failed (harmless)", {
      tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
