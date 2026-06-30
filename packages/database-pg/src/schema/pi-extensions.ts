/**
 * Dynamic Pi extension registry.
 *
 * Pi extensions are executable runtime capabilities, not workspace skills,
 * MCP servers, or built-in tools. These tables model reviewed source versions
 * and explicit Default Agent / Agent Profile assignments. Runtime execution is
 * intentionally gated by version status plus assignment state.
 */

import {
  boolean,
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
import { agentProfiles } from "./agent-profiles.js";
import { tenants, users } from "./core.js";

export const PI_EXTENSION_SOURCE_TYPES = ["github"] as const;
export type PiExtensionSourceType = (typeof PI_EXTENSION_SOURCE_TYPES)[number];

export const PI_EXTENSION_VERSION_STATUSES = [
  "imported",
  "needs_review",
  "approved",
  "rejected",
  "failed_verification",
] as const;
export type PiExtensionVersionStatus =
  (typeof PI_EXTENSION_VERSION_STATUSES)[number];

export const PI_EXTENSION_ASSIGNMENT_TARGET_TYPES = [
  "default_agent",
  "agent_profile",
] as const;
export type PiExtensionAssignmentTargetType =
  (typeof PI_EXTENSION_ASSIGNMENT_TARGET_TYPES)[number];

export const piExtensionSources = pgTable(
  "pi_extension_sources",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    source_type: text("source_type").notNull().default("github"),
    repository_url: text("repository_url").notNull(),
    repository_owner: text("repository_owner"),
    repository_name: text("repository_name"),
    display_name: text("display_name"),
    created_by_user_id: uuid("created_by_user_id").references(() => users.id, {
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
    uniqueIndex("uq_pi_extension_sources_tenant_repository").on(
      table.tenant_id,
      table.source_type,
      table.repository_url,
    ),
    index("idx_pi_extension_sources_tenant").on(table.tenant_id),
    check(
      "pi_extension_sources_source_type_check",
      sql`${table.source_type} IN ('github')`,
    ),
  ],
);

export const piExtensionVersions = pgTable(
  "pi_extension_versions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    source_id: uuid("source_id")
      .notNull()
      .references(() => piExtensionSources.id, { onDelete: "cascade" }),
    display_name: text("display_name"),
    description: text("description"),
    source_ref: text("source_ref").notNull(),
    commit_sha: text("commit_sha"),
    manifest_hash: text("manifest_hash"),
    artifact_hash: text("artifact_hash"),
    artifact_uri: text("artifact_uri"),
    runtime_target: text("runtime_target"),
    status: text("status").notNull().default("imported"),
    status_reason: text("status_reason"),
    manifest: jsonb("manifest")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    tool_names: text("tool_names")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    lifecycle_hooks: text("lifecycle_hooks")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    permission_classes: text("permission_classes")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    verification_report: jsonb("verification_report")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    reviewed_by_user_id: uuid("reviewed_by_user_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    reviewed_at: timestamp("reviewed_at", { withTimezone: true }),
    approved_by_user_id: uuid("approved_by_user_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    approved_at: timestamp("approved_at", { withTimezone: true }),
    rejected_by_user_id: uuid("rejected_by_user_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    rejected_at: timestamp("rejected_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_pi_extension_versions_source_commit").on(
      table.tenant_id,
      table.source_id,
      table.commit_sha,
    ),
    index("idx_pi_extension_versions_tenant_status").on(
      table.tenant_id,
      table.status,
    ),
    index("idx_pi_extension_versions_source").on(table.source_id),
    check(
      "pi_extension_versions_status_check",
      sql`${table.status} IN ('imported','needs_review','approved','rejected','failed_verification')`,
    ),
  ],
);

export const piExtensionAssignments = pgTable(
  "pi_extension_assignments",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    version_id: uuid("version_id")
      .notNull()
      .references(() => piExtensionVersions.id, { onDelete: "cascade" }),
    target_type: text("target_type").notNull(),
    agent_profile_id: uuid("agent_profile_id").references(
      () => agentProfiles.id,
      { onDelete: "cascade" },
    ),
    enabled: boolean("enabled").notNull().default(true),
    granted_permissions: jsonb("granted_permissions")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    assigned_by_user_id: uuid("assigned_by_user_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_pi_extension_assignments_default_version")
      .on(table.tenant_id, table.version_id)
      .where(sql`${table.target_type} = 'default_agent'`),
    uniqueIndex("uq_pi_extension_assignments_profile_version")
      .on(table.tenant_id, table.agent_profile_id, table.version_id)
      .where(sql`${table.target_type} = 'agent_profile'`),
    index("idx_pi_extension_assignments_tenant_target").on(
      table.tenant_id,
      table.target_type,
      table.agent_profile_id,
    ),
    index("idx_pi_extension_assignments_version").on(table.version_id),
    check(
      "pi_extension_assignments_target_type_check",
      sql`${table.target_type} IN ('default_agent','agent_profile')`,
    ),
    check(
      "pi_extension_assignments_profile_target_check",
      sql`(${table.target_type} = 'agent_profile' AND ${table.agent_profile_id} IS NOT NULL) OR (${table.target_type} = 'default_agent' AND ${table.agent_profile_id} IS NULL)`,
    ),
  ],
);

export const piExtensionSourcesRelations = relations(
  piExtensionSources,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [piExtensionSources.tenant_id],
      references: [tenants.id],
    }),
    createdByUser: one(users, {
      fields: [piExtensionSources.created_by_user_id],
      references: [users.id],
    }),
    versions: many(piExtensionVersions),
  }),
);

export const piExtensionVersionsRelations = relations(
  piExtensionVersions,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [piExtensionVersions.tenant_id],
      references: [tenants.id],
    }),
    source: one(piExtensionSources, {
      fields: [piExtensionVersions.source_id],
      references: [piExtensionSources.id],
    }),
    reviewedByUser: one(users, {
      fields: [piExtensionVersions.reviewed_by_user_id],
      references: [users.id],
    }),
    approvedByUser: one(users, {
      fields: [piExtensionVersions.approved_by_user_id],
      references: [users.id],
    }),
    rejectedByUser: one(users, {
      fields: [piExtensionVersions.rejected_by_user_id],
      references: [users.id],
    }),
    assignments: many(piExtensionAssignments),
  }),
);

export const piExtensionAssignmentsRelations = relations(
  piExtensionAssignments,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [piExtensionAssignments.tenant_id],
      references: [tenants.id],
    }),
    version: one(piExtensionVersions, {
      fields: [piExtensionAssignments.version_id],
      references: [piExtensionVersions.id],
    }),
    agentProfile: one(agentProfiles, {
      fields: [piExtensionAssignments.agent_profile_id],
      references: [agentProfiles.id],
    }),
    assignedByUser: one(users, {
      fields: [piExtensionAssignments.assigned_by_user_id],
      references: [users.id],
    }),
  }),
);
