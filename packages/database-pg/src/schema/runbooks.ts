/**
 * Computer runbook catalog and execution state.
 *
 * Runbook-capable Computer skills live in workspace/skills/<slug>/ and the
 * packaged skill catalog. These compatibility tables preserve catalog/run
 * state and immutable skill snapshots for auditability.
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  boolean,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants, users } from "./core";
import { computers } from "./computers";
import { messages } from "./messages";
import { threads } from "./threads";

export const RUNBOOK_CATALOG_STATUSES = [
  "active",
  "unavailable",
  "archived",
] as const;
export type RunbookCatalogStatus = (typeof RUNBOOK_CATALOG_STATUSES)[number];

export const RUNBOOK_RUN_STATUSES = [
  "awaiting_confirmation",
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "rejected",
] as const;
export type RunbookRunStatus = (typeof RUNBOOK_RUN_STATUSES)[number];

export const RUNBOOK_INVOCATION_MODES = ["auto", "explicit", "ad_hoc"] as const;
export type RunbookInvocationMode = (typeof RUNBOOK_INVOCATION_MODES)[number];

export const RUNBOOK_TASK_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
  "cancelled",
] as const;
export type RunbookTaskStatus = (typeof RUNBOOK_TASK_STATUSES)[number];

export const tenantRunbookCatalog = pgTable(
  "tenant_runbook_catalog",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    slug: text("slug").notNull(),
    source_version: text("source_version").notNull(),
    display_name: text("display_name").notNull(),
    description: text("description").notNull(),
    category: text("category").notNull(),
    status: text("status").notNull().default("active"),
    enabled: boolean("enabled").notNull().default(true),
    definition: jsonb("definition").notNull(),
    operator_overrides: jsonb("operator_overrides"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("tenant_runbook_catalog_tenant_slug_uq").on(
      table.tenant_id,
      table.slug,
    ),
    index("idx_tenant_runbook_catalog_tenant_status").on(
      table.tenant_id,
      table.status,
    ),
    check(
      "tenant_runbook_catalog_status_allowed",
      sql`${table.status} IN ('active','unavailable','archived')`,
    ),
  ],
);

export const computerRunbookRuns = pgTable(
  "computer_runbook_runs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    computer_id: uuid("computer_id")
      .references(() => computers.id, { onDelete: "cascade" })
      .notNull(),
    thread_id: uuid("thread_id").references(() => threads.id, {
      onDelete: "set null",
    }),
    catalog_id: uuid("catalog_id").references(() => tenantRunbookCatalog.id, {
      onDelete: "set null",
    }),
    runbook_slug: text("runbook_slug").notNull(),
    runbook_version: text("runbook_version").notNull(),
    status: text("status").notNull().default("awaiting_confirmation"),
    invocation_mode: text("invocation_mode").notNull().default("auto"),
    selected_by_message_id: uuid("selected_by_message_id").references(
      () => messages.id,
      { onDelete: "set null" },
    ),
    approved_by_user_id: uuid("approved_by_user_id").references(
      () => users.id,
      {
        onDelete: "set null",
      },
    ),
    rejected_by_user_id: uuid("rejected_by_user_id").references(
      () => users.id,
      {
        onDelete: "set null",
      },
    ),
    cancelled_by_user_id: uuid("cancelled_by_user_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    definition_snapshot: jsonb("definition_snapshot").notNull(),
    inputs: jsonb("inputs").notNull().default({}),
    output: jsonb("output"),
    error: jsonb("error"),
    idempotency_key: text("idempotency_key"),
    approved_at: timestamp("approved_at", { withTimezone: true }),
    rejected_at: timestamp("rejected_at", { withTimezone: true }),
    cancelled_at: timestamp("cancelled_at", { withTimezone: true }),
    started_at: timestamp("started_at", { withTimezone: true }),
    completed_at: timestamp("completed_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_computer_runbook_runs_tenant_status").on(
      table.tenant_id,
      table.status,
    ),
    index("idx_computer_runbook_runs_computer_created").on(
      table.computer_id,
      table.created_at,
    ),
    uniqueIndex("computer_runbook_runs_tenant_computer_idempotency_uq")
      .on(table.tenant_id, table.computer_id, table.idempotency_key)
      .where(sql`${table.idempotency_key} IS NOT NULL`),
    check(
      "computer_runbook_runs_status_allowed",
      sql`${table.status} IN ('awaiting_confirmation','queued','running','completed','failed','cancelled','rejected')`,
    ),
    check(
      "computer_runbook_runs_invocation_mode_allowed",
      sql`${table.invocation_mode} IN ('auto','explicit','ad_hoc')`,
    ),
  ],
);

export const computerRunbookTasks = pgTable(
  "computer_runbook_tasks",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    run_id: uuid("run_id")
      .references(() => computerRunbookRuns.id, { onDelete: "cascade" })
      .notNull(),
    phase_id: text("phase_id").notNull(),
    phase_title: text("phase_title").notNull(),
    task_key: text("task_key").notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    status: text("status").notNull().default("pending"),
    depends_on: jsonb("depends_on").notNull().default([]),
    capability_roles: jsonb("capability_roles").notNull().default([]),
    sort_order: integer("sort_order").notNull(),
    details: jsonb("details"),
    output: jsonb("output"),
    error: jsonb("error"),
    started_at: timestamp("started_at", { withTimezone: true }),
    completed_at: timestamp("completed_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("computer_runbook_tasks_run_task_key_uq").on(
      table.run_id,
      table.task_key,
    ),
    index("idx_computer_runbook_tasks_run_order").on(
      table.run_id,
      table.sort_order,
    ),
    index("idx_computer_runbook_tasks_tenant_status").on(
      table.tenant_id,
      table.status,
    ),
    check(
      "computer_runbook_tasks_status_allowed",
      sql`${table.status} IN ('pending','running','completed','failed','skipped','cancelled')`,
    ),
  ],
);

export const tenantRunbookCatalogRelations = relations(
  tenantRunbookCatalog,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [tenantRunbookCatalog.tenant_id],
      references: [tenants.id],
    }),
    runs: many(computerRunbookRuns),
  }),
);

export const computerRunbookRunsRelations = relations(
  computerRunbookRuns,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [computerRunbookRuns.tenant_id],
      references: [tenants.id],
    }),
    computer: one(computers, {
      fields: [computerRunbookRuns.computer_id],
      references: [computers.id],
    }),
    thread: one(threads, {
      fields: [computerRunbookRuns.thread_id],
      references: [threads.id],
    }),
    catalogItem: one(tenantRunbookCatalog, {
      fields: [computerRunbookRuns.catalog_id],
      references: [tenantRunbookCatalog.id],
    }),
    selectedByMessage: one(messages, {
      fields: [computerRunbookRuns.selected_by_message_id],
      references: [messages.id],
    }),
    tasks: many(computerRunbookTasks),
  }),
);

export const computerRunbookTasksRelations = relations(
  computerRunbookTasks,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [computerRunbookTasks.tenant_id],
      references: [tenants.id],
    }),
    run: one(computerRunbookRuns, {
      fields: [computerRunbookTasks.run_id],
      references: [computerRunbookRuns.id],
    }),
  }),
);
