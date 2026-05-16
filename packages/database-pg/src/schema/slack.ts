/**
 * Slack workspace app domain tables.
 *
 * The workspace app is tenant-installed once per Slack workspace, while user
 * links remain per Slack workspace/user pair so the same ThinkWork user can
 * invoke their Computer from multiple Slack workspaces.
 */

import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants, users } from "./core.js";
import { threads } from "./threads.js";

export const slackWorkspaces = pgTable(
  "slack_workspaces",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    slack_team_id: text("slack_team_id").notNull(),
    slack_team_name: text("slack_team_name"),
    bot_user_id: text("bot_user_id").notNull(),
    bot_token_secret_path: text("bot_token_secret_path").notNull(),
    app_id: text("app_id").notNull(),
    installed_by_user_id: uuid("installed_by_user_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    status: text("status").notNull().default("active"),
    installed_at: timestamp("installed_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    uninstalled_at: timestamp("uninstalled_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_slack_workspaces_team").on(table.slack_team_id),
    uniqueIndex("uq_slack_workspaces_tenant_team").on(
      table.tenant_id,
      table.slack_team_id,
    ),
    index("idx_slack_workspaces_tenant_status").on(
      table.tenant_id,
      table.status,
    ),
    check(
      "slack_workspaces_status_allowed",
      sql`${table.status} IN ('active','uninstalled','revoked')`,
    ),
  ],
);

export const slackUserLinks = pgTable(
  "slack_user_links",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    slack_team_id: text("slack_team_id")
      .references(() => slackWorkspaces.slack_team_id, {
        onDelete: "restrict",
      })
      .notNull(),
    slack_user_id: text("slack_user_id").notNull(),
    user_id: uuid("user_id")
      .references(() => users.id, { onDelete: "restrict" })
      .notNull(),
    slack_user_name: text("slack_user_name"),
    slack_user_email: text("slack_user_email"),
    status: text("status").notNull().default("active"),
    linked_at: timestamp("linked_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    unlinked_at: timestamp("unlinked_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_slack_user_links_team_user").on(
      table.slack_team_id,
      table.slack_user_id,
    ),
    index("idx_slack_user_links_tenant_user").on(
      table.tenant_id,
      table.user_id,
    ),
    index("idx_slack_user_links_user").on(table.user_id),
    check(
      "slack_user_links_status_allowed",
      sql`${table.status} IN ('active','unlinked','orphaned','suspended')`,
    ),
  ],
);

export const slackThreads = pgTable(
  "slack_threads",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    slack_team_id: text("slack_team_id")
      .references(() => slackWorkspaces.slack_team_id, {
        onDelete: "restrict",
      })
      .notNull(),
    channel_id: text("channel_id").notNull(),
    root_thread_ts: text("root_thread_ts"),
    thread_id: uuid("thread_id")
      .references(() => threads.id, { onDelete: "cascade" })
      .notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_slack_threads_team_channel_root").on(
      table.slack_team_id,
      table.channel_id,
      table.root_thread_ts,
    ),
    index("idx_slack_threads_thread").on(table.thread_id),
    index("idx_slack_threads_tenant_team").on(
      table.tenant_id,
      table.slack_team_id,
    ),
  ],
);

export const slackWorkspacesRelations = relations(
  slackWorkspaces,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [slackWorkspaces.tenant_id],
      references: [tenants.id],
    }),
    installedBy: one(users, {
      fields: [slackWorkspaces.installed_by_user_id],
      references: [users.id],
    }),
    userLinks: many(slackUserLinks),
    threads: many(slackThreads),
  }),
);

export const slackUserLinksRelations = relations(slackUserLinks, ({ one }) => ({
  tenant: one(tenants, {
    fields: [slackUserLinks.tenant_id],
    references: [tenants.id],
  }),
  workspace: one(slackWorkspaces, {
    fields: [slackUserLinks.slack_team_id],
    references: [slackWorkspaces.slack_team_id],
  }),
  user: one(users, {
    fields: [slackUserLinks.user_id],
    references: [users.id],
  }),
}));

export const slackThreadsRelations = relations(slackThreads, ({ one }) => ({
  tenant: one(tenants, {
    fields: [slackThreads.tenant_id],
    references: [tenants.id],
  }),
  workspace: one(slackWorkspaces, {
    fields: [slackThreads.slack_team_id],
    references: [slackWorkspaces.slack_team_id],
  }),
  thread: one(threads, {
    fields: [slackThreads.thread_id],
    references: [threads.id],
  }),
}));
