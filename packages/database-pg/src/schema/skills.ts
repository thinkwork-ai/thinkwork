/**
 * Skill-adjacent domain tables.
 * Historical skill catalog and tenant install state now live in S3/workspace
 * files instead of database tables.
 */

import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants } from "./core.js";

// ---------------------------------------------------------------------------
// plugin_uploads — audit trail for tenant self-serve plugin uploads
// (plan #007 §R1, R2; schema landed in migration 0025).
//
// Each POST /api/plugins/upload writes a row in phase 1 of the three-phase
// saga (plan §U10). Survives later-phase failures as a durable record; a
// hourly sweeper reaps orphan staging > 1h. The U10 handler is the only
// writer; read-only from GraphQL.
// ---------------------------------------------------------------------------

export const pluginUploads = pgTable(
  "plugin_uploads",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    /** Admin user who initiated the upload. Nullable for system-attributed paths. */
    uploaded_by: uuid("uploaded_by"),
    uploaded_at: timestamp("uploaded_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    /** Content hash of the plugin zip. Lets the saga dedupe idempotent re-uploads. */
    bundle_sha256: text("bundle_sha256").notNull(),
    /** Parsed from plugin.json `name`. */
    plugin_name: text("plugin_name").notNull(),
    /** Parsed from plugin.json `version` when present. */
    plugin_version: text("plugin_version"),
    /** Three-phase saga status: 'staging' → 'installed' | 'failed'. */
    status: text("status").notNull().default("staging"),
    /** Intermediate S3 upload key before phase-2 rename to canonical path. */
    s3_staging_prefix: text("s3_staging_prefix"),
    /** Populated on failure. Null for `staging` and `installed`. */
    error_message: text("error_message"),
  },
  (table) => [
    index("idx_plugin_uploads_tenant").on(table.tenant_id),
    // Partial index matches the sweeper predicate `WHERE status='staging'`.
    index("idx_plugin_uploads_status").on(table.status, table.uploaded_at),
  ],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const pluginUploadsRelations = relations(pluginUploads, ({ one }) => ({
  tenant: one(tenants, {
    fields: [pluginUploads.tenant_id],
    references: [tenants.id],
  }),
}));
