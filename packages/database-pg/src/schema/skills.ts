/**
 * Skill Catalog domain tables: skill_catalog, tenant_skills.
 * PRD-31: Skills Catalog Upgrade
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  boolean,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants } from "./core.js";

// ---------------------------------------------------------------------------
// skill_catalog — canonical catalog metadata (replaces S3 index.json)
// ---------------------------------------------------------------------------

export const skillCatalog = pgTable(
  "skill_catalog",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    slug: text("slug").notNull().unique(),
    /** Human-readable display name (from SKILL.md frontmatter `display_name`) */
    display_name: text("display_name").notNull(),
    description: text("description"),
    category: text("category"),
    version: text("version").notNull(),
    author: text("author").notNull().default("thinkwork"),
    icon: text("icon"),
    tags: text("tags").array(),
    /** 'builtin' | 'community' */
    source: text("source").notNull().default("builtin"),
    /** Auto-install for all tenants */
    is_default: boolean("is_default").notNull().default(false),
    requires_env: text("requires_env").array(),
    oauth_provider: text("oauth_provider"),
    oauth_scopes: text("oauth_scopes").array(),
    /** Linked MCP server name (transitional — migrates to script) */
    mcp_server: text("mcp_server"),
    mcp_tools: text("mcp_tools").array(),
    /** Skill slugs this skill depends on */
    dependencies: text("dependencies").array(),
    /** Trigger phrases for progressive disclosure tier-1 matching */
    triggers: text("triggers").array(),
    /** Cached YAML frontmatter for fast tier-1 loading */
    tier1_metadata: jsonb("tier1_metadata"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_skill_catalog_category").on(table.category),
  ],
);

// ---------------------------------------------------------------------------
// tenant_skills — tracks which skills each tenant has installed
// ---------------------------------------------------------------------------

export const tenantSkills = pgTable(
  "tenant_skills",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id)
      .notNull(),
    /** Skill slug from SKILL.md frontmatter `name:` */
    skill_id: text("skill_id").notNull(),
    /** 'builtin' | 'catalog' | 'tenant' */
    source: text("source").notNull().default("catalog"),
    /** Installed version */
    version: text("version"),
    /** Version from catalog at time of install */
    catalog_version: text("catalog_version"),
    config: jsonb("config"),
    enabled: boolean("enabled").notNull().default(true),
    installed_at: timestamp("installed_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_tenant_skills").on(table.tenant_id, table.skill_id),
    index("idx_tenant_skills_tenant_source").on(table.tenant_id, table.source),
  ],
);

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

export const tenantSkillsRelations = relations(tenantSkills, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tenantSkills.tenant_id],
    references: [tenants.id],
  }),
}));

export const pluginUploadsRelations = relations(pluginUploads, ({ one }) => ({
  tenant: one(tenants, {
    fields: [pluginUploads.tenant_id],
    references: [tenants.id],
  }),
}));
