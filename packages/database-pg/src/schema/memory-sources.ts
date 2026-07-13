/**
 * External-memory-compounding thin ledger (THINK-193 U1).
 *
 * These tables track external memory sources feeding the company brain:
 * processor configs (one per shared scope), source bindings, CAS cursors,
 * an evidence ledger with lineage into Hindsight projections, and a
 * per-run idempotency ledger. Thin U1 set — no claims or identity tables.
 */

import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants, users } from "./core";
import { workflows } from "./workflows";
import { workflowRuns } from "./workflow-runs";
import { canonicalEntities } from "./entity-identity";

export const MEMORY_SOURCE_FAMILIES = [
  "twenty",
  "firecrawl",
  "email",
  "bedrock_kb",
] as const;

export type MemorySourceFamily = (typeof MEMORY_SOURCE_FAMILIES)[number];

export const MEMORY_PROCESSOR_MODES = ["personal", "shared"] as const;

export type MemoryProcessorMode = (typeof MEMORY_PROCESSOR_MODES)[number];

export const MEMORY_TARGET_SCOPES = ["user", "space", "tenant"] as const;

export type MemoryTargetScope = (typeof MEMORY_TARGET_SCOPES)[number];

export const MEMORY_EVIDENCE_LIFECYCLES = [
  "active",
  "superseded",
  "deleted",
  "deferred",
  "failed",
] as const;

export type MemoryEvidenceLifecycle =
  (typeof MEMORY_EVIDENCE_LIFECYCLES)[number];

export const MEMORY_DERIVATION_LIFECYCLES = [
  "active",
  "superseded",
  "retracted",
] as const;

export type MemoryDerivationLifecycle =
  (typeof MEMORY_DERIVATION_LIFECYCLES)[number];

export const MEMORY_RUN_ITEM_STAGES = [
  "acquire",
  "extract",
  "project",
  "resolve",
  "retain",
  "compound",
  "graph",
  "wiki",
  "preflight",
] as const;

export type MemoryRunItemStage = (typeof MEMORY_RUN_ITEM_STAGES)[number];

export const MEMORY_RUN_ITEM_RESULTS = [
  "seen",
  "changed",
  "retracted",
  "deferred",
  "failed",
  "noop",
] as const;

export type MemoryRunItemResult = (typeof MEMORY_RUN_ITEM_RESULTS)[number];

export const MEMORY_SOURCE_AUTHORIZATION_STATUSES = [
  "active",
  "revoked",
  "expired",
] as const;

export type MemorySourceAuthorizationStatus =
  (typeof MEMORY_SOURCE_AUTHORIZATION_STATUSES)[number];

export const MEMORY_CLAIM_STATUSES = [
  "active",
  "superseded",
  "retracted",
] as const;

export type MemoryClaimStatus = (typeof MEMORY_CLAIM_STATUSES)[number];

export const MEMORY_CLAIM_CONFLICT_STATES = ["none", "conflicted"] as const;

export type MemoryClaimConflictState =
  (typeof MEMORY_CLAIM_CONFLICT_STATES)[number];

export const MEMORY_CLAIM_EVIDENCE_STATUSES = ["active", "retracted"] as const;

export type MemoryClaimEvidenceStatus =
  (typeof MEMORY_CLAIM_EVIDENCE_STATUSES)[number];

export const MEMORY_RETRACTION_SCOPES = ["derivation", "source"] as const;

export type MemoryRetractionScope = (typeof MEMORY_RETRACTION_SCOPES)[number];

export const MEMORY_RETRACTION_STATUSES = [
  "queued",
  "running",
  "supports_updated",
  "provider_deleted",
  "reconsolidated",
  "retracted",
  "failed",
  "dead_lettered",
] as const;

export type MemoryRetractionStatus =
  (typeof MEMORY_RETRACTION_STATUSES)[number];

// ---------------------------------------------------------------------------
// memory_processor_configs — one processor per shared scope
// ---------------------------------------------------------------------------

