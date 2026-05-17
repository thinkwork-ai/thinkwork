/**
 * ThinkWork Computer domain tables.
 *
 * Computers are the durable per-user workplace. Agent rows remain the
 * delegated-worker/runtime substrate; this table owns the user-facing Computer
 * identity and future runtime/work queue state.
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants, users } from "./core.js";
import { agents } from "./agents.js";
import { agentTemplates } from "./agent-templates.js";
import { teams } from "./teams.js";

export const computers = pgTable(
  "computers",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    owner_user_id: uuid("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    template_id: uuid("template_id")
      .references(() => agentTemplates.id)
      .notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    scope: text("scope").notNull().default("shared"),
    status: text("status").notNull().default("active"),
    desired_runtime_status: text("desired_runtime_status")
      .notNull()
      .default("running"),
    runtime_status: text("runtime_status").notNull().default("pending"),
    runtime_config: jsonb("runtime_config"),
    live_workspace_root: text("live_workspace_root"),
    efs_access_point_id: text("efs_access_point_id"),
    ecs_service_name: text("ecs_service_name"),
    last_heartbeat_at: timestamp("last_heartbeat_at", { withTimezone: true }),
    last_active_at: timestamp("last_active_at", { withTimezone: true }),
    budget_monthly_cents: integer("budget_monthly_cents"),
    spent_monthly_cents: integer("spent_monthly_cents").default(0),
    budget_paused_at: timestamp("budget_paused_at", { withTimezone: true }),
    budget_paused_reason: text("budget_paused_reason"),
    migrated_from_agent_id: uuid("migrated_from_agent_id").references(
      () => agents.id,
    ),
    /**
     * Anchor agent for per-agent bindings (skills, MCP servers, routines)
     * surfaced through the Customize page. Backfilled from
     * `migrated_from_agent_id` where present and resolved from
     * `(tenant_id, owner_user_id, template_id)` for greenfield Computers.
     */
    primary_agent_id: uuid("primary_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    migration_metadata: jsonb("migration_metadata"),
    created_by: uuid("created_by").references(() => users.id),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_computers_tenant_slug").on(table.tenant_id, table.slug),
    index("idx_computers_tenant_status").on(table.tenant_id, table.status),
    index("idx_computers_tenant_scope_status").on(
      table.tenant_id,
      table.scope,
      table.status,
    ),
    index("idx_computers_owner").on(table.owner_user_id),
    index("idx_computers_template").on(table.template_id),
    index("idx_computers_migrated_agent").on(table.migrated_from_agent_id),
    index("idx_computers_primary_agent").on(table.primary_agent_id),
    check(
      "computers_scope_allowed",
      sql`${table.scope} IN ('shared','historical_personal')`,
    ),
    check(
      "computers_status_allowed",
      sql`${table.status} IN ('active','provisioning','failed','archived')`,
    ),
    check(
      "computers_desired_runtime_status_allowed",
      sql`${table.desired_runtime_status} IN ('running','stopped')`,
    ),
    check(
      "computers_runtime_status_allowed",
      sql`${table.runtime_status} IN ('pending','starting','running','stopped','failed','unknown')`,
    ),
  ],
);

export const computerAssignments = pgTable(
  "computer_assignments",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    computer_id: uuid("computer_id")
      .references(() => computers.id, { onDelete: "cascade" })
      .notNull(),
    subject_type: text("subject_type").notNull(),
    user_id: uuid("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    team_id: uuid("team_id").references(() => teams.id, {
      onDelete: "cascade",
    }),
    role: text("role").notNull().default("member"),
    assigned_by_user_id: uuid("assigned_by_user_id").references(
      () => users.id,
      {
        onDelete: "set null",
      },
    ),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_computer_assignments_user")
      .on(table.tenant_id, table.computer_id, table.user_id)
      .where(sql`${table.user_id} IS NOT NULL`),
    uniqueIndex("uq_computer_assignments_team")
      .on(table.tenant_id, table.computer_id, table.team_id)
      .where(sql`${table.team_id} IS NOT NULL`),
    index("idx_computer_assignments_computer").on(table.computer_id),
    index("idx_computer_assignments_tenant_user").on(
      table.tenant_id,
      table.user_id,
    ),
    index("idx_computer_assignments_tenant_team").on(
      table.tenant_id,
      table.team_id,
    ),
    check(
      "computer_assignments_subject_type_allowed",
      sql`${table.subject_type} IN ('user','team')`,
    ),
    check(
      "computer_assignments_subject_matches_target",
      sql`(
        (${table.subject_type} = 'user' AND ${table.user_id} IS NOT NULL AND ${table.team_id} IS NULL)
        OR
        (${table.subject_type} = 'team' AND ${table.team_id} IS NOT NULL AND ${table.user_id} IS NULL)
      )`,
    ),
  ],
);

