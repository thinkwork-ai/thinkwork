/**
 * Native Work Item domain tables.
 *
 * Work Items are ThinkWork-owned units of work. Threads can discuss them, but
 * the durable task state lives here so Spaces, onboarding workflows, humans,
 * and agents share one canonical substrate.
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

export const WORK_ITEM_STATUS_CATEGORIES = [
  "todo",
  "active",
  "blocked",
  "done",
  "skipped",
] as const;

export const WORK_ITEM_PRIORITIES = [
  "low",
  "normal",
  "high",
  "urgent",
] as const;

export const WORK_ITEM_EVENT_TYPES = [
  "created",
  "updated",
  "status_changed",
  "completed",
  "blocked",
  "unblocked",
  "assigned",
  "due_date_changed",
  "applicability_changed",
  "linked_thread",
  "agent_action",
] as const;

export const WORK_ITEM_VIEW_TYPES = ["list", "board"] as const;

export const WORK_ITEM_THREAD_RELATIONSHIPS = [
  "primary",
  "mentioned",
  "evidence",
  "follow_up",
] as const;

export const WORK_ITEM_EXTERNAL_REF_PROVIDERS = [
  "thinkwork",
  "lastmile",
  "linear",
  "plane",
  "twenty",
] as const;

export const WORK_ITEM_OPEN_ENGINE_DEPENDENCY_STATES = [
  "ready",
  "waiting",
] as const;

export const WORK_ITEM_DOGFOOD_LABELS = [
  "openengine",
  "dogfood",
  "codex",
  "claude",
  "thinkwork-agent",
  "bug",
  "feature",
  "docs",
  "infra",
  "needs-human",
  "review",
  "blocked",
] as const;

export const WORK_ITEM_DOCUMENT_KINDS = [
  "plan",
  "progress",
  "spec",
  "evidence",
  "handoff",
  "note",
  "other",
] as const;

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
    uniqueIndex("uq_work_item_statuses_space_name").on(
      table.tenant_id,
      table.space_id,
      table.name,
    ),
    uniqueIndex("uq_work_item_statuses_space_default")
      .on(table.tenant_id, table.space_id)
      .where(sql`${table.is_default} = true`),
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
    status_id: uuid("status_id").references(() => workItemStatuses.id, {
      onDelete: "restrict",
    }),
    title: text("title").notNull(),
    notes: text("notes"),
    priority: text("priority").notNull().default("normal"),
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
    open_engine_enabled: boolean("open_engine_enabled")
      .notNull()
      .default(false),
    open_engine_queue_key: text("open_engine_queue_key"),
    open_engine_claimed_by_agent_id: uuid(
      "open_engine_claimed_by_agent_id",
    ).references(() => agents.id, {
      onDelete: "set null",
    }),
    open_engine_claimed_at: timestamp("open_engine_claimed_at", {
      withTimezone: true,
    }),
    open_engine_claim_expires_at: timestamp("open_engine_claim_expires_at", {
      withTimezone: true,
    }),
    open_engine_human_hold: boolean("open_engine_human_hold")
      .notNull()
      .default(false),
    open_engine_human_hold_reason: text("open_engine_human_hold_reason"),
    open_engine_scheduled_at: timestamp("open_engine_scheduled_at", {
      withTimezone: true,
    }),
    open_engine_dependency_state: text("open_engine_dependency_state")
      .notNull()
      .default("ready"),
    open_engine_routing: jsonb("open_engine_routing"),
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
    index("idx_work_items_space_status").on(
      table.tenant_id,
      table.space_id,
      table.status_id,
    ),
    index("idx_work_items_space_due").on(
      table.tenant_id,
      table.space_id,
      table.due_at,
    ),
    index("idx_work_items_owner_user").on(
      table.tenant_id,
      table.owner_user_id,
      table.archived_at,
    ),
    index("idx_work_items_owner_agent").on(
      table.tenant_id,
      table.owner_agent_id,
      table.archived_at,
    ),
    index("idx_work_items_template_source").on(
      table.tenant_id,
      table.template_source_id,
    ),
    index("idx_work_items_open_engine_ready")
      .on(
        table.tenant_id,
        table.open_engine_queue_key,
        table.open_engine_scheduled_at,
        table.open_engine_claim_expires_at,
        table.updated_at,
      )
      .where(
        sql`${table.open_engine_enabled} = true
          AND ${table.archived_at} IS NULL
          AND ${table.open_engine_human_hold} = false
          AND ${table.blocked} = false
          AND ${table.open_engine_dependency_state} = 'ready'`,
      ),
    index("idx_work_items_open_engine_claim").on(
      table.tenant_id,
      table.open_engine_claimed_by_agent_id,
      table.open_engine_claim_expires_at,
    ),
    check(
      "work_items_priority_allowed",
      sql`${table.priority} IN ('low','normal','high','urgent')`,
    ),
    check(
      "work_items_open_engine_dependency_state_allowed",
      sql`${table.open_engine_dependency_state} IN ('ready','waiting')`,
    ),
  ],
);

export const workItemLabels = pgTable(
  "work_item_labels",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    color: text("color"),
    description: text("description"),
    created_by_user_id: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    archived_at: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("uq_work_item_labels_tenant_slug").on(
      table.tenant_id,
      table.slug,
    ),
    index("idx_work_item_labels_tenant_active").on(
      table.tenant_id,
      table.archived_at,
      table.name,
    ),
  ],
);

export const workItemLabelAssignments = pgTable(
  "work_item_label_assignments",
  {
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    work_item_id: uuid("work_item_id")
      .references(() => workItems.id, { onDelete: "cascade" })
      .notNull(),
    label_id: uuid("label_id")
      .references(() => workItemLabels.id, { onDelete: "cascade" })
      .notNull(),
    created_by_user_id: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_work_item_label_assignments_pair").on(
      table.tenant_id,
      table.work_item_id,
      table.label_id,
    ),
    index("idx_work_item_label_assignments_label").on(
      table.tenant_id,
      table.label_id,
      table.work_item_id,
    ),
    index("idx_work_item_label_assignments_item").on(
      table.tenant_id,
      table.work_item_id,
    ),
  ],
);

export const workItemDocuments = pgTable(
  "work_item_documents",
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
    kind: text("kind").notNull().default("note"),
    title: text("title").notNull(),
    content_type: text("content_type").notNull().default("text/markdown"),
    s3_key: text("s3_key").notNull(),
    size_bytes: integer("size_bytes").notNull().default(0),
    checksum_sha256: text("checksum_sha256"),
    metadata: jsonb("metadata"),
    created_by_user_id: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    created_by_agent_id: uuid("created_by_agent_id").references(
      () => agents.id,
      { onDelete: "set null" },
    ),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    archived_at: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_work_item_documents_item_active").on(
      table.tenant_id,
      table.work_item_id,
      table.archived_at,
      table.updated_at,
    ),
    index("idx_work_item_documents_tenant_kind").on(
      table.tenant_id,
      table.kind,
      table.archived_at,
    ),
    check(
      "work_item_documents_kind_allowed",
      sql`${table.kind} IN ('plan','progress','spec','evidence','handoff','note','other')`,
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
    relationship: text("relationship").notNull().default("primary"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_work_item_thread_links_pair").on(
      table.tenant_id,
      table.work_item_id,
      table.thread_id,
    ),
    index("idx_work_item_thread_links_thread").on(
      table.tenant_id,
      table.thread_id,
    ),
    index("idx_work_item_thread_links_space").on(
      table.tenant_id,
      table.space_id,
    ),
    check(
      "work_item_thread_links_relationship_allowed",
      sql`${table.relationship} IN ('primary','mentioned','evidence','follow_up')`,
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
    index("idx_work_item_events_item_created").on(
      table.tenant_id,
      table.work_item_id,
      table.created_at,
    ),
    index("idx_work_item_events_thread").on(table.tenant_id, table.thread_id),
    check(
      "work_item_events_type_allowed",
      sql`${table.event_type} IN ('created','updated','status_changed','completed','blocked','unblocked','assigned','due_date_changed','applicability_changed','linked_thread','agent_action')`,
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
    filters: jsonb("filters"),
    grouping: jsonb("grouping"),
    sorting: jsonb("sorting"),
    view_config: jsonb("view_config"),
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
    uniqueIndex("uq_work_item_saved_views_user_name").on(
      table.tenant_id,
      table.user_id,
      table.name,
    ),
    uniqueIndex("uq_work_item_saved_views_user_default")
      .on(table.tenant_id, table.user_id)
      .where(sql`${table.is_default} = true`),
    index("idx_work_item_saved_views_user").on(
      table.tenant_id,
      table.user_id,
      table.is_favorite,
    ),
    index("idx_work_item_saved_views_space").on(
      table.tenant_id,
      table.space_id,
    ),
    check(
      "work_item_saved_views_type_allowed",
      sql`${table.view_type} IN ('list','board')`,
    ),
    check(
      "work_item_saved_views_owner_required",
      sql`${table.user_id} IS NOT NULL OR ${table.is_private} = false`,
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
    check(
      "work_item_external_refs_provider_allowed",
      sql`${table.provider} IN ('thinkwork','lastmile','linear','plane','twenty')`,
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
  templateSource: one(spaceChecklistItems, {
    fields: [workItems.template_source_id],
    references: [spaceChecklistItems.id],
  }),
  threadLinks: many(workItemThreadLinks),
  events: many(workItemEvents),
  externalRefs: many(workItemExternalRefs),
  labelAssignments: many(workItemLabelAssignments),
  documents: many(workItemDocuments),
}));

export const workItemLabelsRelations = relations(
  workItemLabels,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [workItemLabels.tenant_id],
      references: [tenants.id],
    }),
    createdByUser: one(users, {
      fields: [workItemLabels.created_by_user_id],
      references: [users.id],
    }),
    assignments: many(workItemLabelAssignments),
  }),
);

export const workItemLabelAssignmentsRelations = relations(
  workItemLabelAssignments,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [workItemLabelAssignments.tenant_id],
      references: [tenants.id],
    }),
    workItem: one(workItems, {
      fields: [workItemLabelAssignments.work_item_id],
      references: [workItems.id],
    }),
    label: one(workItemLabels, {
      fields: [workItemLabelAssignments.label_id],
      references: [workItemLabels.id],
    }),
    createdByUser: one(users, {
      fields: [workItemLabelAssignments.created_by_user_id],
      references: [users.id],
    }),
  }),
);

export const workItemDocumentsRelations = relations(
  workItemDocuments,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [workItemDocuments.tenant_id],
      references: [tenants.id],
    }),
    workItem: one(workItems, {
      fields: [workItemDocuments.work_item_id],
      references: [workItems.id],
    }),
    createdByUser: one(users, {
      fields: [workItemDocuments.created_by_user_id],
      references: [users.id],
    }),
    createdByAgent: one(agents, {
      fields: [workItemDocuments.created_by_agent_id],
      references: [agents.id],
    }),
  }),
);

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
  actorUser: one(users, {
    fields: [workItemEvents.actor_user_id],
    references: [users.id],
  }),
  actorAgent: one(agents, {
    fields: [workItemEvents.actor_agent_id],
    references: [agents.id],
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
