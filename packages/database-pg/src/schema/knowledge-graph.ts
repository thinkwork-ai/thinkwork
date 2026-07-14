/**
 * Knowledge Graph tables.
 *
 * Lives in the `kg.*` Postgres schema (extracted from `public.knowledge_graph_*`
 * in 2026-07 — see docs/solutions/database-issues/feature-schema-extraction-pattern.md
 * and packages/database-pg/drizzle/0250_kg_schema_extraction.sql). Unlike the
 * wiki/brain extraction, TS export identifiers were renamed with the tables
 * (`knowledgeGraphEntities` → `kgEntities`, etc.) so DB names and code names
 * match.
 *
 * Stores normalized, tenant-scoped graph snapshots in Aurora. Rows are scoped
 * by source kind/ref so thread transcripts, wiki pages, and Brain pages can
 * share the same ontology-gated normalization pipeline.
 */

import {
  pgSchema,
  uuid,
  text,
  integer,
  numeric,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants, users } from "./core";
import { threads } from "./threads";
import { messages } from "./messages";
import { ontologyEntityTypes, ontologyRelationshipTypes } from "./ontology";
import { canonicalEntities } from "./entity-identity";

export const kg = pgSchema("kg");

export const KNOWLEDGE_GRAPH_INGEST_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "canceled",
  "stale_noop",
] as const;
export type KnowledgeGraphIngestStatus =
  (typeof KNOWLEDGE_GRAPH_INGEST_STATUSES)[number];

export const KNOWLEDGE_GRAPH_SOURCE_KINDS = [
  "thread",
  "wiki",
  "brain",
  "observations",
] as const;
export type KnowledgeGraphSourceKind =
  (typeof KNOWLEDGE_GRAPH_SOURCE_KINDS)[number];

export const KNOWLEDGE_GRAPH_GROUNDING_STATUSES = [
  "grounded",
  "unapproved_type",
  "ungrounded",
  "conflict",
  "unknown",
] as const;
export type KnowledgeGraphGroundingStatus =
  (typeof KNOWLEDGE_GRAPH_GROUNDING_STATUSES)[number];

export const KNOWLEDGE_GRAPH_PROVENANCE_STATUSES = [
  "strong",
  "weak",
  "missing",
] as const;
export type KnowledgeGraphProvenanceStatus =
  (typeof KNOWLEDGE_GRAPH_PROVENANCE_STATUSES)[number];

export const KNOWLEDGE_GRAPH_EVIDENCE_SOURCE_KINDS = [
  "thread_message",
  "wiki_page",
  "wiki_section",
  "brain_page",
  "brain_section",
  "hindsight_observation",
  "graph_payload",
  "normalizer",
] as const;
export type KnowledgeGraphEvidenceSourceKind =
  (typeof KNOWLEDGE_GRAPH_EVIDENCE_SOURCE_KINDS)[number];

export const kgIngestRuns = kg.table(
  "ingest_runs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    thread_id: uuid("thread_id").references(() => threads.id, {
      onDelete: "cascade",
    }),
    source_kind: text("source_kind").notNull().default("thread"),
    source_ref: text("source_ref").notNull(),
    source_label: text("source_label"),
    requested_by_user_id: uuid("requested_by_user_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    status: text("status").notNull().default("queued"),
    trigger: text("trigger").notNull().default("manual"),
    source_dataset_name: text("source_dataset_name").notNull(),
    source_dataset_id: text("source_dataset_id"),
    started_at: timestamp("started_at", { withTimezone: true }),
    finished_at: timestamp("finished_at", { withTimezone: true }),
    duration_ms: integer("duration_ms"),
    error: text("error"),
    entity_count: integer("entity_count").notNull().default(0),
    relationship_count: integer("relationship_count").notNull().default(0),
    evidence_count: integer("evidence_count").notNull().default(0),
    diagnostic_count: integer("diagnostic_count").notNull().default(0),
    message_count: integer("message_count").notNull().default(0),
    input: jsonb("input").notNull().default({}),
    metrics: jsonb("metrics").notNull().default({}),
    metadata: jsonb("metadata").notNull().default({}),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_kg_ingest_runs_tenant_thread_created").on(
      table.tenant_id,
      table.thread_id,
      table.created_at,
    ),
    index("idx_kg_ingest_runs_tenant_source_created").on(
      table.tenant_id,
      table.source_kind,
      table.source_ref,
      table.created_at,
    ),
    index("idx_kg_ingest_runs_tenant_status").on(table.tenant_id, table.status),
    index("idx_kg_ingest_runs_requested_by").on(
      table.tenant_id,
      table.requested_by_user_id,
      table.created_at,
    ),
    uniqueIndex("uq_kg_ingest_runs_active_thread")
      .on(table.tenant_id, table.thread_id)
      .where(
        sql`${table.thread_id} IS NOT NULL AND ${table.status} IN ('queued','running')`,
      ),
    uniqueIndex("uq_kg_ingest_runs_active_source")
      .on(table.tenant_id, table.source_kind, table.source_ref)
      .where(sql`${table.status} IN ('queued','running')`),
    check(
      "ingest_runs_status_allowed",
      sql`${table.status} IN ('queued','running','succeeded','failed','canceled','stale_noop')`,
    ),
    check(
      "ingest_runs_trigger_allowed",
      sql`${table.trigger} IN ('manual','scheduled')`,
    ),
    check(
      "ingest_runs_source_kind_allowed",
      sql`${table.source_kind} IN ('thread','wiki','brain','observations')`,
    ),
    check(
      "ingest_runs_thread_scope_required",
      sql`${table.source_kind} != 'thread' OR ${table.thread_id} IS NOT NULL`,
    ),
  ],
);

