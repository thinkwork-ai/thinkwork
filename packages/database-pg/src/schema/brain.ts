/**
 * Brain (entity-pages) domain tables.
 *
 * Tenant-shared structured-knowledge pages for first-class business entities
 * (Customer / Opportunity / Order / Person). Structurally parallels the
 * owner-scoped wiki tables — pages, sections, links, aliases, section sources —
 * but the scoping is tenant-wide rather than per-user, and the data lifecycle
 * is enrichment-driven (LLM extraction + operator review) rather than
 * memory-compile-driven.
 *
 * Lives in the `brain.*` Postgres schema (extracted from `public.*` in 2026-05
 * — see docs/solutions/database-issues/feature-schema-extraction-pattern.md
 * and packages/database-pg/drizzle/NNNN_brain_schema_extraction.sql). Wiki
 * shipped in PR 1 of the 3-PR arc; this is PR 2.
 *
 * TS export identifiers (`tenantEntityPages`, `tenantEntityPageSections`,
 * etc.) remain stable across the schema move so consumer imports don't
 * churn; only the in-DB names changed (e.g., `public.tenant_entity_pages` →
 * `brain.pages`). The mobile SDK's `brain.ts` public API name is also
 * unchanged — its internal GraphQL queries observe no wire-format shift.
 *
 * The `tenant_entity_external_refs` table (formerly its own file) is
 * consolidated here as `brain.external_refs` since it's part of the same
 * feature surface.
 */

import {
  pgSchema,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  customType,
  uniqueIndex,
  index,
  check,
  foreignKey,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants, users } from "./core";
import {
  managedApplicationDeploymentJobs,
  managedApplications,
} from "./deployments";
import { knowledgeGraphIngestRuns } from "./knowledge-graph";

// ---------------------------------------------------------------------------
// Schema handle
// ---------------------------------------------------------------------------

export const brain = pgSchema("brain");

// ---------------------------------------------------------------------------
// Custom tsvector column helper (mirror of wiki.ts)
// ---------------------------------------------------------------------------

const tsvector = (name: string) =>
  customType<{ data: string; driverData: string }>({
    dataType() {
      return "tsvector";
    },
  })(name);

// ---------------------------------------------------------------------------
// Enum-shaped value sets (unchanged from pre-move)
// ---------------------------------------------------------------------------

export const TENANT_ENTITY_SUBTYPES = [
  "customer",
  "opportunity",
  "order",
  "person",
] as const;

export type TenantEntitySubtype = (typeof TENANT_ENTITY_SUBTYPES)[number];

export const TENANT_ENTITY_FACET_TYPES = [
  "operational",
  "relationship",
  "activity",
  "compiled",
  "kb_sourced",
  "external",
] as const;

export type TenantEntityFacetType = (typeof TENANT_ENTITY_FACET_TYPES)[number];

export const BRAIN_STORAGE_TIERS = ["default", "production"] as const;

export type BrainStorageTier = (typeof BRAIN_STORAGE_TIERS)[number];

export const BRAIN_SUBSTRATE_STATUSES = [
  "not_installed",
  "provisioning",
  "ready",
  "degraded",
  "failed",
  "migrating",
  "disabled",
] as const;

export type BrainSubstrateStatus = (typeof BRAIN_SUBSTRATE_STATUSES)[number];

export const BRAIN_SUBSTRATE_HEALTH_STATUSES = [
  "unknown",
  "healthy",
  "degraded",
  "failed",
  "disabled",
] as const;

export type BrainSubstrateHealthStatus =
  (typeof BRAIN_SUBSTRATE_HEALTH_STATUSES)[number];

export const BRAIN_ACTIVE_BACKENDS = [
  "none",
  "default",
  "production",
  "legacy_cognee",
] as const;

export type BrainActiveBackend = (typeof BRAIN_ACTIVE_BACKENDS)[number];

export const BRAIN_MIGRATION_PHASES = [
  "none",
  "requested",
  "snapshotting",
  "provisioning",
  "replaying",
  "validating",
  "cutover",
  "completed",
  "failed",
  "rolled_back",
] as const;

export type BrainMigrationPhase = (typeof BRAIN_MIGRATION_PHASES)[number];

export const BRAIN_MIGRATION_STATUSES = [
  "none",
  "requested",
  "running",
  "completed",
  "failed",
  "rolled_back",
  "canceled",
] as const;

