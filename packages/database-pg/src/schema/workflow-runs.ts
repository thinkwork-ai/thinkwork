/**
 * Workflow run ledger, events, and evidence.
 *
 * These tables are the product-level execution ledger. Backend-specific
 * histories (Step Functions executions, n8n executions, CRM events, logs, and
 * traces) attach as evidence/correlation rather than replacing this ledger.
 */

import {
  bigint,
  bigserial,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants } from "./core";
import { workflowEngineBindings } from "./workflow-bindings";
import { workflowVersions, workflows } from "./workflows";

export const WORKFLOW_RUN_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "canceled",
  "timed_out",
  "blocked_not_ready",
] as const;

export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];

export const WORKFLOW_EVENT_PROVENANCE = [
  "native_event",
  "app_callback",
  "engine_history",
  "output_inferred",
  "operator_decision",
] as const;

export type WorkflowEventProvenance =
  (typeof WORKFLOW_EVENT_PROVENANCE)[number];

export const WORKFLOW_EVIDENCE_REDACTION_STATES = [
  "summary_only",
  "redacted",
  "offloaded",
  "raw_allowed",
] as const;

export type WorkflowEvidenceRedactionState =
  (typeof WORKFLOW_EVIDENCE_REDACTION_STATES)[number];

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    workflow_id: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    workflow_version_id: uuid("workflow_version_id").references(
      () => workflowVersions.id,
      { onDelete: "set null" },
    ),
    engine_binding_id: uuid("engine_binding_id").references(
      () => workflowEngineBindings.id,
      { onDelete: "set null" },
    ),
    status: text("status").notNull().default("queued"),
    trigger_family: text("trigger_family").notNull(),
    trigger_source: text("trigger_source"),
    actor_type: text("actor_type"),
    actor_id: uuid("actor_id"),
    idempotency_key: text("idempotency_key"),
    correlation_id: text("correlation_id"),
    backend_execution_id: text("backend_execution_id"),
    backend_execution_ref: jsonb("backend_execution_ref")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    capability_snapshot: jsonb("capability_snapshot")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    readiness_snapshot: jsonb("readiness_snapshot")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    input_summary: jsonb("input_summary").$type<Record<
      string,
      unknown
    > | null>(),
    output_summary: jsonb("output_summary").$type<Record<
      string,
      unknown
    > | null>(),
    started_at: timestamp("started_at", { withTimezone: true }),
    finished_at: timestamp("finished_at", { withTimezone: true }),
    last_event_at: timestamp("last_event_at", { withTimezone: true }),
    error_code: text("error_code"),
    error_message: text("error_message"),
    total_cost_usd_cents: bigint("total_cost_usd_cents", { mode: "number" }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("workflow_runs_tenant_status_idx").on(table.tenant_id, table.status),
    index("workflow_runs_workflow_created_idx").on(
      table.workflow_id,
      table.created_at,
    ),
    index("workflow_runs_tenant_correlation_idx").on(
      table.tenant_id,
      table.correlation_id,
    ),
    uniqueIndex("workflow_runs_tenant_idempotency_uidx")
      .on(table.tenant_id, table.idempotency_key)
      .where(sql`${table.idempotency_key} IS NOT NULL`),
    check(
      "workflow_runs_status_check",
      sql`${table.status} IN ('queued', 'running', 'succeeded', 'failed', 'canceled', 'timed_out', 'blocked_not_ready')`,
    ),
  ],
);

export const workflowRunEvents = pgTable(
  "workflow_run_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    workflow_run_id: uuid("workflow_run_id")
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    event_type: text("event_type").notNull(),
    event_status: text("event_status"),
    provenance: text("provenance").notNull(),
    occurred_at: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    message: text("message"),
    payload_summary: jsonb("payload_summary")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    evidence_ref: jsonb("evidence_ref")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("workflow_run_events_run_occurred_idx").on(
      table.workflow_run_id,
      table.occurred_at,
    ),
    index("workflow_run_events_tenant_type_idx").on(
      table.tenant_id,
      table.event_type,
    ),
    check(
      "workflow_run_events_provenance_check",
      sql`${table.provenance} IN ('native_event', 'app_callback', 'engine_history', 'output_inferred', 'operator_decision')`,
    ),
  ],
);

export const workflowEvidence = pgTable(
  "workflow_evidence",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    workflow_id: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    workflow_run_id: uuid("workflow_run_id").references(() => workflowRuns.id, {
      onDelete: "cascade",
    }),
    evidence_type: text("evidence_type").notNull(),
    source_system: text("source_system").notNull(),
    source_id: text("source_id"),
    uri: text("uri"),
    summary: jsonb("summary")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    redaction_state: text("redaction_state").notNull().default("summary_only"),
    sensitivity: text("sensitivity"),
    retention_expires_at: timestamp("retention_expires_at", {
      withTimezone: true,
    }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("workflow_evidence_run_idx").on(table.workflow_run_id),
    index("workflow_evidence_workflow_idx").on(table.workflow_id),
    index("workflow_evidence_source_idx").on(
      table.tenant_id,
      table.source_system,
      table.source_id,
    ),
    check(
      "workflow_evidence_redaction_state_check",
      sql`${table.redaction_state} IN ('summary_only', 'redacted', 'offloaded', 'raw_allowed')`,
    ),
  ],
);

export const workflowRunsRelations = relations(
  workflowRuns,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [workflowRuns.tenant_id],
      references: [tenants.id],
    }),
    workflow: one(workflows, {
      fields: [workflowRuns.workflow_id],
      references: [workflows.id],
    }),
    workflowVersion: one(workflowVersions, {
      fields: [workflowRuns.workflow_version_id],
      references: [workflowVersions.id],
    }),
    engineBinding: one(workflowEngineBindings, {
      fields: [workflowRuns.engine_binding_id],
      references: [workflowEngineBindings.id],
    }),
    events: many(workflowRunEvents),
    evidence: many(workflowEvidence),
  }),
);

export const workflowRunEventsRelations = relations(
  workflowRunEvents,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [workflowRunEvents.tenant_id],
      references: [tenants.id],
    }),
    workflowRun: one(workflowRuns, {
      fields: [workflowRunEvents.workflow_run_id],
      references: [workflowRuns.id],
    }),
  }),
);

export const workflowEvidenceRelations = relations(
  workflowEvidence,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [workflowEvidence.tenant_id],
      references: [tenants.id],
    }),
    workflow: one(workflows, {
      fields: [workflowEvidence.workflow_id],
      references: [workflows.id],
    }),
    workflowRun: one(workflowRuns, {
      fields: [workflowEvidence.workflow_run_id],
      references: [workflowRuns.id],
    }),
  }),
);
