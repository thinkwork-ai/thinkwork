/**
 * Knowledge Base Manager Lambda
 *
 * Invoked by the GraphQL resolver to provision, sync, and delete Bedrock
 * Knowledge Bases. Uses @aws-sdk/client-bedrock-agent.
 *
 * External S3 KB source (U2): a KB holds N data sources — one row per
 * knowledge_base_sources record. 'managed-upload' sources keep the original
 * S3-crawler path (platform workspace bucket + StartIngestionJob).
 * 's3-connect' sources point at a customer-owned bucket read in place; they
 * are provisioned as CUSTOM data sources and synced by platform-driven
 * direct ingestion (Ingest/DeleteKnowledgeBaseDocuments), because Bedrock's
 * S3 connector has no exclusion filters. Filter semantics (exclusion wins)
 * live in src/lib/knowledge/kb-source-sync.ts.
 *
 * Operator-initiated actions (connect_source) run RequestResponse and throw
 * on failure so the resolver surfaces the error synchronously (R9);
 * background sync stays fire-and-forget with status rows.
 */

import { getConfig } from "@thinkwork/runtime-config";
import { and, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  knowledgeBases,
  knowledgeBaseDocuments,
  knowledgeBaseSources,
  agentKnowledgeBases,
  tenants,
} from "@thinkwork/database-pg/schema";
import {
  enqueueManifestRetractions,
  normalizeManifestEtag,
  reconcileKnowledgeBaseDocuments,
  settleDeletedDocuments,
  type ManifestS3Object,
} from "./src/lib/knowledge/kb-document-manifest.js";
import {
  batch,
  keyMatchesFilters,
  planDirectIngestion,
  MAX_DIRECT_INGEST_BYTES,
  type LiveObject,
  type SourceFilterPatterns,
} from "./src/lib/knowledge/kb-source-sync.js";

const AWS_REGION = process.env.AWS_REGION || "us-east-1";

// Env reads are wrapped in functions (not module-scope consts) so tests can
// set process.env before invoking the handler — static imports hoist above
// test-file env assignments (vitest env-capture-timing trap).
function kbServiceRoleArn(): string {
  return process.env.KB_SERVICE_ROLE_ARN || "";
}
function dbClusterArn(): string {
  return process.env.DATABASE_CLUSTER_ARN || "";
}

function workspaceBucket(): string {
  return getConfig("WORKSPACE_BUCKET", "");
}

function databaseName(): string {
  return getConfig("DATABASE_NAME", "thinkwork");
}

/** The stack's own account, parsed from the KB service role ARN. */
function stackAccountId(): string {
  const match = kbServiceRoleArn().match(/^arn:aws:iam::(\d{12}):/);
  return match?.[1] ?? "";
}

async function getBedrockKbSecretArn(): Promise<string> {
  // Bedrock's RDS storage needs a `{username, password}` secret to connect to
  // Aurora. The Lambda already has DATABASE_SECRET_ARN — the cluster's
  // credentials secret, a full ARN, in exactly that format, and readable by
  // both this role and the KB service role. Reuse it rather than maintaining a
  // separate bedrock-kb secret (which was never provisioned, so the old
  // name-resolution path silently fell back to a bare name and Bedrock rejected
  // it as not-an-ARN).
  const fromEnv = getConfig("DATABASE_SECRET_ARN");
  if (fromEnv) return fromEnv;
  // Legacy fallback: resolve a dedicated secret by name.
  const stage = process.env.STAGE || "dev";
  const secretName = `thinkwork-${stage}-bedrock-kb-rds-credentials`;
  try {
    const { SecretsManagerClient, DescribeSecretCommand } =
      await import("@aws-sdk/client-secrets-manager");
    const sm = new SecretsManagerClient({ region: AWS_REGION });
    const resp = await sm.send(
      new DescribeSecretCommand({ SecretId: secretName }),
    );
    return resp.ARN || secretName;
  } catch {
    return secretName;
  }
}

const db = getDb();

type SourceRow = typeof knowledgeBaseSources.$inferSelect;

export interface KbConnectInput {
  bucket: string;
  prefix: string;
  include?: string[];
  exclude?: string[];
  bucketOwnerAccountId?: string | null;
}

interface KbManagerEvent {
  action: "create" | "sync" | "delete" | "rechunk" | "connect_source";
  knowledgeBaseId: string;
  /** connect_source only. */
  connect?: KbConnectInput;
}

async function getBedrockAgentClient() {
  const { BedrockAgentClient } = await import("@aws-sdk/client-bedrock-agent");
  return new BedrockAgentClient({ region: AWS_REGION });
}

async function resolveKbInfo(kbId: string) {
  const [kb] = await db
    .select()
    .from(knowledgeBases)
    .where(eq(knowledgeBases.id, kbId));
  if (!kb) throw new Error(`Knowledge base not found: ${kbId}`);
  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, kb.tenant_id));
  return { kb, tenantSlug: tenant?.slug || "" };
}

async function listSources(kbId: string): Promise<SourceRow[]> {
  const { asc } = await import("drizzle-orm");
  return db
    .select()
    .from(knowledgeBaseSources)
    .where(eq(knowledgeBaseSources.knowledge_base_id, kbId))
    .orderBy(asc(knowledgeBaseSources.created_at));
}

function managedUploadPrefix(tenantSlug: string, kbSlug: string): string {
  return `tenants/${tenantSlug}/knowledge-bases/${kbSlug}/documents/`;
}

function sourcePatterns(source: SourceRow): SourceFilterPatterns | null {
  return (source.filter_patterns as SourceFilterPatterns | null) ?? null;
}

/** The bucket a source reads from (managed-upload rows resolve the
 * platform workspace bucket at runtime). */
function sourceBucket(source: SourceRow): string {
  return source.bucket ?? workspaceBucket();
}