export type BrainMigrationStatus = (typeof BRAIN_MIGRATION_STATUSES)[number];

export const BRAIN_ARTIFACT_MANIFEST_KINDS = [
  "source_artifact",
  "ingestion_manifest",
  "migration_snapshot",
  "vault_projection",
  "export",
  "okf_bundle",
  "okf_current_manifest",
] as const;

export type BrainArtifactManifestKind =
  (typeof BRAIN_ARTIFACT_MANIFEST_KINDS)[number];

export const BRAIN_ARTIFACT_MANIFEST_STATUSES = [
  "active",
  "superseded",
  "deleted",
  "failed",
] as const;

export type BrainArtifactManifestStatus =
  (typeof BRAIN_ARTIFACT_MANIFEST_STATUSES)[number];

// ---------------------------------------------------------------------------
// brain.substrate_states — Company Brain storage/runtime posture
// ---------------------------------------------------------------------------

export const brainSubstrateStates = brain.table(
  "substrate_states",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    managed_application_id: uuid("managed_application_id"),
    latest_deployment_job_id: uuid("latest_deployment_job_id"),
    storage_tier: text("storage_tier").notNull().default("default"),
    active_backend: text("active_backend").notNull().default("none"),
    status: text("status").notNull().default("not_installed"),
    health_status: text("health_status").notNull().default("unknown"),
    backend_mode: text("backend_mode"),
    graph_provider: text("graph_provider"),
    vector_provider: text("vector_provider"),
    embedding_model: text("embedding_model"),
    vector_dimension: integer("vector_dimension"),
    cognee_version: text("cognee_version"),
    cognee_endpoint: text("cognee_endpoint"),
    s3_artifact_root: text("s3_artifact_root"),
    s3_manifest_root: text("s3_manifest_root"),
    s3_vault_projection_root: text("s3_vault_projection_root"),
    neptune_graph_id: text("neptune_graph_id"),
    neptune_endpoint: text("neptune_endpoint"),
    efs_file_system_id: text("efs_file_system_id"),
    production_posture: text("production_posture"),
    latest_ingest_at: timestamp("latest_ingest_at", { withTimezone: true }),
    latest_projection_at: timestamp("latest_projection_at", {
      withTimezone: true,
    }),
    ingestion_queue_depth: integer("ingestion_queue_depth")
      .notNull()
      .default(0),
    failed_ingest_count: integer("failed_ingest_count").notNull().default(0),
    graph_entity_count: integer("graph_entity_count"),
    graph_edge_count: integer("graph_edge_count"),
    source_artifact_count: integer("source_artifact_count"),
    vault_projection_count: integer("vault_projection_count"),
    ontology_version: text("ontology_version"),
    launch_capabilities: jsonb("launch_capabilities").notNull().default({}),
    optional_capabilities: jsonb("optional_capabilities").notNull().default({}),
    operator_evidence: jsonb("operator_evidence").notNull().default({}),
    last_failure_message: text("last_failure_message"),
    last_failure_at: timestamp("last_failure_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    foreignKey({
      name: "substrate_states_managed_application_id_fk",
      columns: [table.managed_application_id],
      foreignColumns: [managedApplications.id],
    }).onDelete("set null"),
    foreignKey({
      name: "substrate_states_latest_deployment_job_id_fk",
      columns: [table.latest_deployment_job_id],
      foreignColumns: [managedApplicationDeploymentJobs.id],
    }).onDelete("set null"),
    uniqueIndex("brain_substrate_states_tenant_uidx").on(table.tenant_id),
    index("brain_substrate_states_tenant_status_idx").on(
      table.tenant_id,
      table.status,
    ),
    index("brain_substrate_states_managed_app_idx").on(
      table.managed_application_id,
    ),
    index("brain_substrate_states_latest_job_idx").on(
      table.latest_deployment_job_id,
    ),
    index("brain_substrate_states_storage_tier_idx").on(table.storage_tier),
    check(
      "brain_substrate_states_tier_allowed",
      sql`${table.storage_tier} IN ('default','production')`,
    ),
    check(
      "brain_substrate_states_backend_allowed",
      sql`${table.active_backend} IN ('none','default','production','legacy_cognee')`,
    ),
    check(
      "brain_substrate_states_status_allowed",
      sql`${table.status} IN ('not_installed','provisioning','ready','degraded','failed','migrating','disabled')`,
    ),
    check(
      "brain_substrate_states_health_allowed",
      sql`${table.health_status} IN ('unknown','healthy','degraded','failed','disabled')`,
    ),
    check(
      "brain_substrate_states_vector_positive",
      sql`${table.vector_dimension} IS NULL OR ${table.vector_dimension} > 0`,
    ),
    check(
      "brain_substrate_states_queue_nonneg",
      sql`${table.ingestion_queue_depth} >= 0`,
    ),
    check(
      "brain_substrate_states_failed_nonneg",
      sql`${table.failed_ingest_count} >= 0`,
    ),
    check(
      "brain_substrate_states_entity_nonneg",
      sql`${table.graph_entity_count} IS NULL OR ${table.graph_entity_count} >= 0`,
    ),
    check(
      "brain_substrate_states_edge_nonneg",
      sql`${table.graph_edge_count} IS NULL OR ${table.graph_edge_count} >= 0`,
    ),
    check(
      "brain_substrate_states_artifact_nonneg",
      sql`${table.source_artifact_count} IS NULL OR ${table.source_artifact_count} >= 0`,
    ),
    check(
      "brain_substrate_states_projection_nonneg",
      sql`${table.vault_projection_count} IS NULL OR ${table.vault_projection_count} >= 0`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// brain.substrate_migrations — tier migration/cutover state
// ---------------------------------------------------------------------------

export const brainSubstrateMigrations = brain.table(
  "substrate_migrations",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    substrate_id: uuid("substrate_id"),
    from_storage_tier: text("from_storage_tier").notNull().default("default"),
    to_storage_tier: text("to_storage_tier").notNull().default("production"),
    phase: text("phase").notNull().default("none"),
    status: text("status").notNull().default("none"),
    requested_by_user_id: uuid("requested_by_user_id"),
    deployment_job_id: uuid("deployment_job_id"),
    embedding_model: text("embedding_model"),
    vector_dimension: integer("vector_dimension"),
    validation_summary: jsonb("validation_summary").notNull().default({}),
    operator_evidence: jsonb("operator_evidence").notNull().default({}),
    error_message: text("error_message"),
    requested_at: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    started_at: timestamp("started_at", { withTimezone: true }),
    completed_at: timestamp("completed_at", { withTimezone: true }),
    rollback_window_closes_at: timestamp("rollback_window_closes_at", {
      withTimezone: true,
    }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    foreignKey({
      name: "substrate_migrations_substrate_id_fk",
      columns: [table.substrate_id],
      foreignColumns: [brainSubstrateStates.id],
    }).onDelete("set null"),
    foreignKey({
      name: "substrate_migrations_requested_by_user_id_fk",
      columns: [table.requested_by_user_id],
      foreignColumns: [users.id],
    }).onDelete("set null"),
    foreignKey({
      name: "substrate_migrations_deployment_job_id_fk",
      columns: [table.deployment_job_id],
      foreignColumns: [managedApplicationDeploymentJobs.id],
    }).onDelete("set null"),
    index("brain_substrate_migrations_tenant_status_idx").on(
      table.tenant_id,
      table.status,
    ),
    index("brain_substrate_migrations_tenant_phase_idx").on(
      table.tenant_id,
      table.phase,
    ),
    index("brain_substrate_migrations_substrate_created_idx").on(
      table.substrate_id,
      table.created_at,
    ),
    index("brain_substrate_migrations_job_idx").on(table.deployment_job_id),
    check(
      "brain_substrate_migrations_from_tier_allowed",
      sql`${table.from_storage_tier} IN ('default','production')`,
    ),
    check(
      "brain_substrate_migrations_to_tier_allowed",
      sql`${table.to_storage_tier} IN ('default','production')`,
    ),
    check(
      "brain_substrate_migrations_phase_allowed",
      sql`${table.phase} IN ('none','requested','snapshotting','provisioning','replaying','validating','cutover','completed','failed','rolled_back')`,
    ),
    check(
      "brain_substrate_migrations_status_allowed",
      sql`${table.status} IN ('none','requested','running','completed','failed','rolled_back','canceled')`,
    ),
    check(
      "brain_substrate_migrations_vector_positive",
      sql`${table.vector_dimension} IS NULL OR ${table.vector_dimension} > 0`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// brain.substrate_events — operational event log
// ---------------------------------------------------------------------------

export const brainSubstrateEvents = brain.table(
  "substrate_events",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    substrate_id: uuid("substrate_id"),
    migration_id: uuid("migration_id"),
    deployment_job_id: uuid("deployment_job_id"),
    event_type: text("event_type").notNull(),
    message: text("message").notNull(),
    payload: jsonb("payload").notNull().default({}),
    evidence_uri: text("evidence_uri"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    foreignKey({
      name: "substrate_events_substrate_id_fk",
      columns: [table.substrate_id],
      foreignColumns: [brainSubstrateStates.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "substrate_events_migration_id_fk",
      columns: [table.migration_id],
      foreignColumns: [brainSubstrateMigrations.id],
    }).onDelete("set null"),
    foreignKey({
      name: "substrate_events_deployment_job_id_fk",
      columns: [table.deployment_job_id],
      foreignColumns: [managedApplicationDeploymentJobs.id],
    }).onDelete("set null"),
    index("brain_substrate_events_tenant_created_idx").on(
      table.tenant_id,
      table.created_at,
    ),
    index("brain_substrate_events_substrate_created_idx").on(
      table.substrate_id,
      table.created_at,
    ),
    index("brain_substrate_events_migration_idx").on(table.migration_id),
    index("brain_substrate_events_deployment_job_idx").on(
      table.deployment_job_id,
    ),
  ],
);

// ---------------------------------------------------------------------------
// brain.artifact_manifests — replayable Brain source/vault artifacts
// ---------------------------------------------------------------------------

export const brainArtifactManifests = brain.table(
  "artifact_manifests",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    substrate_id: uuid("substrate_id"),
    migration_id: uuid("migration_id"),
    ingest_run_id: uuid("ingest_run_id"),
    manifest_kind: text("manifest_kind").notNull(),
    storage_tier: text("storage_tier").notNull().default("default"),
    source_family: text("source_family"),
    source_kind: text("source_kind"),
    source_type: text("source_type"),
    source_ids: text("source_ids")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    source_id_hash: text("source_id_hash"),
    manifest_uri: text("manifest_uri").notNull(),
    artifact_root_uri: text("artifact_root_uri"),
    vault_projection_root_uri: text("vault_projection_root_uri"),
    object_version_id: text("object_version_id"),
    content_type: text("content_type"),
    content_encoding: text("content_encoding"),
    byte_length: integer("byte_length"),
    checksum_sha256: text("checksum_sha256"),
    object_count: integer("object_count").notNull().default(0),
    source_count: integer("source_count").notNull().default(0),
    embedding_model: text("embedding_model"),
    vector_dimension: integer("vector_dimension"),
    ontology_version: text("ontology_version"),
    ontology_mechanism: text("ontology_mechanism"),
    status: text("status").notNull().default("active"),
    metadata: jsonb("metadata").notNull().default({}),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    foreignKey({
      name: "artifact_manifests_substrate_id_fk",
      columns: [table.substrate_id],
      foreignColumns: [brainSubstrateStates.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "artifact_manifests_migration_id_fk",
      columns: [table.migration_id],
      foreignColumns: [brainSubstrateMigrations.id],
    }).onDelete("set null"),
    foreignKey({
      name: "artifact_manifests_ingest_run_id_fk",
      columns: [table.ingest_run_id],
      foreignColumns: [knowledgeGraphIngestRuns.id],
    }).onDelete("set null"),
    uniqueIndex("brain_artifact_manifests_manifest_uri_uidx").on(
      table.manifest_uri,
    ),
    index("brain_artifact_manifests_tenant_kind_idx").on(
      table.tenant_id,
      table.manifest_kind,
    ),
    index("brain_artifact_manifests_substrate_kind_idx").on(
      table.substrate_id,
      table.manifest_kind,
    ),
    index("brain_artifact_manifests_migration_idx").on(table.migration_id),
    index("brain_artifact_manifests_ingest_run_idx").on(table.ingest_run_id),
    index("brain_artifact_manifests_source_idx").on(
      table.tenant_id,
      table.source_family,
      table.source_id_hash,
    ),
    index("brain_artifact_manifests_source_kind_idx").on(
      table.tenant_id,
      table.source_kind,
      table.source_id_hash,
    ),
    check(
      "brain_artifact_manifests_kind_allowed",
      sql`${table.manifest_kind} IN ('source_artifact','ingestion_manifest','migration_snapshot','vault_projection','export','okf_bundle','okf_current_manifest')`,
    ),
    check(
      "brain_artifact_manifests_tier_allowed",
      sql`${table.storage_tier} IN ('default','production')`,
    ),
    check(
      "brain_artifact_manifests_status_allowed",
      sql`${table.status} IN ('active','superseded','deleted','failed')`,
    ),
    check(
      "brain_artifact_manifests_source_kind_allowed",
      sql`${table.source_kind} IS NULL OR ${table.source_kind} IN ('thread','wiki','brain','observations','okf')`,
    ),
    check(
      "brain_artifact_manifests_object_nonneg",
      sql`${table.object_count} >= 0`,
    ),
    check(
      "brain_artifact_manifests_source_nonneg",
      sql`${table.source_count} >= 0`,
    ),
    check(
      "brain_artifact_manifests_byte_nonneg",
      sql`${table.byte_length} IS NULL OR ${table.byte_length} >= 0`,
    ),
    check(
      "brain_artifact_manifests_vector_positive",
      sql`${table.vector_dimension} IS NULL OR ${table.vector_dimension} > 0`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// brain.pages — tenant-shared structured entity pages
// ---------------------------------------------------------------------------

export const tenantEntityPages = brain.table(
  "pages",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    type: text("type").notNull(),
    entity_subtype: text("entity_subtype").notNull(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    body_md: text("body_md"),
    search_tsv: tsvector("search_tsv").generatedAlwaysAs(
      sql`to_tsvector('english'::regconfig, regexp_replace(coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(body_md,''), '[^[:alnum:]]+', ' ', 'g'))`,
    ),
    status: text("status").notNull().default("active"),
    parent_page_id: uuid("parent_page_id").references(
      (): AnyPgColumn => tenantEntityPages.id,
      { onDelete: "set null" },
    ),
    hubness_score: integer("hubness_score").notNull().default(0),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    last_compiled_at: timestamp("last_compiled_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_pages_tenant_type_subtype_slug").on(
      table.tenant_id,
      table.type,
      table.entity_subtype,
      table.slug,
    ),
    index("idx_pages_tenant_type_status").on(
      table.tenant_id,
      table.type,
      table.status,
    ),
    index("idx_pages_subtype").on(table.entity_subtype),
    index("idx_pages_last_compiled").on(table.last_compiled_at),
    index("idx_pages_search_tsv").using("gin", table.search_tsv),
    index("idx_pages_parent").on(table.parent_page_id),
    index("idx_pages_title_trgm").using(
      "gin",
      sql`${table.title} gin_trgm_ops`,
    ),
    check(
      "pages_type_allowed",
      sql`${table.type} IN ('entity','topic','decision')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// brain.page_sections
// ---------------------------------------------------------------------------

export const tenantEntityPageSections = brain.table(
  "page_sections",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    page_id: uuid("page_id")
      .references(() => tenantEntityPages.id, { onDelete: "cascade" })
      .notNull(),
    section_slug: text("section_slug").notNull(),
    heading: text("heading").notNull(),
    body_md: text("body_md").notNull(),
    position: integer("position").notNull(),
    last_source_at: timestamp("last_source_at", { withTimezone: true }),
    aggregation: jsonb("aggregation"),
    status: text("status").notNull().default("active"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_page_sections_page_slug").on(
      table.page_id,
      table.section_slug,
    ),
    index("idx_page_sections_page_position").on(table.page_id, table.position),
    check(
      "page_sections_facet_type_allowed",
      sql`${table.aggregation}->>'facet_type' IS NULL OR ${table.aggregation}->>'facet_type' IN ('operational','relationship','activity','compiled','kb_sourced','external')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// brain.page_links
// ---------------------------------------------------------------------------

export const tenantEntityPageLinks = brain.table(
  "page_links",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    from_page_id: uuid("from_page_id")
      .references(() => tenantEntityPages.id, { onDelete: "cascade" })
      .notNull(),
    to_page_id: uuid("to_page_id")
      .references(() => tenantEntityPages.id, { onDelete: "cascade" })
      .notNull(),
    kind: text("kind").notNull().default("reference"),
    context: text("context"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_page_links_from_to_kind").on(
      table.from_page_id,
      table.to_page_id,
      table.kind,
    ),
    index("idx_page_links_to").on(table.to_page_id),
    index("idx_page_links_kind").on(table.kind),
  ],
);

// ---------------------------------------------------------------------------
// brain.page_aliases
// ---------------------------------------------------------------------------

export const tenantEntityPageAliases = brain.table(
  "page_aliases",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    page_id: uuid("page_id")
      .references(() => tenantEntityPages.id, { onDelete: "cascade" })
      .notNull(),
    alias: text("alias").notNull(),
    source: text("source").notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_page_aliases_page_alias").on(table.page_id, table.alias),
    index("idx_page_aliases_alias").on(table.alias),
    index("idx_page_aliases_alias_trgm").using(
      "gin",
      sql`${table.alias} gin_trgm_ops`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// brain.section_sources — provenance for section content
// ---------------------------------------------------------------------------

export const tenantEntitySectionSources = brain.table(
  "section_sources",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    section_id: uuid("section_id")
      .references(() => tenantEntityPageSections.id, { onDelete: "restrict" })
      .notNull(),
    source_kind: text("source_kind").notNull(),
    source_ref: text("source_ref").notNull(),
    first_seen_at: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_section_sources_section_kind_ref").on(
      table.section_id,
      table.source_kind,
      table.source_ref,
    ),
    index("idx_section_sources_tenant_kind_ref").on(
      table.tenant_id,
      table.source_kind,
      table.source_ref,
    ),
  ],
);

// ---------------------------------------------------------------------------
// brain.external_refs — provenance for facts pulled from external systems
//
// Consolidated into brain.ts from the prior tenant-entity-external-refs.ts;
// it's the same feature surface (ERP/CRM/support/KB enrichment provenance).
// ---------------------------------------------------------------------------

export const tenantEntityExternalRefs = brain.table(
  "external_refs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    source_kind: text("source_kind").notNull(),
    external_id: text("external_id"),
    source_payload: jsonb("source_payload"),
    as_of: timestamp("as_of", { withTimezone: true }).notNull(),
    ttl_seconds: integer("ttl_seconds").notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_external_refs_source")
      .on(table.tenant_id, table.source_kind, table.external_id)
      .where(sql`${table.external_id} IS NOT NULL`),
    index("idx_external_refs_tenant_source").on(
      table.tenant_id,
      table.source_kind,
    ),
    // Constraint excludes tracker_issue / tracker_ticket per the OSS-connector
    // retirement (originally 0087's responsibility). 0090 absorbs 0087's
    // tracker cleanup as part of the schema move: DELETE tracker rows, drop
    // the prior constraint (whichever name — _v2 or _kind_allowed), re-add
    // without tracker entries and without the _v2 suffix. This makes 0087's
    // connector-related schema work (specifically the external_refs piece)
    // redundant — 0087's DROP TABLE statements for computer_delegations /
    // connector_executions / connectors / tenant_connector_catalog remain
    // out of scope here.
    check(
      "external_refs_kind_allowed",
      sql`${table.source_kind} IN ('erp_customer','crm_opportunity','erp_order','crm_person','support_case','bedrock_kb')`,
    ),
    check("external_refs_ttl_positive", sql`${table.ttl_seconds} > 0`),
  ],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const tenantEntityPagesRelations = relations(
  tenantEntityPages,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [tenantEntityPages.tenant_id],
      references: [tenants.id],
    }),
    parentPage: one(tenantEntityPages, {
      relationName: "brain_parent_page",
      fields: [tenantEntityPages.parent_page_id],
      references: [tenantEntityPages.id],
    }),
    childPages: many(tenantEntityPages, {
      relationName: "brain_parent_page",
    }),
    sections: many(tenantEntityPageSections),
    outgoingLinks: many(tenantEntityPageLinks, {
      relationName: "brain_from_page",
    }),
    incomingLinks: many(tenantEntityPageLinks, {
      relationName: "brain_to_page",
    }),
    aliases: many(tenantEntityPageAliases),
  }),
);

export const tenantEntityPageSectionsRelations = relations(
  tenantEntityPageSections,
  ({ one, many }) => ({
    page: one(tenantEntityPages, {
      fields: [tenantEntityPageSections.page_id],
      references: [tenantEntityPages.id],
    }),
    sources: many(tenantEntitySectionSources),
  }),
);

export const tenantEntityPageLinksRelations = relations(
  tenantEntityPageLinks,
  ({ one }) => ({
    fromPage: one(tenantEntityPages, {
      relationName: "brain_from_page",
      fields: [tenantEntityPageLinks.from_page_id],
      references: [tenantEntityPages.id],
    }),
    toPage: one(tenantEntityPages, {
      relationName: "brain_to_page",
      fields: [tenantEntityPageLinks.to_page_id],
      references: [tenantEntityPages.id],
    }),
  }),
);

export const tenantEntityPageAliasesRelations = relations(
  tenantEntityPageAliases,
  ({ one }) => ({
    page: one(tenantEntityPages, {
      fields: [tenantEntityPageAliases.page_id],
      references: [tenantEntityPages.id],
    }),
  }),
);

export const tenantEntitySectionSourcesRelations = relations(
  tenantEntitySectionSources,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [tenantEntitySectionSources.tenant_id],
      references: [tenants.id],
    }),
    section: one(tenantEntityPageSections, {
      fields: [tenantEntitySectionSources.section_id],
      references: [tenantEntityPageSections.id],
    }),
  }),
);

export const tenantEntityExternalRefsRelations = relations(
  tenantEntityExternalRefs,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [tenantEntityExternalRefs.tenant_id],
      references: [tenants.id],
    }),
  }),
);

