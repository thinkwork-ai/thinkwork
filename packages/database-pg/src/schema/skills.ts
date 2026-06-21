/**
 * Skill-adjacent domain tables.
 * Historical skill catalog and tenant install state now live in S3/workspace
 * files instead of database tables.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants, users } from "./core.js";
import { threads } from "./threads.js";
import { messages } from "./messages.js";

// ---------------------------------------------------------------------------
// plugin_uploads — LEGACY audit trail for the retired tenant zip-upload
// plugin flow (plan #007 §R1, R2; schema landed in migration 0025).
//
// The upload handler + sweeper were removed in plan 2026-06-12-001 U2;
// nothing reads or writes this table anymore. The export stays so drizzle
// stays consistent with the deployed schema — the DROP TABLE is a deferred
// follow-up per migration ordering rules (#1618).
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
// skill_catalog — per-tenant index of the S3 skill catalog
// (plan 2026-06-04-002 U1; migration 0144).
//
// A derived read cache, NOT a source of truth: S3 at
// `tenants/<slug>/skill-catalog/<slug>/` remains authoritative. This table
// exists so the Skills settings list resolves from one query instead of
// scanning S3 and reading every file per load. Written by the catalog
// put/delete/move handlers (write-through) and reconstructable from S3 by the
// `skill catalog rebuild` command. Unlike the dropped global `skill_catalog`
// (migration 0131), this is per-tenant, keyed (tenant_id, slug).
//
// `content_sha` mirrors `computeCatalogSkillSha` output and is display/
// freshness-only — reinstall drift checks recompute from S3 and never read it.
// ---------------------------------------------------------------------------

export const skillCatalog = pgTable(
  "skill_catalog",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    /** First path segment of the skill folder under skill-catalog/. */
    slug: text("slug").notNull(),
    /** From SKILL.md frontmatter `display_name`; null → render falls back to slug. */
    display_name: text("display_name"),
    description: text("description"),
    category: text("category"),
    icon: text("icon"),
    tags: text("tags").array(),
    /** computeCatalogSkillSha() of the skill's catalog files. Display-only. */
    content_sha: text("content_sha").notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_skill_catalog_tenant_slug").on(table.tenant_id, table.slug),
    index("idx_skill_catalog_tenant").on(table.tenant_id),
  ],
);

// ---------------------------------------------------------------------------
// skill_drafts — tenant-scoped generated/imported skill candidates
// (THNK-11 U1).
//
// Source-of-truth draft files live in S3 under
// `tenants/<tenant-slug>/skill-drafts/<draft-id>/`. These rows are the
// lifecycle/control-plane index used by authoring, trust, and operator review.
// The tenant skill catalog remains untouched until the publish transaction in a
// later unit.
// ---------------------------------------------------------------------------

export const skillDrafts = pgTable(
  "skill_drafts",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    requested_by_user_id: uuid("requested_by_user_id")
      .references(() => users.id)
      .notNull(),
    source_thread_id: uuid("source_thread_id").references(() => threads.id, {
      onDelete: "set null",
    }),
    source_message_id: uuid("source_message_id").references(() => messages.id, {
      onDelete: "set null",
    }),
    inbox_item_id: uuid("inbox_item_id"),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    display_name: text("display_name"),
    summary: text("summary"),
    source_kind: text("source_kind").notNull().default("thread"),
    status: text("status").notNull().default("draft"),
    current_content_hash: text("current_content_hash"),
    draft_s3_prefix: text("draft_s3_prefix").notNull(),
    failure_message: text("failure_message"),
    rejected_by_user_id: uuid("rejected_by_user_id").references(
      () => users.id,
      {
        onDelete: "set null",
      },
    ),
    rejected_at: timestamp("rejected_at", { withTimezone: true }),
    published_catalog_slug: text("published_catalog_slug"),
    published_content_hash: text("published_content_hash"),
    metadata: jsonb("metadata").notNull().default({}),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    submitted_at: timestamp("submitted_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_skill_drafts_tenant_status_updated").on(
      table.tenant_id,
      table.status,
      table.updated_at,
    ),
    index("idx_skill_drafts_tenant_requester").on(
      table.tenant_id,
      table.requested_by_user_id,
      table.updated_at,
    ),
    uniqueIndex("uq_skill_drafts_tenant_id").on(table.tenant_id, table.id),
    check(
      "skill_drafts_status_check",
      sql`${table.status} IN ('draft','submitted','rejected','failed')`,
    ),
    check(
      "skill_drafts_source_kind_check",
      sql`${table.source_kind} IN ('thread','archive','manual','existing_skill')`,
    ),
  ],
);

export const skillDraftEvents = pgTable(
  "skill_draft_events",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    draft_id: uuid("draft_id")
      .references(() => skillDrafts.id, { onDelete: "cascade" })
      .notNull(),
    actor_user_id: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    event_type: text("event_type").notNull(),
    message: text("message"),
    payload: jsonb("payload").notNull().default({}),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_skill_draft_events_draft_created").on(
      table.draft_id,
      table.created_at,
    ),
    index("idx_skill_draft_events_tenant_type").on(
      table.tenant_id,
      table.event_type,
    ),
    check(
      "skill_draft_events_type_check",
      sql`${table.event_type} IN ('created','updated','submitted','rejected','failed')`,
    ),
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

export const skillCatalogRelations = relations(skillCatalog, ({ one }) => ({
  tenant: one(tenants, {
    fields: [skillCatalog.tenant_id],
    references: [tenants.id],
  }),
}));

export const skillDraftsRelations = relations(skillDrafts, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [skillDrafts.tenant_id],
    references: [tenants.id],
  }),
  requester: one(users, {
    fields: [skillDrafts.requested_by_user_id],
    references: [users.id],
  }),
  sourceThread: one(threads, {
    fields: [skillDrafts.source_thread_id],
    references: [threads.id],
  }),
  sourceMessage: one(messages, {
    fields: [skillDrafts.source_message_id],
    references: [messages.id],
  }),
  events: many(skillDraftEvents),
}));

export const skillDraftEventsRelations = relations(
  skillDraftEvents,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [skillDraftEvents.tenant_id],
      references: [tenants.id],
    }),
    draft: one(skillDrafts, {
      fields: [skillDraftEvents.draft_id],
      references: [skillDrafts.id],
    }),
    actor: one(users, {
      fields: [skillDraftEvents.actor_user_id],
      references: [users.id],
    }),
  }),
);
