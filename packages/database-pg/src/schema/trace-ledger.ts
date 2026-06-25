/**
 * Canonical trace and cost accounting substrate.
 *
 * Product surfaces should project from this ledger while AWS/Bedrock/CUR remain
 * source-evidence inputs. The tables are intentionally append/evidence oriented
 * so reconciliation can preserve original runtime observations.
 */

import {
  bigserial,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { agents } from "./agents";
import { costEvents } from "./cost-events";
import { tenants, users } from "./core";
import { threadTurns } from "./scheduled-jobs";

export const TRACE_EVENT_TYPES = [
  "turn",
  "runtime_phase",
  "model_invocation",
  "tool_invocation",
  "memory_context_lookup",
  "workspace_hydration",
  "response_finalization",
  "agent_profile_run",
  "sub_agent_lane",
  "cost_observation",
] as const;

export type TraceEventType = (typeof TRACE_EVENT_TYPES)[number];

export const TRACE_SOURCE_TYPES = [
  "runtime",
  "agentcore_span",
  "bedrock_invocation_log",
  "aws_cur",
  "operator",
  "backfill",
] as const;

export type TraceSourceType = (typeof TRACE_SOURCE_TYPES)[number];

export const TRACE_RECONCILIATION_STATES = [
  "runtime-reported",
  "invocation-reconciled",
  "bill-reconciled",
  "mismatch",
  "unreconciled/error",
] as const;

export type TraceReconciliationState =
  (typeof TRACE_RECONCILIATION_STATES)[number];

export const TRACE_RECONCILIATION_SCOPES = [
  "runtime",
  "invocation",
  "bill",
  "aggregate",
  "operator_resolution",
] as const;

export type TraceReconciliationScope =
  (typeof TRACE_RECONCILIATION_SCOPES)[number];

export const traceRuns = pgTable(
  "trace_runs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    trace_id: text("trace_id").notNull(),
    thread_id: uuid("thread_id"),
    thread_turn_id: uuid("thread_turn_id").references(() => threadTurns.id, {
      onDelete: "set null",
    }),
    agent_id: uuid("agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    user_id: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    runtime_type: text("runtime_type"),
    runtime_session_id: text("runtime_session_id"),
    status: text("status").notNull().default("open"),
    started_at: timestamp("started_at", { withTimezone: true }),
    finished_at: timestamp("finished_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("trace_runs_tenant_trace_uidx").on(
      table.tenant_id,
      table.trace_id,
    ),
    index("trace_runs_thread_turn_idx").on(table.thread_turn_id),
    index("trace_runs_thread_idx").on(table.tenant_id, table.thread_id),
    index("trace_runs_agent_created_idx").on(table.agent_id, table.created_at),
  ],
);

export const traceEvents = pgTable(
  "trace_events",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    trace_run_id: uuid("trace_run_id")
      .notNull()
      .references(() => traceRuns.id, { onDelete: "cascade" }),
    parent_event_id: uuid("parent_event_id").references(
      (): any => traceEvents.id,
      { onDelete: "set null" },
    ),
    thread_turn_id: uuid("thread_turn_id").references(() => threadTurns.id, {
      onDelete: "set null",
    }),
    request_id: text("request_id"),
    parent_request_id: text("parent_request_id"),
    event_type: text("event_type").notNull(),
    event_status: text("event_status"),
    observed_at: timestamp("observed_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    duration_ms: integer("duration_ms"),
    payload_summary: jsonb("payload_summary")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    source_evidence_ref: jsonb("source_evidence_ref")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("trace_events_run_observed_idx").on(
      table.trace_run_id,
      table.observed_at,
    ),
    index("trace_events_parent_idx").on(table.parent_event_id),
    index("trace_events_request_idx").on(table.tenant_id, table.request_id),
    index("trace_events_turn_type_idx").on(
      table.thread_turn_id,
      table.event_type,
    ),
    check(
      "trace_events_type_check",
      sql`${table.event_type} IN ('turn', 'runtime_phase', 'model_invocation', 'tool_invocation', 'memory_context_lookup', 'workspace_hydration', 'response_finalization', 'agent_profile_run', 'sub_agent_lane', 'cost_observation')`,
    ),
  ],
);

export const traceSourceEvidence = pgTable(
  "trace_source_evidence",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    trace_run_id: uuid("trace_run_id").references(() => traceRuns.id, {
      onDelete: "cascade",
    }),
    trace_event_id: uuid("trace_event_id").references(() => traceEvents.id, {
      onDelete: "cascade",
    }),
    source_type: text("source_type").notNull(),
    source_system: text("source_system").notNull(),
    source_id: text("source_id"),
    uri: text("uri"),
    observed_at: timestamp("observed_at", { withTimezone: true }),
    summary: jsonb("summary")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    redaction_state: text("redaction_state").notNull().default("summary_only"),
    retention_expires_at: timestamp("retention_expires_at", {
      withTimezone: true,
    }),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("trace_source_evidence_run_idx").on(table.trace_run_id),
    index("trace_source_evidence_event_idx").on(table.trace_event_id),
    index("trace_source_evidence_source_idx").on(
      table.tenant_id,
      table.source_type,
      table.source_id,
    ),
    check(
      "trace_source_evidence_source_type_check",
      sql`${table.source_type} IN ('runtime', 'agentcore_span', 'bedrock_invocation_log', 'aws_cur', 'operator', 'backfill')`,
    ),
  ],
);