async function updateSource(
  sourceId: string,
  set: Partial<typeof knowledgeBaseSources.$inferInsert>,
): Promise<void> {
  await db
    .update(knowledgeBaseSources)
    .set({ ...set, updated_at: new Date() })
    .where(eq(knowledgeBaseSources.id, sourceId));
}

/**
 * Ensure a KB created after the sources migration has its managed-upload
 * source row (#0). Existing KBs were backfilled by drizzle/0277.
 */
async function ensureManagedUploadSource(
  kb: typeof knowledgeBases.$inferSelect,
  tenantSlug: string,
): Promise<SourceRow[]> {
  const sources = await listSources(kb.id);
  if (sources.some((source) => source.kind === "managed-upload")) {
    return sources;
  }
  await db.insert(knowledgeBaseSources).values({
    tenant_id: kb.tenant_id,
    knowledge_base_id: kb.id,
    kind: "managed-upload",
    prefix: managedUploadPrefix(tenantSlug, kb.slug),
    aws_data_source_id: kb.aws_data_source_id,
    access_status: "healthy",
  });
  return listSources(kb.id);
}

function chunkingConfiguration(kb: typeof knowledgeBases.$inferSelect) {
  return {
    chunkingConfiguration: {
      chunkingStrategy: (kb.chunking_strategy === "FIXED_SIZE"
        ? "FIXED_SIZE"
        : "NONE") as "FIXED_SIZE" | "NONE",
      fixedSizeChunkingConfiguration:
        kb.chunking_strategy === "FIXED_SIZE"
          ? {
              maxTokens: kb.chunk_size_tokens ?? 300,
              overlapPercentage: kb.chunk_overlap_percent ?? 20,
            }
          : undefined,
    },
  };
}

/**
 * Create the Bedrock data source for one source row and persist its id.
 * managed-upload -> S3 crawler over the platform prefix (unchanged from the
 * pre-sources behavior); s3-connect -> CUSTOM data source fed by direct
 * ingestion (see module header).
 */
async function createDataSourceForSource(
  kb: typeof knowledgeBases.$inferSelect,
  awsKbId: string,
  source: SourceRow,
): Promise<string> {
  const client = await getBedrockAgentClient();
  const { CreateDataSourceCommand } =
    await import("@aws-sdk/client-bedrock-agent");

  const isManagedUpload = source.kind === "managed-upload";
  const createDsResp = await client.send(
    new CreateDataSourceCommand({
      knowledgeBaseId: awsKbId,
      name: isManagedUpload
        ? `${kb.slug}-s3`
        : `${kb.slug}-connect-${source.id.slice(0, 8)}`,
      dataSourceConfiguration: isManagedUpload
        ? {
            type: "S3",
            s3Configuration: {
              bucketArn: `arn:aws:s3:::${workspaceBucket()}`,
              inclusionPrefixes: [source.prefix!],
            },
          }
        : { type: "CUSTOM" },
      vectorIngestionConfiguration: chunkingConfiguration(kb),
    }),
  );

  const awsDsId = createDsResp.dataSource?.dataSourceId;
  if (!awsDsId)
    throw new Error("Failed to create Bedrock data source — no ID returned");
  await updateSource(source.id, { aws_data_source_id: awsDsId });
  if (isManagedUpload) {
    // Legacy readers (retrieval provider, manifest) still use the KB column.
    await db
      .update(knowledgeBases)
      .set({ aws_data_source_id: awsDsId, updated_at: new Date() })
      .where(eq(knowledgeBases.id, kb.id));
  }
  return awsDsId;
}

async function createVectorTable(tableName: string): Promise<void> {
  // Create the pgvector table Bedrock KB expects, using direct pg connection
  const { getDb } = await import("@thinkwork/database-pg");
  const db = getDb();
  const { sql } = await import("drizzle-orm");

  const statements = [
    `CREATE SCHEMA IF NOT EXISTS bedrock_kb`,
    `CREATE TABLE IF NOT EXISTS bedrock_kb.${tableName} (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), embedding vector(1024), chunks TEXT, metadata JSONB)`,
    `CREATE INDEX IF NOT EXISTS ${tableName}_embedding_idx ON bedrock_kb.${tableName} USING hnsw (embedding vector_cosine_ops)`,
    `CREATE INDEX IF NOT EXISTS ${tableName}_chunks_idx ON bedrock_kb.${tableName} USING gin (to_tsvector('simple', chunks))`,
  ];

  for (const stmt of statements) {
    await (db as any).execute(sql.raw(stmt));
  }
  console.log(`[kb-manager] Created vector table: ${tableName}`);
}

