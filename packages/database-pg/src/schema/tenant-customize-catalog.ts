/**
 * Per-tenant catalog tables that back the apps/computer Customize page's
 * Available / Discover sections for Connectors and Workflows. Skills already
 * have `tenant_skills` and MCP servers already have `tenant_mcp_servers`;
 * these two tables fill the missing per-kind catalogs.
 *
 * Plan: docs/plans/2026-05-09-006-feat-computer-customization-page-plan.md U9.
 */

import {
  pgTable,
  uuid,
  text,
  jsonb,
  boolean,
  timestamp,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants } from "./core.js";

export const tenantConnectorCatalog = pgTable(
  "tenant_connector_catalog",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    /** Stable per-tenant identifier the UI uses for enable/disable and ON CONFLICT seeding. */
    slug: text("slug").notNull(),
    /** "native" for built-in connectors, "mcp" reserved for future use (MCP catalog actually lives in tenant_mcp_servers). */
    kind: text("kind").notNull().default("native"),
    display_name: text("display_name").notNull(),
    description: text("description"),
    category: text("category"),
    icon: text("icon"),
    /** Default config copied into the `connectors` row when the user enables this catalog item. */
    default_config: jsonb("default_config").notNull().default({}),
    /** "active" = visible on Customize, "draft" = hidden, "archived" = hidden + non-enrollable. */
    status: text("status").notNull().default("active"),
    enabled: boolean("enabled").notNull().default(true),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_tenant_connector_catalog_slug").on(
      table.tenant_id,
      table.slug,
    ),
    index("idx_tenant_connector_catalog_tenant_status").on(
      table.tenant_id,
      table.status,
    ),
    check(
      "tenant_connector_catalog_kind_enum",
      sql`${table.kind} IN ('native','mcp')`,
    ),
    check(
      "tenant_connector_catalog_status_enum",
      sql`${table.status} IN ('active','draft','archived')`,
    ),
  ],
);

export const tenantWorkflowCatalog = pgTable(
  "tenant_workflow_catalog",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    slug: text("slug").notNull(),
    display_name: text("display_name").notNull(),
    description: text("description"),
    category: text("category"),
    icon: text("icon"),
    /** Default config copied into the `routines` row when the user enables this catalog item. */
    default_config: jsonb("default_config").notNull().default({}),
    /** Default schedule cron string, or null for on-demand workflows. */
    default_schedule: text("default_schedule"),
    status: text("status").notNull().default("active"),
    enabled: boolean("enabled").notNull().default(true),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_tenant_workflow_catalog_slug").on(
      table.tenant_id,
      table.slug,
    ),
    index("idx_tenant_workflow_catalog_tenant_status").on(
      table.tenant_id,
      table.status,
    ),
    check(
      "tenant_workflow_catalog_status_enum",
      sql`${table.status} IN ('active','draft','archived')`,
    ),
  ],
);

export const tenantConnectorCatalogRelations = relations(
  tenantConnectorCatalog,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [tenantConnectorCatalog.tenant_id],
      references: [tenants.id],
    }),
  }),
);

export const tenantWorkflowCatalogRelations = relations(
  tenantWorkflowCatalog,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [tenantWorkflowCatalog.tenant_id],
      references: [tenants.id],
    }),
  }),
);
