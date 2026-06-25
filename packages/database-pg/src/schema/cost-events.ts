/**
 * Cost event domain tables (PRD-02): cost_events, budget_policies.
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants, users } from "./core";
import { agents } from "./agents";

// ---------------------------------------------------------------------------
// 6.5 — cost_events (PRD-02 schema)
// ---------------------------------------------------------------------------

export const costEvents = pgTable(
  "cost_events",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id)
      .notNull(),
    agent_id: uuid("agent_id").references(() => agents.id),
    user_id: uuid("user_id").references(() => users.id),
    thread_id: uuid("thread_id"),
    request_id: text("request_id").notNull(),
    event_type: text("event_type").notNull(), // 'llm' | 'agentcore_compute'
    runtime_type: text("runtime_type"),
    amount_usd: numeric("amount_usd", { precision: 12, scale: 6 }).notNull(),
    model: text("model"),
    provider: text("provider"),
    input_tokens: integer("input_tokens"),
    output_tokens: integer("output_tokens"),
    cached_read_tokens: integer("cached_read_tokens"),
    duration_ms: integer("duration_ms"),
    trace_id: text("trace_id"),
    trace_event_id: uuid("trace_event_id"),
    reconciliation_state: text("reconciliation_state")
      .notNull()
      .default("runtime-reported"),
    reconciliation_source: text("reconciliation_source"),
    reconciliation_at: timestamp("reconciliation_at", { withTimezone: true }),
    source_evidence_ref: jsonb("source_evidence_ref"),
    billing_account_id: text("billing_account_id"),
    billing_service_code: text("billing_service_code"),
    billing_operation: text("billing_operation"),
    billing_period_start: timestamp("billing_period_start", {
      withTimezone: true,
    }),
    billing_period_end: timestamp("billing_period_end", {
      withTimezone: true,
    }),
    billing_attribution_level: text("billing_attribution_level"),
    metadata: jsonb("metadata"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_cost_events_tenant_created").on(
      table.tenant_id,
      table.created_at,
    ),
    index("idx_cost_events_agent_created").on(table.agent_id, table.created_at),
    index("idx_cost_events_user_created").on(
      table.tenant_id,
      table.user_id,
      table.created_at,
    ),
    uniqueIndex("uq_cost_events_request_type").on(
      table.request_id,
      table.event_type,
    ),
    index("idx_cost_events_thread").on(table.thread_id),
    index("idx_cost_events_runtime").on(table.tenant_id, table.runtime_type),
    index("idx_cost_events_trace").on(table.trace_id),
    index("idx_cost_events_trace_event").on(table.trace_event_id),
    index("idx_cost_events_reconciliation_state").on(
      table.tenant_id,
      table.reconciliation_state,
      table.created_at,
    ),
    index("idx_cost_events_billing_period").on(
      table.tenant_id,
      table.billing_service_code,
      table.billing_period_start,
    ),
    check(
      "cost_events_reconciliation_state_check",
      sql`${table.reconciliation_state} IN ('runtime-reported', 'invocation-reconciled', 'bill-reconciled', 'mismatch', 'unreconciled/error')`,
    ),
  ],
);

export const billingExportImports = pgTable(
  "billing_export_imports",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    provider: text("provider").notNull().default("aws"),
    source_type: text("source_type").notNull().default("aws_cur"),
    manifest_bucket: text("manifest_bucket").notNull(),
    manifest_key: text("manifest_key").notNull(),
    billing_period_start: timestamp("billing_period_start", {
      withTimezone: true,
    }).notNull(),
    billing_period_end: timestamp("billing_period_end", {
      withTimezone: true,
    }).notNull(),
    status: text("status").notNull().default("imported"),
    row_count: integer("row_count").notNull().default(0),
    error_count: integer("error_count").notNull().default(0),
    error_summary: text("error_summary"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    imported_at: timestamp("imported_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("billing_export_imports_manifest_uidx").on(
      table.provider,
      table.manifest_bucket,
      table.manifest_key,
    ),
    index("billing_export_imports_period_idx").on(
      table.provider,
      table.billing_period_start,
      table.billing_period_end,
    ),
    check(
      "billing_export_imports_status_check",
      sql`${table.status} IN ('imported', 'imported_with_errors', 'failed')`,
    ),
  ],
);

export const billingExportLineItems = pgTable(
  "billing_export_line_items",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    import_id: uuid("import_id")
      .notNull()
      .references(() => billingExportImports.id, { onDelete: "cascade" }),
    tenant_id: uuid("tenant_id").references(() => tenants.id, {
      onDelete: "set null",
    }),
    provider: text("provider").notNull().default("aws"),
    line_item_id: text("line_item_id").notNull(),
    usage_account_id: text("usage_account_id"),
    service_code: text("service_code").notNull(),
    operation: text("operation").notNull(),
    line_item_type: text("line_item_type"),
    usage_start: timestamp("usage_start", { withTimezone: true }).notNull(),
    usage_end: timestamp("usage_end", { withTimezone: true }).notNull(),
    billing_period_start: timestamp("billing_period_start", {
      withTimezone: true,
    }).notNull(),
    billing_period_end: timestamp("billing_period_end", {
      withTimezone: true,
    }).notNull(),
    amount_usd: numeric("amount_usd", { precision: 12, scale: 6 }).notNull(),
    usage_amount: numeric("usage_amount", { precision: 20, scale: 6 }),
    currency: text("currency").notNull().default("USD"),
    model: text("model").notNull().default("unknown"),
    region: text("region"),
    resource_id: text("resource_id"),
    attribution_level: text("attribution_level").notNull(),
    attribution_key: text("attribution_key").notNull(),
    source_uri: text("source_uri").notNull(),
    raw_row: jsonb("raw_row")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("billing_export_line_items_import_line_uidx").on(
      table.import_id,
      table.line_item_id,
    ),
    index("billing_export_line_items_period_idx").on(
      table.provider,
      table.billing_period_start,
      table.billing_period_end,
    ),
    index("billing_export_line_items_tenant_idx").on(
      table.tenant_id,
      table.service_code,
      table.billing_period_start,
    ),
    index("billing_export_line_items_attribution_idx").on(
      table.provider,
      table.attribution_level,
      table.attribution_key,
    ),
    check(
      "billing_export_line_items_attribution_check",
      sql`${table.attribution_level} IN ('tenant', 'account', 'service_window')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// 6.6 — budget_policies (unified tenant + agent + user scope)
// ---------------------------------------------------------------------------

export const budgetPolicies = pgTable(
  "budget_policies",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id)
      .notNull(),
    agent_id: uuid("agent_id").references(() => agents.id),
    user_id: uuid("user_id").references(() => users.id),
    scope: text("scope").notNull(), // 'tenant' | 'agent' | 'user'
    period: text("period").notNull().default("monthly"),
    limit_usd: numeric("limit_usd", { precision: 12, scale: 6 }).notNull(),
    action_on_exceed: text("action_on_exceed").notNull().default("pause"),
    enabled: boolean("enabled").notNull().default(true),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_budget_policies_tenant").on(table.tenant_id),
    index("idx_budget_policies_agent").on(table.agent_id),
    index("idx_budget_policies_user").on(table.tenant_id, table.user_id),
    check(
      "budget_policies_scope_shape_check",
      sql`(
        (${table.scope} = 'tenant' AND ${table.agent_id} IS NULL AND ${table.user_id} IS NULL)
        OR (${table.scope} = 'agent' AND ${table.agent_id} IS NOT NULL AND ${table.user_id} IS NULL)
        OR (${table.scope} = 'user' AND ${table.agent_id} IS NULL AND ${table.user_id} IS NOT NULL)
      )`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Relations (for Drizzle query builder)
// ---------------------------------------------------------------------------

export const costEventsRelations = relations(costEvents, ({ one }) => ({
  tenant: one(tenants, {
    fields: [costEvents.tenant_id],
    references: [tenants.id],
  }),
  agent: one(agents, {
    fields: [costEvents.agent_id],
    references: [agents.id],
  }),
  user: one(users, {
    fields: [costEvents.user_id],
    references: [users.id],
  }),
}));

export const billingExportImportsRelations = relations(
  billingExportImports,
  ({ many }) => ({
    lineItems: many(billingExportLineItems),
  }),
);

export const billingExportLineItemsRelations = relations(
  billingExportLineItems,
  ({ one }) => ({
    import: one(billingExportImports, {
      fields: [billingExportLineItems.import_id],
      references: [billingExportImports.id],
    }),
    tenant: one(tenants, {
      fields: [billingExportLineItems.tenant_id],
      references: [tenants.id],
    }),
  }),
);

export const budgetPoliciesRelations = relations(budgetPolicies, ({ one }) => ({
  tenant: one(tenants, {
    fields: [budgetPolicies.tenant_id],
    references: [tenants.id],
  }),
  agent: one(agents, {
    fields: [budgetPolicies.agent_id],
    references: [agents.id],
  }),
  user: one(users, {
    fields: [budgetPolicies.user_id],
    references: [users.id],
  }),
}));
