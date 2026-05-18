/**
 * Requester idle memory learning tables.
 *
 * These rows coordinate the one-time "Thread has been idle for 15 minutes"
 * trigger and preserve an auditable run history for automatic requester-memory
 * updates. The learned memory itself lives in requester-scoped markdown files;
 * these tables only track orchestration, status, and report pointers.
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants, users } from "./core";
import { threads } from "./threads";
import { computers } from "./computers";
import { scheduledJobs } from "./scheduled-jobs";

export const threadIdleLearningState = pgTable(
  "thread_idle_learning_state",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    thread_id: uuid("thread_id")
      .references(() => threads.id, { onDelete: "cascade" })
      .notNull(),
    computer_id: uuid("computer_id").references(() => computers.id, {
      onDelete: "set null",
    }),
    requester_user_id: uuid("requester_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    activity_sequence: integer("activity_sequence").notNull().default(0),
    last_activity_at: timestamp("last_activity_at", {
      withTimezone: true,
    }).notNull(),
    scheduled_for: timestamp("scheduled_for", { withTimezone: true }),
    scheduled_job_id: uuid("scheduled_job_id").references(
      () => scheduledJobs.id,
      {
        onDelete: "set null",
      },
    ),
    status: text("status").notNull().default("idle_scheduled"),
    last_run_id: uuid("last_run_id"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_thread_idle_learning_state_thread").on(table.thread_id),
    index("idx_thread_idle_learning_state_tenant_requester").on(
      table.tenant_id,
      table.requester_user_id,
      table.updated_at,
    ),
    index("idx_thread_idle_learning_state_tenant_status_scheduled").on(
      table.tenant_id,
      table.status,
      table.scheduled_for,
    ),
    index("idx_thread_idle_learning_state_scheduled_job").on(
      table.scheduled_job_id,
    ),
    check(
      "thread_idle_learning_state_status_allowed",
      sql`${table.status} IN ('idle_scheduled','running','stale','changed','no_change','failed','disabled')`,
    ),
  ],
);

export const threadIdleLearningRuns = pgTable(
  "thread_idle_learning_runs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    thread_id: uuid("thread_id")
      .references(() => threads.id, { onDelete: "cascade" })
      .notNull(),
    computer_id: uuid("computer_id").references(() => computers.id, {
      onDelete: "set null",
    }),
    requester_user_id: uuid("requester_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    scheduled_job_id: uuid("scheduled_job_id").references(
      () => scheduledJobs.id,
      {
        onDelete: "set null",
      },
    ),
    activity_sequence: integer("activity_sequence").notNull(),
    scheduled_for: timestamp("scheduled_for", { withTimezone: true }),
    started_at: timestamp("started_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    finished_at: timestamp("finished_at", { withTimezone: true }),
    status: text("status").notNull().default("running"),
    changed_files: jsonb("changed_files"),
    candidate_summary: jsonb("candidate_summary"),
    report_s3_key: text("report_s3_key"),
    error: text("error"),
    budget: jsonb("budget"),
    metadata: jsonb("metadata"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_thread_idle_learning_runs_thread_created").on(
      table.tenant_id,
      table.thread_id,
      table.created_at,
    ),
    index("idx_thread_idle_learning_runs_requester_created").on(
      table.tenant_id,
      table.requester_user_id,
      table.created_at,
    ),
    index("idx_thread_idle_learning_runs_status").on(
      table.tenant_id,
      table.status,
    ),
    index("idx_thread_idle_learning_runs_scheduled_job").on(
      table.scheduled_job_id,
    ),
    check(
      "thread_idle_learning_runs_status_allowed",
      sql`${table.status} IN ('running','stale_noop','changed','no_change','failed','rolled_back')`,
    ),
  ],
);

export const threadIdleLearningStateRelations = relations(
  threadIdleLearningState,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [threadIdleLearningState.tenant_id],
      references: [tenants.id],
    }),
    thread: one(threads, {
      fields: [threadIdleLearningState.thread_id],
      references: [threads.id],
    }),
    computer: one(computers, {
      fields: [threadIdleLearningState.computer_id],
      references: [computers.id],
    }),
    requester: one(users, {
      fields: [threadIdleLearningState.requester_user_id],
      references: [users.id],
    }),
    scheduledJob: one(scheduledJobs, {
      fields: [threadIdleLearningState.scheduled_job_id],
      references: [scheduledJobs.id],
    }),
    runs: many(threadIdleLearningRuns),
  }),
);

export const threadIdleLearningRunsRelations = relations(
  threadIdleLearningRuns,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [threadIdleLearningRuns.tenant_id],
      references: [tenants.id],
    }),
    thread: one(threads, {
      fields: [threadIdleLearningRuns.thread_id],
      references: [threads.id],
    }),
    computer: one(computers, {
      fields: [threadIdleLearningRuns.computer_id],
      references: [computers.id],
    }),
    requester: one(users, {
      fields: [threadIdleLearningRuns.requester_user_id],
      references: [users.id],
    }),
    scheduledJob: one(scheduledJobs, {
      fields: [threadIdleLearningRuns.scheduled_job_id],
      references: [scheduledJobs.id],
    }),
    state: one(threadIdleLearningState, {
      fields: [threadIdleLearningRuns.thread_id],
      references: [threadIdleLearningState.thread_id],
    }),
  }),
);