export const kgEntities = kg.table(
  "entities",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    thread_id: uuid("thread_id").references(() => threads.id, {
      onDelete: "cascade",
    }),
    source_kind: text("source_kind").notNull().default("thread"),
    source_ref: text("source_ref").notNull(),
    ingest_run_id: uuid("ingest_run_id")
      .references(() => kgIngestRuns.id, { onDelete: "cascade" })
      .notNull(),
    graph_node_id: text("graph_node_id").notNull(),
    label: text("label").notNull(),
    normalized_label: text("normalized_label").notNull(),
    type_label: text("type_label"),
    ontology_entity_type_id: uuid("ontology_entity_type_id").references(
      () => ontologyEntityTypes.id,
      { onDelete: "set null" },
    ),
    ontology_type_slug: text("ontology_type_slug"),
    /** THINK-193 U4: stable canonical identity for shared/grounded entities. */
    canonical_entity_id: uuid("canonical_entity_id").references(
      () => canonicalEntities.id,
      { onDelete: "set null" },
    ),
    /**
     * 'resolved' — canonical id assigned; 'deferred' — shared entity awaiting
     * an operator resolution case; 'private' — personal-scope row that must
     * not create tenant identity; 'legacy' — pre-U4 row not yet backfilled.
     */
    resolution_state: text("resolution_state").notNull().default("legacy"),
    grounding_status: text("grounding_status").notNull().default("unknown"),
    provenance_status: text("provenance_status").notNull().default("missing"),
    summary: text("summary"),
    aliases: text("aliases")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    properties: jsonb("properties").notNull().default({}),
    diagnostics: jsonb("diagnostics").notNull().default({}),
    relationship_count: integer("relationship_count").notNull().default(0),
    evidence_count: integer("evidence_count").notNull().default(0),
    last_seen_at: timestamp("last_seen_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_kg_entities_run_graph_node").on(
      table.ingest_run_id,
      table.graph_node_id,
    ),
    index("idx_kg_entities_tenant_thread_label").on(
      table.tenant_id,
      table.thread_id,
      table.normalized_label,
    ),
    index("idx_kg_entities_tenant_source_label").on(
      table.tenant_id,
      table.source_kind,
      table.source_ref,
      table.normalized_label,
    ),
    index("idx_kg_entities_tenant_thread_type").on(
      table.tenant_id,
      table.thread_id,
      table.ontology_type_slug,
    ),
    index("idx_kg_entities_tenant_thread_trust").on(
      table.tenant_id,
      table.thread_id,
      table.grounding_status,
      table.provenance_status,
    ),
    index("idx_kg_entities_label_trgm").using(
      "gin",
      sql`${table.normalized_label} gin_trgm_ops`,
    ),
    check(
      "entities_grounding_allowed",
      sql`${table.grounding_status} IN ('grounded','unapproved_type','ungrounded','conflict','unknown')`,
    ),
    check(
      "entities_provenance_allowed",
      sql`${table.provenance_status} IN ('strong','weak','missing')`,
    ),
    check(
      "entities_source_kind_allowed",
      sql`${table.source_kind} IN ('thread','wiki','brain','observations')`,
    ),
    index("idx_kg_entities_tenant_canonical")
      .on(table.tenant_id, table.canonical_entity_id)
      .where(sql`${table.canonical_entity_id} IS NOT NULL`),
    check(
      "entities_resolution_state_allowed",
      sql`${table.resolution_state} IN ('resolved','deferred','private','legacy')`,
    ),
  ],
);