export const memoryProcessorConfigs = pgTable(
  "memory_processor_configs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    mode: text("mode").notNull(),
    target_scope: text("target_scope").notNull(),
    target_id: uuid("target_id").notNull(),
    workflow_id: uuid("workflow_id").references(() => workflows.id, {
      onDelete: "set null",
    }),
    enabled: boolean("enabled").notNull().default(true),
    status: text("status").notNull().default("active"),
    budget: jsonb("budget")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    // THINK-264: per-stage operator toggles. Only the optional tail stages
    // (compound/graph/wiki) may appear here — the acquire→project→resolve→
    // retain spine is structural and is never disableable, so a user cannot
    // silently turn their own pipeline into a no-op. Shape:
    // { disabledStages: MemoryStageKind[] }. Fed to the blueprint builder;
    // the stored workflow steps are still code-owned.
    stage_overrides: jsonb("stage_overrides")
      .$type<{ disabledStages?: string[] }>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    config_version: integer("config_version").notNull().default(1),
    created_by_user_id: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("memory_processor_configs_active_target_uidx")
      .on(table.tenant_id, table.mode, table.target_scope, table.target_id)
      .where(sql`${table.status} = 'active'`),
    index("memory_processor_configs_tenant_idx").on(table.tenant_id),
    check(
      "memory_processor_configs_mode_check",
      sql`${table.mode} IN ('personal', 'shared')`,
    ),
    check(
      "memory_processor_configs_target_scope_check",
      sql`${table.target_scope} IN ('user', 'space', 'tenant')`,
    ),
    check(
      "memory_processor_configs_status_check",
      sql`${table.status} IN ('active', 'disabled')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// memory_source_configs — source bindings under a processor
// ---------------------------------------------------------------------------

export const memorySourceConfigs = pgTable(
  "memory_source_configs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    processor_config_id: uuid("processor_config_id")
      .notNull()
      .references(() => memoryProcessorConfigs.id, { onDelete: "cascade" }),
    source_family: text("source_family").notNull(),
    /** Managed-app key or connection id the source binds to. */
    source_binding_key: text("source_binding_key").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    boundary: jsonb("boundary")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    policy_version: integer("policy_version").notNull().default(1),
    // Erase write-fence (THINK-193 U2, Codex round-3 P1-2): bumped in the
    // SAME transaction that disables the source and persists the erase
    // marker (beginSourceErase). Stage writers capture the generation with
    // the source row; every internal write CASes on it and external writes
    // (Hindsight upsert, S3 put) re-check it first, so an in-flight
    // acquire/project/retain can never resurrect claims/snapshots/documents
    // after erase begins.
    erase_generation: integer("erase_generation").notNull().default(0),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("memory_source_configs_binding_uidx").on(
      table.processor_config_id,
      table.source_family,
      table.source_binding_key,
    ),
    index("memory_source_configs_tenant_idx").on(table.tenant_id),
    check(
      "memory_source_configs_erase_generation_nonnegative",
      sql`${table.erase_generation} >= 0`,
    ),
    check(
      "memory_source_configs_source_family_check",
      sql`${table.source_family} IN ('twenty', 'firecrawl', 'email', 'bedrock_kb')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// memory_source_checkpoints — CAS cursor per partition
// ---------------------------------------------------------------------------

export const memorySourceCheckpoints = pgTable(
  "memory_source_checkpoints",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    source_config_id: uuid("source_config_id")
      .notNull()
      .references(() => memorySourceConfigs.id, { onDelete: "cascade" }),
    partition_key: text("partition_key").notNull(),
    cursor: jsonb("cursor")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** Compare-and-swap version — advance requires matching current value. */
    version: integer("version").notNull().default(0),
    last_advanced_at: timestamp("last_advanced_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("memory_source_checkpoints_partition_uidx").on(
      table.source_config_id,
      table.partition_key,
    ),
  ],
);

// ---------------------------------------------------------------------------
// memory_evidence_items — evidence ledger
// ---------------------------------------------------------------------------

export const memoryEvidenceItems = pgTable(
  "memory_evidence_items",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    source_config_id: uuid("source_config_id")
      .notNull()
      .references(() => memorySourceConfigs.id, { onDelete: "cascade" }),
    source_item_id: text("source_item_id").notNull(),
    source_version: text("source_version").notNull(),
    source_timestamp: timestamp("source_timestamp", { withTimezone: true }),
    content_hash: text("content_hash").notNull(),
    acquisition_run_id: uuid("acquisition_run_id").references(
      () => workflowRuns.id,
      { onDelete: "set null" },
    ),
    target_scope: text("target_scope").notNull(),
    target_id: uuid("target_id").notNull(),
    lifecycle: text("lifecycle").notNull().default("active"),
    sensitivity: text("sensitivity"),
    /** S3 ref for the raw snapshot. */
    snapshot_ref: text("snapshot_ref"),
    /** App-enforced TTL for the S3 snapshot (no DB-side expiry). */
    snapshot_expires_at: timestamp("snapshot_expires_at", {
      withTimezone: true,
    }),
    /** Bounded normalized record kept inline for thin-slice inspectability. */
    normalized_snapshot: jsonb("normalized_snapshot").$type<Record<
      string,
      unknown
    > | null>(),
    /** Recipe/model/ontology version used for extraction. */
    extraction_recipe: jsonb("extraction_recipe")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    last_error: text("last_error"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("memory_evidence_items_source_version_uidx").on(
      table.source_config_id,
      table.source_item_id,
      table.source_version,
    ),
    index("memory_evidence_items_tenant_idx").on(table.tenant_id),
    index("memory_evidence_items_source_lifecycle_idx").on(
      table.source_config_id,
      table.lifecycle,
    ),
    // v2 (THINK-193 U6): personal email evidence targets the owner's User
    // Bank — 'user' joined the shared scopes (migration 0240).
    check(
      "memory_evidence_items_target_scope_check_v2",
      sql`${table.target_scope} IN ('user', 'space', 'tenant')`,
    ),
    check(
      "memory_evidence_items_lifecycle_check",
      sql`${table.lifecycle} IN ('active', 'superseded', 'deleted', 'deferred', 'failed')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// memory_run_items — run idempotency ledger
// ---------------------------------------------------------------------------

export const memoryRunItems = pgTable(
  "memory_run_items",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    workflow_run_id: uuid("workflow_run_id")
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    source_config_id: uuid("source_config_id")
      .notNull()
      .references(() => memorySourceConfigs.id, { onDelete: "cascade" }),
    source_item_id: text("source_item_id").notNull(),
    stage: text("stage").notNull(),
    result: text("result").notNull(),
    /** Counts / cost detail for the stage outcome. */
    detail: jsonb("detail")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("memory_run_items_stage_uidx").on(
      table.workflow_run_id,
      table.source_config_id,
      table.source_item_id,
      table.stage,
    ),
    index("memory_run_items_run_idx").on(table.workflow_run_id),
    check(
      "memory_run_items_stage_check",
      sql`${table.stage} IN ('acquire', 'extract', 'project', 'resolve', 'retain', 'compound', 'graph', 'wiki', 'preflight')`,
    ),
    check(
      "memory_run_items_result_check",
      sql`${table.result} IN ('seen', 'changed', 'retracted', 'deferred', 'failed', 'noop')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// memory_derivations — evidence → projection lineage
// ---------------------------------------------------------------------------

export const memoryDerivations = pgTable(
  "memory_derivations",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    source_config_id: uuid("source_config_id")
      .notNull()
      .references(() => memorySourceConfigs.id, { onDelete: "cascade" }),
    evidence_item_id: uuid("evidence_item_id")
      .notNull()
      .references(() => memoryEvidenceItems.id, { onDelete: "cascade" }),
    /** e.g. 'company:<twentyId>'. */
    projection_key: text("projection_key").notNull(),
    /** e.g. 'tenant_<uuid>'. */
    target_bank_id: text("target_bank_id").notNull(),
    /** 'external:<sourceConfigId>:<projectionKey>'. */
    hindsight_document_id: text("hindsight_document_id").notNull(),
    current_version: text("current_version").notNull(),
    lifecycle: text("lifecycle").notNull().default("active"),
    retracted_at: timestamp("retracted_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("memory_derivations_active_projection_uidx")
      .on(table.source_config_id, table.projection_key)
      .where(sql`${table.lifecycle} = 'active'`),
    index("memory_derivations_tenant_idx").on(table.tenant_id),
    index("memory_derivations_evidence_idx").on(table.evidence_item_id),
    check(
      "memory_derivations_lifecycle_check",
      sql`${table.lifecycle} IN ('active', 'superseded', 'retracted')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// memory_source_authorizations — explicit grant, the MAXIMUM readable envelope
// ---------------------------------------------------------------------------

export const memorySourceAuthorizations = pgTable(
  "memory_source_authorizations",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    processor_config_id: uuid("processor_config_id")
      .notNull()
      .references(() => memoryProcessorConfigs.id, { onDelete: "cascade" }),
    source_family: text("source_family").notNull(),
    source_binding_key: text("source_binding_key").notNull(),
    /** Maximum readable envelope — source-config boundaries must fit inside. */
    boundary: jsonb("boundary")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    granted_by_user_id: uuid("granted_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    grant_version: integer("grant_version").notNull().default(1),
    status: text("status").notNull().default("active"),
    expires_at: timestamp("expires_at", { withTimezone: true }),
    revoked_at: timestamp("revoked_at", { withTimezone: true }),
    sensitivity: jsonb("sensitivity")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("memory_source_authorizations_active_uidx")
      .on(
        table.processor_config_id,
        table.source_family,
        table.source_binding_key,
      )
      .where(sql`${table.status} = 'active'`),
    index("memory_source_authorizations_tenant_idx").on(table.tenant_id),
    check(
      "memory_source_authorizations_source_family_check",
      sql`${table.source_family} IN ('twenty', 'firecrawl', 'email', 'bedrock_kb')`,
    ),
    check(
      "memory_source_authorizations_status_check",
      sql`${table.status} IN ('active', 'revoked', 'expired')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// memory_claims — durable ontology-shaped claims
// ---------------------------------------------------------------------------

export const memoryClaims = pgTable(
  "memory_claims",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    target_scope: text("target_scope").notNull(),
    target_id: uuid("target_id").notNull(),
    /** Canonical subject (THINK-193 U4) — filled when the subject resolves. */
    canonical_subject_id: uuid("canonical_subject_id").references(
      () => canonicalEntities.id,
      { onDelete: "set null" },
    ),
    /** Pre-canonical stable subject, e.g. 'twenty:company:<id>'. */
    subject_key: text("subject_key").notNull(),
    /** Ontology entity-type slug. */
    subject_entity_type: text("subject_entity_type")
      .notNull()
      .default("customer"),
    /** e.g. 'customer.employees'. */
    ontology_predicate: text("ontology_predicate").notNull(),
    /** FULL normalized value — never in an index. */
    value: jsonb("value").$type<Record<string, unknown>>().notNull(),
    /** sha256 hex of the normalized value — fixed-length index material. */
    value_hash: text("value_hash").notNull(),
    effective_from: timestamp("effective_from", { withTimezone: true }),
    effective_to: timestamp("effective_to", { withTimezone: true }),
    status: text("status").notNull().default("active"),
    conflict_state: text("conflict_state").notNull().default("none"),
    extraction_version: text("extraction_version").notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    // Null-safe fingerprint: COALESCE folds NULL effective_from into a single
    // sentinel so duplicate open-ended claims collide instead of coexisting.
    uniqueIndex("memory_claims_fingerprint_uidx").on(
      table.tenant_id,
      table.target_scope,
      table.target_id,
      table.subject_key,
      table.ontology_predicate,
      table.value_hash,
      sql`COALESCE(${table.effective_from}, '-infinity'::timestamptz)`,
    ),
    index("memory_claims_target_subject_idx").on(
      table.tenant_id,
      table.target_scope,
      table.target_id,
      table.subject_key,
    ),
    index("memory_claims_tenant_status_idx").on(table.tenant_id, table.status),
    // v2 (THINK-193 U6): personal email claims are user-scoped (migration
    // 0240); shared-only APIs keep the SharedTargetScope type guard.
    check(
      "memory_claims_target_scope_check_v2",
      sql`${table.target_scope} IN ('user', 'space', 'tenant')`,
    ),
    check(
      "memory_claims_status_check",
      sql`${table.status} IN ('active', 'superseded', 'retracted')`,
    ),
    check(
      "memory_claims_conflict_state_check",
      sql`${table.conflict_state} IN ('none', 'conflicted')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// memory_claim_evidence — many-to-many claim <- evidence support edges
// ---------------------------------------------------------------------------

export const memoryClaimEvidence = pgTable(
  "memory_claim_evidence",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    claim_id: uuid("claim_id")
      .notNull()
      .references(() => memoryClaims.id, { onDelete: "cascade" }),
    evidence_item_id: uuid("evidence_item_id")
      .notNull()
      .references(() => memoryEvidenceItems.id, { onDelete: "cascade" }),
    source_config_id: uuid("source_config_id")
      .notNull()
      .references(() => memorySourceConfigs.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("active"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    retracted_at: timestamp("retracted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("memory_claim_evidence_pair_uidx").on(
      table.claim_id,
      table.evidence_item_id,
    ),
    index("memory_claim_evidence_evidence_idx").on(table.evidence_item_id),
    index("memory_claim_evidence_claim_status_idx").on(
      table.claim_id,
      table.status,
    ),
    check(
      "memory_claim_evidence_status_check",
      sql`${table.status} IN ('active', 'retracted')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// memory_retraction_attempts — idempotent multi-system retraction ledger
// ---------------------------------------------------------------------------

export const memoryRetractionAttempts = pgTable(
  "memory_retraction_attempts",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    derivation_id: uuid("derivation_id").references(
      () => memoryDerivations.id,
      {
        onDelete: "set null",
      },
    ),
    source_config_id: uuid("source_config_id")
      .notNull()
      .references(() => memorySourceConfigs.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("hindsight"),
    provider_document_id: text("provider_document_id").notNull(),
    target_bank_id: text("target_bank_id").notNull(),
    status: text("status").notNull().default("queued"),
    attempt_count: integer("attempt_count").notNull().default(0),
    max_attempts: integer("max_attempts").notNull().default(5),
    next_retry_at: timestamp("next_retry_at", { withTimezone: true }),
    locked_at: timestamp("locked_at", { withTimezone: true }),
    locked_by: text("locked_by"),
    // Fencing token (THINK-193 U2, Codex P2): every claim increments the
    // generation; all saga transitions CAS on (locked_by, lock_generation)
    // so a stale worker reclaimed past its lease can never clobber the
    // newer claimant's progress.
    lock_generation: integer("lock_generation").notNull().default(0),
    // Which erase generation of the source this row belongs to (Codex
    // round-4 P1-C): 'erase' markers and their 'source'-scoped children are
    // tagged with memory_source_configs.erase_generation at enqueue time so
    // aggregate child accounting never counts dead-lettered children from a
    // PREVIOUS (remediated) erase. 0 for derivation-scoped rows.
    erase_generation: integer("erase_generation").notNull().default(0),
    // Durable bounded-cleanup progress on 'erase' marker rows: NULL (not
    // started) → 'snapshots_deleted' → 'evidence_purged'; checkpoints are
    // deleted last and the marker goes terminal. cleanup_cursor carries the
    // bounded evidence-purge resume position (last processed evidence id).
    cleanup_phase: text("cleanup_phase"),
    cleanup_cursor: text("cleanup_cursor"),
    // Non-null when the reconsolidation step was skipped (e.g. the adapter
    // is delete-capable but exposes no consolidator) — a durable
    // skipped-with-reason record, distinct from success.
    reconsolidation_note: text("reconsolidation_note"),
    error_class: text("error_class"),
    error_message: text("error_message"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    completed_at: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    // Partial unique — a completed retraction can be re-queued later.
    uniqueIndex("memory_retraction_attempts_document_uidx")
      .on(table.tenant_id, table.provider, table.provider_document_id)
      .where(sql`${table.status} NOT IN ('retracted', 'dead_lettered')`),
    index("memory_retraction_attempts_due_idx").on(
      table.status,
      table.next_retry_at,
      table.created_at,
    ),
    // Per-generation erase accounting (countSourceAttemptsByStatus /
    // cleanup discovery).
    index("memory_retraction_attempts_erase_accounting_idx").on(
      table.source_config_id,
      table.erase_generation,
      table.scope,
      table.status,
    ),
    // v2 (THINK-193 U2): 'erase' rows are durable source-erase AGGREGATE
    // markers — one non-terminal marker per source (via the partial unique
    // document index on a synthetic erase:<sourceConfigId> document id).
    // They are never processed by the per-document saga; the scheduled
    // drainer keys its self-finalizing cleanup sweep on them, which is what
    // lets an erase of a source with ZERO derivations survive an S3 failure
    // and complete on a later tick.
    check(
      "memory_retraction_attempts_scope_check_v2",
      sql`${table.scope} IN ('derivation', 'source', 'erase')`,
    ),
    check(
      "memory_retraction_attempts_status_check",
      sql`${table.status} IN ('queued', 'running', 'supports_updated', 'provider_deleted', 'reconsolidated', 'retracted', 'failed', 'dead_lettered')`,
    ),
    check(
      "memory_retraction_attempts_attempt_count_nonnegative",
      sql`${table.attempt_count} >= 0`,
    ),
    check(
      "memory_retraction_attempts_max_attempts_positive",
      sql`${table.max_attempts} > 0`,
    ),
    check(
      "memory_retraction_attempts_erase_generation_nonnegative",
      sql`${table.erase_generation} >= 0`,
    ),
    // Derivation-scoped rows never belong to an erase generation; erase
    // markers and their 'source' children carry the generation they were
    // enqueued/promoted under.
    check(
      "memory_retraction_attempts_derivation_generation_check",
      sql`${table.scope} <> 'derivation' OR ${table.erase_generation} = 0`,
    ),
    // Cleanup phase progress is meaningful ONLY on erase markers and is a
    // closed domain.
    check(
      "memory_retraction_attempts_cleanup_phase_check",
      sql`${table.cleanup_phase} IS NULL OR (${table.scope} = 'erase' AND ${table.cleanup_phase} IN ('snapshots_deleted', 'evidence_purged'))`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const memoryProcessorConfigsRelations = relations(
  memoryProcessorConfigs,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [memoryProcessorConfigs.tenant_id],
      references: [tenants.id],
    }),
    workflow: one(workflows, {
      fields: [memoryProcessorConfigs.workflow_id],
      references: [workflows.id],
    }),
    createdByUser: one(users, {
      fields: [memoryProcessorConfigs.created_by_user_id],
      references: [users.id],
    }),
    sourceConfigs: many(memorySourceConfigs),
    sourceAuthorizations: many(memorySourceAuthorizations),
  }),
);

export const memorySourceConfigsRelations = relations(
  memorySourceConfigs,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [memorySourceConfigs.tenant_id],
      references: [tenants.id],
    }),
    processorConfig: one(memoryProcessorConfigs, {
      fields: [memorySourceConfigs.processor_config_id],
      references: [memoryProcessorConfigs.id],
    }),
    checkpoints: many(memorySourceCheckpoints),
    evidenceItems: many(memoryEvidenceItems),
    derivations: many(memoryDerivations),
    claimEvidence: many(memoryClaimEvidence),
    retractionAttempts: many(memoryRetractionAttempts),
  }),
);

export const memorySourceCheckpointsRelations = relations(
  memorySourceCheckpoints,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [memorySourceCheckpoints.tenant_id],
      references: [tenants.id],
    }),
    sourceConfig: one(memorySourceConfigs, {
      fields: [memorySourceCheckpoints.source_config_id],
      references: [memorySourceConfigs.id],
    }),
  }),
);

export const memoryEvidenceItemsRelations = relations(
  memoryEvidenceItems,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [memoryEvidenceItems.tenant_id],
      references: [tenants.id],
    }),
    sourceConfig: one(memorySourceConfigs, {
      fields: [memoryEvidenceItems.source_config_id],
      references: [memorySourceConfigs.id],
    }),
    acquisitionRun: one(workflowRuns, {
      fields: [memoryEvidenceItems.acquisition_run_id],
      references: [workflowRuns.id],
    }),
    derivations: many(memoryDerivations),
    claimEvidence: many(memoryClaimEvidence),
  }),
);

