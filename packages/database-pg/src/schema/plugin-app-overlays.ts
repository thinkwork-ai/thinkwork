/**
 * Durable overlay state for trusted plugin apps.
 *
 * CRM-owned records stay in their source system; this table stores
 * ThinkWork-owned annotations, briefs, KPI baselines, and form sections keyed
 * to the plugin app surface and provider record identity.
 */

import {
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
import { pluginInstalls } from "./plugins";

export const pluginAppOverlays = pgTable(
  "plugin_app_overlays",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    plugin_install_id: uuid("plugin_install_id")
      .notNull()
      .references(() => pluginInstalls.id, { onDelete: "cascade" }),
    app_surface_key: text("app_surface_key").notNull(),
    app_key: text("app_key").notNull(),
    provider: text("provider").notNull(),
    provider_record_type: text("provider_record_type").notNull(),
    provider_record_id: text("provider_record_id").notNull(),
    section_key: text("section_key").notNull(),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    created_by_user_id: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    updated_by_user_id: uuid("updated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_plugin_app_overlays_identity").on(
      table.tenant_id,
      table.plugin_install_id,
      table.app_surface_key,
      table.provider,
      table.provider_record_type,
      table.provider_record_id,
      table.section_key,
    ),
    index("idx_plugin_app_overlays_record").on(
      table.tenant_id,
      table.app_key,
      table.provider,
      table.provider_record_type,
      table.provider_record_id,
    ),
    index("idx_plugin_app_overlays_updated").on(
      table.tenant_id,
      table.app_key,
      table.updated_at,
    ),
  ],
);

export const pluginAppOverlaysRelations = relations(
  pluginAppOverlays,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [pluginAppOverlays.tenant_id],
      references: [tenants.id],
    }),
    pluginInstall: one(pluginInstalls, {
      fields: [pluginAppOverlays.plugin_install_id],
      references: [pluginInstalls.id],
    }),
    createdByUser: one(users, {
      fields: [pluginAppOverlays.created_by_user_id],
      references: [users.id],
    }),
    updatedByUser: one(users, {
      fields: [pluginAppOverlays.updated_by_user_id],
      references: [users.id],
    }),
  }),
);