async function handleCreate(kbId: string): Promise<void> {
  const { kb, tenantSlug } = await resolveKbInfo(kbId);
  const client = await getBedrockAgentClient();
  const { CreateKnowledgeBaseCommand } =
    await import("@aws-sdk/client-bedrock-agent");

  try {
    // Idempotent resumable provisioning (U9/KTD6): each Bedrock resource is
    // created only when its id isn't already persisted, and each id is written
    // immediately after creation. A retry after a partial failure therefore
    // resumes where it left off instead of creating a duplicate Bedrock KB.

    // Pre-create the pgvector table Bedrock KB expects (CREATE ... IF NOT
    // EXISTS — already idempotent).
    const tableName = `bedrock_kb_${kb.slug.replace(/-/g, "_")}`;
    await createVectorTable(tableName);

    // 1. Knowledge Base — skip if already provisioned.
    let awsKbId = kb.aws_kb_id ?? undefined;
    if (!awsKbId) {
      const secretArn = await getBedrockKbSecretArn();
      console.log(`[kb-manager] Using secret ARN: ${secretArn}`);
      console.log(`[kb-manager] Using cluster ARN: ${dbClusterArn()}`);
      console.log(`[kb-manager] Using role ARN: ${kbServiceRoleArn()}`);

      const createKbResp = await client.send(
        new CreateKnowledgeBaseCommand({
          name: `thinkwork-${tenantSlug}-${kb.slug}-${kb.id.slice(0, 8)}`,
          roleArn: kbServiceRoleArn(),
          knowledgeBaseConfiguration: {
            type: "VECTOR",
            vectorKnowledgeBaseConfiguration: {
              embeddingModelArn: `arn:aws:bedrock:${AWS_REGION}::foundation-model/${kb.embedding_model}`,
            },
          },
          storageConfiguration: {
            type: "RDS",
            rdsConfiguration: {
              resourceArn: dbClusterArn(),
              credentialsSecretArn: secretArn,
              databaseName: databaseName(),
              tableName: `bedrock_kb.bedrock_kb_${kb.slug.replace(/-/g, "_")}`,
              fieldMapping: {
                primaryKeyField: "id",
                vectorField: "embedding",
                textField: "chunks",
                metadataField: "metadata",
              },
            },
          },
        }),
      );

      awsKbId = createKbResp.knowledgeBase?.knowledgeBaseId;
      if (!awsKbId)
        throw new Error("Failed to create Bedrock KB — no ID returned");
      // Persist immediately so a later-step failure doesn't orphan this KB.
      await db
        .update(knowledgeBases)
        .set({ aws_kb_id: awsKbId, updated_at: new Date() })
        .where(eq(knowledgeBases.id, kbId));
    }

    // 2. Data sources — one per source row; skip rows already provisioned.
    // Never mark the KB active without its managed-upload data source — keep
    // it failed so the operator can retry into the data-source step.
    const sources = await ensureManagedUploadSource(kb, tenantSlug);
    let managedDsId: string | undefined;
    for (const source of sources) {
      if (source.kind === "snapshot") continue;
      let dsId = source.aws_data_source_id ?? undefined;
      if (!dsId) {
        dsId = await createDataSourceForSource(kb, awsKbId, source);
      }
      if (source.kind === "managed-upload") managedDsId = dsId;
    }
    if (!managedDsId) {
      throw new Error("Failed to create Bedrock data source — no ID returned");
    }

    // 3. Mark active and clear any prior error.
    await db
      .update(knowledgeBases)
      .set({ status: "active", error_message: null, updated_at: new Date() })
      .where(eq(knowledgeBases.id, kbId));

    console.log(
      `[kb-manager] Created KB ${kbId}: awsKbId=${awsKbId} awsDsId=${managedDsId}`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[kb-manager] Create failed for ${kbId}:`, message);
    await db
      .update(knowledgeBases)
      .set({
        status: "failed",
        error_message: message.slice(0, 1000),
        updated_at: new Date(),
      })
      .where(eq(knowledgeBases.id, kbId));
  }
}

// ---------------------------------------------------------------------------
// Sync — per-source
// ---------------------------------------------------------------------------

/**
 * Canary retrieval (R11/KTD9): sync health means retrievability, not job
 * completion. Sources with a recorded sentinel must retrieve it and see a
 * hit from the sentinel document; sources without one (managed-upload,
 * pre-sentinel rows) pass vacuously.
 */
async function canaryPasses(
  kb: typeof knowledgeBases.$inferSelect,
  source: SourceRow,
): Promise<boolean> {
  if (!source.sentinel_phrase || !kb.aws_kb_id) return true;
  const { BedrockAgentRuntimeClient, RetrieveCommand } =
    await import("@aws-sdk/client-bedrock-agent-runtime");
  const runtime = new BedrockAgentRuntimeClient({ region: AWS_REGION });
  const resp = await runtime.send(
    new RetrieveCommand({
      knowledgeBaseId: kb.aws_kb_id,
      retrievalQuery: { text: source.sentinel_phrase },
      retrievalConfiguration: {
        vectorSearchConfiguration: { numberOfResults: 10 },
      },
    }),
  );
  const sentinelKey = source.sentinel_document_key;
  return (resp.retrievalResults ?? []).some((result) => {
    const uri =
      result.location?.s3Location?.uri ??
      result.location?.customDocumentLocation?.id ??
      "";
    return sentinelKey ? uri.includes(sentinelKey) : true;
  });
}

/** Original crawler-based sync for one managed-upload source. */
async function syncManagedUploadSource(
  kb: typeof knowledgeBases.$inferSelect,
  source: SourceRow,
): Promise<{ status: "COMPLETE" | "FAILED"; docCount: number | null }> {
  const awsKbId = kb.aws_kb_id!;
  const dataSourceId = source.aws_data_source_id!;
  const client = await getBedrockAgentClient();
  const { StartIngestionJobCommand, GetIngestionJobCommand } =
    await import("@aws-sdk/client-bedrock-agent");

  const startResp = await client.send(
    new StartIngestionJobCommand({
      knowledgeBaseId: awsKbId,
      dataSourceId,
    }),
  );
  const jobId = startResp.ingestionJob?.ingestionJobId;
  if (!jobId) throw new Error("Failed to start ingestion job");
  console.log(
    `[kb-manager] Started ingestion job ${jobId} for KB ${kb.id} source ${source.id}`,
  );

  // Poll for completion (max 10 minutes)
  const maxAttempts = 60;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 10_000)); // 10s between polls

    const getResp = await client.send(
      new GetIngestionJobCommand({
        knowledgeBaseId: awsKbId,
        dataSourceId,
        ingestionJobId: jobId,
      }),
    );

    const status = getResp.ingestionJob?.status;
    console.log(`[kb-manager] Ingestion job ${jobId} status: ${status}`);

    if (status === "COMPLETE") {
      const stats = getResp.ingestionJob?.statistics;
      return {
        status: "COMPLETE",
        docCount: stats?.numberOfDocumentsScanned ?? null,
      };
    }
    if (status === "FAILED") {
      const reason =
        getResp.ingestionJob?.failureReasons?.join("; ") ?? "Unknown error";
      throw new Error(reason);
    }
  }
  throw new Error("Ingestion job timed out after 10 minutes");
}

/**
 * Direct-ingestion sync for one s3-connect source: list the customer bucket
 * in place, apply the source's include/exclude globs, Ingest the changed
 * set (S3_LOCATION content — Bedrock reads from their bucket), Delete
 * removed/now-excluded documents, then wait for terminal per-document
 * statuses.
 */
async function syncS3ConnectSource(
  kb: typeof knowledgeBases.$inferSelect,
  source: SourceRow,
): Promise<{
  status: "COMPLETE" | "FAILED";
  docCount: number;
  skippedOversize: number;
}> {
  const awsKbId = kb.aws_kb_id!;
  const dataSourceId = source.aws_data_source_id!;
  const bucket = sourceBucket(source);

  // 1. Live listing of the connected bucket/prefix.
  const { S3Client, ListObjectsV2Command } = await import("@aws-sdk/client-s3");
  const s3 = new S3Client({ region: AWS_REGION });
  const liveObjects: LiveObject[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: source.prefix ?? undefined,
        ContinuationToken: continuationToken,
      }),
    );
    for (const object of page.Contents ?? []) {
      if (!object.Key || object.Key.endsWith("/")) continue;
      liveObjects.push({
        key: object.Key,
        etag: normalizeManifestEtag(object.ETag),
        sizeBytes: object.Size ?? 0,
      });
    }
    continuationToken = page.IsTruncated
      ? page.NextContinuationToken
      : undefined;
  } while (continuationToken);

  // 2. Plan the delta against this source's manifest rows.
  const manifest = await db
    .select()
    .from(knowledgeBaseDocuments)
    .where(
      and(
        eq(knowledgeBaseDocuments.knowledge_base_id, kb.id),
        eq(knowledgeBaseDocuments.data_source_id, dataSourceId),
      ),
    );
  const plan = planDirectIngestion({
    liveObjects,
    manifest,
    patterns: sourcePatterns(source),
  });
  console.log(
    `[kb-manager] s3-connect sync plan for source ${source.id}: live=${liveObjects.length} ingest=${plan.toIngest.length} delete=${plan.toDelete.length} excluded=${plan.excluded.length} oversize=${plan.skippedOversize.length}`,
  );

  const client = await getBedrockAgentClient();
  const {
    IngestKnowledgeBaseDocumentsCommand,
    DeleteKnowledgeBaseDocumentsCommand,
    ListKnowledgeBaseDocumentsCommand,
  } = await import("@aws-sdk/client-bedrock-agent");

  // 3. Ingest new/changed documents in batches (content stays in the
  // customer bucket — S3_LOCATION source).
  for (const group of batch(plan.toIngest)) {
    await client.send(
      new IngestKnowledgeBaseDocumentsCommand({
        knowledgeBaseId: awsKbId,
        dataSourceId,
        documents: group.map((object) => ({
          content: {
            dataSourceType: "CUSTOM" as const,
            custom: {
              customDocumentIdentifier: { id: object.key },
              sourceType: "S3_LOCATION" as const,
              s3Location: {
                uri: `s3://${bucket}/${object.key}`,
                ...(source.bucket_owner_account_id
                  ? { bucketOwnerAccountId: source.bucket_owner_account_id }
                  : {}),
              },
            },
          },
        })),
      }),
    );
  }

  // 4. Delete removed/now-excluded documents from the index (R12/AE1 —
  // exclusion takes effect on the sync after the move, no crawler involved).
  for (const group of batch(plan.toDelete)) {
    await client.send(
      new DeleteKnowledgeBaseDocumentsCommand({
        knowledgeBaseId: awsKbId,
        dataSourceId,
        documentIdentifiers: group.map((key) => ({
          dataSourceType: "CUSTOM" as const,
          custom: { id: key },
        })),
      }),
    );
  }

  // 5. Wait for terminal per-document statuses (bounded ~5 minutes).
  const pollDeadline = Date.now() + 5 * 60_000;
  let bedrockStatusByKey = new Map<string, string>();
  for (;;) {
    bedrockStatusByKey = new Map();
    let nextToken: string | undefined;
    do {
      const page = await client.send(
        new ListKnowledgeBaseDocumentsCommand({
          knowledgeBaseId: awsKbId,
          dataSourceId,
          nextToken,
        }),
      );
      for (const detail of page.documentDetails ?? []) {
        const key = detail.identifier?.custom?.id;
        if (!key || !detail.status) continue;
        bedrockStatusByKey.set(key, detail.status);
      }
      nextToken = page.nextToken;
    } while (nextToken);

    const inFlight = [...bedrockStatusByKey.values()].filter(
      (status) =>
        status === "PENDING" ||
        status === "IN_PROGRESS" ||
        status === "STARTING" ||
        status === "DELETE_IN_PROGRESS" ||
        status === "DELETING",
    ).length;
    if (inFlight === 0 || Date.now() > pollDeadline) break;
    await new Promise((r) => setTimeout(r, 10_000));
  }

  // 6. Reconcile the manifest against the FILTERED live view so excluded/
  // removed documents get delete intent stamped, then run settlement.
  const included: ManifestS3Object[] = liveObjects
    .filter(
      (object) =>
        keyMatchesFilters(object.key, sourcePatterns(source)) &&
        object.sizeBytes <= MAX_DIRECT_INGEST_BYTES,
    )
    .map((object) => ({ key: object.key, etag: object.etag }));
  const result = await reconcileKnowledgeBaseDocuments(db, {
    tenantId: kb.tenant_id,
    knowledgeBaseId: kb.id,
    dataSourceId,
    sourceId: source.id,
    s3Objects: included,
    bedrockStatusByKey,
  });
  console.log(
    `[kb-manager] s3-connect manifest reconciled for source ${source.id}: created=${result.created} editions=${result.editionsBumped} statusUpdated=${result.statusUpdated} deleting=${result.deletingNeedingRetraction.length}`,
  );

  const failed = [...bedrockStatusByKey.values()].filter(
    (status) => status === "FAILED",
  ).length;
  return {
    status: failed > 0 ? "FAILED" : "COMPLETE",
    docCount: included.length,
    skippedOversize: plan.skippedOversize.length,
  };
}

