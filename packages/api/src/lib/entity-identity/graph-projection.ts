/**
 * Identity snapshot exporter + Neptune write seam (Company Brain U5 / KTD-3).
 *
 * THINK-339 U15: the in-product identity → Neptune projector (event-cursor
 * projection pass, bulk-rebuild lane, resync op builders) moved to the
 * platform Company Brain service — this module keeps only what the product
 * still owns:
 *
 *   - The identity-mapping snapshot (`identity-mapping-snapshot/v1`), cut to
 *     the brain-artifacts bucket at `twin-identity/<tenantId>/latest.json` —
 *     the ONLY identity input the etl twin projection reads (node IDs never
 *     derive from natural keys).
 *   - `createNeptuneClient` — the injectable writer seam the wiki-compile
 *     soft-layer writer still uses to upsert Topic/Decision nodes.
 */

import { getConfig } from "@thinkwork/runtime-config";
import {
  ExecuteOpenCypherQueryCommand,
  NeptunedataClient,
} from "@aws-sdk/client-neptunedata";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { and, eq } from "drizzle-orm";
import {
  canonicalEntities,
  entitySourceMappings,
} from "@thinkwork/database-pg/schema";
import { db as defaultDb } from "../db.js";

type DbLike = typeof defaultDb;

export const IDENTITY_SNAPSHOT_FORMAT = "identity-mapping-snapshot/v1";

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
  const bucket = args.bucket ?? getConfig("BRAIN_ARTIFACTS_BUCKET") ?? null;
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
