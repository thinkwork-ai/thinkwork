/**
 * System Workflow domain tables.
 *
 * System Workflows are ThinkWork-owned operating workflows backed by
 * Step Functions. They intentionally live outside the Routine tables:
 * Routines are tenant/agent-authored workflows, while System Workflows
 * are platform-owned controls with governed config, extension points,
 * evidence, and compliance semantics.
 *
 * Plan: docs/plans/2026-05-02-007-feat-system-workflows-step-functions-plan.md.
 */

import {
  bigint,
  bigserial,
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
import { tenants } from "./core";
import { scheduledJobs } from "./scheduled-jobs";

export const systemWorkflowDefinitions = pgTable(
  "system_workflow_definitions",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    category: text("category").notNull(),
    owner: text("owner").notNull().default("ThinkWork"),
    runtime_shape: text("runtime_shape").notNull(),
    status: text("status").notNull().default("active"),
    active_version: text("active_version").notNull(),
    config_schema_json: jsonb("config_schema_json")
      .notNull()
      .default(sql`'{}'::jsonb`),
    extension_points_json: jsonb("extension_points_json")
      .notNull()
      .default(sql`'[]'::jsonb`),
    evidence_contract_json: jsonb("evidence_contract_json")
      .notNull()
      .default(sql`'[]'::jsonb`),
    step_manifest_json: jsonb("step_manifest_json")
      .notNull()
      .default(sql`'[]'::jsonb`),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_system_workflow_definitions_category").on(table.category),
    index("idx_system_workflow_definitions_status").on(table.status),
  ],
);

export const systemWorkflowConfigs = pgTable(
  "system_workflow_configs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    workflow_id: text("workflow_id")
      .notNull()
      .references(() => systemWorkflowDefinitions.id),
    version_number: integer("version_number").notNull(),
    status: text("status").notNull().default("active"),
    config_json: jsonb("config_json")
      .notNull()
      .default(sql`'{}'::jsonb`),
    created_by_actor_id: uuid("created_by_actor_id"),
    created_by_actor_type: text("created_by_actor_type"),
    activated_at: timestamp("activated_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("idx_system_workflow_configs_tenant_workflow_version").on(
      table.tenant_id,
      table.workflow_id,
      table.version_number,
    ),
    index("idx_system_workflow_configs_tenant_workflow_status").on(
      table.tenant_id,
      table.workflow_id,
      table.status,
    ),
  ],
);

export const systemWorkflowExtensionBindings = pgTable(
  "system_workflow_extension_bindings",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    workflow_id: text("workflow_id")
      .notNull()
      .references(() => systemWorkflowDefinitions.id),
    config_id: uuid("config_id").references(() => systemWorkflowConfigs.id, {
      onDelete: "set null",
    }),
    extension_point_id: text("extension_point_id").notNull(),
    binding_type: text("binding_type").notNull(),
    binding_json: jsonb("binding_json")
      .notNull()
      .default(sql`'{}'::jsonb`),
    status: text("status").notNull().default("active"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_system_workflow_extension_bindings_tenant_workflow").on(
      table.tenant_id,
      table.workflow_id,
    ),
    index("idx_system_workflow_extension_bindings_config").on(table.config_id),
  ],
);

export const systemWorkflowRuns = pgTable(
  "system_workflow_runs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    workflow_id: text("workflow_id")
      .notNull()
      .references(() => systemWorkflowDefinitions.id),
    config_id: uuid("config_id").references(() => systemWorkflowConfigs.id, {
      onDelete: "set null",
    }),
    definition_version: text("definition_version").notNull(),
    runtime_shape: text("runtime_shape").notNull(),
    state_machine_arn: text("state_machine_arn"),
    alias_arn: text("alias_arn"),
    version_arn: text("version_arn"),
    sfn_execution_arn: text("sfn_execution_arn"),
    trigger_id: uuid("trigger_id").references(() => scheduledJobs.id, {
      onDelete: "set null",
    }),
    trigger_source: text("trigger_source").notNull(),
    actor_id: uuid("actor_id"),
    actor_type: text("actor_type"),
    domain_ref_type: text("domain_ref_type"),
    domain_ref_id: text("domain_ref_id"),
    input_json: jsonb("input_json"),
    output_json: jsonb("output_json"),
    evidence_summary_json: jsonb("evidence_summary_json")
      .notNull()
      .default(sql`'{}'::jsonb`),
    status: text("status").notNull().default("running"),
    started_at: timestamp("started_at", { withTimezone: true }),
    finished_at: timestamp("finished_at", { withTimezone: true }),
    error_code: text("error_code"),
    error_message: text("error_message"),
    total_cost_usd_cents: bigint("total_cost_usd_cents", { mode: "number" }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("idx_system_workflow_runs_sfn_arn").on(table.sfn_execution_arn),
    index("idx_system_workflow_runs_tenant_workflow_started").on(
      table.tenant_id,
      table.workflow_id,
      table.started_at,
    ),
    index("idx_system_workflow_runs_tenant_status").on(
      table.tenant_id,
      table.status,
    ),
    index("idx_system_workflow_runs_domain_ref").on(
      table.tenant_id,
      table.domain_ref_type,
      table.domain_ref_id,
    ),
  ],
);

