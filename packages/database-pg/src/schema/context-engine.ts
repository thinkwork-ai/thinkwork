/**
 * Context Engine tenant-level provider policy.
 *
 * Built-in provider families are configured here. MCP providers keep their
 * approval/default state in tenant_mcp_context_tools so operators approve the
 * actual read-only/search-safe tool, not a whole server.
 */

import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./core.js";

export const tenantContextProviderSettings = pgTable(
  "tenant_context_provider_settings",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id)
      .notNull(),
    provider_id: text("provider_id").notNull(),
    family: text("family").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    default_enabled: boolean("default_enabled").notNull().default(false),
    config: jsonb("config").notNull().default({}),
    last_tested_at: timestamp("last_tested_at", { withTimezone: true }),
    last_test_state: text("last_test_state"),
    last_test_latency_ms: integer("last_test_latency_ms"),
    last_test_error: text("last_test_error"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_tenant_context_provider_settings_provider").on(
      table.tenant_id,
      table.provider_id,
    ),
    index("idx_tenant_context_provider_settings_tenant").on(table.tenant_id),
  ],
);
