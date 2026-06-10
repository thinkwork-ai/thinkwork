/**
 * Cognee-derived Knowledge Graph tables.
 *
 * Phase II keeps Cognee out of runtime retrieval and stores a normalized,
 * tenant-scoped graph snapshot in Aurora. Rows are scoped by source kind/ref
 * so thread transcripts, wiki pages, and Company Brain pages can share the
 * same ontology-gated normalization pipeline.
 */

import {
  pgTable,
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
  "cognee_payload",
  "normalizer",
] as const;
export type KnowledgeGraphEvidenceSourceKind =
  (typeof KNOWLEDGE_GRAPH_EVIDENCE_SOURCE_KINDS)[number];

export const knowledgeGraphIngestRuns = pgTable(
  "knowledge_graph_ingest_runs",
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
    cognee_dataset_name: text("cognee_dataset_name").notNull(),
    cognee_dataset_id: text("cognee_dataset_id"),
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
      "knowledge_graph_ingest_runs_status_allowed",
      sql`${table.status} IN ('queued','running','succeeded','failed','canceled','stale_noop')`,
    ),
    check(
      "knowledge_graph_ingest_runs_trigger_allowed",
      sql`${table.trigger} IN ('manual','scheduled')`,
    ),
    check(
      "knowledge_graph_ingest_runs_source_kind_allowed",
      sql`${table.source_kind} IN ('thread','wiki','brain','observations')`,
    ),
    check(
      "knowledge_graph_ingest_runs_thread_scope_required",
      sql`${table.source_kind} != 'thread' OR ${table.thread_id} IS NOT NULL`,
    ),
  ],
);

export const knowledgeGraphEntities = pgTable(
  "knowledge_graph_entities",
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
      .references(() => knowledgeGraphIngestRuns.id, { onDelete: "cascade" })
      .notNull(),
    cognee_node_id: text("cognee_node_id").notNull(),
    label: text("label").notNull(),
    normalized_label: text("normalized_label").notNull(),
    type_label: text("type_label"),
    ontology_entity_type_id: uuid("ontology_entity_type_id").references(
      () => ontologyEntityTypes.id,
      { onDelete: "set null" },
    ),
    ontology_type_slug: text("ontology_type_slug"),
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
    uniqueIndex("uq_kg_entities_run_cognee_node").on(
      table.ingest_run_id,
      table.cognee_node_id,
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
      "knowledge_graph_entities_grounding_allowed",
      sql`${table.grounding_status} IN ('grounded','unapproved_type','ungrounded','conflict','unknown')`,
    ),
    check(
      "knowledge_graph_entities_provenance_allowed",
      sql`${table.provenance_status} IN ('strong','weak','missing')`,
    ),
    check(
      "knowledge_graph_entities_source_kind_allowed",
      sql`${table.source_kind} IN ('thread','wiki','brain','observations')`,
    ),
  ],
);

export const knowledgeGraphRelationships = pgTable(
  "knowledge_graph_relationships",
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
      .references(() => knowledgeGraphIngestRuns.id, { onDelete: "cascade" })
      .notNull(),
    cognee_edge_id: text("cognee_edge_id"),
    source_entity_id: uuid("source_entity_id")
      .references((): AnyPgColumn => knowledgeGraphEntities.id, {
        onDelete: "cascade",
      })
      .notNull(),
    target_entity_id: uuid("target_entity_id")
      .references((): AnyPgColumn => knowledgeGraphEntities.id, {
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
    uniqueIndex("uq_kg_relationships_run_cognee_edge")
      .on(table.ingest_run_id, table.cognee_edge_id)
      .where(sql`${table.cognee_edge_id} IS NOT NULL`),
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
      "knowledge_graph_relationships_grounding_allowed",
      sql`${table.grounding_status} IN ('grounded','unapproved_type','ungrounded','conflict','unknown')`,
    ),
    check(
      "knowledge_graph_relationships_provenance_allowed",
      sql`${table.provenance_status} IN ('strong','weak','missing')`,
    ),
    check(
      "knowledge_graph_relationships_source_kind_allowed",
      sql`${table.source_kind} IN ('thread','wiki','brain','observations')`,
    ),
  ],
);

export const knowledgeGraphEvidence = pgTable(
  "knowledge_graph_evidence",
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
      .references(() => knowledgeGraphIngestRuns.id, { onDelete: "cascade" })
      .notNull(),
    entity_id: uuid("entity_id").references(
      (): AnyPgColumn => knowledgeGraphEntities.id,
      { onDelete: "cascade" },
    ),
    relationship_id: uuid("relationship_id").references(
      (): AnyPgColumn => knowledgeGraphRelationships.id,
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
      "knowledge_graph_evidence_source_kind_allowed",
      sql`${table.source_kind} IN ('thread','wiki','brain','observations')`,
    ),
    check(
      "knowledge_graph_evidence_evidence_source_kind_allowed",
      sql`${table.evidence_source_kind} IN ('thread_message','wiki_page','wiki_section','brain_page','brain_section','hindsight_observation','cognee_payload','normalizer')`,
    ),
    check(
      "knowledge_graph_evidence_subject_required",
      sql`${table.entity_id} IS NOT NULL OR ${table.relationship_id} IS NOT NULL`,
    ),
  ],
);

