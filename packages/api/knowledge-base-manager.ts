/**
 * Knowledge Base Manager Lambda
 *
 * Async Lambda invoked by the GraphQL resolver to provision, sync, and delete
 * Bedrock Knowledge Bases. Uses @aws-sdk/client-bedrock-agent.
 */

import { eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { knowledgeBases, agentKnowledgeBases, tenants } from "@thinkwork/database-pg/schema";

const AWS_REGION = process.env.AWS_REGION || "us-east-1";
const WORKSPACE_BUCKET = process.env.WORKSPACE_BUCKET || "";
const KB_SERVICE_ROLE_ARN = process.env.KB_SERVICE_ROLE_ARN || "";
const DB_CLUSTER_ARN = process.env.DATABASE_CLUSTER_ARN || "";
const DB_NAME = process.env.DATABASE_NAME || "thinkwork";

async function getBedrockKbSecretArn(): Promise<string> {
  // Look up the full ARN (with random suffix) from Secrets Manager
  const stage = process.env.STAGE || "dev";
  const secretName = `thinkwork-${stage}-bedrock-kb-rds-credentials`;
  try {
    const { SecretsManagerClient, DescribeSecretCommand } = await import("@aws-sdk/client-secrets-manager");
    const sm = new SecretsManagerClient({ region: AWS_REGION });
    const resp = await sm.send(new DescribeSecretCommand({ SecretId: secretName }));
    return resp.ARN || secretName;
  } catch {
    return secretName;
  }
}

const db = getDb();

interface KbManagerEvent {
  action: "create" | "sync" | "delete";
  knowledgeBaseId: string;
}

async function getBedrockAgentClient() {
  const {
    BedrockAgentClient,
  } = await import("@aws-sdk/client-bedrock-agent");
  return new BedrockAgentClient({ region: AWS_REGION });
}

async function resolveKbInfo(kbId: string) {
  const [kb] = await db.select().from(knowledgeBases).where(eq(knowledgeBases.id, kbId));
  if (!kb) throw new Error(`Knowledge base not found: ${kbId}`);
  const [tenant] = await db.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, kb.tenant_id));
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
  const { CreateKnowledgeBaseCommand, CreateDataSourceCommand } = await import("@aws-sdk/client-bedrock-agent");

  try {
    // 1. Create Knowledge Base in Bedrock
    // Pre-create pgvector table that Bedrock KB expects
    const tableName = `bedrock_kb_${kb.slug.replace(/-/g, "_")}`;
    await createVectorTable(tableName);

    const secretArn = await getBedrockKbSecretArn();
    console.log(`[kb-manager] Using secret ARN: ${secretArn}`);
    console.log(`[kb-manager] Using cluster ARN: ${DB_CLUSTER_ARN}`);
    console.log(`[kb-manager] Using role ARN: ${KB_SERVICE_ROLE_ARN}`);

    const createKbResp = await client.send(new CreateKnowledgeBaseCommand({
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
          databaseName: DB_NAME,
          tableName: `bedrock_kb.bedrock_kb_${kb.slug.replace(/-/g, "_")}`,
          fieldMapping: {
            primaryKeyField: "id",
            vectorField: "embedding",
            textField: "chunks",
            metadataField: "metadata",
          },
        },
      },
    }));

    const awsKbId = createKbResp.knowledgeBase?.knowledgeBaseId;
    if (!awsKbId) throw new Error("Failed to create Bedrock KB — no ID returned");

    // 2. Create Data Source (S3)
    const s3Prefix = `tenants/${tenantSlug}/knowledge-bases/${kb.slug}/documents/`;
    const createDsResp = await client.send(new CreateDataSourceCommand({
      knowledgeBaseId: awsKbId,
      name: `${kb.slug}-s3`,
      dataSourceConfiguration: {
        type: "S3",
        s3Configuration: {
          bucketArn: `arn:aws:s3:::${WORKSPACE_BUCKET}`,
          inclusionPrefixes: [s3Prefix],
        },
      },
      vectorIngestionConfiguration: {
        chunkingConfiguration: {
          chunkingStrategy: kb.chunking_strategy === "FIXED_SIZE" ? "FIXED_SIZE" : "NONE",
          fixedSizeChunkingConfiguration: kb.chunking_strategy === "FIXED_SIZE" ? {
            maxTokens: kb.chunk_size_tokens ?? 300,
            overlapPercentage: kb.chunk_overlap_percent ?? 20,
          } : undefined,
        },
      },
    }));

    const awsDsId = createDsResp.dataSource?.dataSourceId;

    // 3. Update DB with Bedrock IDs
    await db.update(knowledgeBases).set({
      aws_kb_id: awsKbId,
      aws_data_source_id: awsDsId ?? null,
      status: "active",
      updated_at: new Date(),
    }).where(eq(knowledgeBases.id, kbId));

    console.log(`[kb-manager] Created KB ${kbId}: awsKbId=${awsKbId} awsDsId=${awsDsId}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[kb-manager] Create failed for ${kbId}:`, message);
    await db.update(knowledgeBases).set({
      status: "failed",
      error_message: message.slice(0, 1000),
      updated_at: new Date(),
    }).where(eq(knowledgeBases.id, kbId));
  }
}