export const kgRelationships = kg.table(
  "relationships",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    thread_id: uuid("thread_id").references(() => threads.id, {
      onDelete: "cascade",
    }),
    source_kind: text("source_kind").notNull().default("thread"),
    source_ref: text("source_ref").notNull(),
    ingest_run_id: uuid("ingest_run_id")
      .references(() => kgIngestRuns.id, { onDelete: "cascade" })
      .notNull(),
    graph_edge_id: text("graph_edge_id"),
    source_entity_id: uuid("source_entity_id")
      .references((): AnyPgColumn => kgEntities.id, {
        onDelete: "cascade",
      })
      .notNull(),
    target_entity_id: uuid("target_entity_id")
      .references((): AnyPgColumn => kgEntities.id, {
        onDelete: "cascade",
      })
      .notNull(),
    label: text("label").notNull(),
    ontology_relationship_type_id: uuid(
      "ontology_relationship_type_id",
    ).references(() => ontologyRelationshipTypes.id, { onDelete: "set null" }),
    ontology_type_slug: text("ontology_type_slug"),
    grounding_status: text("grounding_status").notNull().default("unknown"),
    provenance_status: text("provenance_status").notNull().default("missing"),
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
    properties: jsonb("properties").notNull().default({}),
    diagnostics: jsonb("diagnostics").notNull().default({}),
    evidence_count: integer("evidence_count").notNull().default(0),
    last_seen_at: timestamp("last_seen_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_kg_relationships_run_graph_edge")
      .on(table.ingest_run_id, table.graph_edge_id)
      .where(sql`${table.graph_edge_id} IS NOT NULL`),
    index("idx_kg_relationships_tenant_thread_source").on(
      table.tenant_id,
      table.thread_id,
      table.source_entity_id,
    ),
    index("idx_kg_relationships_tenant_thread_target").on(
      table.tenant_id,
      table.thread_id,
      table.target_entity_id,
    ),
    index("idx_kg_relationships_tenant_thread_type").on(
      table.tenant_id,
      table.thread_id,
      table.ontology_type_slug,
    ),
    index("idx_kg_relationships_tenant_source_type").on(
      table.tenant_id,
      table.source_kind,
      table.source_ref,
      table.ontology_type_slug,
    ),
    index("idx_kg_relationships_tenant_thread_trust").on(
      table.tenant_id,
      table.thread_id,
      table.grounding_status,
      table.provenance_status,
    ),
    check(
      "relationships_grounding_allowed",
      sql`${table.grounding_status} IN ('grounded','unapproved_type','ungrounded','conflict','unknown')`,
    ),
    check(
      "relationships_provenance_allowed",
      sql`${table.provenance_status} IN ('strong','weak','missing')`,
    ),
    check(
      "relationships_source_kind_allowed",
      sql`${table.source_kind} IN ('thread','wiki','brain','observations')`,
    ),
  ],
);

export const kgEvidence = kg.table(
  "evidence",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    thread_id: uuid("thread_id").references(() => threads.id, {
      onDelete: "cascade",
    }),
    source_kind: text("source_kind").notNull().default("thread"),
    source_ref: text("source_ref").notNull(),
    ingest_run_id: uuid("ingest_run_id")
      .references(() => kgIngestRuns.id, { onDelete: "cascade" })
      .notNull(),
    entity_id: uuid("entity_id").references((): AnyPgColumn => kgEntities.id, {
      onDelete: "cascade",
    }),
    relationship_id: uuid("relationship_id").references(
      (): AnyPgColumn => kgRelationships.id,
      { onDelete: "cascade" },
    ),
    message_id: uuid("message_id").references(() => messages.id, {
      onDelete: "set null",
    }),
    message_role: text("message_role"),
    message_created_at: timestamp("message_created_at", {
      withTimezone: true,
    }),
    speaker_label: text("speaker_label"),
    snippet: text("snippet").notNull(),
    char_start: integer("char_start"),
    char_end: integer("char_end"),
    evidence_source_kind: text("evidence_source_kind")
      .notNull()
      .default("thread_message"),
    evidence_source_ref: text("evidence_source_ref"),
    metadata: jsonb("metadata").notNull().default({}),
    observed_at: timestamp("observed_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_kg_evidence_tenant_thread_message").on(
      table.tenant_id,
      table.thread_id,
      table.message_id,
    ),
    index("idx_kg_evidence_tenant_source").on(
      table.tenant_id,
      table.source_kind,
      table.source_ref,
    ),
    index("idx_kg_evidence_entity").on(table.entity_id),
    index("idx_kg_evidence_relationship").on(table.relationship_id),
    check(
      "evidence_source_kind_allowed",
      sql`${table.source_kind} IN ('thread','wiki','brain','observations')`,
    ),
    check(
      "evidence_evidence_source_kind_allowed",
      sql`${table.evidence_source_kind} IN ('thread_message','wiki_page','wiki_section','brain_page','brain_section','hindsight_observation','graph_payload','normalizer')`,
    ),
    check(
      "evidence_subject_required",
      sql`${table.entity_id} IS NOT NULL OR ${table.relationship_id} IS NOT NULL`,
    ),
  ],
);