export const traceCostReconciliationFacts = pgTable(
  "trace_cost_reconciliation_facts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    trace_run_id: uuid("trace_run_id").references(() => traceRuns.id, {
      onDelete: "cascade",
    }),
    trace_event_id: uuid("trace_event_id").references(() => traceEvents.id, {
      onDelete: "set null",
    }),
    cost_event_id: uuid("cost_event_id").references(() => costEvents.id, {
      onDelete: "set null",
    }),
    source_evidence_id: uuid("source_evidence_id").references(
      () => traceSourceEvidence.id,
      { onDelete: "set null" },
    ),
    reconciliation_state: text("reconciliation_state").notNull(),
    reconciliation_scope: text("reconciliation_scope").notNull(),
    provider: text("provider"),
    model: text("model"),
    request_id: text("request_id"),
    attribution_level: text("attribution_level"),
    runtime_input_tokens: integer("runtime_input_tokens"),
    runtime_output_tokens: integer("runtime_output_tokens"),
    runtime_cached_read_tokens: integer("runtime_cached_read_tokens"),
    provider_input_tokens: integer("provider_input_tokens"),
    provider_output_tokens: integer("provider_output_tokens"),
    provider_cached_read_tokens: integer("provider_cached_read_tokens"),
    runtime_amount_usd: numeric("runtime_amount_usd", {
      precision: 12,
      scale: 6,
    }),
    provider_amount_usd: numeric("provider_amount_usd", {
      precision: 12,
      scale: 6,
    }),
    billed_amount_usd: numeric("billed_amount_usd", {
      precision: 12,
      scale: 6,
    }),
    variance_usd: numeric("variance_usd", { precision: 12, scale: 6 }),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    reconciled_at: timestamp("reconciled_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("trace_cost_recon_facts_cost_event_idx").on(table.cost_event_id),
    index("trace_cost_recon_facts_trace_event_idx").on(table.trace_event_id),
    index("trace_cost_recon_facts_state_idx").on(
      table.tenant_id,
      table.reconciliation_state,
      table.reconciled_at,
    ),
    index("trace_cost_recon_facts_request_idx").on(
      table.tenant_id,
      table.provider,
      table.request_id,
    ),
    check(
      "trace_cost_recon_facts_state_check",
      sql`${table.reconciliation_state} IN ('runtime-reported', 'invocation-reconciled', 'bill-reconciled', 'mismatch', 'unreconciled/error')`,
    ),
    check(
      "trace_cost_recon_facts_scope_check",
      sql`${table.reconciliation_scope} IN ('runtime', 'invocation', 'bill', 'aggregate', 'operator_resolution')`,
    ),
  ],
);

export const traceRunsRelations = relations(traceRuns, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [traceRuns.tenant_id],
    references: [tenants.id],
  }),
  agent: one(agents, {
    fields: [traceRuns.agent_id],
    references: [agents.id],
  }),
  user: one(users, {
    fields: [traceRuns.user_id],
    references: [users.id],
  }),
  threadTurn: one(threadTurns, {
    fields: [traceRuns.thread_turn_id],
    references: [threadTurns.id],
  }),
  events: many(traceEvents),
  sourceEvidence: many(traceSourceEvidence),
  reconciliationFacts: many(traceCostReconciliationFacts),
}));

export const traceEventsRelations = relations(traceEvents, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [traceEvents.tenant_id],
    references: [tenants.id],
  }),
  traceRun: one(traceRuns, {
    fields: [traceEvents.trace_run_id],
    references: [traceRuns.id],
  }),
  parentEvent: one(traceEvents, {
    fields: [traceEvents.parent_event_id],
    references: [traceEvents.id],
  }),
  threadTurn: one(threadTurns, {
    fields: [traceEvents.thread_turn_id],
    references: [threadTurns.id],
  }),
  sourceEvidence: many(traceSourceEvidence),
  reconciliationFacts: many(traceCostReconciliationFacts),
}));

export const traceSourceEvidenceRelations = relations(
  traceSourceEvidence,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [traceSourceEvidence.tenant_id],
      references: [tenants.id],
    }),
    traceRun: one(traceRuns, {
      fields: [traceSourceEvidence.trace_run_id],
      references: [traceRuns.id],
    }),
    traceEvent: one(traceEvents, {
      fields: [traceSourceEvidence.trace_event_id],
      references: [traceEvents.id],
    }),
    reconciliationFacts: many(traceCostReconciliationFacts),
  }),
);

export const traceCostReconciliationFactsRelations = relations(
  traceCostReconciliationFacts,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [traceCostReconciliationFacts.tenant_id],
      references: [tenants.id],
    }),
    traceRun: one(traceRuns, {
      fields: [traceCostReconciliationFacts.trace_run_id],
      references: [traceRuns.id],
    }),
    traceEvent: one(traceEvents, {
      fields: [traceCostReconciliationFacts.trace_event_id],
      references: [traceEvents.id],
    }),
    costEvent: one(costEvents, {
      fields: [traceCostReconciliationFacts.cost_event_id],
      references: [costEvents.id],
    }),
    sourceEvidence: one(traceSourceEvidence, {
      fields: [traceCostReconciliationFacts.source_evidence_id],
      references: [traceSourceEvidence.id],
    }),
  }),
);
