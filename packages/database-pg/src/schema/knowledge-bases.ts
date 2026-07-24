/**
 * Knowledge Base domain tables: knowledge_bases, agent_knowledge_bases,
 * knowledge_base_documents (per-document edition manifest, THINK-193 U7).
 * Supports document-backed RAG via AWS Bedrock Knowledge Bases.
 */

import {
  check,
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  boolean,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants } from "./core";
import { agents } from "./agents";
import { spaces } from "./spaces";

// ---------------------------------------------------------------------------
// knowledge_bases
// ---------------------------------------------------------------------------

export const knowledgeBases = pgTable(
  "knowledge_bases",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id)
      .notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    embedding_model: text("embedding_model")
      .notNull()
      .default("amazon.titan-embed-text-v2:0"),
    chunking_strategy: text("chunking_strategy")
      .notNull()
      .default("FIXED_SIZE"),
    chunk_size_tokens: integer("chunk_size_tokens").default(300),
    chunk_overlap_percent: integer("chunk_overlap_percent").default(20),
    status: text("status").notNull().default("creating"),
    aws_kb_id: text("aws_kb_id"),
    aws_data_source_id: text("aws_data_source_id"),
    last_sync_at: timestamp("last_sync_at", { withTimezone: true }),
    last_sync_status: text("last_sync_status"),
    document_count: integer("document_count").default(0),
    error_message: text("error_message"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_knowledge_bases_tenant").on(table.tenant_id),
    uniqueIndex("uq_knowledge_bases_tenant_slug").on(
      table.tenant_id,
      table.slug,
    ),
  ],
);

// ---------------------------------------------------------------------------
// agent_knowledge_bases (many-to-many join)
// ---------------------------------------------------------------------------

export const agentKnowledgeBases = pgTable(
  "agent_knowledge_bases",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    agent_id: uuid("agent_id")
      .references(() => agents.id)
      .notNull(),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id)
      .notNull(),
    knowledge_base_id: uuid("knowledge_base_id")
      .references(() => knowledgeBases.id)
      .notNull(),
    enabled: boolean("enabled").notNull().default(true),
    search_config: jsonb("search_config"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_agent_kb").on(table.agent_id, table.knowledge_base_id),
  ],
);

// ---------------------------------------------------------------------------
// space_knowledge_bases (many-to-many join)
// ---------------------------------------------------------------------------

export const spaceKnowledgeBases = pgTable(
  "space_knowledge_bases",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    space_id: uuid("space_id")
      .references(() => spaces.id, { onDelete: "cascade" })
      .notNull(),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    knowledge_base_id: uuid("knowledge_base_id")
      .references(() => knowledgeBases.id)
      .notNull(),
    enabled: boolean("enabled").notNull().default(true),
    search_config: jsonb("search_config"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_space_kb").on(table.space_id, table.knowledge_base_id),
    index("idx_space_kbs_space").on(table.tenant_id, table.space_id),
    index("idx_space_kbs_knowledge_base").on(
      table.tenant_id,
      table.knowledge_base_id,
    ),
  ],
);

// ---------------------------------------------------------------------------
// knowledge_base_sources — N data sources per KB (external-s3-kb-source U1)
// ---------------------------------------------------------------------------

/**
 * 'managed-upload' is the platform-managed upload prefix (the pre-sources
 * implied data source, backfilled as source #0); 's3-connect' points Bedrock
 * at an existing customer-owned bucket/prefix read in place; 'snapshot' is a
 * reserved enum value only — no import path exists.
 */
export const KB_SOURCE_KINDS = [
  "managed-upload",
  "s3-connect",
  "snapshot",
] as const;

export type KbSourceKind = (typeof KB_SOURCE_KINDS)[number];

/**
 * Access/sync lifecycle: 'pending' until preflight + initial sync + canary
 * pass, 'degraded' when ingestion succeeded but the canary retrieval missed,
 * 'access_revoked' when the reconciler's as-role probe fails (fail closed —
 * scheduled syncs skip the source until access is restored).
 */
export const KB_SOURCE_ACCESS_STATUSES = [
  "pending",
  "healthy",
  "degraded",
  "access_revoked",
  "failed",
] as const;

export type KbSourceAccessStatus = (typeof KB_SOURCE_ACCESS_STATUSES)[number];

