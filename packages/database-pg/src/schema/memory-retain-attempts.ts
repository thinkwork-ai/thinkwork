/**
 * Durable memory retain attempt ledger.
 *
 * Hindsight remains the canonical store for user and Space memory. This table
 * tracks ThinkWork-owned retain attempts so runtime timeouts can be retried,
 * inspected, and dead-lettered without depending on Lambda async retries.
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
import { threadTurns } from "./scheduled-jobs";
import { spaces } from "./spaces";

export const memoryRetainAttemptStatuses = [
  "queued",
  "running",
  "retained",
  "failed_timeout",
  "failed_backend",
  "dead_lettered",
] as const;

export type MemoryRetainAttemptStatus =
  (typeof memoryRetainAttemptStatuses)[number];

export const memoryRetainAttempts = pgTable(
  "memory_retain_attempts",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    user_id: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    space_id: uuid("space_id").references(() => spaces.id, {
      onDelete: "set null",
    }),
    thread_id: uuid("thread_id")
      .references(() => threads.id, { onDelete: "cascade" })
      .notNull(),
    thread_turn_id: uuid("thread_turn_id").references(() => threadTurns.id, {
      onDelete: "set null",
    }),
    source_event_key: text("source_event_key").notNull(),
    source_event_type: text("source_event_type")
      .notNull()
      .default("thread_turn"),
    provider: text("provider").notNull().default("hindsight"),
    status: text("status").notNull().default("queued"),
    attempt_count: integer("attempt_count").notNull().default(0),
    max_attempts: integer("max_attempts").notNull().default(5),
    next_retry_at: timestamp("next_retry_at", { withTimezone: true }),
    locked_at: timestamp("locked_at", { withTimezone: true }),
    locked_by: text("locked_by"),
    started_at: timestamp("started_at", { withTimezone: true }),
    finished_at: timestamp("finished_at", { withTimezone: true }),
    backend_latency_ms: integer("backend_latency_ms"),
    provider_document_id: text("provider_document_id"),
    provider_result: jsonb("provider_result"),
    error_class: text("error_class"),
    error_message: text("error_message"),
    metadata: jsonb("metadata"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("memory_retain_attempts_source_event_uidx").on(
      table.tenant_id,
      table.thread_id,
      table.source_event_key,
    ),
    index("memory_retain_attempts_due_idx").on(
      table.status,
      table.next_retry_at,
      table.created_at,
    ),
    index("memory_retain_attempts_tenant_status_idx").on(
      table.tenant_id,
      table.status,
      table.created_at,
    ),
    index("memory_retain_attempts_thread_idx").on(
      table.tenant_id,
      table.thread_id,
      table.created_at,
    ),
    index("memory_retain_attempts_user_idx").on(
      table.tenant_id,
      table.user_id,
      table.created_at,
    ),
    index("memory_retain_attempts_space_idx").on(
      table.tenant_id,
      table.space_id,
      table.created_at,
    ),
    index("memory_retain_attempts_turn_idx").on(table.thread_turn_id),
    check(
      "memory_retain_attempts_status_allowed",
      sql`${table.status} IN ('queued','running','retained','failed_timeout','failed_backend','dead_lettered')`,
    ),
    check(
      "memory_retain_attempts_attempt_count_nonnegative",
      sql`${table.attempt_count} >= 0`,
    ),
    check(
      "memory_retain_attempts_max_attempts_positive",
      sql`${table.max_attempts} > 0`,
    ),
  ],
);

export const memoryRetainAttemptsRelations = relations(
  memoryRetainAttempts,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [memoryRetainAttempts.tenant_id],
      references: [tenants.id],
    }),
    user: one(users, {
      fields: [memoryRetainAttempts.user_id],
      references: [users.id],
    }),
    space: one(spaces, {
      fields: [memoryRetainAttempts.space_id],
      references: [spaces.id],
    }),
    thread: one(threads, {
      fields: [memoryRetainAttempts.thread_id],
      references: [threads.id],
    }),
    threadTurn: one(threadTurns, {
      fields: [memoryRetainAttempts.thread_turn_id],
      references: [threadTurns.id],
    }),
  }),
);