export const computerTasks = pgTable(
  "computer_tasks",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    computer_id: uuid("computer_id")
      .references(() => computers.id, { onDelete: "cascade" })
      .notNull(),
    task_type: text("task_type").notNull(),
    status: text("status").notNull().default("pending"),
    input: jsonb("input"),
    output: jsonb("output"),
    error: jsonb("error"),
    idempotency_key: text("idempotency_key"),
    claimed_at: timestamp("claimed_at", { withTimezone: true }),
    completed_at: timestamp("completed_at", { withTimezone: true }),
    created_by_user_id: uuid("created_by_user_id").references(() => users.id),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_computer_tasks_idempotency")
      .on(table.tenant_id, table.computer_id, table.idempotency_key)
      .where(sql`${table.idempotency_key} IS NOT NULL`),
    index("idx_computer_tasks_computer_status").on(
      table.computer_id,
      table.status,
    ),
    index("idx_computer_tasks_tenant_status").on(table.tenant_id, table.status),
    check(
      "computer_tasks_status_allowed",
      sql`${table.status} IN ('pending','running','completed','failed','cancelled')`,
    ),
  ],
);

export const computerEvents = pgTable(
  "computer_events",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    computer_id: uuid("computer_id")
      .references(() => computers.id, { onDelete: "cascade" })
      .notNull(),
    task_id: uuid("task_id").references(() => computerTasks.id, {
      onDelete: "set null",
    }),
    event_type: text("event_type").notNull(),
    level: text("level").notNull().default("info"),
    payload: jsonb("payload"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_computer_events_computer_created").on(
      table.computer_id,
      table.created_at,
    ),
    index("idx_computer_events_task").on(table.task_id),
    check(
      "computer_events_level_allowed",
      sql`${table.level} IN ('debug','info','warn','error')`,
    ),
  ],
);

export const computerSnapshots = pgTable(
  "computer_snapshots",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    computer_id: uuid("computer_id")
      .references(() => computers.id, { onDelete: "cascade" })
      .notNull(),
    task_id: uuid("task_id").references(() => computerTasks.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull().default("pending"),
    s3_prefix: text("s3_prefix").notNull(),
    manifest: jsonb("manifest"),
    error: jsonb("error"),
    completed_at: timestamp("completed_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_computer_snapshots_computer_created").on(
      table.computer_id,
      table.created_at,
    ),
    check(
      "computer_snapshots_status_allowed",
      sql`${table.status} IN ('pending','completed','failed')`,
    ),
  ],
);

export const computersRelations = relations(computers, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [computers.tenant_id],
    references: [tenants.id],
  }),
  owner: one(users, {
    fields: [computers.owner_user_id],
    references: [users.id],
  }),
  template: one(agentTemplates, {
    fields: [computers.template_id],
    references: [agentTemplates.id],
  }),
  migratedFromAgent: one(agents, {
    fields: [computers.migrated_from_agent_id],
    references: [agents.id],
  }),
  assignments: many(computerAssignments),
  tasks: many(computerTasks),
  events: many(computerEvents),
  snapshots: many(computerSnapshots),
}));

export const computerAssignmentsRelations = relations(
  computerAssignments,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [computerAssignments.tenant_id],
      references: [tenants.id],
    }),
    computer: one(computers, {
      fields: [computerAssignments.computer_id],
      references: [computers.id],
    }),
    user: one(users, {
      fields: [computerAssignments.user_id],
      references: [users.id],
    }),
    team: one(teams, {
      fields: [computerAssignments.team_id],
      references: [teams.id],
    }),
    assignedBy: one(users, {
      fields: [computerAssignments.assigned_by_user_id],
      references: [users.id],
    }),
  }),
);