export const knowledgeGraphIngestRunsRelations = relations(
  knowledgeGraphIngestRuns,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [knowledgeGraphIngestRuns.tenant_id],
      references: [tenants.id],
    }),
    thread: one(threads, {
      fields: [knowledgeGraphIngestRuns.thread_id],
      references: [threads.id],
    }),
    requestedBy: one(users, {
      fields: [knowledgeGraphIngestRuns.requested_by_user_id],
      references: [users.id],
    }),
    entities: many(knowledgeGraphEntities),
    relationships: many(knowledgeGraphRelationships),
    evidence: many(knowledgeGraphEvidence),
  }),
);

export const knowledgeGraphEntitiesRelations = relations(
  knowledgeGraphEntities,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [knowledgeGraphEntities.tenant_id],
      references: [tenants.id],
    }),
    thread: one(threads, {
      fields: [knowledgeGraphEntities.thread_id],
      references: [threads.id],
    }),
    ingestRun: one(knowledgeGraphIngestRuns, {
      fields: [knowledgeGraphEntities.ingest_run_id],
      references: [knowledgeGraphIngestRuns.id],
    }),
    ontologyEntityType: one(ontologyEntityTypes, {
      fields: [knowledgeGraphEntities.ontology_entity_type_id],
      references: [ontologyEntityTypes.id],
    }),
    sourceRelationships: many(knowledgeGraphRelationships, {
      relationName: "kgSourceEntity",
    }),
    targetRelationships: many(knowledgeGraphRelationships, {
      relationName: "kgTargetEntity",
    }),
    evidence: many(knowledgeGraphEvidence),
  }),
);

export const knowledgeGraphRelationshipsRelations = relations(
  knowledgeGraphRelationships,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [knowledgeGraphRelationships.tenant_id],
      references: [tenants.id],
    }),
    thread: one(threads, {
      fields: [knowledgeGraphRelationships.thread_id],
      references: [threads.id],
    }),
    ingestRun: one(knowledgeGraphIngestRuns, {
      fields: [knowledgeGraphRelationships.ingest_run_id],
      references: [knowledgeGraphIngestRuns.id],
    }),
    sourceEntity: one(knowledgeGraphEntities, {
      fields: [knowledgeGraphRelationships.source_entity_id],
      references: [knowledgeGraphEntities.id],
      relationName: "kgSourceEntity",
    }),
    targetEntity: one(knowledgeGraphEntities, {
      fields: [knowledgeGraphRelationships.target_entity_id],
      references: [knowledgeGraphEntities.id],
      relationName: "kgTargetEntity",
    }),
    ontologyRelationshipType: one(ontologyRelationshipTypes, {
      fields: [knowledgeGraphRelationships.ontology_relationship_type_id],
      references: [ontologyRelationshipTypes.id],
    }),
    evidence: many(knowledgeGraphEvidence),
  }),
);

export const knowledgeGraphEvidenceRelations = relations(
  knowledgeGraphEvidence,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [knowledgeGraphEvidence.tenant_id],
      references: [tenants.id],
    }),
    thread: one(threads, {
      fields: [knowledgeGraphEvidence.thread_id],
      references: [threads.id],
    }),
    ingestRun: one(knowledgeGraphIngestRuns, {
      fields: [knowledgeGraphEvidence.ingest_run_id],
      references: [knowledgeGraphIngestRuns.id],
    }),
    entity: one(knowledgeGraphEntities, {
      fields: [knowledgeGraphEvidence.entity_id],
      references: [knowledgeGraphEntities.id],
    }),
    relationship: one(knowledgeGraphRelationships, {
      fields: [knowledgeGraphEvidence.relationship_id],
      references: [knowledgeGraphRelationships.id],
    }),
    message: one(messages, {
      fields: [knowledgeGraphEvidence.message_id],
      references: [messages.id],
    }),
  }),
);

/**
 * Per-(tenant, bank) incremental cursors for the observations ingest source.
 *
 * Tenant fan-in reads each user bank's engine-synthesized observations via
 * the Hindsight adapter's cursor read; the `(last_record_updated_at,
 * last_record_id)` pair mirrors the wiki compile-cursor tiebreaker so
 * same-timestamp rows are never missed or double-read. Cursors advance only
 * inside the same transaction that replaces the mirror snapshot and marks the
 * run succeeded (crash between Cognee write and snapshot leaves cursors put,
 * and the idempotent per-observation dataset identity absorbs the re-read).
 */
export const knowledgeGraphObservationCursors = pgTable(
  "knowledge_graph_observation_cursors",
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
