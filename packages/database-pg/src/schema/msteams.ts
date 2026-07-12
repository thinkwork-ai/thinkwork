/**
 * Microsoft Teams application domain tables.
 *
 * A Teams install binds one customer Entra directory (tenant) to exactly one
 * ThinkWork tenant, globally. User links remain per Entra tenant/user pair so
 * the same ThinkWork user can invoke their Computer from multiple Entra
 * tenants. `msteams_threads` maps Bot Framework conversations onto ThinkWork
 * threads (used by U7).
 *
 * These tables intentionally hold NO secret material (tokens, credentials);
 * bot credentials stay in Secrets Manager / SSM. Keep it that way.
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

export const msteamsTenantInstalls = pgTable(
  "msteams_tenant_installs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    /** Customer Entra directory (tenant) id. */
    entra_tenant_id: text("entra_tenant_id").notNull(),
    /** ThinkWork-owned Entra application (client) id serving this install. */
    bot_app_id: text("bot_app_id").notNull(),
    status: text("status").notNull().default("pending"),
    consent_status: text("consent_status").notNull().default("pending"),
    installed_by_user_id: uuid("installed_by_user_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    installed_at: timestamp("installed_at", { withTimezone: true }),
    uninstalled_at: timestamp("uninstalled_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_msteams_tenant_installs_entra_tenant").on(
      table.entra_tenant_id,
    ),
    uniqueIndex("uq_msteams_tenant_installs_tenant_entra_tenant").on(
      table.tenant_id,
      table.entra_tenant_id,
    ),
    // A ThinkWork tenant has at most one ACTIVE Entra binding; concurrent
    // consent callbacks cannot race two bindings live.
    uniqueIndex("uq_msteams_tenant_installs_tenant_active")
      .on(table.tenant_id)
      .where(sql`${table.status} = 'active'`),
    index("idx_msteams_tenant_installs_tenant_status").on(
      table.tenant_id,
      table.status,
    ),
    check(
      "msteams_tenant_installs_status_allowed",
      sql`${table.status} IN ('pending','active','uninstalled','revoked')`,
    ),
    check(
      "msteams_tenant_installs_consent_status_allowed",
      sql`${table.consent_status} IN ('pending','granted','admin_required','revoked')`,
    ),
  ],
);

export const msteamsUserLinks = pgTable(
  "msteams_user_links",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    entra_tenant_id: text("entra_tenant_id")
      .references(() => msteamsTenantInstalls.entra_tenant_id, {
        onDelete: "restrict",
      })
      .notNull(),
    /** The Teams user's Entra object id. */
    aad_object_id: text("aad_object_id").notNull(),
    user_id: uuid("user_id")
      .references(() => users.id, { onDelete: "restrict" })
      .notNull(),
    display_name: text("display_name"),
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
    uniqueIndex("uq_msteams_user_links_entra_tenant_aad_object").on(
      table.entra_tenant_id,
      table.aad_object_id,
    ),
    index("idx_msteams_user_links_tenant_user").on(
      table.tenant_id,
      table.user_id,
    ),
    index("idx_msteams_user_links_user").on(table.user_id),
    check(
      "msteams_user_links_status_allowed",
      sql`${table.status} IN ('active','unlinked','orphaned','suspended')`,
    ),
  ],
);

export const msteamsThreads = pgTable(
  "msteams_threads",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    entra_tenant_id: text("entra_tenant_id")
      .references(() => msteamsTenantInstalls.entra_tenant_id, {
        onDelete: "restrict",
      })
      .notNull(),
    /** Bot Framework conversation id (the reply-chain id in channels). */
    conversation_id: text("conversation_id").notNull(),
    /** Verified Bot Framework service URL persisted for continuation. */
    service_url: text("service_url").notNull(),
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
    uniqueIndex("uq_msteams_threads_entra_tenant_conversation").on(
      table.entra_tenant_id,
      table.conversation_id,
    ),
    index("idx_msteams_threads_thread").on(table.thread_id),
    index("idx_msteams_threads_tenant_entra_tenant").on(
      table.tenant_id,
      table.entra_tenant_id,
    ),
  ],
);

export const msteamsTenantInstallsRelations = relations(
  msteamsTenantInstalls,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [msteamsTenantInstalls.tenant_id],
      references: [tenants.id],
    }),
    installedBy: one(users, {
      fields: [msteamsTenantInstalls.installed_by_user_id],
      references: [users.id],
    }),
    userLinks: many(msteamsUserLinks),
    threads: many(msteamsThreads),
  }),
);

export const msteamsUserLinksRelations = relations(
  msteamsUserLinks,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [msteamsUserLinks.tenant_id],
      references: [tenants.id],
    }),
    install: one(msteamsTenantInstalls, {
      fields: [msteamsUserLinks.entra_tenant_id],
      references: [msteamsTenantInstalls.entra_tenant_id],
    }),
    user: one(users, {
      fields: [msteamsUserLinks.user_id],
      references: [users.id],
    }),
  }),
);

export const msteamsThreadsRelations = relations(msteamsThreads, ({ one }) => ({
  tenant: one(tenants, {
    fields: [msteamsThreads.tenant_id],
    references: [tenants.id],
  }),
  install: one(msteamsTenantInstalls, {
    fields: [msteamsThreads.entra_tenant_id],
    references: [msteamsTenantInstalls.entra_tenant_id],
  }),
  thread: one(threads, {
    fields: [msteamsThreads.thread_id],
    references: [threads.id],
  }),
}));
