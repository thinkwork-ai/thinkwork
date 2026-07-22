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
 *     alias edge    t#<tenant>#m#<loserId>         type = merged_into
 *
 * Merge (KTD-4): the loser node retires (state='merged', mergedInto set),
 * its external_identity edges drop (the relational merge already repointed
 * the mappings — the survivor resync recreates them), and a merged_into
 * alias edge redirects traversals. The identity-mapping snapshot this
 * module cuts (KTD-3) carries the same redirect so the etl facet-upsert
 * path lands on the survivor instead of resurrecting the retired node.
 *
 * The snapshot (`identity-mapping-snapshot/v1`) is cut off the same cursor
 * after each projection pass, to the brain-artifacts bucket at
 * `twin-identity/<tenantId>/latest.json` — the ONLY identity input the etl
 * twin projection reads (node IDs never derive from natural keys).
 */

import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import {
  ExecuteOpenCypherQueryCommand,
  NeptunedataClient,
} from "@aws-sdk/client-neptunedata";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { and, asc, eq, gt, inArray, or, sql } from "drizzle-orm";
import {
  canonicalEntities,
  entityResolutionEvents,
  entitySourceMappings,
  identityGraphProjectionCursors,
} from "@thinkwork/database-pg/schema";
import { db as defaultDb } from "../db.js";

type DbLike = typeof defaultDb;

export const IDENTITY_SNAPSHOT_FORMAT = "identity-mapping-snapshot/v1";

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
  const endpoint = args?.endpoint ?? process.env.NEPTUNE_ENDPOINT ?? "";
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

