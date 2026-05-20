/**
 * Spaces domain tables.
 *
 * Spaces are tenant-scoped contextual workrooms. They organize threads while
 * carrying the context, connected data, tool policy, MCP policy, and agent
 * availability hints that shape agent turns inside the workroom.
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
import { agents } from "./agents.js";
import { tenants, users } from "./core.js";

export const spaces = pgTable(
  "spaces",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    prompt: text("prompt"),
    status: text("status").notNull().default("active"),
    kind: text("kind").notNull().default("custom"),
    icon: text("icon"),
    category: text("category"),
    template_key: text("template_key"),
    config: jsonb("config"),
    context_config: jsonb("context_config"),
    connected_data_config: jsonb("connected_data_config"),
    tool_policy: jsonb("tool_policy"),
    mcp_policy: jsonb("mcp_policy"),
    agent_availability_policy: jsonb("agent_availability_policy"),
    trigger_config: jsonb("trigger_config"),
    render_diagnostics: jsonb("render_diagnostics"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_spaces_tenant_slug").on(table.tenant_id, table.slug),
    index("idx_spaces_tenant_status").on(table.tenant_id, table.status),
    index("idx_spaces_tenant_template").on(table.tenant_id, table.template_key),
    index("idx_spaces_migrated_template")
      .on(table.tenant_id, table.template_key)
      .where(sql`${table.template_key} LIKE 'agent-template:%'`),
    check(
      "spaces_status_allowed",
      sql`${table.status} IN ('active','archived')`,
    ),
    check(
      "spaces_kind_allowed",
      sql`${table.kind} IN ('custom','customer_onboarding')`,
    ),
  ],
);

export const spaceMembers = pgTable(
  "space_members",
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
    user_id: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    role: text("role").notNull().default("member"),
    notification_preference: text("notification_preference")
      .notNull()
      .default("subscribed"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_space_members_user").on(
      table.tenant_id,
      table.space_id,
      table.user_id,
    ),
    index("idx_space_members_tenant_user").on(table.tenant_id, table.user_id),
    index("idx_space_members_space").on(table.space_id),
    check(
      "space_members_role_allowed",
      sql`${table.role} IN ('owner','admin','member','viewer')`,
    ),
    check(
      "space_members_notification_preference_allowed",
      sql`${table.notification_preference} IN ('subscribed','mentions','muted')`,
    ),
  ],
);

export const spaceAgentAssignments = pgTable(
  "space_agent_assignments",
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
    agent_id: uuid("agent_id")
      .references(() => agents.id, { onDelete: "cascade" })
      .notNull(),
    local_role: text("local_role"),
    local_instructions: text("local_instructions"),
    auto_subscribe: boolean("auto_subscribe").notNull().default(true),
    allowed_capabilities: jsonb("allowed_capabilities"),
    allowed_tools: jsonb("allowed_tools"),
    status: text("status").notNull().default("active"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_space_agent_assignments_agent").on(
      table.tenant_id,
      table.space_id,
      table.agent_id,
    ),
    index("idx_space_agent_assignments_agent").on(
      table.tenant_id,
      table.agent_id,
    ),
    index("idx_space_agent_assignments_space").on(table.space_id),
    check(
      "space_agent_assignments_status_allowed",
      sql`${table.status} IN ('active','paused','archived')`,
    ),
  ],
);

export const spaceChecklistTemplates = pgTable(
  "space_checklist_templates",
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
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    config: jsonb("config"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_space_checklist_templates_key").on(
      table.tenant_id,
      table.space_id,
      table.key,
    ),
    index("idx_space_checklist_templates_space").on(table.space_id),
  ],
);

export const spaceChecklistItems = pgTable(
  "space_checklist_items",
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
    template_id: uuid("template_id")
      .references(() => spaceChecklistTemplates.id, { onDelete: "cascade" })
      .notNull(),
    key: text("key").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    role_key: text("role_key"),
    required: boolean("required").notNull().default(true),
    sort_order: integer("sort_order").notNull().default(0),
    external_task_template: jsonb("external_task_template"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_space_checklist_items_key").on(
      table.tenant_id,
      table.template_id,
      table.key,
    ),
    index("idx_space_checklist_items_template").on(table.template_id),
    index("idx_space_checklist_items_space").on(table.space_id),
  ],
);

export const spaceIntegrations = pgTable(
  "space_integrations",
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
    provider: text("provider").notNull(),
    status: text("status").notNull().default("active"),
    writeback_policy: text("writeback_policy").notNull().default("disabled"),
    config: jsonb("config"),
    webhook_config_ref: text("webhook_config_ref"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_space_integrations_provider").on(
      table.tenant_id,
      table.space_id,
      table.provider,
    ),
    index("idx_space_integrations_space").on(table.space_id),
    check(
      "space_integrations_provider_allowed",
      sql`${table.provider} IN ('lastmile_tasks','webhook')`,
    ),
    check(
      "space_integrations_status_allowed",
      sql`${table.status} IN ('active','paused','archived')`,
    ),
    check(
      "space_integrations_writeback_policy_allowed",
      sql`${table.writeback_policy} IN ('disabled','status_only','status_and_comments')`,
    ),
  ],
);

export const spacesRelations = relations(spaces, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [spaces.tenant_id],
    references: [tenants.id],
  }),
  members: many(spaceMembers),
  agentAssignments: many(spaceAgentAssignments),
  checklistTemplates: many(spaceChecklistTemplates),
  integrations: many(spaceIntegrations),
}));

export const spaceMembersRelations = relations(spaceMembers, ({ one }) => ({
  tenant: one(tenants, {
    fields: [spaceMembers.tenant_id],
    references: [tenants.id],
  }),
  space: one(spaces, {
    fields: [spaceMembers.space_id],
    references: [spaces.id],
  }),
  user: one(users, {
    fields: [spaceMembers.user_id],
    references: [users.id],
  }),
}));

export const spaceAgentAssignmentsRelations = relations(
  spaceAgentAssignments,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [spaceAgentAssignments.tenant_id],
      references: [tenants.id],
    }),
    space: one(spaces, {
      fields: [spaceAgentAssignments.space_id],
      references: [spaces.id],
    }),
    agent: one(agents, {
      fields: [spaceAgentAssignments.agent_id],
      references: [agents.id],
    }),
  }),
);

export const spaceChecklistTemplatesRelations = relations(
  spaceChecklistTemplates,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [spaceChecklistTemplates.tenant_id],
      references: [tenants.id],
    }),
    space: one(spaces, {
      fields: [spaceChecklistTemplates.space_id],
      references: [spaces.id],
    }),
    items: many(spaceChecklistItems),
  }),
);

export const spaceChecklistItemsRelations = relations(
  spaceChecklistItems,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [spaceChecklistItems.tenant_id],
      references: [tenants.id],
    }),
    space: one(spaces, {
      fields: [spaceChecklistItems.space_id],
      references: [spaces.id],
    }),
    template: one(spaceChecklistTemplates, {
      fields: [spaceChecklistItems.template_id],
      references: [spaceChecklistTemplates.id],
    }),
  }),
);

export const spaceIntegrationsRelations = relations(
  spaceIntegrations,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [spaceIntegrations.tenant_id],
      references: [tenants.id],
    }),
    space: one(spaces, {
      fields: [spaceIntegrations.space_id],
      references: [spaces.id],
    }),
  }),
);