async function handleSync(kbId: string): Promise<void> {
  const { kb, tenantSlug } = await resolveKbInfo(kbId);
  if (!kb.aws_kb_id) {
    console.error(`[kb-manager] Cannot sync KB ${kbId}: missing Bedrock IDs`);
    await db
      .update(knowledgeBases)
      .set({
        status: "failed",
        error_message: "Missing Bedrock KB or Data Source ID",
        last_sync_status: "FAILED",
        updated_at: new Date(),
      })
      .where(eq(knowledgeBases.id, kbId));
    return;
  }

  const sources = await ensureManagedUploadSource(kb, tenantSlug);
  let anyFailed = false;
  let anyDegraded = false;
  let totalDocs = 0;

  for (const source of sources) {
    if (source.kind === "snapshot") continue;
    if (source.access_status === "access_revoked") {
      console.log(
        `[kb-manager] Skipping access_revoked source ${source.id} of KB ${kbId}`,
      );
      continue;
    }
    if (!source.aws_data_source_id) {
      if (source.kind === "managed-upload") {
        anyFailed = true;
        await updateSource(source.id, {
          last_sync_status: "FAILED",
          error_message: "Missing Bedrock Data Source ID",
        });
      }
      continue;
    }

    try {
      const outcome =
        source.kind === "managed-upload"
          ? await syncManagedUploadSource(kb, source)
          : await syncS3ConnectSource(kb, source);
      totalDocs += outcome.docCount ?? 0;

      // Canary-gated health (R11): job success alone never marks healthy.
      const retrievable = await canaryPasses(kb, source).catch((err) => {
        console.error(
          `[kb-manager] Canary retrieval failed for source ${source.id}:`,
          err instanceof Error ? err.message : err,
        );
        return false;
      });
      if (!retrievable) anyDegraded = true;
      await updateSource(source.id, {
        last_sync_at: new Date(),
        last_sync_status: outcome.status,
        document_count: outcome.docCount ?? source.document_count,
        access_status: retrievable ? "healthy" : "degraded",
        error_message: null,
      });

      // THINK-193 U7: manifest reconciliation for managed-upload sources runs
      // ONLY after a successful ingestion job (never racing StartIngestionJob
      // with direct Ingest calls). s3-connect sources reconcile inside their
      // sync. A reconciliation failure must not fail the sync — it retries on
      // the next sync.
      if (source.kind === "managed-upload") {
        try {
          await reconcileManifestAfterSync(kbId, source);
        } catch (err) {
          console.error(
            `[kb-manager] Manifest reconciliation failed for KB ${kbId}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    } catch (err) {
      anyFailed = true;
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[kb-manager] Sync failed for KB ${kbId} source ${source.id}:`,
        message,
      );
      await updateSource(source.id, {
        last_sync_at: new Date(),
        last_sync_status: "FAILED",
        error_message: message.slice(0, 1000),
      });
    }
  }

  await db
    .update(knowledgeBases)
    .set({
      status: "active",
      last_sync_at: new Date(),
      last_sync_status: anyFailed ? "FAILED" : "COMPLETE",
      document_count: totalDocs > 0 ? totalDocs : kb.document_count,
      error_message: anyFailed
        ? "One or more sources failed to sync"
        : anyDegraded
          ? "One or more sources are degraded (canary retrieval missed)"
          : null,
      updated_at: new Date(),
    })
    .where(eq(knowledgeBases.id, kbId));
}

// ---------------------------------------------------------------------------
// connect_source — operator-initiated, RequestResponse, throws on failure
// ---------------------------------------------------------------------------

/**
 * As-role access preflight (R8): assume the KB service role and probe
 * ListObjectsV2 + GetObject so we prove the identity Bedrock ingests with
 * can actually read the bucket — operator credentials passing is not
 * evidence. Returns the sampled listing for sentinel selection.
 */
async function preflightAsKbRole(
  bucket: string,
  prefix: string,
): Promise<{ keys: string[] }> {
  const { STSClient, AssumeRoleCommand } = await import("@aws-sdk/client-sts");
  const sts = new STSClient({ region: AWS_REGION });
  let credentials;
  try {
    const assumed = await sts.send(
      new AssumeRoleCommand({
        RoleArn: kbServiceRoleArn(),
        RoleSessionName: "kb-connect-preflight",
        DurationSeconds: 900,
      }),
    );
    credentials = assumed.Credentials;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Preflight failed: cannot assume KB service role ${kbServiceRoleArn()} (${message})`,
    );
  }
  if (!credentials?.AccessKeyId) {
    throw new Error(
      `Preflight failed: no credentials returned assuming ${kbServiceRoleArn()}`,
    );
  }

  const { S3Client, ListObjectsV2Command, GetObjectCommand } =
    await import("@aws-sdk/client-s3");
  const s3 = new S3Client({
    region: AWS_REGION,
    credentials: {
      accessKeyId: credentials.AccessKeyId,
      secretAccessKey: credentials.SecretAccessKey!,
      sessionToken: credentials.SessionToken!,
    },
  });

  let keys: string[] = [];
  try {
    const listResp = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: 50 }),
    );
    keys = (listResp.Contents ?? [])
      .map((object) => object.Key!)
      .filter((key) => key && !key.endsWith("/"));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Preflight failed: KB service role ${kbServiceRoleArn()} cannot s3:ListBucket on ${bucket} (${message}). Grant it via terraform external_kb_source_arns.`,
    );
  }
  if (keys.length === 0) {
    throw new Error(
      `Preflight failed: no objects found under s3://${bucket}/${prefix}`,
    );
  }
  try {
    const probeKey = keys[0];
    const getResp = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: probeKey }),
    );
    // Drain/abort the body so the socket is released.
    await getResp.Body?.transformToByteArray().catch(() => undefined);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Preflight failed: KB service role ${kbServiceRoleArn()} cannot s3:GetObject on ${bucket} (${message}). Grant it via terraform external_kb_source_arns.`,
    );
  }
  return { keys };
}

/**
 * Sentinel selection (KTD9): a canary needs a query that should hit a known
 * document. Derive the phrase from the sentinel document's filename —
 * format-agnostic (works for PDFs/docx where content sampling isn't) and SOP
 * filenames are descriptive titles that embed in the document's chunks.
 */
export function deriveSentinel(
  keys: string[],
  patterns: SourceFilterPatterns | null,
): { key: string; phrase: string } | null {
  const candidates = keys.filter((key) => keyMatchesFilters(key, patterns));
  if (candidates.length === 0) return null;
  // Prefer the longest filename — more distinctive phrase.
  const key = [...candidates].sort(
    (a, b) => basename(b).length - basename(a).length,
  )[0];
  const phrase = basename(key)
    .replace(/\.[A-Za-z0-9]+$/, "")
    .replace(/[-_+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return phrase ? { key, phrase } : { key, phrase: basename(key) };
}

function basename(key: string): string {
  return key.slice(key.lastIndexOf("/") + 1);
}

interface ConnectSourceResult {
  sourceId: string;
  sentinelDocumentKey: string | null;
  sampledObjectCount: number;
}

async function handleConnectSource(
  kbId: string,
  input: KbConnectInput,
): Promise<ConnectSourceResult> {
  const { kb } = await resolveKbInfo(kbId);
  if (!kb.aws_kb_id) {
    throw new Error(
      `Knowledge base ${kbId} is not provisioned — create it before connecting a source`,
    );
  }

  // Validation (R5/AE6): same-account only in V1; fail before any AWS call.
  const ownAccount = stackAccountId();
  if (
    input.bucketOwnerAccountId &&
    ownAccount &&
    input.bucketOwnerAccountId !== ownAccount
  ) {
    throw new Error(
      `Cross-account buckets are not yet supported (bucket owner ${input.bucketOwnerAccountId}, stack account ${ownAccount})`,
    );
  }
  const include = input.include ?? [];
  const exclude = input.exclude ?? [];
  if (include.length > 25 || exclude.length > 25) {
    throw new Error("At most 25 include and 25 exclude patterns are allowed");
  }
  if (!input.bucket || !input.prefix) {
    throw new Error("bucket and prefix are required for an s3-connect source");
  }

  // As-role preflight (R8) — nothing is created if this throws.
  const { keys } = await preflightAsKbRole(input.bucket, input.prefix);

  const patterns: SourceFilterPatterns = { include, exclude };
  const sentinel = deriveSentinel(keys, patterns);

  const [source] = await db
    .insert(knowledgeBaseSources)
    .values({
      tenant_id: kb.tenant_id,
      knowledge_base_id: kb.id,
      kind: "s3-connect",
      bucket: input.bucket,
      prefix: input.prefix,
      filter_patterns: patterns,
      bucket_owner_account_id: input.bucketOwnerAccountId ?? null,
      access_status: "pending",
      sentinel_document_key: sentinel?.key ?? null,
      sentinel_phrase: sentinel?.phrase ?? null,
    })
    .returning();

  try {
    await createDataSourceForSource(kb, kb.aws_kb_id, source);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateSource(source.id, {
      access_status: "failed",
      error_message: message.slice(0, 1000),
    });
    throw new Error(`Failed to create Bedrock data source: ${message}`);
  }

  console.log(
    `[kb-manager] Connected source ${source.id} (s3://${input.bucket}/${input.prefix}) to KB ${kbId}`,
  );
  return {
    sourceId: source.id,
    sentinelDocumentKey: sentinel?.key ?? null,
    sampledObjectCount: keys.length,
  };
}

