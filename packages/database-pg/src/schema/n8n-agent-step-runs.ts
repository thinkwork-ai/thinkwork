/**
 * n8n agent-step bridge ledger.
 *
 * One row represents one durable n8n -> ThinkWork agent step, keyed by
 * tenant/workflow/execution/correlation/step idempotency. The row owns bridge
 * lifecycle state, thread linkage, expiry, sanitized audit metadata, and
 * callback resume evidence. Secret callback URL material is intentionally held
 * by reference only.
 *
 * Plan: docs/plans/2026-06-20-001-feat-n8n-agent-step-bridge-plan.md (U1).
 */

import {
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
import { tenants } from "./core";
import { managedApplications } from "./deployments";
import { messages } from "./messages";
import { pluginInstalls } from "./plugins";
import { threadTurns } from "./scheduled-jobs";
import { spaces } from "./spaces";
import { threads } from "./threads";

export const N8N_AGENT_STEP_RUN_STATUSES = [
  "accepted",
  "waiting",
  "awaiting_human",
  "resume_pending",
  "resuming",
  "resumed",
  "resume_failed",
  "failed",
  "expired",
] as const;

export type N8nAgentStepRunStatus =
  (typeof N8N_AGENT_STEP_RUN_STATUSES)[number];

export const N8N_AGENT_STEP_RESUME_STATUSES = [
  "not_ready",
  "pending",
  "resuming",
  "resumed",
  "failed",
] as const;

export type N8nAgentStepResumeStatus =
  (typeof N8N_AGENT_STEP_RESUME_STATUSES)[number];

export const n8nAgentStepRuns = pgTable(
  "n8n_agent_step_runs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    plugin_install_id: uuid("plugin_install_id").references(
      () => pluginInstalls.id,
      { onDelete: "set null" },
    ),
    managed_application_id: uuid("managed_application_id").references(
      () => managedApplications.id,
      { onDelete: "set null" },
    ),
    space_id: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "restrict" }),
    agent_id: uuid("agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    thread_id: uuid("thread_id").references(() => threads.id, {
      onDelete: "set null",
    }),
    thread_turn_id: uuid("thread_turn_id").references(() => threadTurns.id, {
      onDelete: "set null",
    }),
    opening_message_id: uuid("opening_message_id").references(
      () => messages.id,
      { onDelete: "set null" },
    ),
    status: text("status").notNull().default("accepted"),
    resume_status: text("resume_status").notNull().default("not_ready"),

    workflow_id: text("workflow_id").notNull(),
    workflow_name: text("workflow_name"),
    execution_id: text("execution_id").notNull(),
    step_id: text("step_id").notNull(),
    correlation_id: text("correlation_id").notNull(),
    request_id: text("request_id"),
    idempotency_key: text("idempotency_key").notNull(),

    instructions_preview: text("instructions_preview"),
    input_preview: text("input_preview"),
    request_metadata: jsonb("request_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),

    resume_url_secret_ref: text("resume_url_secret_ref"),
    resume_url_host: text("resume_url_host"),
    resume_url_path: text("resume_url_path"),
    timeout_seconds: integer("timeout_seconds").notNull(),
    expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),

    result_payload: jsonb("result_payload").$type<Record<
      string,
      unknown
    > | null>(),
    output_payload: jsonb("output_payload").$type<Record<
      string,
      unknown
    > | null>(),
    error_payload: jsonb("error_payload").$type<Record<
      string,
      unknown
    > | null>(),
    summary: text("summary"),
    links: jsonb("links").$type<Record<string, unknown> | null>(),

    resume_attempt_count: integer("resume_attempt_count").notNull().default(0),
    next_resume_attempt_at: timestamp("next_resume_attempt_at", {
      withTimezone: true,
    }),
    last_resume_attempt_at: timestamp("last_resume_attempt_at", {
      withTimezone: true,
    }),
    last_resume_http_status: integer("last_resume_http_status"),
    last_resume_error: text("last_resume_error"),
    resumed_at: timestamp("resumed_at", { withTimezone: true }),
    terminal_at: timestamp("terminal_at", { withTimezone: true }),
    accepted_at: timestamp("accepted_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("n8n_agent_step_runs_tenant_idempotency_uidx").on(
      table.tenant_id,
      table.idempotency_key,
    ),
    index("n8n_agent_step_runs_tenant_status_idx").on(
      table.tenant_id,
      table.status,
    ),
    index("n8n_agent_step_runs_thread_idx").on(
      table.tenant_id,
      table.thread_id,
    ),
    index("n8n_agent_step_runs_n8n_execution_idx").on(
      table.tenant_id,
      table.workflow_id,
      table.execution_id,
    ),
    index("n8n_agent_step_runs_due_expiry_idx")
      .on(table.tenant_id, table.expires_at)
      .where(sql`${table.status} IN ('accepted', 'waiting', 'awaiting_human')`),
    index("n8n_agent_step_runs_resume_pending_idx")
      .on(table.tenant_id, table.next_resume_attempt_at)
      .where(sql`${table.status} = 'resume_pending'`),
    check(
      "n8n_agent_step_runs_status_check",
      sql`${table.status} IN ('accepted', 'waiting', 'awaiting_human', 'resume_pending', 'resuming', 'resumed', 'resume_failed', 'failed', 'expired')`,
    ),
    check(
      "n8n_agent_step_runs_resume_status_check",
      sql`${table.resume_status} IN ('not_ready', 'pending', 'resuming', 'resumed', 'failed')`,
    ),
    check(
      "n8n_agent_step_runs_timeout_bounds_check",
      sql`${table.timeout_seconds} BETWEEN 300 AND 604800`,
    ),
    check(
      "n8n_agent_step_runs_terminal_state_check",
      sql`(${table.status} NOT IN ('resumed', 'resume_failed', 'failed', 'expired')) OR ${table.terminal_at} IS NOT NULL`,
    ),
  ],
);

export const n8nAgentStepRunsRelations = relations(
  n8nAgentStepRuns,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [n8nAgentStepRuns.tenant_id],
      references: [tenants.id],
    }),
    pluginInstall: one(pluginInstalls, {
      fields: [n8nAgentStepRuns.plugin_install_id],
      references: [pluginInstalls.id],
    }),
    managedApplication: one(managedApplications, {
      fields: [n8nAgentStepRuns.managed_application_id],
      references: [managedApplications.id],
    }),
    space: one(spaces, {
      fields: [n8nAgentStepRuns.space_id],
      references: [spaces.id],
    }),
    agent: one(agents, {
      fields: [n8nAgentStepRuns.agent_id],
      references: [agents.id],
    }),
    thread: one(threads, {
      fields: [n8nAgentStepRuns.thread_id],
      references: [threads.id],
    }),
    threadTurn: one(threadTurns, {
      fields: [n8nAgentStepRuns.thread_turn_id],
      references: [threadTurns.id],
    }),
    openingMessage: one(messages, {
      fields: [n8nAgentStepRuns.opening_message_id],
      references: [messages.id],
    }),
  }),
);
