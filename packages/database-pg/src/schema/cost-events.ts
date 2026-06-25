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
    check(
      "cost_events_reconciliation_state_check",
      sql`${table.reconciliation_state} IN ('runtime-reported', 'invocation-reconciled', 'bill-reconciled', 'mismatch', 'unreconciled/error')`,
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
