/**
 * Workflow control-plane identity tables.
 *
 * Workflows are the user-facing product records. Existing Routine rows remain
 * the Step Functions execution substrate and are attached through
 * workflow_engine_bindings rather than renamed in place.
 *
 * Plan: docs/plans/2026-06-20-001-feat-first-class-workflow-control-plane-plan.md (U1).
 */

import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { agents } from "./agents";
import { tenants, users } from "./core";
import { routineAslVersions } from "./routine-asl-versions";

export const WORKFLOW_LIFECYCLE_STATUSES = [
  "draft",
  "active",
  "deprecated",
  "archived",
] as const;

export type WorkflowLifecycleStatus =
  (typeof WORKFLOW_LIFECYCLE_STATUSES)[number];

export const WORKFLOW_VISIBILITIES = [
  "agent_private",
  "tenant_shared",
] as const;

export type WorkflowVisibility = (typeof WORKFLOW_VISIBILITIES)[number];

export const WORKFLOW_TRIGGER_FAMILIES = [
  "manual",
  "schedule",
  "webhook",
  "crm",
  "n8n",
  "api",
  "agent",
  "child_workflow",
] as const;

export type WorkflowTriggerFamily = (typeof WORKFLOW_TRIGGER_FAMILIES)[number];

export const WORKFLOW_READINESS_STATES = [
  "unknown",
  "ready",
  "blocked_not_ready",
  "disabled",
] as const;

export type WorkflowReadinessState = (typeof WORKFLOW_READINESS_STATES)[number];

export const WORKFLOW_VERSION_STATUSES = [
  "draft",
  "active",
  "superseded",
  "archived",
] as const;

export type WorkflowVersionStatus = (typeof WORKFLOW_VERSION_STATUSES)[number];

export const workflows = pgTable(
  "workflows",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    lifecycle_status: text("lifecycle_status").notNull().default("draft"),
    visibility: text("visibility").notNull().default("tenant_shared"),
    owner_user_id: uuid("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    owner_agent_id: uuid("owner_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    primary_trigger_family: text("primary_trigger_family")
      .notNull()
      .default("manual"),
    current_version_id: uuid("current_version_id"),
    current_version_number: integer("current_version_number"),
    capability_flags: jsonb("capability_flags")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    readiness_state: text("readiness_state").notNull().default("unknown"),
    readiness_reasons: jsonb("readiness_reasons")
      .$type<unknown[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    last_run_id: uuid("last_run_id"),
    last_run_at: timestamp("last_run_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("workflows_tenant_slug_uidx").on(table.tenant_id, table.slug),
    index("workflows_tenant_lifecycle_idx").on(
      table.tenant_id,
      table.lifecycle_status,
    ),
    index("workflows_tenant_readiness_idx").on(
      table.tenant_id,
      table.readiness_state,
    ),
    index("workflows_tenant_last_run_idx").on(
      table.tenant_id,
      table.last_run_at,
    ),
    check(
      "workflows_lifecycle_status_check",
      sql`${table.lifecycle_status} IN ('draft', 'active', 'deprecated', 'archived')`,
    ),
    check(
      "workflows_visibility_check",
      sql`${table.visibility} IN ('agent_private', 'tenant_shared')`,
    ),
    check(
      "workflows_trigger_family_check",
      sql`${table.primary_trigger_family} IN ('manual', 'schedule', 'webhook', 'crm', 'n8n', 'api', 'agent', 'child_workflow')`,
    ),
    check(
      "workflows_readiness_state_check",
      sql`${table.readiness_state} IN ('unknown', 'ready', 'blocked_not_ready', 'disabled')`,
    ),
  ],
);

export const workflowVersions = pgTable(
  "workflow_versions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    workflow_id: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    version_number: integer("version_number").notNull(),
    version_status: text("version_status").notNull().default("draft"),
    source_kind: text("source_kind")
      .notNull()
      .default("workflow_control_plane"),
    source_metadata: jsonb("source_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    definition_snapshot: jsonb("definition_snapshot")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    capability_snapshot: jsonb("capability_snapshot")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    routine_asl_version_id: uuid("routine_asl_version_id").references(
      () => routineAslVersions.id,
      { onDelete: "set null" },
    ),
    created_by_actor_type: text("created_by_actor_type"),
    created_by_actor_id: uuid("created_by_actor_id"),
    published_at: timestamp("published_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("workflow_versions_workflow_version_uidx").on(
      table.workflow_id,
      table.version_number,
    ),
    index("workflow_versions_tenant_workflow_idx").on(
      table.tenant_id,
      table.workflow_id,
    ),
    index("workflow_versions_routine_asl_idx").on(table.routine_asl_version_id),
    check(
      "workflow_versions_status_check",
      sql`${table.version_status} IN ('draft', 'active', 'superseded', 'archived')`,
    ),
  ],
);

export const workflowTriggers = pgTable(
  "workflow_triggers",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    workflow_id: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    workflow_version_id: uuid("workflow_version_id").references(
      () => workflowVersions.id,
      { onDelete: "set null" },
    ),
    trigger_family: text("trigger_family").notNull(),
    source_system: text("source_system"),
    enabled: boolean("enabled").notNull().default(true),
    idempotency_required: boolean("idempotency_required")
      .notNull()
      .default(true),
    trigger_config: jsonb("trigger_config")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    actor_contract: jsonb("actor_contract")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    readiness_state: text("readiness_state").notNull().default("unknown"),
    readiness_reasons: jsonb("readiness_reasons")
      .$type<unknown[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("workflow_triggers_workflow_enabled_idx").on(
      table.workflow_id,
      table.enabled,
    ),
    index("workflow_triggers_tenant_family_idx").on(
      table.tenant_id,
      table.trigger_family,
    ),
    check(
      "workflow_triggers_family_check",
      sql`${table.trigger_family} IN ('manual', 'schedule', 'webhook', 'crm', 'n8n', 'api', 'agent', 'child_workflow')`,
    ),
    check(
      "workflow_triggers_readiness_state_check",
      sql`${table.readiness_state} IN ('unknown', 'ready', 'blocked_not_ready', 'disabled')`,
    ),
  ],
);

export const workflowsRelations = relations(workflows, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [workflows.tenant_id],
    references: [tenants.id],
  }),
  ownerUser: one(users, {
    fields: [workflows.owner_user_id],
    references: [users.id],
  }),
  ownerAgent: one(agents, {
    fields: [workflows.owner_agent_id],
    references: [agents.id],
  }),
  versions: many(workflowVersions),
  triggers: many(workflowTriggers),
}));

export const workflowVersionsRelations = relations(
  workflowVersions,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [workflowVersions.tenant_id],
      references: [tenants.id],
    }),
    workflow: one(workflows, {
      fields: [workflowVersions.workflow_id],
      references: [workflows.id],
    }),
    routineAslVersion: one(routineAslVersions, {
      fields: [workflowVersions.routine_asl_version_id],
      references: [routineAslVersions.id],
    }),
  }),
);

export const workflowTriggersRelations = relations(
  workflowTriggers,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [workflowTriggers.tenant_id],
      references: [tenants.id],
    }),
    workflow: one(workflows, {
      fields: [workflowTriggers.workflow_id],
      references: [workflows.id],
    }),
    workflowVersion: one(workflowVersions, {
      fields: [workflowTriggers.workflow_version_id],
      references: [workflowVersions.id],
    }),
  }),
);