export const memoryRunItemsRelations = relations(memoryRunItems, ({ one }) => ({
  tenant: one(tenants, {
    fields: [memoryRunItems.tenant_id],
    references: [tenants.id],
  }),
  workflowRun: one(workflowRuns, {
    fields: [memoryRunItems.workflow_run_id],
    references: [workflowRuns.id],
  }),
  sourceConfig: one(memorySourceConfigs, {
    fields: [memoryRunItems.source_config_id],
    references: [memorySourceConfigs.id],
  }),
}));

export const memoryDerivationsRelations = relations(
  memoryDerivations,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [memoryDerivations.tenant_id],
      references: [tenants.id],
    }),
    sourceConfig: one(memorySourceConfigs, {
      fields: [memoryDerivations.source_config_id],
      references: [memorySourceConfigs.id],
    }),
    evidenceItem: one(memoryEvidenceItems, {
      fields: [memoryDerivations.evidence_item_id],
      references: [memoryEvidenceItems.id],
    }),
    retractionAttempts: many(memoryRetractionAttempts),
  }),
);

export const memorySourceAuthorizationsRelations = relations(
  memorySourceAuthorizations,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [memorySourceAuthorizations.tenant_id],
      references: [tenants.id],
    }),
    processorConfig: one(memoryProcessorConfigs, {
      fields: [memorySourceAuthorizations.processor_config_id],
      references: [memoryProcessorConfigs.id],
    }),
    grantedByUser: one(users, {
      fields: [memorySourceAuthorizations.granted_by_user_id],
      references: [users.id],
    }),
  }),
);