// ---------------------------------------------------------------------------
// THINK-193 U7 — document manifest reconciliation (post-successful-sync)
// ---------------------------------------------------------------------------

/** S3 uri for a document key in the workspace bucket. */
function documentS3Uri(key: string): string {
  return `s3://${workspaceBucket()}/${key}`;
}

/**
 * After a COMPLETE ingestion job for a managed-upload source:
 *   1. list the live S3 objects under the KB documents prefix (etag; the
 *      version id is captured via HeadObject only for new/changed keys —
 *      ListObjectsV2 doesn't return it and ListObjectVersions would need a
 *      broader IAM grant);
 *   2. list Bedrock's per-document statuses (ListKnowledgeBaseDocuments);
 *   3. reconcile the knowledge_base_documents manifest (new editions on
 *      changed etags, delete intent for removed keys);
 *   4. chain the standard Hindsight derivation retraction for documents
 *      that reached 'deleting' (provider stays 'hindsight');
 *   5. run deletion settlement: 'deleting' → 'absent_verified' only when
 *      GetKnowledgeBaseDocuments reports the document absent AND a scoped
 *      Retrieve returns no hits — retried on every subsequent sync.
 */
async function reconcileManifestAfterSync(
  kbId: string,
  source: SourceRow,
): Promise<void> {
  const { kb, tenantSlug } = await resolveKbInfo(kbId);
  if (!kb.aws_kb_id || !source.aws_data_source_id || !tenantSlug) return;
  const awsKbId = kb.aws_kb_id;
  const dataSourceId = source.aws_data_source_id;
  const prefix = source.prefix ?? managedUploadPrefix(tenantSlug, kb.slug);

  // 1. Live S3 objects (paginated), etags normalized.
  const { S3Client, ListObjectsV2Command, HeadObjectCommand } =
    await import("@aws-sdk/client-s3");
  const s3 = new S3Client({ region: AWS_REGION });
  const listed: Array<{ key: string; etag: string | null }> = [];
  let continuationToken: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: workspaceBucket(),
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const object of page.Contents ?? []) {
      if (!object.Key || object.Key === prefix) continue;
      listed.push({
        key: object.Key,
        etag: normalizeManifestEtag(object.ETag),
      });
    }
    continuationToken = page.IsTruncated
      ? page.NextContinuationToken
      : undefined;
  } while (continuationToken);

  // Version ids only for keys the manifest doesn't already know at this
  // etag (bounded HeadObject fan-out on the changed set).
  const manifestRows = await db
    .select({
      document_key: knowledgeBaseDocuments.document_key,
      etag: knowledgeBaseDocuments.etag,
    })
    .from(knowledgeBaseDocuments)
    .where(
      and(
        eq(knowledgeBaseDocuments.knowledge_base_id, kbId),
        eq(knowledgeBaseDocuments.data_source_id, dataSourceId),
      ),
    );
  const knownEtagByKey = new Map(
    manifestRows.map((row) => [
      row.document_key,
      normalizeManifestEtag(row.etag),
    ]),
  );
  const s3Objects: ManifestS3Object[] = [];
  for (const object of listed) {
    let versionId: string | null | undefined;
    const known = knownEtagByKey.get(object.key);
    if (known === undefined || known !== object.etag) {
      try {
        const head = await s3.send(
          new HeadObjectCommand({ Bucket: workspaceBucket(), Key: object.key }),
        );
        versionId = head.VersionId ?? null;
      } catch {
        versionId = null;
      }
    }
    s3Objects.push({ key: object.key, etag: object.etag, versionId });
  }

  // 2. Bedrock per-document statuses.
  const client = await getBedrockAgentClient();
  const {
    ListKnowledgeBaseDocumentsCommand,
    GetKnowledgeBaseDocumentsCommand,
  } = await import("@aws-sdk/client-bedrock-agent");
  const bedrockStatusByKey = new Map<string, string>();
  let nextToken: string | undefined;
  do {
    const page = await client.send(
      new ListKnowledgeBaseDocumentsCommand({
        knowledgeBaseId: awsKbId,
        dataSourceId,
        nextToken,
      }),
    );
    for (const detail of page.documentDetails ?? []) {
      const uri = detail.identifier?.s3?.uri;
      if (!uri || !detail.status) continue;
      const key = uri.replace(/^s3:\/\/[^/]+\//, "");
      bedrockStatusByKey.set(key, detail.status);
    }
    nextToken = page.nextToken;
  } while (nextToken);

  // 3. Reconcile the manifest.
  const [tenantRow] = await db
    .select({ tenant_id: knowledgeBases.tenant_id })
    .from(knowledgeBases)
    .where(eq(knowledgeBases.id, kbId));
  const tenantId = tenantRow!.tenant_id;
  const result = await reconcileKnowledgeBaseDocuments(db, {
    tenantId,
    knowledgeBaseId: kbId,
    dataSourceId,
    sourceId: source.id,
    s3Objects,
    bedrockStatusByKey,
  });
  console.log(
    `[kb-manager] Manifest reconciled for KB ${kbId}: created=${result.created} editions=${result.editionsBumped} statusUpdated=${result.statusUpdated} unchanged=${result.unchanged} deleting=${result.deletingNeedingRetraction.length}`,
  );

  // 4. Chain Hindsight retraction for newly-deleting documents.
  if (result.deletingNeedingRetraction.length > 0) {
    const { enqueued } = await enqueueManifestRetractions(db, {
      tenantId,
      knowledgeBaseId: kbId,
      rows: result.deletingNeedingRetraction,
    });
    console.log(
      `[kb-manager] Enqueued ${enqueued} Hindsight retraction(s) for deleted KB documents`,
    );
  }

  // 5. Deletion settlement (independent of the retraction chain; retried
  // on every sync until both probes agree the document is gone).
  const { BedrockAgentRuntimeClient, RetrieveCommand } =
    await import("@aws-sdk/client-bedrock-agent-runtime");
  const runtime = new BedrockAgentRuntimeClient({ region: AWS_REGION });
  const settled = await settleDeletedDocuments(db, {
    tenantId,
    knowledgeBaseId: kbId,
    dataSourceId,
    probes: {
      async isDocumentAbsent(documentKey: string): Promise<boolean> {
        const resp = await client.send(
          new GetKnowledgeBaseDocumentsCommand({
            knowledgeBaseId: awsKbId,
            dataSourceId,
            documentIdentifiers: [
              {
                dataSourceType: "S3",
                s3: { uri: documentS3Uri(documentKey) },
              },
            ],
          }),
        );
        const detail = (resp.documentDetails ?? [])[0];
        return !detail || detail.status === "NOT_FOUND";
      },
      async retrieveHasResidue(documentKey: string): Promise<boolean> {
        const resp = await runtime.send(
          new RetrieveCommand({
            knowledgeBaseId: awsKbId,
            retrievalQuery: {
              text:
                documentKey.slice(documentKey.lastIndexOf("/") + 1) ||
                "document",
            },
            retrievalConfiguration: {
              vectorSearchConfiguration: {
                numberOfResults: 1,
                filter: {
                  equals: {
                    key: "x-amz-bedrock-kb-source-uri",
                    value: documentS3Uri(documentKey),
                  },
                },
              },
            },
          }),
        );
        return (resp.retrievalResults ?? []).length > 0;
      },
    },
  });
  if (settled.settled > 0 || settled.pending > 0) {
    console.log(
      `[kb-manager] Deletion settlement: settled=${settled.settled} pending=${settled.pending}`,
    );
  }
}

