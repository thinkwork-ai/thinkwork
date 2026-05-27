/**
 * Goal ledger tables.
 *
 * Goals make promoted Thread workflows explicit while keeping markdown files
 * portable in S3. Aurora owns the indexed contract, lifecycle, review policy,
 * and Thread binding.
 */

import {
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
import { spaces } from "./spaces";
import { threads } from "./threads";

export const goals = pgTable(
  "goals",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    space_id: uuid("space_id")
      .references(() => spaces.id, { onDelete: "cascade" })
      .notNull(),
    thread_id: uuid("thread_id")
      .references(() => threads.id, { onDelete: "cascade" })
      .notNull(),
    template_key: text("template_key"),
    outcome: text("outcome").notNull(),
    owner_type: text("owner_type"),
    owner_id: text("owner_id"),
    mode: text("mode").notNull().default("collaborate"),
    status: text("status").notNull().default("active"),
    progress_model: text("progress_model").notNull().default("linked_tasks"),
    completion_rule: jsonb("completion_rule"),
    review_policy: jsonb("review_policy"),
    folder_s3_prefix: text("folder_s3_prefix").notNull(),
    reviewer_type: text("reviewer_type"),
    reviewer_id: text("reviewer_id"),
    started_at: timestamp("started_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    reviewed_at: timestamp("reviewed_at", { withTimezone: true }),
    completed_at: timestamp("completed_at", { withTimezone: true }),
    cancelled_at: timestamp("cancelled_at", { withTimezone: true }),
    metadata: jsonb("metadata"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_goals_tenant_thread").on(table.tenant_id, table.thread_id),
    index("idx_goals_tenant_space_status").on(
      table.tenant_id,
      table.space_id,
      table.status,
    ),
    index("idx_goals_folder_s3_prefix").on(table.folder_s3_prefix),
    uniqueIndex("uq_goals_thread_non_terminal")
      .on(table.tenant_id, table.thread_id)
      .where(sql`${table.status} IN ('active','in_review')`),
    check(
      "goals_mode_allowed",
      sql`${table.mode} IN ('delegate','collaborate')`,
    ),
    check(
      "goals_status_allowed",
      sql`${table.status} IN ('active','in_review','completed','cancelled')`,
    ),
  ],
);

export const goalsRelations = relations(goals, ({ one }) => ({
  tenant: one(tenants, {
    fields: [goals.tenant_id],
    references: [tenants.id],
  }),
  space: one(spaces, {
    fields: [goals.space_id],
    references: [spaces.id],
  }),
  thread: one(threads, {
    fields: [goals.thread_id],
    references: [threads.id],
  }),
}));
