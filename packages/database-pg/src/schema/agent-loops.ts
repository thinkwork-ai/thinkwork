/**
 * AgentLoop product identity, version snapshots, and run ledger. EventBridge
 * scheduled_jobs rows remain schedule plumbing and bind back through
 * scheduled_jobs.agent_loop_id.
 */

import type {
  GoalSpec,
  LoopPolicy,
  TriggerSpec,
  WorkerSpec,
} from "@thinkwork/agent-loops-core";
import {
  bigint,
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
import { agents } from "./agents";
import { tenants, users } from "./core";
import { agentWakeupRequests } from "./heartbeats";
import { spaces } from "./spaces";
import { threadTurns } from "./scheduled-jobs";

export const AGENT_LOOP_LIFECYCLE_STATUSES = [
  "draft",
  "active",
  "paused",
  "archived",
] as const;

export type AgentLoopLifecycleStatus =
  (typeof AGENT_LOOP_LIFECYCLE_STATUSES)[number];

export const AGENT_LOOP_VERSION_STATUSES = [
  "draft",
  "active",
  "superseded",
  "archived",
] as const;

export type AgentLoopVersionStatus =
  (typeof AGENT_LOOP_VERSION_STATUSES)[number];

export const AGENT_LOOP_TRIGGER_FAMILIES = [
  "manual",
  "schedule",
  "api",
  "webhook",
  "app_event",
  "n8n",
] as const;

export type AgentLoopTriggerFamily =
  (typeof AGENT_LOOP_TRIGGER_FAMILIES)[number];

export const AGENT_LOOP_RUN_STATUSES = [
  "queued",
  "running",
  "waiting_for_human",
  "completed",
  "failed",
  "budget_stopped",
  "escalated",
  "canceled",
  "skipped",
] as const;

export type AgentLoopRunStatus = (typeof AGENT_LOOP_RUN_STATUSES)[number];

export const AGENT_LOOP_ITERATION_STATUSES = [
  "queued",
  "running",
  "waiting_for_human",
  "completed",
  "failed",
  "budget_stopped",
  "escalated",
  "canceled",
  "skipped",
] as const;

export type AgentLoopIterationStatus =
  (typeof AGENT_LOOP_ITERATION_STATUSES)[number];

export const agentLoops = pgTable(
  "agent_loops",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    lifecycle_status: text("lifecycle_status").notNull().default("draft"),
    enabled: boolean("enabled").notNull().default(true),
    owner_user_id: uuid("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    owner_agent_id: uuid("owner_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    // THINK-137 Automations: the user identity a run acts as (nullable).
    run_as_user_id: uuid("run_as_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    space_id: uuid("space_id").references(() => spaces.id, {
      onDelete: "set null",
    }),
    primary_trigger_family: text("primary_trigger_family")
      .notNull()
      .default("manual"),
    current_version_id: uuid("current_version_id"),
    current_version_number: integer("current_version_number"),
    last_run_id: uuid("last_run_id"),
    last_run_status: text("last_run_status"),
    last_run_at: timestamp("last_run_at", { withTimezone: true }),
    last_run_summary: jsonb("last_run_summary")
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
    uniqueIndex("agent_loops_tenant_slug_uidx").on(table.tenant_id, table.slug),
    index("agent_loops_tenant_lifecycle_idx").on(
      table.tenant_id,
      table.lifecycle_status,
    ),
    index("agent_loops_tenant_enabled_idx").on(table.tenant_id, table.enabled),
    index("agent_loops_tenant_space_idx").on(table.tenant_id, table.space_id),
    index("agent_loops_tenant_last_run_idx").on(
      table.tenant_id,
      table.last_run_at,
    ),
    check(
      "agent_loops_lifecycle_status_check",
      sql`${table.lifecycle_status} IN ('draft', 'active', 'paused', 'archived')`,
    ),
    check(
      "agent_loops_trigger_family_check",
      sql`${table.primary_trigger_family} IN ('manual', 'schedule', 'api', 'webhook', 'app_event', 'n8n')`,
    ),
  ],
);

export const agentLoopVersions = pgTable(
  "agent_loop_versions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    agent_loop_id: uuid("agent_loop_id")
      .notNull()
      .references(() => agentLoops.id, { onDelete: "cascade" }),
    version_number: integer("version_number").notNull(),
    version_status: text("version_status").notNull().default("draft"),
    trigger_spec: jsonb("trigger_spec").$type<TriggerSpec>().notNull(),
    // THINK-159: goal_spec/worker_spec/loop_policy are inert — target_spec is
    // the sole dispatch source. Nullable (migration 0215) so saveAgentLoop can
    // stop writing them; the columns are DROPPED in the follow-up PR.
    goal_spec: jsonb("goal_spec").$type<GoalSpec>(),
    worker_spec: jsonb("worker_spec").$type<WorkerSpec>(),
    loop_policy: jsonb("loop_policy").$type<LoopPolicy>(),
    // Deterministic routine actions (plan 2026-07-03-004 U5). Null on
    // versions without routine actions; {actions[], agentTurn} otherwise.
    routine_actions_spec: jsonb("routine_actions_spec"),
    // THINK-137 Automations target resolution spec (plan 2026-07-03 U1).
    // Nullable; populated by later units.
    target_spec: jsonb("target_spec"),
    source_metadata: jsonb("source_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    created_by_actor_type: text("created_by_actor_type"),
    created_by_actor_id: uuid("created_by_actor_id"),
    published_at: timestamp("published_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("agent_loop_versions_loop_version_uidx").on(
      table.agent_loop_id,
      table.version_number,
    ),
    index("agent_loop_versions_tenant_loop_idx").on(
      table.tenant_id,
      table.agent_loop_id,
    ),
    check(
      "agent_loop_versions_status_check",
      sql`${table.version_status} IN ('draft', 'active', 'superseded', 'archived')`,
    ),
  ],
);

