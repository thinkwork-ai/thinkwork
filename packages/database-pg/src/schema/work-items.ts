/**
 * Native Work Items domain tables.
 *
 * Work Items are ThinkWork-owned units of work for Spaces and Threads. External
 * systems can reference them, but V1 keeps ThinkWork as the canonical source of
 * task state.
 */

import {
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
import { spaceChecklistItems, spaces } from "./spaces";
import { threads } from "./threads";

export const workItemStatuses = pgTable(
  "work_item_statuses",
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
    name: text("name").notNull(),
    description: text("description"),
    color: text("color"),
    icon: text("icon"),
    category: text("category").notNull().default("todo"),
    is_active: boolean("is_active").notNull().default(true),
    is_final: boolean("is_final").notNull().default(false),
    is_default: boolean("is_default").notNull().default(false),
    display_order: integer("display_order").notNull().default(0),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_work_item_status_name").on(
      table.tenant_id,
      table.space_id,
      table.name,
    ),
    uniqueIndex("uq_work_item_status_default_category")
      .on(table.tenant_id, table.space_id, table.category)
      .where(sql`${table.is_default} IS TRUE`),
    index("idx_work_item_statuses_space_order").on(
      table.tenant_id,
      table.space_id,
      table.display_order,
    ),
    check(
      "work_item_statuses_category_allowed",
      sql`${table.category} IN ('todo','active','blocked','done','skipped')`,
    ),
  ],
);

export const workItems = pgTable(
  "work_items",
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
    status_id: uuid("status_id")
      .references(() => workItemStatuses.id, { onDelete: "restrict" })
      .notNull(),
    title: text("title").notNull(),
    notes: text("notes"),
    priority: text("priority").notNull().default("medium"),
    owner_user_id: uuid("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    owner_agent_id: uuid("owner_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    due_at: timestamp("due_at", { withTimezone: true }),
    required: boolean("required").notNull().default(true),
    applicable: boolean("applicable").notNull().default(true),
    blocked: boolean("blocked").notNull().default(false),
    completed_at: timestamp("completed_at", { withTimezone: true }),
    completed_by_user_id: uuid("completed_by_user_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    completed_by_agent_id: uuid("completed_by_agent_id").references(
      () => agents.id,
      { onDelete: "set null" },
    ),
    created_by_user_id: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    created_by_agent_id: uuid("created_by_agent_id").references(
      () => agents.id,
      { onDelete: "set null" },
    ),
    template_source_id: uuid("template_source_id").references(
      () => spaceChecklistItems.id,
      { onDelete: "set null" },
    ),
    metadata: jsonb("metadata"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    archived_at: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_work_items_tenant_space_status").on(
      table.tenant_id,
      table.space_id,
      table.status_id,
      table.updated_at,
    ),
    index("idx_work_items_tenant_owner_user").on(
      table.tenant_id,
      table.owner_user_id,
      table.updated_at,
    ),
    index("idx_work_items_tenant_owner_agent").on(
      table.tenant_id,
      table.owner_agent_id,
      table.updated_at,
    ),
    index("idx_work_items_tenant_due").on(table.tenant_id, table.due_at),
    index("idx_work_items_tenant_priority").on(
      table.tenant_id,
      table.priority,
      table.updated_at,
    ),
    index("idx_work_items_template_source").on(
      table.tenant_id,
      table.template_source_id,
    ),
    check(
      "work_items_priority_allowed",
      sql`${table.priority} IN ('low','medium','high','urgent')`,
    ),
  ],
);

export const workItemThreadLinks = pgTable(
  "work_item_thread_links",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    work_item_id: uuid("work_item_id")
      .references(() => workItems.id, { onDelete: "cascade" })
      .notNull(),
    thread_id: uuid("thread_id")
      .references(() => threads.id, { onDelete: "cascade" })
      .notNull(),
    space_id: uuid("space_id")
      .references(() => spaces.id, { onDelete: "cascade" })
      .notNull(),
    relationship: text("relationship").notNull().default("context"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_work_item_thread_links").on(
      table.tenant_id,
      table.work_item_id,
      table.thread_id,
    ),
    index("idx_work_item_thread_links_thread").on(
      table.tenant_id,
      table.thread_id,
      table.work_item_id,
    ),
    index("idx_work_item_thread_links_item").on(
      table.tenant_id,
      table.work_item_id,
    ),
    check(
      "work_item_thread_links_relationship_allowed",
      sql`${table.relationship} IN ('context','source','evidence','blocks','blocked_by')`,
    ),
  ],
);

export const workItemEvents = pgTable(
  "work_item_events",
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
    work_item_id: uuid("work_item_id")
      .references(() => workItems.id, { onDelete: "cascade" })
      .notNull(),
    thread_id: uuid("thread_id").references(() => threads.id, {
      onDelete: "set null",
    }),
    actor_type: text("actor_type").notNull().default("system"),
    actor_user_id: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    actor_agent_id: uuid("actor_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    event_type: text("event_type").notNull(),
    previous_status_id: uuid("previous_status_id").references(
      () => workItemStatuses.id,
      { onDelete: "set null" },
    ),
    new_status_id: uuid("new_status_id").references(() => workItemStatuses.id, {
      onDelete: "set null",
    }),
    message: text("message"),
    metadata: jsonb("metadata"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_work_item_events_item").on(
      table.tenant_id,
      table.work_item_id,
      table.created_at,
    ),
    index("idx_work_item_events_thread").on(
      table.tenant_id,
      table.thread_id,
      table.created_at,
    ),
    check(
      "work_item_events_actor_type_allowed",
      sql`${table.actor_type} IN ('system','user','agent','service')`,
    ),
    check(
      "work_item_events_type_allowed",
      sql`${table.event_type} IN ('created','updated','status_changed','completed','blocked','skipped','assigned','due_date_changed','applicability_changed','linked_thread','unlinked_thread','agent_action','external_ref_added')`,
    ),
  ],
);

