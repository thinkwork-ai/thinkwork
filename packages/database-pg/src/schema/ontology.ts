/**
 * Business ontology domain tables.
 *
 * Tenant-scoped ontology definitions give the Company Brain an explicit
 * contract for which business entity and relationship types exist, how their
 * wiki/brain facets should be compiled, and which external vocabularies they
 * loosely map to. The change-set tables capture suggested ontology evolution
 * before operators approve a new version and enqueue derived Brain reprocessing.
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
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants, users } from "./core";

export const ontology = pgSchema("ontology");

export const ONTOLOGY_LIFECYCLE_STATUSES = [
  "proposed",
  "approved",
  "deprecated",
  "rejected",
] as const;
export type OntologyLifecycleStatus =
  (typeof ONTOLOGY_LIFECYCLE_STATUSES)[number];

export const ONTOLOGY_MAPPING_KINDS = [
  "exact",
  "close",
  "broad",
  "narrow",
  "related",
] as const;
export type OntologyMappingKind = (typeof ONTOLOGY_MAPPING_KINDS)[number];

export const ONTOLOGY_CHANGE_SET_STATUSES = [
  "draft",
  "pending_review",
  "approved",
  "rejected",
  "applied",
] as const;
export type OntologyChangeSetStatus =
  (typeof ONTOLOGY_CHANGE_SET_STATUSES)[number];

export const ONTOLOGY_CHANGE_ITEM_TYPES = [
  "entity_type",
  "relationship_type",
  "facet_template",
  "external_mapping",
] as const;
export type OntologyChangeItemType =
  (typeof ONTOLOGY_CHANGE_ITEM_TYPES)[number];

export const ONTOLOGY_CHANGE_ACTIONS = [
  "create",
  "update",
  "deprecate",
  "reject",
] as const;
export type OntologyChangeAction = (typeof ONTOLOGY_CHANGE_ACTIONS)[number];

export const ONTOLOGY_JOB_STATUSES = [
  "pending",
  "running",
  "succeeded",
  "failed",
  "canceled",
] as const;
export type OntologyJobStatus = (typeof ONTOLOGY_JOB_STATUSES)[number];

export const ontologyVersions = ontology.table(
  "versions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    version_number: integer("version_number").notNull(),
    status: text("status").notNull().default("active"),
    source_change_set_id: uuid("source_change_set_id"),
    activated_at: timestamp("activated_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_ontology_versions_tenant_version").on(
      table.tenant_id,
      table.version_number,
    ),
    uniqueIndex("uq_ontology_versions_tenant_active")
      .on(table.tenant_id)
      .where(sql`${table.status} = 'active'`),
    index("idx_ontology_versions_tenant_created").on(
      table.tenant_id,
      table.created_at,
    ),
    check(
      "ontology_versions_status_allowed",
      sql`${table.status} IN ('active','superseded')`,
    ),
  ],
);

export const ontologyEntityTypes = ontology.table(
  "entity_types",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    version_id: uuid("version_id").references(() => ontologyVersions.id, {
      onDelete: "set null",
    }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    broad_type: text("broad_type").notNull().default("entity"),
    aliases: text("aliases")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    properties_schema: jsonb("properties_schema").notNull().default({}),
    guidance_notes: text("guidance_notes"),
    lifecycle_status: text("lifecycle_status").notNull().default("proposed"),
    proposed_by_user_id: uuid("proposed_by_user_id").references(
      () => users.id,
      {
        onDelete: "set null",
      },
    ),
    approved_by_user_id: uuid("approved_by_user_id").references(
      () => users.id,
      {
        onDelete: "set null",
      },
    ),
    approved_at: timestamp("approved_at", { withTimezone: true }),
    deprecated_at: timestamp("deprecated_at", { withTimezone: true }),
    rejected_at: timestamp("rejected_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_ontology_entity_types_tenant_slug").on(
      table.tenant_id,
      table.slug,
    ),
    index("idx_ontology_entity_types_tenant_status").on(
      table.tenant_id,
      table.lifecycle_status,
    ),
    index("idx_ontology_entity_types_broad_type").on(table.broad_type),
    check(
      "ontology_entity_types_lifecycle_allowed",
      sql`${table.lifecycle_status} IN ('proposed','approved','deprecated','rejected')`,
    ),
  ],
);

export const ontologyRelationshipTypes = ontology.table(
  "relationship_types",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    version_id: uuid("version_id").references(() => ontologyVersions.id, {
      onDelete: "set null",
    }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    inverse_name: text("inverse_name"),
    source_entity_type_id: uuid("source_entity_type_id").references(
      () => ontologyEntityTypes.id,
      { onDelete: "set null" },
    ),
    target_entity_type_id: uuid("target_entity_type_id").references(
      () => ontologyEntityTypes.id,
      { onDelete: "set null" },
    ),
    source_type_slugs: text("source_type_slugs")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    target_type_slugs: text("target_type_slugs")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    aliases: text("aliases")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    guidance_notes: text("guidance_notes"),
    lifecycle_status: text("lifecycle_status").notNull().default("proposed"),
    proposed_by_user_id: uuid("proposed_by_user_id").references(
      () => users.id,
      {
        onDelete: "set null",
      },
    ),
    approved_by_user_id: uuid("approved_by_user_id").references(
      () => users.id,
      {
        onDelete: "set null",
      },
    ),
    approved_at: timestamp("approved_at", { withTimezone: true }),
    deprecated_at: timestamp("deprecated_at", { withTimezone: true }),
    rejected_at: timestamp("rejected_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_ontology_relationship_types_tenant_slug").on(
      table.tenant_id,
      table.slug,
    ),
    index("idx_ontology_relationship_types_tenant_status").on(
      table.tenant_id,
      table.lifecycle_status,
    ),
    index("idx_ontology_relationship_types_source").on(
      table.source_entity_type_id,
    ),
    index("idx_ontology_relationship_types_target").on(
      table.target_entity_type_id,
    ),
    check(
      "ontology_relationship_types_lifecycle_allowed",
      sql`${table.lifecycle_status} IN ('proposed','approved','deprecated','rejected')`,
    ),
  ],
);

export const ontologyFacetTemplates = ontology.table(
  "facet_templates",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    entity_type_id: uuid("entity_type_id")
      .references(() => ontologyEntityTypes.id, { onDelete: "cascade" })
      .notNull(),
    slug: text("slug").notNull(),
    heading: text("heading").notNull(),
    facet_type: text("facet_type").notNull().default("compiled"),
    position: integer("position").notNull().default(0),
    source_priority: jsonb("source_priority").notNull().default([]),
    prompt: text("prompt"),
    guidance_notes: text("guidance_notes"),
    lifecycle_status: text("lifecycle_status").notNull().default("approved"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_ontology_facet_templates_entity_slug").on(
      table.entity_type_id,
      table.slug,
    ),
    index("idx_ontology_facet_templates_tenant").on(table.tenant_id),
    check(
      "ontology_facet_templates_lifecycle_allowed",
      sql`${table.lifecycle_status} IN ('proposed','approved','deprecated','rejected')`,
    ),
  ],
);

export const ontologyExternalMappings = ontology.table(
  "external_mappings",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    subject_kind: text("subject_kind").notNull(),
    subject_id: uuid("subject_id").notNull(),
    mapping_kind: text("mapping_kind").notNull(),
    vocabulary: text("vocabulary").notNull(),
    external_uri: text("external_uri").notNull(),
    external_label: text("external_label"),
    notes: text("notes"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_ontology_external_mappings_subject_uri").on(
      table.subject_kind,
      table.subject_id,
      table.vocabulary,
      table.external_uri,
    ),
    index("idx_ontology_external_mappings_tenant_kind").on(
      table.tenant_id,
      table.subject_kind,
    ),
    check(
      "ontology_external_mappings_subject_allowed",
      sql`${table.subject_kind} IN ('entity_type','relationship_type','facet_template')`,
    ),
    check(
      "ontology_external_mappings_kind_allowed",
      sql`${table.mapping_kind} IN ('exact','close','broad','narrow','related')`,
    ),
  ],
);

export const ontologyChangeSets = ontology.table(
  "change_sets",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    status: text("status").notNull().default("draft"),
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
    observed_frequency: integer("observed_frequency").notNull().default(0),
    expected_impact: jsonb("expected_impact").notNull().default({}),
    proposed_by: text("proposed_by").notNull().default("suggestion_engine"),
    proposed_by_user_id: uuid("proposed_by_user_id").references(
      () => users.id,
      {
        onDelete: "set null",
      },
    ),
    approved_by_user_id: uuid("approved_by_user_id").references(
      () => users.id,
      {
        onDelete: "set null",
      },
    ),
    approved_at: timestamp("approved_at", { withTimezone: true }),
    rejected_by_user_id: uuid("rejected_by_user_id").references(
      () => users.id,
      {
        onDelete: "set null",
      },
    ),
    rejected_at: timestamp("rejected_at", { withTimezone: true }),
    applied_version_id: uuid("applied_version_id").references(
      () => ontologyVersions.id,
      { onDelete: "set null" },
    ),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_ontology_change_sets_tenant_status").on(
      table.tenant_id,
      table.status,
    ),
    index("idx_ontology_change_sets_applied_version").on(
      table.applied_version_id,
    ),
    check(
      "ontology_change_sets_status_allowed",
      sql`${table.status} IN ('draft','pending_review','approved','rejected','applied')`,
    ),
  ],
);

export const ontologyChangeSetItems = ontology.table(
  "change_set_items",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    change_set_id: uuid("change_set_id")
      .references(() => ontologyChangeSets.id, { onDelete: "cascade" })
      .notNull(),
    item_type: text("item_type").notNull(),
    action: text("action").notNull(),
    status: text("status").notNull().default("pending_review"),
    target_kind: text("target_kind"),
    target_slug: text("target_slug"),
    title: text("title").notNull(),
    description: text("description"),
    proposed_value: jsonb("proposed_value").notNull().default({}),
    edited_value: jsonb("edited_value"),
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
    position: integer("position").notNull().default(0),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_ontology_change_set_items_change_set").on(table.change_set_id),
    index("idx_ontology_change_set_items_tenant_status").on(
      table.tenant_id,
      table.status,
    ),
    check(
      "ontology_change_set_items_type_allowed",
      sql`${table.item_type} IN ('entity_type','relationship_type','facet_template','external_mapping')`,
    ),
    check(
      "ontology_change_set_items_action_allowed",
      sql`${table.action} IN ('create','update','deprecate','reject')`,
    ),
    check(
      "ontology_change_set_items_status_allowed",
      sql`${table.status} IN ('pending_review','approved','rejected','applied')`,
    ),
  ],
);

export const ontologyEvidenceExamples = ontology.table(
  "evidence_examples",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    change_set_id: uuid("change_set_id")
      .references(() => ontologyChangeSets.id, { onDelete: "cascade" })
      .notNull(),
    item_id: uuid("item_id").references(() => ontologyChangeSetItems.id, {
      onDelete: "set null",
    }),
    source_kind: text("source_kind").notNull(),
    source_ref: text("source_ref"),
    source_label: text("source_label"),
    quote: text("quote").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    observed_at: timestamp("observed_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_ontology_evidence_change_set").on(table.change_set_id),
    index("idx_ontology_evidence_item").on(table.item_id),
    index("idx_ontology_evidence_tenant_source").on(
      table.tenant_id,
      table.source_kind,
    ),
  ],
);

export const ontologySuggestionScanJobs = ontology.table(
  "suggestion_scan_jobs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    status: text("status").notNull().default("pending"),
    trigger: text("trigger").notNull().default("manual"),
    dedupe_key: text("dedupe_key"),
    started_at: timestamp("started_at", { withTimezone: true }),
    finished_at: timestamp("finished_at", { withTimezone: true }),
    error: text("error"),
    result: jsonb("result").notNull().default({}),
    metrics: jsonb("metrics").notNull().default({}),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_ontology_suggestion_scan_jobs_dedupe")
      .on(table.tenant_id, table.dedupe_key)
      .where(sql`${table.dedupe_key} IS NOT NULL`),
    index("idx_ontology_suggestion_scan_jobs_tenant_status").on(
      table.tenant_id,
      table.status,
    ),
    check(
      "ontology_suggestion_scan_jobs_status_allowed",
      sql`${table.status} IN ('pending','running','succeeded','failed','canceled')`,
    ),
  ],
);

export const ontologyReprocessJobs = ontology.table(
  "reprocess_jobs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    change_set_id: uuid("change_set_id").references(
      () => ontologyChangeSets.id,
      { onDelete: "set null" },
    ),
    ontology_version_id: uuid("ontology_version_id").references(
      () => ontologyVersions.id,
      { onDelete: "set null" },
    ),
    dedupe_key: text("dedupe_key"),
    status: text("status").notNull().default("pending"),
    attempt: integer("attempt").notNull().default(0),
    claimed_at: timestamp("claimed_at", { withTimezone: true }),
    started_at: timestamp("started_at", { withTimezone: true }),
    finished_at: timestamp("finished_at", { withTimezone: true }),
    input: jsonb("input").notNull().default({}),
    impact: jsonb("impact").notNull().default({}),
    metrics: jsonb("metrics").notNull().default({}),
    error: text("error"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_ontology_reprocess_jobs_dedupe")
      .on(table.tenant_id, table.dedupe_key)
      .where(sql`${table.dedupe_key} IS NOT NULL`),
    index("idx_ontology_reprocess_jobs_tenant_status").on(
      table.tenant_id,
      table.status,
    ),
    index("idx_ontology_reprocess_jobs_change_set").on(table.change_set_id),
    check(
      "ontology_reprocess_jobs_status_allowed",
      sql`${table.status} IN ('pending','running','succeeded','failed','canceled')`,
    ),
  ],
);

export const ontologyVersionsRelations = relations(
  ontologyVersions,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [ontologyVersions.tenant_id],
      references: [tenants.id],
    }),
    entityTypes: many(ontologyEntityTypes),
    relationshipTypes: many(ontologyRelationshipTypes),
  }),
);

export const ontologyEntityTypesRelations = relations(
  ontologyEntityTypes,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [ontologyEntityTypes.tenant_id],
      references: [tenants.id],
    }),
    version: one(ontologyVersions, {
      fields: [ontologyEntityTypes.version_id],
      references: [ontologyVersions.id],
    }),
    facetTemplates: many(ontologyFacetTemplates),
  }),
);

export const ontologyRelationshipTypesRelations = relations(
  ontologyRelationshipTypes,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [ontologyRelationshipTypes.tenant_id],
      references: [tenants.id],
    }),
    version: one(ontologyVersions, {
      fields: [ontologyRelationshipTypes.version_id],
      references: [ontologyVersions.id],
    }),
    sourceEntityType: one(ontologyEntityTypes, {
      fields: [ontologyRelationshipTypes.source_entity_type_id],
      references: [ontologyEntityTypes.id],
      relationName: "relationshipSourceEntityType",
    }),
    targetEntityType: one(ontologyEntityTypes, {
      fields: [ontologyRelationshipTypes.target_entity_type_id],
      references: [ontologyEntityTypes.id],
      relationName: "relationshipTargetEntityType",
    }),
  }),
);

export const ontologyFacetTemplatesRelations = relations(
  ontologyFacetTemplates,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [ontologyFacetTemplates.tenant_id],
      references: [tenants.id],
    }),
    entityType: one(ontologyEntityTypes, {
      fields: [ontologyFacetTemplates.entity_type_id],
      references: [ontologyEntityTypes.id],
    }),
  }),
);

export const ontologyChangeSetsRelations = relations(
  ontologyChangeSets,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [ontologyChangeSets.tenant_id],
      references: [tenants.id],
    }),
    appliedVersion: one(ontologyVersions, {
      fields: [ontologyChangeSets.applied_version_id],
      references: [ontologyVersions.id],
    }),
    items: many(ontologyChangeSetItems),
    evidenceExamples: many(ontologyEvidenceExamples),
  }),
);

export const ontologyChangeSetItemsRelations = relations(
  ontologyChangeSetItems,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [ontologyChangeSetItems.tenant_id],
      references: [tenants.id],
    }),
    changeSet: one(ontologyChangeSets, {
      fields: [ontologyChangeSetItems.change_set_id],
      references: [ontologyChangeSets.id],
    }),
    evidenceExamples: many(ontologyEvidenceExamples),
  }),
);

export const ontologyEvidenceExamplesRelations = relations(
  ontologyEvidenceExamples,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [ontologyEvidenceExamples.tenant_id],
      references: [tenants.id],
    }),
    changeSet: one(ontologyChangeSets, {
      fields: [ontologyEvidenceExamples.change_set_id],
      references: [ontologyChangeSets.id],
    }),
    item: one(ontologyChangeSetItems, {
      fields: [ontologyEvidenceExamples.item_id],
      references: [ontologyChangeSetItems.id],
    }),
  }),
);
