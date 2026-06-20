/**
 * Workflow engine/app bindings.
 *
 * A binding connects a product Workflow to an execution substrate or connected
 * app without making that backend the workflow identity. Existing Step
 * Functions Routines are the first active binding type.
 */

import {
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
import { tenants } from "./core";
import { managedApplications } from "./deployments";
import { pluginInstalls } from "./plugins";
import { routineAslVersions } from "./routine-asl-versions";
import { routines } from "./routines";
import { workflowVersions, workflows } from "./workflows";

export const WORKFLOW_BINDING_TYPES = [
  "step_functions_routine",
  "n8n_bridge",
  "n8n_import",
  "twenty_crm",
  "connected_app",
  "native",
] as const;

export type WorkflowBindingType = (typeof WORKFLOW_BINDING_TYPES)[number];

export const WORKFLOW_BINDING_STATUSES = [
  "configured",
  "ready",
  "blocked_not_ready",
  "disabled",
  "archived",
] as const;

export type WorkflowBindingStatus = (typeof WORKFLOW_BINDING_STATUSES)[number];

export const workflowEngineBindings = pgTable(
  "workflow_engine_bindings",
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
    binding_type: text("binding_type").notNull(),
    binding_status: text("binding_status").notNull().default("configured"),
    routine_id: uuid("routine_id").references(() => routines.id, {
      onDelete: "set null",
    }),
    routine_asl_version_id: uuid("routine_asl_version_id").references(
      () => routineAslVersions.id,
      { onDelete: "set null" },
    ),
    plugin_install_id: uuid("plugin_install_id").references(
      () => pluginInstalls.id,
      { onDelete: "set null" },
    ),
    managed_application_id: uuid("managed_application_id").references(
      () => managedApplications.id,
      { onDelete: "set null" },
    ),
    external_workflow_id: text("external_workflow_id"),
    external_workflow_name: text("external_workflow_name"),
    external_version_id: text("external_version_id"),
    connection_ref: jsonb("connection_ref")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    capability_flags: jsonb("capability_flags")
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
    index("workflow_engine_bindings_workflow_idx").on(table.workflow_id),
    index("workflow_engine_bindings_tenant_type_idx").on(
      table.tenant_id,
      table.binding_type,
    ),
    uniqueIndex("workflow_engine_bindings_step_routine_uidx")
      .on(table.tenant_id, table.routine_id)
      .where(sql`${table.routine_id} IS NOT NULL`),
    uniqueIndex("workflow_engine_bindings_external_uidx")
      .on(table.tenant_id, table.binding_type, table.external_workflow_id)
      .where(sql`${table.external_workflow_id} IS NOT NULL`),
    check(
      "workflow_engine_bindings_type_check",
      sql`${table.binding_type} IN ('step_functions_routine', 'n8n_bridge', 'n8n_import', 'twenty_crm', 'connected_app', 'native')`,
    ),
    check(
      "workflow_engine_bindings_status_check",
      sql`${table.binding_status} IN ('configured', 'ready', 'blocked_not_ready', 'disabled', 'archived')`,
    ),
    check(
      "workflow_engine_bindings_readiness_state_check",
      sql`${table.readiness_state} IN ('unknown', 'ready', 'blocked_not_ready', 'disabled')`,
    ),
  ],
);

export const workflowEngineBindingsRelations = relations(
  workflowEngineBindings,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [workflowEngineBindings.tenant_id],
      references: [tenants.id],
    }),
    workflow: one(workflows, {
      fields: [workflowEngineBindings.workflow_id],
      references: [workflows.id],
    }),
    workflowVersion: one(workflowVersions, {
      fields: [workflowEngineBindings.workflow_version_id],
      references: [workflowVersions.id],
    }),
    routine: one(routines, {
      fields: [workflowEngineBindings.routine_id],
      references: [routines.id],
    }),
    routineAslVersion: one(routineAslVersions, {
      fields: [workflowEngineBindings.routine_asl_version_id],
      references: [routineAslVersions.id],
    }),
    pluginInstall: one(pluginInstalls, {
      fields: [workflowEngineBindings.plugin_install_id],
      references: [pluginInstalls.id],
    }),
    managedApplication: one(managedApplications, {
      fields: [workflowEngineBindings.managed_application_id],
      references: [managedApplications.id],
    }),
  }),
);