async function handleSync(kbId: string): Promise<void> {
  const { kb } = await resolveKbInfo(kbId);
  if (!kb.aws_kb_id || !kb.aws_data_source_id) {
    console.error(`[kb-manager] Cannot sync KB ${kbId}: missing Bedrock IDs`);
    await db.update(knowledgeBases).set({
      status: "failed",
      error_message: "Missing Bedrock KB or Data Source ID",
      last_sync_status: "FAILED",
      updated_at: new Date(),
    }).where(eq(knowledgeBases.id, kbId));
    return;
  }

  const client = await getBedrockAgentClient();
  const { StartIngestionJobCommand, GetIngestionJobCommand } = await import("@aws-sdk/client-bedrock-agent");

  try {
    // Start ingestion
    const startResp = await client.send(new StartIngestionJobCommand({
      knowledgeBaseId: kb.aws_kb_id,
      dataSourceId: kb.aws_data_source_id,
    }));

    const jobId = startResp.ingestionJob?.ingestionJobId;
    if (!jobId) throw new Error("Failed to start ingestion job");

    console.log(`[kb-manager] Started ingestion job ${jobId} for KB ${kbId}`);

    // Poll for completion (max 10 minutes)
    const maxAttempts = 60;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 10_000)); // 10s between polls

      const getResp = await client.send(new GetIngestionJobCommand({
        knowledgeBaseId: kb.aws_kb_id,
        dataSourceId: kb.aws_data_source_id,
        ingestionJobId: jobId,
      }));

      const status = getResp.ingestionJob?.status;
      console.log(`[kb-manager] Ingestion job ${jobId} status: ${status}`);

      if (status === "COMPLETE") {
        const stats = getResp.ingestionJob?.statistics;
        await db.update(knowledgeBases).set({
          status: "active",
          last_sync_at: new Date(),
          last_sync_status: "COMPLETE",
          document_count: stats?.numberOfDocumentsScanned ?? kb.document_count,
          error_message: null,
          updated_at: new Date(),
        }).where(eq(knowledgeBases.id, kbId));
        console.log(`[kb-manager] Sync complete for KB ${kbId}: ${stats?.numberOfDocumentsScanned ?? 0} docs`);
        return;
      }

      if (status === "FAILED") {
        const reason = getResp.ingestionJob?.failureReasons?.join("; ") ?? "Unknown error";
        await db.update(knowledgeBases).set({
          status: "active",
          last_sync_at: new Date(),
          last_sync_status: "FAILED",
          error_message: reason.slice(0, 1000),
          updated_at: new Date(),
        }).where(eq(knowledgeBases.id, kbId));
        console.error(`[kb-manager] Sync failed for KB ${kbId}: ${reason}`);
        return;
      }
    }

    // Timed out
    await db.update(knowledgeBases).set({
      status: "active",
      last_sync_status: "FAILED",
      error_message: "Ingestion job timed out after 10 minutes",
      updated_at: new Date(),
    }).where(eq(knowledgeBases.id, kbId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[kb-manager] Sync error for ${kbId}:`, message);
    await db.update(knowledgeBases).set({
      status: "active",
      last_sync_status: "FAILED",
      error_message: message.slice(0, 1000),
      updated_at: new Date(),
    }).where(eq(knowledgeBases.id, kbId));
  }
}

async function handleDelete(kbId: string): Promise<void> {
  const [kb] = await db.select().from(knowledgeBases).where(eq(knowledgeBases.id, kbId));
  if (!kb) return;

  const client = await getBedrockAgentClient();
  const { DeleteDataSourceCommand, DeleteKnowledgeBaseCommand } = await import("@aws-sdk/client-bedrock-agent");

  try {
    // Delete data source first, then KB
    if (kb.aws_data_source_id && kb.aws_kb_id) {
      try {
        await client.send(new DeleteDataSourceCommand({
          knowledgeBaseId: kb.aws_kb_id,
          dataSourceId: kb.aws_data_source_id,
        }));
      } catch (err) {
        console.warn(`[kb-manager] Failed to delete data source: ${err}`);
      }
    }

    if (kb.aws_kb_id) {
      try {
        await client.send(new DeleteKnowledgeBaseCommand({
          knowledgeBaseId: kb.aws_kb_id,
        }));
      } catch (err) {
        console.warn(`[kb-manager] Failed to delete Bedrock KB: ${err}`);
      }
    }

    // Delete S3 documents
    try {
      const [tenant] = await db.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, kb.tenant_id));
      if (tenant?.slug) {
        const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = await import("@aws-sdk/client-s3");
        const s3 = new S3Client({ region: AWS_REGION });
        const prefix = `tenants/${tenant.slug}/knowledge-bases/${kb.slug}/documents/`;
        const listResp = await s3.send(new ListObjectsV2Command({
          Bucket: WORKSPACE_BUCKET,
          Prefix: prefix,
        }));
        const objects = (listResp.Contents ?? []).filter((o) => o.Key).map((o) => ({ Key: o.Key! }));
        if (objects.length > 0) {
          await s3.send(new DeleteObjectsCommand({
            Bucket: WORKSPACE_BUCKET,
            Delete: { Objects: objects },
          }));
        }
      }
    } catch (err) {
      console.warn(`[kb-manager] Failed to delete S3 documents: ${err}`);
    }

    // Delete DB rows
    await db.delete(agentKnowledgeBases).where(eq(agentKnowledgeBases.knowledge_base_id, kbId));
    await db.delete(knowledgeBases).where(eq(knowledgeBases.id, kbId));
    console.log(`[kb-manager] Deleted KB ${kbId}`);
  } catch (err) {
    console.error(`[kb-manager] Delete error for ${kbId}:`, err);
  }
}

export async function handler(event: KbManagerEvent): Promise<void> {
  console.log(`[kb-manager] action=${event.action} kbId=${event.knowledgeBaseId}`);

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
    default:
      console.error(`[kb-manager] Unknown action: ${event.action}`);
  }
}
