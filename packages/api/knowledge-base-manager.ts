/**
 * Knowledge Base Manager Lambda
 *
 * Async Lambda invoked by the GraphQL resolver to provision, sync, and delete
 * Bedrock Knowledge Bases. Uses @aws-sdk/client-bedrock-agent.
 */

import { getConfig } from "@thinkwork/runtime-config";
import { and, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  knowledgeBases,
  knowledgeBaseDocuments,
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

const AWS_REGION = process.env.AWS_REGION || "us-east-1";
const KB_SERVICE_ROLE_ARN = process.env.KB_SERVICE_ROLE_ARN || "";
const DB_CLUSTER_ARN = process.env.DATABASE_CLUSTER_ARN || "";

function workspaceBucket(): string {
  return getConfig("WORKSPACE_BUCKET", "");
}

function databaseName(): string {
  return getConfig("DATABASE_NAME", "thinkwork");
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
    const { SecretsManagerClient, DescribeSecretCommand } = await import(
      "@aws-sdk/client-secrets-manager"
    );
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

interface KbManagerEvent {
  action: "create" | "sync" | "delete" | "rechunk";
  knowledgeBaseId: string;
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
  const { CreateKnowledgeBaseCommand, CreateDataSourceCommand } = await import(
    "@aws-sdk/client-bedrock-agent"
  );

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
      console.log(`[kb-manager] Using cluster ARN: ${DB_CLUSTER_ARN}`);
      console.log(`[kb-manager] Using role ARN: ${KB_SERVICE_ROLE_ARN}`);

      const createKbResp = await client.send(
        new CreateKnowledgeBaseCommand({
          name: `thinkwork-${tenantSlug}-${kb.slug}-${kb.id.slice(0, 8)}`,
          roleArn: KB_SERVICE_ROLE_ARN,
          knowledgeBaseConfiguration: {
            type: "VECTOR",
            vectorKnowledgeBaseConfiguration: {
              embeddingModelArn: `arn:aws:bedrock:${AWS_REGION}::foundation-model/${kb.embedding_model}`,
            },
          },
          storageConfiguration: {
            type: "RDS",
            rdsConfiguration: {
              resourceArn: DB_CLUSTER_ARN,
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

    // 2. Data Source (S3) — skip if already provisioned.
    let awsDsId = kb.aws_data_source_id ?? undefined;
    if (!awsDsId) {
      const s3Prefix = `tenants/${tenantSlug}/knowledge-bases/${kb.slug}/documents/`;
      const createDsResp = await client.send(
        new CreateDataSourceCommand({
          knowledgeBaseId: awsKbId,
          name: `${kb.slug}-s3`,
          dataSourceConfiguration: {
            type: "S3",
            s3Configuration: {
              bucketArn: `arn:aws:s3:::${workspaceBucket()}`,
              inclusionPrefixes: [s3Prefix],
            },
          },
          vectorIngestionConfiguration: {
            chunkingConfiguration: {
              chunkingStrategy:
                kb.chunking_strategy === "FIXED_SIZE" ? "FIXED_SIZE" : "NONE",
              fixedSizeChunkingConfiguration:
                kb.chunking_strategy === "FIXED_SIZE"
                  ? {
                      maxTokens: kb.chunk_size_tokens ?? 300,
                      overlapPercentage: kb.chunk_overlap_percent ?? 20,
                    }
                  : undefined,
            },
          },
        }),
      );

      awsDsId = createDsResp.dataSource?.dataSourceId;
      // Never mark the KB active without a data source — keep it failed so the
      // operator can retry into the data-source step (the prior code silently
      // marked it active with a null data source id).
      if (!awsDsId)
        throw new Error(
          "Failed to create Bedrock data source — no ID returned",
        );
      await db
        .update(knowledgeBases)
        .set({ aws_data_source_id: awsDsId, updated_at: new Date() })
        .where(eq(knowledgeBases.id, kbId));
    }

    // 3. Mark active and clear any prior error.
    await db
      .update(knowledgeBases)
      .set({ status: "active", error_message: null, updated_at: new Date() })
      .where(eq(knowledgeBases.id, kbId));

    console.log(
      `[kb-manager] Created KB ${kbId}: awsKbId=${awsKbId} awsDsId=${awsDsId}`,
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

async function handleSync(kbId: string): Promise<void> {
  const { kb } = await resolveKbInfo(kbId);
  if (!kb.aws_kb_id || !kb.aws_data_source_id) {
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

  const client = await getBedrockAgentClient();
  const { StartIngestionJobCommand, GetIngestionJobCommand } = await import(
    "@aws-sdk/client-bedrock-agent"
  );

  try {
    // Start ingestion
    const startResp = await client.send(
      new StartIngestionJobCommand({
        knowledgeBaseId: kb.aws_kb_id,
        dataSourceId: kb.aws_data_source_id,
      }),
    );

    const jobId = startResp.ingestionJob?.ingestionJobId;
    if (!jobId) throw new Error("Failed to start ingestion job");

    console.log(`[kb-manager] Started ingestion job ${jobId} for KB ${kbId}`);

    // Poll for completion (max 10 minutes)
    const maxAttempts = 60;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 10_000)); // 10s between polls

      const getResp = await client.send(
        new GetIngestionJobCommand({
          knowledgeBaseId: kb.aws_kb_id,
          dataSourceId: kb.aws_data_source_id,
          ingestionJobId: jobId,
        }),
      );

      const status = getResp.ingestionJob?.status;
      console.log(`[kb-manager] Ingestion job ${jobId} status: ${status}`);

      if (status === "COMPLETE") {
        const stats = getResp.ingestionJob?.statistics;
        await db
          .update(knowledgeBases)
          .set({
            status: "active",
            last_sync_at: new Date(),
            last_sync_status: "COMPLETE",
            document_count:
              stats?.numberOfDocumentsScanned ?? kb.document_count,
            error_message: null,
            updated_at: new Date(),
          })
          .where(eq(knowledgeBases.id, kbId));
        console.log(
          `[kb-manager] Sync complete for KB ${kbId}: ${stats?.numberOfDocumentsScanned ?? 0} docs`,
        );
        // THINK-193 U7: reconcile the per-document manifest ONLY after a
        // successful ingestion job (never racing StartIngestionJob with
        // direct Ingest calls). A reconciliation failure must not fail the
        // sync itself — it retries on the next sync.
        try {
          await reconcileManifestAfterSync(kbId);
        } catch (err) {
          console.error(
            `[kb-manager] Manifest reconciliation failed for KB ${kbId}:`,
            err instanceof Error ? err.message : err,
          );
        }
        return;
      }

      if (status === "FAILED") {
        const reason =
          getResp.ingestionJob?.failureReasons?.join("; ") ?? "Unknown error";
        await db
          .update(knowledgeBases)
          .set({
            status: "active",
            last_sync_at: new Date(),
            last_sync_status: "FAILED",
            error_message: reason.slice(0, 1000),
            updated_at: new Date(),
          })
          .where(eq(knowledgeBases.id, kbId));
        console.error(`[kb-manager] Sync failed for KB ${kbId}: ${reason}`);
        return;
      }
    }

    // Timed out
    await db
      .update(knowledgeBases)
      .set({
        status: "active",
        last_sync_status: "FAILED",
        error_message: "Ingestion job timed out after 10 minutes",
        updated_at: new Date(),
      })
      .where(eq(knowledgeBases.id, kbId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[kb-manager] Sync error for ${kbId}:`, message);
    await db
      .update(knowledgeBases)
      .set({
        status: "active",
        last_sync_status: "FAILED",
        error_message: message.slice(0, 1000),
        updated_at: new Date(),
      })
      .where(eq(knowledgeBases.id, kbId));
  }
}

// ---------------------------------------------------------------------------
// THINK-193 U7 — document manifest reconciliation (post-successful-sync)
// ---------------------------------------------------------------------------

/** S3 uri for a document key in the workspace bucket. */
function documentS3Uri(key: string): string {
  return `s3://${workspaceBucket()}/${key}`;
}

/**
 * After a COMPLETE ingestion job:
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
async function reconcileManifestAfterSync(kbId: string): Promise<void> {
  const { kb, tenantSlug } = await resolveKbInfo(kbId);
  if (!kb.aws_kb_id || !kb.aws_data_source_id || !tenantSlug) return;
  const awsKbId = kb.aws_kb_id;
  const dataSourceId = kb.aws_data_source_id;
  const prefix = `tenants/${tenantSlug}/knowledge-bases/${kb.slug}/documents/`;

  // 1. Live S3 objects (paginated), etags normalized.
  const { S3Client, ListObjectsV2Command, HeadObjectCommand } = await import(
    "@aws-sdk/client-s3"
  );
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
  const { BedrockAgentRuntimeClient, RetrieveCommand } = await import(
    "@aws-sdk/client-bedrock-agent-runtime"
  );
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
  const { DeleteDataSourceCommand, DeleteKnowledgeBaseCommand } = await import(
    "@aws-sdk/client-bedrock-agent"
  );

  try {
    // Delete data source first, then KB
    if (kb.aws_data_source_id && kb.aws_kb_id) {
      try {
        await client.send(
          new DeleteDataSourceCommand({
            knowledgeBaseId: kb.aws_kb_id,
            dataSourceId: kb.aws_data_source_id,
          }),
        );
      } catch (err) {
        console.warn(`[kb-manager] Failed to delete data source: ${err}`);
      }
    }

    if (kb.aws_kb_id) {
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

    // Delete S3 documents
    try {
      const [tenant] = await db
        .select({ slug: tenants.slug })
        .from(tenants)
        .where(eq(tenants.id, kb.tenant_id));
      if (tenant?.slug) {
        const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } =
          await import("@aws-sdk/client-s3");
        const s3 = new S3Client({ region: AWS_REGION });
        const prefix = `tenants/${tenant.slug}/knowledge-bases/${kb.slug}/documents/`;
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

    // Delete DB rows
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
  const { DeleteDataSourceCommand, CreateDataSourceCommand } = await import(
    "@aws-sdk/client-bedrock-agent"
  );

  try {
    // Guarded state machine (U8/KTD5): Bedrock fixes chunking at the data
    // source, so changing it means recreating the data source. Drop the old
    // one, mark `rechunking` with a null data-source id, then recreate with the
    // new chunking config. A crash between delete and recreate leaves a
    // recoverable rechunking/failed state instead of a dangling
    // aws_data_source_id the provider would query blind.
    if (kb.aws_data_source_id) {
      await client.send(
        new DeleteDataSourceCommand({
          knowledgeBaseId: kb.aws_kb_id,
          dataSourceId: kb.aws_data_source_id,
        }),
      );
    }
    await db
      .update(knowledgeBases)
      .set({
        aws_data_source_id: null,
        status: "rechunking",
        updated_at: new Date(),
      })
      .where(eq(knowledgeBases.id, kbId));

    const s3Prefix = `tenants/${tenantSlug}/knowledge-bases/${kb.slug}/documents/`;
    const createDsResp = await client.send(
      new CreateDataSourceCommand({
        knowledgeBaseId: kb.aws_kb_id,
        name: `${kb.slug}-s3`,
        dataSourceConfiguration: {
          type: "S3",
          s3Configuration: {
            bucketArn: `arn:aws:s3:::${workspaceBucket()}`,
            inclusionPrefixes: [s3Prefix],
          },
        },
        vectorIngestionConfiguration: {
          chunkingConfiguration: {
            chunkingStrategy:
              kb.chunking_strategy === "FIXED_SIZE" ? "FIXED_SIZE" : "NONE",
            fixedSizeChunkingConfiguration:
              kb.chunking_strategy === "FIXED_SIZE"
                ? {
                    maxTokens: kb.chunk_size_tokens ?? 300,
                    overlapPercentage: kb.chunk_overlap_percent ?? 20,
                  }
                : undefined,
          },
        },
      }),
    );

    const newDsId = createDsResp.dataSource?.dataSourceId;
    if (!newDsId)
      throw new Error(
        "Failed to recreate Bedrock data source — no ID returned",
      );
    await db
      .update(knowledgeBases)
      .set({ aws_data_source_id: newDsId, updated_at: new Date() })
      .where(eq(knowledgeBases.id, kbId));
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

export async function handler(event: KbManagerEvent): Promise<void> {
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
    default:
      console.error(`[kb-manager] Unknown action: ${event.action}`);
  }
}
