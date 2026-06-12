/**
 * Agent Profile tables.
 *
 * Agent Profiles are tenant-global Pi subagent definitions. A profile can be
 * assigned to zero or more Spaces; when assigned, the same global definition is
 * available in those Spaces without per-Space edits.
 *
 * Space-local profiles (plan 2026-06-12-002 U7): a profile file under a Space
 * source's `agents/` folder projects into this table with `source_space_id`
 * set to that Space. `source_space_id IS NULL` means a central (agent-source)
 * profile. Slugs are unique per tenant within each origin scope, so a
 * space-local profile may intentionally collide with a central slug — the
 * space-local row shadows the central one while its Space is active.
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
import { spaces } from "./spaces.js";

export const agentProfiles = pgTable(
  "agent_profiles",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    routing_guidance: text("routing_guidance"),
    instructions: text("instructions").notNull().default(""),
    model_id: text("model_id").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    built_in_key: text("built_in_key"),
    // Origin discriminator: NULL = central profile (AGENT source `agents/`),
    // non-NULL = space-local profile projected from that Space source's
    // `agents/` folder. Cascade with the Space.
    source_space_id: uuid("source_space_id").references(() => spaces.id, {
      onDelete: "cascade",
    }),
    tool_policy: jsonb("tool_policy")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    skill_policy: jsonb("skill_policy")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    execution_controls: jsonb("execution_controls")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_agent_profiles_tenant_slug")
      .on(table.tenant_id, table.slug)
      .where(sql`${table.source_space_id} IS NULL`),
    uniqueIndex("uq_agent_profiles_tenant_slug_source_space")
      .on(table.tenant_id, table.slug, table.source_space_id)
      .where(sql`${table.source_space_id} IS NOT NULL`),
    uniqueIndex("uq_agent_profiles_tenant_built_in_key")
      .on(table.tenant_id, table.built_in_key)
      .where(sql`${table.built_in_key} IS NOT NULL`),
    index("idx_agent_profiles_tenant_enabled").on(
      table.tenant_id,
      table.enabled,
    ),
  ],
);

export const agentProfileSpaceAssignments = pgTable(
  "agent_profile_space_assignments",
  {
    profile_id: uuid("profile_id")
      .references(() => agentProfiles.id, { onDelete: "cascade" })
      .notNull(),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    space_id: uuid("space_id")
      .references(() => spaces.id, { onDelete: "cascade" })
      .notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_agent_profile_space_assignments").on(
      table.profile_id,
      table.space_id,
    ),
    index("idx_agent_profile_space_assignments_space").on(
      table.tenant_id,
      table.space_id,
    ),
  ],
);

export const agentProfilesRelations = relations(
  agentProfiles,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [agentProfiles.tenant_id],
      references: [tenants.id],
    }),
    sourceSpace: one(spaces, {
      fields: [agentProfiles.source_space_id],
      references: [spaces.id],
    }),
    spaceAssignments: many(agentProfileSpaceAssignments),
  }),
);

export const agentProfileSpaceAssignmentsRelations = relations(
  agentProfileSpaceAssignments,
  ({ one }) => ({
    profile: one(agentProfiles, {
      fields: [agentProfileSpaceAssignments.profile_id],
      references: [agentProfiles.id],
    }),
    tenant: one(tenants, {
      fields: [agentProfileSpaceAssignments.tenant_id],
      references: [tenants.id],
    }),
    space: one(spaces, {
      fields: [agentProfileSpaceAssignments.space_id],
      references: [spaces.id],
    }),
  }),
);