async function handleDelete(kbId: string): Promise<void> {
  const [kb] = await db
    .select()
    .from(knowledgeBases)
    .where(eq(knowledgeBases.id, kbId));
  if (!kb) return;

  const client = await getBedrockAgentClient();
  const { DeleteDataSourceCommand, DeleteKnowledgeBaseCommand } =
    await import("@aws-sdk/client-bedrock-agent");

  try {
    // Delete every data source (all source rows + the legacy KB column,
    // deduped), then the KB itself.
    if (kb.aws_kb_id) {
      const sources = await listSources(kbId);
      const dsIds = new Set(
        sources
          .map((source) => source.aws_data_source_id)
          .filter((id): id is string => !!id),
      );
      if (kb.aws_data_source_id) dsIds.add(kb.aws_data_source_id);
      for (const dataSourceId of dsIds) {
        try {
          await client.send(
            new DeleteDataSourceCommand({
              knowledgeBaseId: kb.aws_kb_id,
              dataSourceId,
            }),
          );
        } catch (err) {
          console.warn(`[kb-manager] Failed to delete data source: ${err}`);
        }
      }
      try {
        await client.send(
          new DeleteKnowledgeBaseCommand({
            knowledgeBaseId: kb.aws_kb_id,
          }),
        );
      } catch (err) {
        console.warn(`[kb-manager] Failed to delete Bedrock KB: ${err}`);
      }
    }

    // Delete S3 documents — the platform-managed prefix ONLY. Connected
    // customer buckets are never written to or deleted from.
    try {
      const [tenant] = await db
        .select({ slug: tenants.slug })
        .from(tenants)
        .where(eq(tenants.id, kb.tenant_id));
      if (tenant?.slug) {
        const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } =
          await import("@aws-sdk/client-s3");
        const s3 = new S3Client({ region: AWS_REGION });
        const prefix = managedUploadPrefix(tenant.slug, kb.slug);
        const listResp = await s3.send(
          new ListObjectsV2Command({
            Bucket: workspaceBucket(),
            Prefix: prefix,
          }),
        );
        const objects = (listResp.Contents ?? [])
          .filter((o) => o.Key)
          .map((o) => ({ Key: o.Key! }));
        if (objects.length > 0) {
          await s3.send(
            new DeleteObjectsCommand({
              Bucket: workspaceBucket(),
              Delete: { Objects: objects },
            }),
          );
        }
      }
    } catch (err) {
      console.warn(`[kb-manager] Failed to delete S3 documents: ${err}`);
    }

    // Delete DB rows (knowledge_base_sources + knowledge_base_documents
    // cascade from the KB row).
    await db
      .delete(agentKnowledgeBases)
      .where(eq(agentKnowledgeBases.knowledge_base_id, kbId));
    await db.delete(knowledgeBases).where(eq(knowledgeBases.id, kbId));
    console.log(`[kb-manager] Deleted KB ${kbId}`);
  } catch (err) {
    console.error(`[kb-manager] Delete error for ${kbId}:`, err);
  }
}