export const brainSubstrateStatesRelations = relations(
  brainSubstrateStates,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [brainSubstrateStates.tenant_id],
      references: [tenants.id],
    }),
    managedApplication: one(managedApplications, {
      fields: [brainSubstrateStates.managed_application_id],
      references: [managedApplications.id],
    }),
    latestDeploymentJob: one(managedApplicationDeploymentJobs, {
      fields: [brainSubstrateStates.latest_deployment_job_id],
      references: [managedApplicationDeploymentJobs.id],
    }),
    migrations: many(brainSubstrateMigrations),
    events: many(brainSubstrateEvents),
    artifactManifests: many(brainArtifactManifests),
  }),
);

export const brainSubstrateMigrationsRelations = relations(
  brainSubstrateMigrations,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [brainSubstrateMigrations.tenant_id],
      references: [tenants.id],
    }),
    substrate: one(brainSubstrateStates, {
      fields: [brainSubstrateMigrations.substrate_id],
      references: [brainSubstrateStates.id],
    }),
    requestedByUser: one(users, {
      fields: [brainSubstrateMigrations.requested_by_user_id],
      references: [users.id],
    }),
    deploymentJob: one(managedApplicationDeploymentJobs, {
      fields: [brainSubstrateMigrations.deployment_job_id],
      references: [managedApplicationDeploymentJobs.id],
    }),
    events: many(brainSubstrateEvents),
    artifactManifests: many(brainArtifactManifests),
  }),
);

export const brainSubstrateEventsRelations = relations(
  brainSubstrateEvents,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [brainSubstrateEvents.tenant_id],
      references: [tenants.id],
    }),
    substrate: one(brainSubstrateStates, {
      fields: [brainSubstrateEvents.substrate_id],
      references: [brainSubstrateStates.id],
    }),
    migration: one(brainSubstrateMigrations, {
      fields: [brainSubstrateEvents.migration_id],
      references: [brainSubstrateMigrations.id],
    }),
    deploymentJob: one(managedApplicationDeploymentJobs, {
      fields: [brainSubstrateEvents.deployment_job_id],
      references: [managedApplicationDeploymentJobs.id],
    }),
  }),
);

export const brainArtifactManifestsRelations = relations(
  brainArtifactManifests,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [brainArtifactManifests.tenant_id],
      references: [tenants.id],
    }),
    substrate: one(brainSubstrateStates, {
      fields: [brainArtifactManifests.substrate_id],
      references: [brainSubstrateStates.id],
    }),
    migration: one(brainSubstrateMigrations, {
      fields: [brainArtifactManifests.migration_id],
      references: [brainSubstrateMigrations.id],
    }),
  }),
);