export const memoryClaimsRelations = relations(
  memoryClaims,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [memoryClaims.tenant_id],
      references: [tenants.id],
    }),
    claimEvidence: many(memoryClaimEvidence),
  }),
);

export const memoryClaimEvidenceRelations = relations(
  memoryClaimEvidence,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [memoryClaimEvidence.tenant_id],
      references: [tenants.id],
    }),
    claim: one(memoryClaims, {
      fields: [memoryClaimEvidence.claim_id],
      references: [memoryClaims.id],
    }),
    evidenceItem: one(memoryEvidenceItems, {
      fields: [memoryClaimEvidence.evidence_item_id],
      references: [memoryEvidenceItems.id],
    }),
    sourceConfig: one(memorySourceConfigs, {
      fields: [memoryClaimEvidence.source_config_id],
      references: [memorySourceConfigs.id],
    }),
  }),
);

export const memoryRetractionAttemptsRelations = relations(
  memoryRetractionAttempts,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [memoryRetractionAttempts.tenant_id],
      references: [tenants.id],
    }),
    derivation: one(memoryDerivations, {
      fields: [memoryRetractionAttempts.derivation_id],
      references: [memoryDerivations.id],
    }),
    sourceConfig: one(memorySourceConfigs, {
      fields: [memoryRetractionAttempts.source_config_id],
      references: [memorySourceConfigs.id],
    }),
  }),
);
