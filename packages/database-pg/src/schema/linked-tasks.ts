/**
 * Linked task mirror tables.
 *
 * ThinkWork mirrors the checklist/task state needed for collaborative Threads,
 * while external task providers such as LastMile Tasks remain the source of
 * truth for task ownership and workflow updates.
 */

import {
  boolean,
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
import { spaceChecklistItems, spaces } from "./spaces";
import { threads } from "./threads";

export const linkedTasks = pgTable(
  "linked_tasks",
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
    checklist_item_id: uuid("checklist_item_id").references(
      () => spaceChecklistItems.id,
      { onDelete: "set null" },
    ),
    provider: text("provider").notNull().default("lastmile"),
    external_task_id: text("external_task_id").notNull(),
    external_task_url: text("external_task_url"),
    title: text("title").notNull(),
    required: boolean("required").notNull().default(true),
    role_key: text("role_key"),
    assignee_display: text("assignee_display"),
    assignee_external_id: text("assignee_external_id"),
    status: text("status").notNull().default("unknown"),
    blocked: boolean("blocked").notNull().default(false),
    sync_status: text("sync_status").notNull().default("pending"),
    last_synced_at: timestamp("last_synced_at", { withTimezone: true }),
    metadata: jsonb("metadata"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_linked_tasks_external").on(
      table.tenant_id,
      table.provider,
      table.external_task_id,
    ),
    uniqueIndex("uq_linked_tasks_checklist_item")
      .on(table.tenant_id, table.thread_id, table.checklist_item_id)
      .where(sql`${table.checklist_item_id} IS NOT NULL`),
    index("idx_linked_tasks_thread").on(table.tenant_id, table.thread_id),
    index("idx_linked_tasks_space").on(table.tenant_id, table.space_id),
    check(
      "linked_tasks_provider_allowed",
      sql`${table.provider} IN ('lastmile')`,
    ),
    check(
      "linked_tasks_status_allowed",
      sql`${table.status} IN ('unknown','todo','in_progress','completed','blocked','cancelled')`,
    ),
    check(
      "linked_tasks_sync_status_allowed",
      sql`${table.sync_status} IN ('pending','synced','warning','error')`,
    ),
  ],
);

export const linkedTaskEvents = pgTable(
  "linked_task_events",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    linked_task_id: uuid("linked_task_id")
      .references(() => linkedTasks.id, { onDelete: "cascade" })
      .notNull(),
    space_id: uuid("space_id")
      .references(() => spaces.id, { onDelete: "cascade" })
      .notNull(),
    thread_id: uuid("thread_id")
      .references(() => threads.id, { onDelete: "cascade" })
      .notNull(),
    provider: text("provider").notNull().default("lastmile"),
    event_type: text("event_type").notNull(),
    external_event_id: text("external_event_id"),
    previous_status: text("previous_status"),
    new_status: text("new_status"),
    message: text("message"),
    metadata: jsonb("metadata"),
    occurred_at: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_linked_task_events_external")
      .on(table.tenant_id, table.provider, table.external_event_id)
      .where(sql`${table.external_event_id} IS NOT NULL`),
    index("idx_linked_task_events_task").on(table.linked_task_id),
    index("idx_linked_task_events_thread").on(table.tenant_id, table.thread_id),
    check(
      "linked_task_events_provider_allowed",
      sql`${table.provider} IN ('lastmile')`,
    ),
    check(
      "linked_task_events_type_allowed",
      sql`${table.event_type} IN ('created','completed','blocked','reassigned','due_date_changed','sync_failed','writeback_posted')`,
    ),
    check(
      "linked_task_events_previous_status_allowed",
      sql`${table.previous_status} IS NULL OR ${table.previous_status} IN ('unknown','todo','in_progress','completed','blocked','cancelled')`,
    ),
    check(
      "linked_task_events_new_status_allowed",
      sql`${table.new_status} IS NULL OR ${table.new_status} IN ('unknown','todo','in_progress','completed','blocked','cancelled')`,
    ),
  ],
);

export const linkedTasksRelations = relations(linkedTasks, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [linkedTasks.tenant_id],
    references: [tenants.id],
  }),
  space: one(spaces, {
    fields: [linkedTasks.space_id],
    references: [spaces.id],
  }),
  thread: one(threads, {
    fields: [linkedTasks.thread_id],
    references: [threads.id],
  }),
  checklistItem: one(spaceChecklistItems, {
    fields: [linkedTasks.checklist_item_id],
    references: [spaceChecklistItems.id],
  }),
  events: many(linkedTaskEvents),
}));

export const linkedTaskEventsRelations = relations(
  linkedTaskEvents,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [linkedTaskEvents.tenant_id],
      references: [tenants.id],
    }),
    linkedTask: one(linkedTasks, {
      fields: [linkedTaskEvents.linked_task_id],
      references: [linkedTasks.id],
    }),
    space: one(spaces, {
      fields: [linkedTaskEvents.space_id],
      references: [spaces.id],
    }),
    thread: one(threads, {
      fields: [linkedTaskEvents.thread_id],
      references: [threads.id],
    }),
  }),
);