export const agentLoopRuns = pgTable(
  "agent_loop_runs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    agent_loop_id: uuid("agent_loop_id")
      .notNull()
      .references(() => agentLoops.id, { onDelete: "cascade" }),
    agent_loop_version_id: uuid("agent_loop_version_id").references(
      () => agentLoopVersions.id,
      { onDelete: "set null" },
    ),
    status: text("status").notNull().default("queued"),
    trigger_family: text("trigger_family").notNull(),
    trigger_source: text("trigger_source"),
    scheduled_job_id: uuid("scheduled_job_id"),
    actor_type: text("actor_type"),
    actor_id: uuid("actor_id"),
    idempotency_key: text("idempotency_key"),
    correlation_id: text("correlation_id"),
    current_iteration: integer("current_iteration").notNull().default(0),
    terminal_reason: text("terminal_reason"),
    policy_snapshot: jsonb("policy_snapshot")
      .$type<LoopPolicy | Record<string, unknown>>()
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
    index("agent_loop_runs_tenant_status_idx").on(
      table.tenant_id,
      table.status,
    ),
    index("agent_loop_runs_loop_created_idx").on(
      table.agent_loop_id,
      table.created_at,
    ),
    index("agent_loop_runs_tenant_correlation_idx").on(
      table.tenant_id,
      table.correlation_id,
    ),
    uniqueIndex("agent_loop_runs_tenant_idempotency_uidx")
      .on(table.tenant_id, table.idempotency_key)
      .where(sql`${table.idempotency_key} IS NOT NULL`),
    check(
      "agent_loop_runs_status_check",
      sql`${table.status} IN ('queued', 'running', 'waiting_for_human', 'completed', 'failed', 'budget_stopped', 'escalated', 'canceled', 'skipped')`,
    ),
    check(
      "agent_loop_runs_trigger_family_check",
      sql`${table.trigger_family} IN ('manual', 'schedule', 'api', 'webhook', 'app_event', 'n8n')`,
    ),
  ],
);

export const agentLoopIterations = pgTable(
  "agent_loop_iterations",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    agent_loop_run_id: uuid("agent_loop_run_id")
      .notNull()
      .references(() => agentLoopRuns.id, { onDelete: "cascade" }),
    iteration_number: integer("iteration_number").notNull(),
    status: text("status").notNull().default("queued"),
    goal_mode_action: text("goal_mode_action"),
    agent_wakeup_request_id: uuid("agent_wakeup_request_id").references(
      () => agentWakeupRequests.id,
      { onDelete: "set null" },
    ),
    thread_turn_id: uuid("thread_turn_id").references(() => threadTurns.id, {
      onDelete: "set null",
    }),
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
    uniqueIndex("agent_loop_iterations_run_number_uidx").on(
      table.agent_loop_run_id,
      table.iteration_number,
    ),
    index("agent_loop_iterations_tenant_status_idx").on(
      table.tenant_id,
      table.status,
    ),
    index("agent_loop_iterations_wakeup_idx").on(table.agent_wakeup_request_id),
    index("agent_loop_iterations_thread_turn_idx").on(table.thread_turn_id),
    check(
      "agent_loop_iterations_status_check",
      sql`${table.status} IN ('queued', 'running', 'waiting_for_human', 'completed', 'failed', 'budget_stopped', 'escalated', 'canceled', 'skipped')`,
    ),
  ],
);

export const agentLoopsRelations = relations(agentLoops, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [agentLoops.tenant_id],
    references: [tenants.id],
  }),
  ownerUser: one(users, {
    fields: [agentLoops.owner_user_id],
    references: [users.id],
  }),
  ownerAgent: one(agents, {
    fields: [agentLoops.owner_agent_id],
    references: [agents.id],
  }),
  space: one(spaces, {
    fields: [agentLoops.space_id],
    references: [spaces.id],
  }),
  versions: many(agentLoopVersions),
  runs: many(agentLoopRuns),
}));

export const agentLoopVersionsRelations = relations(
  agentLoopVersions,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [agentLoopVersions.tenant_id],
      references: [tenants.id],
    }),
    agentLoop: one(agentLoops, {
      fields: [agentLoopVersions.agent_loop_id],
      references: [agentLoops.id],
    }),
  }),
);

export const agentLoopRunsRelations = relations(
  agentLoopRuns,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [agentLoopRuns.tenant_id],
      references: [tenants.id],
    }),
    agentLoop: one(agentLoops, {
      fields: [agentLoopRuns.agent_loop_id],
      references: [agentLoops.id],
    }),
    agentLoopVersion: one(agentLoopVersions, {
      fields: [agentLoopRuns.agent_loop_version_id],
      references: [agentLoopVersions.id],
    }),
    iterations: many(agentLoopIterations),
  }),
);

export const agentLoopIterationsRelations = relations(
  agentLoopIterations,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [agentLoopIterations.tenant_id],
      references: [tenants.id],
    }),
    agentLoopRun: one(agentLoopRuns, {
      fields: [agentLoopIterations.agent_loop_run_id],
      references: [agentLoopRuns.id],
    }),
    wakeupRequest: one(agentWakeupRequests, {
      fields: [agentLoopIterations.agent_wakeup_request_id],
      references: [agentWakeupRequests.id],
    }),
    threadTurn: one(threadTurns, {
      fields: [agentLoopIterations.thread_turn_id],
      references: [threadTurns.id],
    }),
  }),
);