async function handleRechunk(kbId: string): Promise<void> {
  const { kb, tenantSlug } = await resolveKbInfo(kbId);
  if (!kb.aws_kb_id) {
    await db
      .update(knowledgeBases)
      .set({
        status: "failed",
        error_message:
          "Cannot re-chunk a knowledge base that is not provisioned",
        updated_at: new Date(),
      })
      .where(eq(knowledgeBases.id, kbId));
    return;
  }

  const client = await getBedrockAgentClient();
  const { DeleteDataSourceCommand } =
    await import("@aws-sdk/client-bedrock-agent");

  try {
    // Guarded state machine (U8/KTD5): Bedrock fixes chunking at the data
    // source, so changing it means recreating EVERY data source. Drop each
    // old one, null its id (KB column too for managed-upload), then recreate
    // with the new chunking config. A crash between delete and recreate
    // leaves a recoverable rechunking/failed state instead of a dangling
    // data-source id the provider would query blind.
    const sources = await ensureManagedUploadSource(kb, tenantSlug);
    for (const source of sources) {
      if (source.kind === "snapshot") continue;
      if (source.aws_data_source_id) {
        await client.send(
          new DeleteDataSourceCommand({
            knowledgeBaseId: kb.aws_kb_id,
            dataSourceId: source.aws_data_source_id,
          }),
        );
      }
      await updateSource(source.id, { aws_data_source_id: null });
      if (source.kind === "managed-upload") {
        await db
          .update(knowledgeBases)
          .set({
            aws_data_source_id: null,
            status: "rechunking",
            updated_at: new Date(),
          })
          .where(eq(knowledgeBases.id, kbId));
      }
    }

    for (const source of await listSources(kbId)) {
      if (source.kind === "snapshot") continue;
      await createDataSourceForSource(kb, kb.aws_kb_id, source);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[kb-manager] Rechunk failed for ${kbId}:`, message);
    await db
      .update(knowledgeBases)
      .set({
        status: "failed",
        error_message: message.slice(0, 1000),
        updated_at: new Date(),
      })
      .where(eq(knowledgeBases.id, kbId));
    return;
  }

  // Re-ingest every document under the new chunking via the existing sync path
  // (starts an ingestion job against the new data source and polls to active).
  await handleSync(kbId);
}

export async function handler(
  event: KbManagerEvent,
): Promise<ConnectSourceResult | void> {
  console.log(
    `[kb-manager] action=${event.action} kbId=${event.knowledgeBaseId}`,
  );

  switch (event.action) {
    case "create":
      await handleCreate(event.knowledgeBaseId);
      break;
    case "sync":
      await handleSync(event.knowledgeBaseId);
      break;
    case "delete":
      await handleDelete(event.knowledgeBaseId);
      break;
    case "rechunk":
      await handleRechunk(event.knowledgeBaseId);
      break;
    case "connect_source":
      if (!event.connect) throw new Error("connect_source requires connect");
      // Throws on failure — the resolver invokes RequestResponse and
      // surfaces the message (R9).
      return handleConnectSource(event.knowledgeBaseId, event.connect);
    default:
      console.error(`[kb-manager] Unknown action: ${event.action}`);
  }
}
