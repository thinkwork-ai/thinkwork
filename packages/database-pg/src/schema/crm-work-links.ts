/**
 * CRM work links.
 *
 * These rows are the durable bridge between a CRM record and the ThinkWork
 * Thread/Goal that owns execution. V1 is intentionally narrow: Twenty
 * Opportunity -> Customer Onboarding.
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
import { tenants, users } from "./core";
import { goals } from "./goals";
import { tenantMcpServers } from "./mcp-servers";
import { pluginInstalls } from "./plugins";
import { spaces } from "./spaces";
import { threads } from "./threads";

export const crmWorkLinks = pgTable(
  "crm_work_links",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    object_type: text("object_type").notNull(),
    object_id: text("object_id").notNull(),
    object_url: text("object_url"),
    workflow_key: text("workflow_key").notNull(),
    outcome_key: text("outcome_key").notNull().default("default"),
    space_id: uuid("space_id").references(() => spaces.id, {
      onDelete: "set null",
    }),
    thread_id: uuid("thread_id").references(() => threads.id, {
      onDelete: "set null",
    }),
    goal_id: uuid("goal_id").references(() => goals.id, {
      onDelete: "set null",
    }),
    requester_user_id: uuid("requester_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    last_writeback_user_id: uuid("last_writeback_user_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    plugin_install_id: uuid("plugin_install_id").references(
      () => pluginInstalls.id,
      { onDelete: "set null" },
    ),
    mcp_server_id: uuid("mcp_server_id").references(() => tenantMcpServers.id, {
      onDelete: "set null",
    }),
    state: text("state").notNull().default("active"),
    status_handle_state: text("status_handle_state")
      .notNull()
      .default("pending"),
    status_handle_url: text("status_handle_url"),
    status_handle_action: text("status_handle_action"),
    last_writeback_state: text("last_writeback_state")
      .notNull()
      .default("pending"),
    failure_code: text("failure_code"),
    failure_message: text("failure_message"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    started_at: timestamp("started_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    last_resumed_at: timestamp("last_resumed_at", { withTimezone: true }),
    deactivated_at: timestamp("deactivated_at", { withTimezone: true }),
    archived_at: timestamp("archived_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_crm_work_links_active_outcome")
      .on(
        table.tenant_id,
        table.provider,
        table.object_type,
        table.object_id,
        table.workflow_key,
        table.outcome_key,
      )
      .where(sql`${table.state} IN ('starting','active')`),
    index("idx_crm_work_links_thread").on(table.tenant_id, table.thread_id),
    index("idx_crm_work_links_goal").on(table.tenant_id, table.goal_id),
    index("idx_crm_work_links_provider_record").on(
      table.tenant_id,
      table.provider,
      table.object_type,
      table.object_id,
    ),
    check(
      "crm_work_links_provider_allowed",
      sql`${table.provider} IN ('twenty')`,
    ),
    check(
      "crm_work_links_object_type_allowed",
      sql`${table.object_type} IN ('opportunity')`,
    ),
    check(
      "crm_work_links_workflow_key_allowed",
      sql`${table.workflow_key} IN ('customer_onboarding')`,
    ),
    check(
      "crm_work_links_state_allowed",
      sql`${table.state} IN ('starting','active','completed','cancelled','failed','archived')`,
    ),
    check(
      "crm_work_links_status_handle_state_allowed",
      sql`${table.status_handle_state} IN ('pending','posted','requires_reauth','writeback_blocked','failed')`,
    ),
    check(
      "crm_work_links_last_writeback_state_allowed",
      sql`${table.last_writeback_state} IN ('pending','posted','requires_reauth','blocked','failed','skipped')`,
    ),
  ],
);

export const crmWorkLinksRelations = relations(crmWorkLinks, ({ one }) => ({
  tenant: one(tenants, {
    fields: [crmWorkLinks.tenant_id],
    references: [tenants.id],
  }),
  space: one(spaces, {
    fields: [crmWorkLinks.space_id],
    references: [spaces.id],
  }),
  thread: one(threads, {
    fields: [crmWorkLinks.thread_id],
    references: [threads.id],
  }),
  goal: one(goals, {
    fields: [crmWorkLinks.goal_id],
    references: [goals.id],
  }),
  requester: one(users, {
    fields: [crmWorkLinks.requester_user_id],
    references: [users.id],
  }),
  pluginInstall: one(pluginInstalls, {
    fields: [crmWorkLinks.plugin_install_id],
    references: [pluginInstalls.id],
  }),
  mcpServer: one(tenantMcpServers, {
    fields: [crmWorkLinks.mcp_server_id],
    references: [tenantMcpServers.id],
  }),
}));
