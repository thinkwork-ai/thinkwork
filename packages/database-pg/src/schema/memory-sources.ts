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
    check(
      "memory_evidence_items_target_scope_check",
      sql`${table.target_scope} IN ('space', 'tenant')`,
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
  ({ one }) => ({
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
  }),
);