export const kgIngestRunsRelations = relations(
  kgIngestRuns,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [kgIngestRuns.tenant_id],
      references: [tenants.id],
    }),
    thread: one(threads, {
      fields: [kgIngestRuns.thread_id],
      references: [threads.id],
    }),
    requestedBy: one(users, {
      fields: [kgIngestRuns.requested_by_user_id],
      references: [users.id],
    }),
    entities: many(kgEntities),
    relationships: many(kgRelationships),
    evidence: many(kgEvidence),
  }),
);

export const kgEntitiesRelations = relations(kgEntities, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [kgEntities.tenant_id],
    references: [tenants.id],
  }),
  thread: one(threads, {
    fields: [kgEntities.thread_id],
    references: [threads.id],
  }),
  ingestRun: one(kgIngestRuns, {
    fields: [kgEntities.ingest_run_id],
    references: [kgIngestRuns.id],
  }),
  ontologyEntityType: one(ontologyEntityTypes, {
    fields: [kgEntities.ontology_entity_type_id],
    references: [ontologyEntityTypes.id],
  }),
  sourceRelationships: many(kgRelationships, {
    relationName: "kgSourceEntity",
  }),
  targetRelationships: many(kgRelationships, {
    relationName: "kgTargetEntity",
  }),
  evidence: many(kgEvidence),
}));

export const kgRelationshipsRelations = relations(
  kgRelationships,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [kgRelationships.tenant_id],
      references: [tenants.id],
    }),
    thread: one(threads, {
      fields: [kgRelationships.thread_id],
      references: [threads.id],
    }),
    ingestRun: one(kgIngestRuns, {
      fields: [kgRelationships.ingest_run_id],
      references: [kgIngestRuns.id],
    }),
    sourceEntity: one(kgEntities, {
      fields: [kgRelationships.source_entity_id],
      references: [kgEntities.id],
      relationName: "kgSourceEntity",
    }),
    targetEntity: one(kgEntities, {
      fields: [kgRelationships.target_entity_id],
      references: [kgEntities.id],
      relationName: "kgTargetEntity",
    }),
    ontologyRelationshipType: one(ontologyRelationshipTypes, {
      fields: [kgRelationships.ontology_relationship_type_id],
      references: [ontologyRelationshipTypes.id],
    }),
    evidence: many(kgEvidence),
  }),
);

export const kgEvidenceRelations = relations(kgEvidence, ({ one }) => ({
  tenant: one(tenants, {
    fields: [kgEvidence.tenant_id],
    references: [tenants.id],
  }),
  thread: one(threads, {
    fields: [kgEvidence.thread_id],
    references: [threads.id],
  }),
  ingestRun: one(kgIngestRuns, {
    fields: [kgEvidence.ingest_run_id],
    references: [kgIngestRuns.id],
  }),
  entity: one(kgEntities, {
    fields: [kgEvidence.entity_id],
    references: [kgEntities.id],
  }),
  relationship: one(kgRelationships, {
    fields: [kgEvidence.relationship_id],
    references: [kgRelationships.id],
  }),
  message: one(messages, {
    fields: [kgEvidence.message_id],
    references: [messages.id],
  }),
}));

/**
 * Per-(tenant, bank) incremental cursors for the observations ingest source.
 *
 * Tenant fan-in reads each user bank's engine-synthesized observations via
 * the Hindsight adapter's cursor read; the `(last_record_updated_at,
 * last_record_id)` pair mirrors the wiki compile-cursor tiebreaker so
 * same-timestamp rows are never missed or double-read. Cursors advance only
 * inside the same transaction that replaces the mirror snapshot and marks the
 * run succeeded (crash between extraction and snapshot leaves cursors put,
 * and the idempotent per-observation dataset identity absorbs the re-read).
 */
export const kgObservationCursors = kg.table(
  "observation_cursors",
  {
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    bank_id: text("bank_id").notNull(),
    last_record_updated_at: timestamp("last_record_updated_at", {
      withTimezone: true,
    }),
    last_record_id: text("last_record_id"),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_kg_observation_cursors_tenant_bank").on(
      table.tenant_id,
      table.bank_id,
    ),
    index("idx_kg_observation_cursors_tenant").on(table.tenant_id),
  ],
);