export const workItemSavedViews = pgTable(
  "work_item_saved_views",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    user_id: uuid("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    space_id: uuid("space_id").references(() => spaces.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    view_type: text("view_type").notNull().default("list"),
    filters: jsonb("filters").notNull().default({}),
    grouping: jsonb("grouping").notNull().default({}),
    sorting: jsonb("sorting").notNull().default({}),
    view_config: jsonb("view_config").notNull().default({}),
    is_private: boolean("is_private").notNull().default(true),
    is_default: boolean("is_default").notNull().default(false),
    is_favorite: boolean("is_favorite").notNull().default(false),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_work_item_saved_views_name").on(
      table.tenant_id,
      table.user_id,
      table.space_id,
      table.name,
    ),
    uniqueIndex("uq_work_item_saved_views_default")
      .on(table.tenant_id, table.user_id, table.space_id)
      .where(sql`${table.is_default} IS TRUE`),
    index("idx_work_item_saved_views_user").on(
      table.tenant_id,
      table.user_id,
      table.is_favorite,
    ),
    check(
      "work_item_saved_views_type_allowed",
      sql`${table.view_type} IN ('list','board')`,
    ),
  ],
);

export const workItemExternalRefs = pgTable(
  "work_item_external_refs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    work_item_id: uuid("work_item_id")
      .references(() => workItems.id, { onDelete: "cascade" })
      .notNull(),
    provider: text("provider").notNull(),
    external_id: text("external_id").notNull(),
    external_url: text("external_url"),
    metadata: jsonb("metadata"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_work_item_external_refs_provider").on(
      table.tenant_id,
      table.provider,
      table.external_id,
    ),
    index("idx_work_item_external_refs_item").on(
      table.tenant_id,
      table.work_item_id,
    ),
  ],
);

export const workItemStatusesRelations = relations(
  workItemStatuses,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [workItemStatuses.tenant_id],
      references: [tenants.id],
    }),
    space: one(spaces, {
      fields: [workItemStatuses.space_id],
      references: [spaces.id],
    }),
    workItems: many(workItems),
  }),
);

export const workItemsRelations = relations(workItems, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [workItems.tenant_id],
    references: [tenants.id],
  }),
  space: one(spaces, {
    fields: [workItems.space_id],
    references: [spaces.id],
  }),
  status: one(workItemStatuses, {
    fields: [workItems.status_id],
    references: [workItemStatuses.id],
  }),
  ownerUser: one(users, {
    fields: [workItems.owner_user_id],
    references: [users.id],
  }),
  ownerAgent: one(agents, {
    fields: [workItems.owner_agent_id],
    references: [agents.id],
  }),
  threadLinks: many(workItemThreadLinks),
  events: many(workItemEvents),
  externalRefs: many(workItemExternalRefs),
}));

export const workItemThreadLinksRelations = relations(
  workItemThreadLinks,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [workItemThreadLinks.tenant_id],
      references: [tenants.id],
    }),
    workItem: one(workItems, {
      fields: [workItemThreadLinks.work_item_id],
      references: [workItems.id],
    }),
    thread: one(threads, {
      fields: [workItemThreadLinks.thread_id],
      references: [threads.id],
    }),
    space: one(spaces, {
      fields: [workItemThreadLinks.space_id],
      references: [spaces.id],
    }),
  }),
);

export const workItemEventsRelations = relations(workItemEvents, ({ one }) => ({
  tenant: one(tenants, {
    fields: [workItemEvents.tenant_id],
    references: [tenants.id],
  }),
  space: one(spaces, {
    fields: [workItemEvents.space_id],
    references: [spaces.id],
  }),
  workItem: one(workItems, {
    fields: [workItemEvents.work_item_id],
    references: [workItems.id],
  }),
  thread: one(threads, {
    fields: [workItemEvents.thread_id],
    references: [threads.id],
  }),
  previousStatus: one(workItemStatuses, {
    fields: [workItemEvents.previous_status_id],
    references: [workItemStatuses.id],
  }),
  newStatus: one(workItemStatuses, {
    fields: [workItemEvents.new_status_id],
    references: [workItemStatuses.id],
  }),
}));

export const workItemSavedViewsRelations = relations(
  workItemSavedViews,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [workItemSavedViews.tenant_id],
      references: [tenants.id],
    }),
    user: one(users, {
      fields: [workItemSavedViews.user_id],
      references: [users.id],
    }),
    space: one(spaces, {
      fields: [workItemSavedViews.space_id],
      references: [spaces.id],
    }),
  }),
);

export const workItemExternalRefsRelations = relations(
  workItemExternalRefs,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [workItemExternalRefs.tenant_id],
      references: [tenants.id],
    }),
    workItem: one(workItems, {
      fields: [workItemExternalRefs.work_item_id],
      references: [workItems.id],
    }),
  }),
);