/**
 * One row per Bedrock data source of a KB. `bucket` is NULL for
 * 'managed-upload' (resolved to the platform workspace bucket at runtime);
 * 's3-connect' rows carry the external bucket name. `filter_patterns` holds
 * `{include: string[], exclude: string[]}` glob arrays (Bedrock
 * PatternObjectFilter semantics — exclusion wins). The sentinel columns back
 * the canary retrieval: a distinctive phrase sampled from one document at
 * connect time; post-sync health requires retrieving it.
 */
export const knowledgeBaseSources = pgTable(
  "knowledge_base_sources",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id)
      .notNull(),
    knowledge_base_id: uuid("knowledge_base_id")
      .references(() => knowledgeBases.id, { onDelete: "cascade" })
      .notNull(),
    kind: text("kind").notNull(),
    bucket: text("bucket"),
    prefix: text("prefix"),
    filter_patterns: jsonb("filter_patterns"),
    bucket_owner_account_id: text("bucket_owner_account_id"),
    parsing_strategy: text("parsing_strategy").notNull().default("DEFAULT"),
    aws_data_source_id: text("aws_data_source_id"),
    access_status: text("access_status").notNull().default("pending"),
    last_sync_at: timestamp("last_sync_at", { withTimezone: true }),
    last_sync_status: text("last_sync_status"),
    document_count: integer("document_count").default(0),
    error_message: text("error_message"),
    sentinel_document_key: text("sentinel_document_key"),
    sentinel_phrase: text("sentinel_phrase"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_kb_sources_kb").on(table.knowledge_base_id),
    index("idx_kb_sources_tenant").on(table.tenant_id),
    // One managed-upload source per KB (the migrated source #0).
    uniqueIndex("uq_kb_sources_managed_upload")
      .on(table.knowledge_base_id)
      .where(sql`${table.kind} = 'managed-upload'`),
    check(
      "knowledge_base_sources_kind_check",
      sql`${table.kind} IN ('managed-upload', 's3-connect', 'snapshot')`,
    ),
    check(
      "knowledge_base_sources_access_status_check",
      sql`${table.access_status} IN ('pending', 'healthy', 'degraded', 'access_revoked', 'failed')`,
    ),
    // s3-connect rows must know where they point.
    check(
      "knowledge_base_sources_s3_connect_location_check",
      sql`${table.kind} <> 's3-connect' OR (${table.bucket} IS NOT NULL AND ${table.prefix} IS NOT NULL)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// knowledge_base_documents — per-document edition manifest (THINK-193 U7)
// ---------------------------------------------------------------------------

/**
 * Bedrock-reported per-document ingestion lifecycle, plus the two
 * ThinkWork-owned deletion states: 'deleting' (delete intent stamped /
 * object gone from S3, Bedrock removal not yet verified) and
 * 'absent_verified' (Bedrock reports the document absent AND a scoped
 * Retrieve returned no hits — the zero-residue settlement gate).
 */
export const KB_DOCUMENT_INGEST_STATUSES = [
  "pending",
  "ingesting",
  "indexed",
  "failed",
  "deleting",
  "absent_verified",
] as const;

export type KbDocumentIngestStatus =
  (typeof KB_DOCUMENT_INGEST_STATUSES)[number];

/**
 * Hindsight-projection lifecycle for one manifest row: 'pending' until the
 * bedrock_kb memory-source adapter projects the current edition, 'skipped'
 * for formats gated behind the fidelity probe (PDF), 'retracting' once a
 * deletion enqueued the standard Hindsight derivation retraction.
 */
export const KB_DOCUMENT_PROJECTION_STATUSES = [
  "pending",
  "projected",
  "skipped",
  "failed",
  "retracting",
  "retracted",
] as const;

export type KbDocumentProjectionStatus =
  (typeof KB_DOCUMENT_PROJECTION_STATUSES)[number];

/**
 * ONE row per (knowledge_base_id, data_source_id, document_key): the row id
 * is the document's stable manifest identity across editions, so the
 * Hindsight projection key derived from it replaces in place. `edition`
 * increments when the S3 object's etag/content changes; `effective_from`
 * tracks the current edition's start and `effective_to` closes only at
 * verified deletion. Edition HISTORY lives in the evidence ledger
 * (memory_evidence_items.source_version embeds edition + content hash).
 */
export const knowledgeBaseDocuments = pgTable(
  "knowledge_base_documents",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id)
      .notNull(),
    knowledge_base_id: uuid("knowledge_base_id")
      .references(() => knowledgeBases.id, { onDelete: "cascade" })
      .notNull(),
    /** Bedrock data source id the document was ingested through. A rechunk
     * recreates the data source, so rows are partitioned by it. */
    data_source_id: text("data_source_id").notNull(),
    /** Source row the document belongs to (external-s3-kb-source U1). The
     * text column above is the AWS identity; this is the row reference. */
    source_id: uuid("source_id").references(() => knowledgeBaseSources.id, {
      onDelete: "set null",
    }),
    /** Full S3 object key (tenants/<slug>/knowledge-bases/<kb>/documents/…). */
    document_key: text("document_key").notNull(),
    s3_version_id: text("s3_version_id"),
    etag: text("etag"),
    content_hash: text("content_hash"),
    edition: integer("edition").notNull().default(1),
    effective_from: timestamp("effective_from", { withTimezone: true }),
    effective_to: timestamp("effective_to", { withTimezone: true }),
    ingest_status: text("ingest_status").notNull().default("pending"),
    projection_status: text("projection_status").notNull().default("pending"),
    last_error: text("last_error"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_kb_documents_identity").on(
      table.knowledge_base_id,
      table.data_source_id,
      table.document_key,
    ),
    index("idx_kb_documents_tenant").on(table.tenant_id),
    // Adapter acquisition cursor: changed editions since (updated_at, id).
    index("idx_kb_documents_kb_updated").on(
      table.knowledge_base_id,
      table.updated_at,
      table.id,
    ),
    // Settlement scan for 'deleting' rows per KB.
    index("idx_kb_documents_kb_ingest_status").on(
      table.knowledge_base_id,
      table.ingest_status,
    ),
    check(
      "knowledge_base_documents_ingest_status_check",
      sql`${table.ingest_status} IN ('pending', 'ingesting', 'indexed', 'failed', 'deleting', 'absent_verified')`,
    ),
    check(
      "knowledge_base_documents_projection_status_check",
      sql`${table.projection_status} IN ('pending', 'projected', 'skipped', 'failed', 'retracting', 'retracted')`,
    ),
    check(
      "knowledge_base_documents_edition_positive",
      sql`${table.edition} >= 1`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const knowledgeBasesRelations = relations(
  knowledgeBases,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [knowledgeBases.tenant_id],
      references: [tenants.id],
    }),
    agentKnowledgeBases: many(agentKnowledgeBases),
    spaceKnowledgeBases: many(spaceKnowledgeBases),
    documents: many(knowledgeBaseDocuments),
    sources: many(knowledgeBaseSources),
  }),
);

export const knowledgeBaseSourcesRelations = relations(
  knowledgeBaseSources,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [knowledgeBaseSources.tenant_id],
      references: [tenants.id],
    }),
    knowledgeBase: one(knowledgeBases, {
      fields: [knowledgeBaseSources.knowledge_base_id],
      references: [knowledgeBases.id],
    }),
    documents: many(knowledgeBaseDocuments),
  }),
);

export const knowledgeBaseDocumentsRelations = relations(
  knowledgeBaseDocuments,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [knowledgeBaseDocuments.tenant_id],
      references: [tenants.id],
    }),
    knowledgeBase: one(knowledgeBases, {
      fields: [knowledgeBaseDocuments.knowledge_base_id],
      references: [knowledgeBases.id],
    }),
    source: one(knowledgeBaseSources, {
      fields: [knowledgeBaseDocuments.source_id],
      references: [knowledgeBaseSources.id],
    }),
  }),
);

export const agentKnowledgeBasesRelations = relations(
  agentKnowledgeBases,
  ({ one }) => ({
    agent: one(agents, {
      fields: [agentKnowledgeBases.agent_id],
      references: [agents.id],
    }),
    tenant: one(tenants, {
      fields: [agentKnowledgeBases.tenant_id],
      references: [tenants.id],
    }),
    knowledgeBase: one(knowledgeBases, {
      fields: [agentKnowledgeBases.knowledge_base_id],
      references: [knowledgeBases.id],
    }),
  }),
);

export const spaceKnowledgeBasesRelations = relations(
  spaceKnowledgeBases,
  ({ one }) => ({
    space: one(spaces, {
      fields: [spaceKnowledgeBases.space_id],
      references: [spaces.id],
    }),
    tenant: one(tenants, {
      fields: [spaceKnowledgeBases.tenant_id],
      references: [tenants.id],
    }),
    knowledgeBase: one(knowledgeBases, {
      fields: [spaceKnowledgeBases.knowledge_base_id],
      references: [knowledgeBases.id],
    }),
  }),
);