function safeLabel(slug: string): string {
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
 * external_identity edges, and (for merged losers) retire the node behind a
 * merged_into alias edge.
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

  if (canonical.status === "merged" && canonical.merged_into_id) {
    const survivorNodeId = entityNodeId(tenantId, canonical.merged_into_id);
    // Retire the loser: mark it, drop its external_identity edges (the
    // relational merge repointed the mappings; the survivor's resync
    // recreates them), and lay the alias edge for traversals.
    //
    // BOTH MERGE patterns carry the entity-type label. Neptune's MERGE
    // treats a label mismatch as create-with-same-~id — "Cannot create
    // node; id already in use" — so an UNLABELED merge here would mint a
    // label-less survivor whenever the loser is resynced first, and the
    // survivor's own labeled resync would then explode (seen live on the
    // first dev rebuild, 2026-07-22). Merges are same-type, so the loser's
    // label is the survivor's label.
    ops.push({
      query:
        `MERGE (n:${label} {\`~id\`: $nodeId}) ` +
        "SET n.tenantId = $tenantId, n.canonicalId = $canonicalId, " +
        "n.state = 'merged', n.mergedInto = $mergedInto",
      parameters: {
        nodeId,
        tenantId,
        canonicalId: canonical.id,
        mergedInto: canonical.merged_into_id,
      },
    });
    ops.push({
      query: "MATCH (n {`~id`: $nodeId})-[r:external_identity]->() DELETE r",
      parameters: { nodeId },
    });
    ops.push({
      query:
        `MERGE (loser:${label} {\`~id\`: $nodeId}) ` +
        `MERGE (survivor:${label} {\`~id\`: $survivorId}) ` +
        "MERGE (loser)-[a:merged_into {`~id`: $aliasId}]->(survivor) " +
        // Stamp the survivor too: a survivor first minted here must never
        // be a property-less ghost invisible to tenant-scoped maintenance.
        "SET a.tenantId = $tenantId, survivor.tenantId = $tenantId",
      parameters: {
        nodeId,
        survivorId: survivorNodeId,
        aliasId: `t#${tenantId}#m#${canonical.id}`,
        tenantId,
      },
    });
    return ops;
  }

  ops.push({
    query:
      `MERGE (n:${label} {\`~id\`: $nodeId}) ` +
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

export async function uploadIdentitySnapshot(args: {
  snapshot: IdentitySnapshotDoc;
  s3?: SnapshotS3Client;
  bucket?: string;
}): Promise<{ uploaded: boolean; key?: string }> {
  const bucket = args.bucket ?? process.env.BRAIN_ARTIFACTS_BUCKET ?? null;
  if (!bucket) return { uploaded: false };
  const s3 = args.s3 ?? new S3Client({});
  const key = `twin-identity/${args.snapshot.tenantId}/latest.json`;
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(args.snapshot, null, 2),
      ContentType: "application/json",
      Metadata: { identity_snapshot_cursor: args.snapshot.cursor },
    }),
  );
  return { uploaded: true, key };
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
  const afterId = cursorRow?.last_event_id ?? null;

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
            or(
              gt(entityResolutionEvents.created_at, afterCreatedAt),
              and(
                eq(entityResolutionEvents.created_at, afterCreatedAt),
                afterId ? gt(entityResolutionEvents.id, afterId) : sql`TRUE`,
              ),
            ),
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

  await db
    .insert(identityGraphProjectionCursors)
    .values({
      tenant_id: args.tenantId,
      last_event_created_at: last.created_at,
      last_event_id: last.id,
      last_snapshot_cursor: cursor,
      updated_at: args.now ?? new Date(),
    })
    .onConflictDoUpdate({
      target: [identityGraphProjectionCursors.tenant_id],
      set: {
        last_event_created_at: last.created_at,
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
 * Full rebuild (first-class recovery command): resync EVERY canonical
 * entity for the tenant from the relational store, then cut a fresh
 * snapshot and fast-forward the cursor to the newest event. The graph is
 * rebuildable, never authoritative.
 */
export async function rebuildTenantGraph(args: {
  tenantId: string;
  /**
   * Drop the tenant's ENTIRE subgraph before resyncing. Opt-in because it
   * also destroys etl-synced facet properties — and the etl twin_batch
   * ledger is skip-on-hit, so cleared facets stay gone until NEW batches
   * arrive. Use to recover from mislabeled/orphaned nodes (e.g. the
   * unlabeled-survivor bug this flag shipped with); leave off for a
   * routine identity resync.
   */
  clearFirst?: boolean;
  db?: DbLike;
  neptune?: NeptuneQueryClient;
  s3?: SnapshotS3Client;
  now?: Date;
}): Promise<{ tenantId: string; resyncedCanonicals: number }> {
  const db = args.db ?? defaultDb;
  const neptune = args.neptune ?? createNeptuneClient();

  if (args.clearFirst) {
    // Batched DETACH DELETE, fenced by the tenant's deterministic ~id
    // PREFIX rather than a property match: the pre-label-fix loser path
    // minted survivor nodes with NO properties at all, and a
    // {tenantId: …} match walks straight past those ghosts (which is how
    // the first clearing rebuild still collided). The id prefix is the
    // tenant firewall by construction.
    const idPrefix = `t#${args.tenantId}#`;
    for (let round = 0; round < 200; round += 1) {
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
  }

  const allCanonicals = await db
    .select({ id: canonicalEntities.id })
    .from(canonicalEntities)
    .where(eq(canonicalEntities.tenant_id, args.tenantId));

  let resynced = 0;
  for (let i = 0; i < allCanonicals.length; i += RESYNC_CHUNK) {
    const chunkIds = allCanonicals.slice(i, i + RESYNC_CHUNK).map((r) => r.id);
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

  // Fast-forward the cursor to the newest event and publish a fresh
  // snapshot — the rebuild reflected everything up to now.
  const [latest] = await db
    .select({
      id: entityResolutionEvents.id,
      created_at: entityResolutionEvents.created_at,
    })
    .from(entityResolutionEvents)
    .where(eq(entityResolutionEvents.tenant_id, args.tenantId))
    .orderBy(
      sql`${entityResolutionEvents.created_at} DESC`,
      sql`${entityResolutionEvents.id} DESC`,
    )
    .limit(1);
  const cursor = latest
    ? `${latest.created_at.toISOString()}#${latest.id}`
    : "rebuild#empty";
  const snapshot = await buildIdentitySnapshot({
    tenantId: args.tenantId,
    cursor,
    db,
    now: args.now,
  });
  await uploadIdentitySnapshot({ snapshot, s3: args.s3 });
  await db
    .insert(identityGraphProjectionCursors)
    .values({
      tenant_id: args.tenantId,
      last_event_created_at: latest?.created_at ?? null,
      last_event_id: latest?.id ?? null,
      last_snapshot_cursor: cursor,
      updated_at: args.now ?? new Date(),
    })
    .onConflictDoUpdate({
      target: [identityGraphProjectionCursors.tenant_id],
      set: {
        last_event_created_at: latest?.created_at ?? null,
        last_event_id: latest?.id ?? null,
        last_snapshot_cursor: cursor,
        updated_at: args.now ?? new Date(),
      },
    });

  return { tenantId: args.tenantId, resyncedCanonicals: resynced };
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
    if (!stage || !process.env.NEPTUNE_ENDPOINT) return; // twin not deployed
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