export const systemWorkflowStepEvents = pgTable(
  "system_workflow_step_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    run_id: uuid("run_id")
      .notNull()
      .references(() => systemWorkflowRuns.id, { onDelete: "cascade" }),
    node_id: text("node_id").notNull(),
    step_type: text("step_type").notNull(),
    status: text("status").notNull(),
    started_at: timestamp("started_at", { withTimezone: true }),
    finished_at: timestamp("finished_at", { withTimezone: true }),
    input_json: jsonb("input_json"),
    output_json: jsonb("output_json"),
    error_json: jsonb("error_json"),
    cost_usd_cents: bigint("cost_usd_cents", { mode: "number" }),
    retry_count: integer("retry_count").notNull().default(0),
    idempotency_key: text("idempotency_key"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_system_workflow_step_events_run").on(
      table.run_id,
      table.started_at,
    ),
    uniqueIndex("idx_system_workflow_step_events_dedup")
      .on(table.run_id, table.idempotency_key)
      .where(sql`${table.idempotency_key} IS NOT NULL`),
    index("idx_system_workflow_step_events_tenant_step").on(
      table.tenant_id,
      table.step_type,
    ),
  ],
);

export const systemWorkflowEvidence = pgTable(
  "system_workflow_evidence",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    run_id: uuid("run_id")
      .notNull()
      .references(() => systemWorkflowRuns.id, { onDelete: "cascade" }),
    evidence_type: text("evidence_type").notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    artifact_uri: text("artifact_uri"),
    artifact_json: jsonb("artifact_json")
      .notNull()
      .default(sql`'{}'::jsonb`),
    compliance_tags: text("compliance_tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    idempotency_key: text("idempotency_key"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_system_workflow_evidence_run").on(table.run_id),
    index("idx_system_workflow_evidence_tenant_type").on(
      table.tenant_id,
      table.evidence_type,
    ),
    uniqueIndex("idx_system_workflow_evidence_dedup")
      .on(table.run_id, table.idempotency_key)
      .where(sql`${table.idempotency_key} IS NOT NULL`),
  ],
);

export const systemWorkflowChangeEvents = pgTable(
  "system_workflow_change_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    workflow_id: text("workflow_id")
      .notNull()
      .references(() => systemWorkflowDefinitions.id),
    run_id: uuid("run_id").references(() => systemWorkflowRuns.id, {
      onDelete: "set null",
    }),
    actor_id: uuid("actor_id"),
    actor_type: text("actor_type"),
    change_type: text("change_type").notNull(),
    before_json: jsonb("before_json"),
    after_json: jsonb("after_json"),
    reason: text("reason"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_system_workflow_change_events_tenant_workflow").on(
      table.tenant_id,
      table.workflow_id,
    ),
    index("idx_system_workflow_change_events_run").on(table.run_id),
  ],
);

export const systemWorkflowDefinitionsRelations = relations(
  systemWorkflowDefinitions,
  ({ many }) => ({
    configs: many(systemWorkflowConfigs),
    runs: many(systemWorkflowRuns),
  }),
);

export const systemWorkflowConfigsRelations = relations(
  systemWorkflowConfigs,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [systemWorkflowConfigs.tenant_id],
      references: [tenants.id],
    }),
    definition: one(systemWorkflowDefinitions, {
      fields: [systemWorkflowConfigs.workflow_id],
      references: [systemWorkflowDefinitions.id],
    }),
    extensionBindings: many(systemWorkflowExtensionBindings),
    runs: many(systemWorkflowRuns),
  }),
);

export const systemWorkflowExtensionBindingsRelations = relations(
  systemWorkflowExtensionBindings,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [systemWorkflowExtensionBindings.tenant_id],
      references: [tenants.id],
    }),
    definition: one(systemWorkflowDefinitions, {
      fields: [systemWorkflowExtensionBindings.workflow_id],
      references: [systemWorkflowDefinitions.id],
    }),
    config: one(systemWorkflowConfigs, {
      fields: [systemWorkflowExtensionBindings.config_id],
      references: [systemWorkflowConfigs.id],
    }),
  }),
);

export const systemWorkflowRunsRelations = relations(
  systemWorkflowRuns,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [systemWorkflowRuns.tenant_id],
      references: [tenants.id],
    }),
    definition: one(systemWorkflowDefinitions, {
      fields: [systemWorkflowRuns.workflow_id],
      references: [systemWorkflowDefinitions.id],
    }),
    config: one(systemWorkflowConfigs, {
      fields: [systemWorkflowRuns.config_id],
      references: [systemWorkflowConfigs.id],
    }),
    trigger: one(scheduledJobs, {
      fields: [systemWorkflowRuns.trigger_id],
      references: [scheduledJobs.id],
    }),
    stepEvents: many(systemWorkflowStepEvents),
    evidence: many(systemWorkflowEvidence),
    changeEvents: many(systemWorkflowChangeEvents),
  }),
);

export const systemWorkflowStepEventsRelations = relations(
  systemWorkflowStepEvents,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [systemWorkflowStepEvents.tenant_id],
      references: [tenants.id],
    }),
    run: one(systemWorkflowRuns, {
      fields: [systemWorkflowStepEvents.run_id],
      references: [systemWorkflowRuns.id],
    }),
  }),
);

export const systemWorkflowEvidenceRelations = relations(
  systemWorkflowEvidence,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [systemWorkflowEvidence.tenant_id],
      references: [tenants.id],
    }),
    run: one(systemWorkflowRuns, {
      fields: [systemWorkflowEvidence.run_id],
      references: [systemWorkflowRuns.id],
    }),
  }),
);

export const systemWorkflowChangeEventsRelations = relations(
  systemWorkflowChangeEvents,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [systemWorkflowChangeEvents.tenant_id],
      references: [tenants.id],
    }),
    definition: one(systemWorkflowDefinitions, {
      fields: [systemWorkflowChangeEvents.workflow_id],
      references: [systemWorkflowDefinitions.id],
    }),
    run: one(systemWorkflowRuns, {
      fields: [systemWorkflowChangeEvents.run_id],
      references: [systemWorkflowRuns.id],
    }),
  }),
);
