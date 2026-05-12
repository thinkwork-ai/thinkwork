/**
 * Template-level Computer runbook assignments.
 *
 * Runbook visibility is scoped by agent template rather than by catalog file
 * presence. This lets tenant teams expose different starter runbooks to
 * different Computer templates without introducing a separate template entity.
 */

import {
  pgTable,
  uuid,
  boolean,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
  foreignKey,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { agentTemplates } from "./agent-templates";
import { tenants } from "./core";
import { tenantRunbookCatalog } from "./runbooks";

export const agentTemplateRunbookAssignments = pgTable(
  "agent_template_runbook_assignments",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    template_id: uuid("template_id").notNull(),
    catalog_id: uuid("catalog_id").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    config: jsonb("config"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_agent_template_runbook_assignments").on(
      table.template_id,
      table.catalog_id,
    ),
    index("idx_agent_template_runbook_assignments_template").on(
      table.template_id,
    ),
    index("idx_agent_template_runbook_assignments_catalog").on(
      table.catalog_id,
    ),
    foreignKey({
      name: "fk_agent_template_runbook_assignments_template_tenant",
      columns: [table.tenant_id, table.template_id],
      foreignColumns: [agentTemplates.tenant_id, agentTemplates.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "fk_agent_template_runbook_assignments_catalog_tenant",
      columns: [table.tenant_id, table.catalog_id],
      foreignColumns: [tenantRunbookCatalog.tenant_id, tenantRunbookCatalog.id],
    }).onDelete("cascade"),
  ],
);

export const agentTemplateRunbookAssignmentsRelations = relations(
  agentTemplateRunbookAssignments,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [agentTemplateRunbookAssignments.tenant_id],
      references: [tenants.id],
    }),
    template: one(agentTemplates, {
      fields: [agentTemplateRunbookAssignments.template_id],
      references: [agentTemplates.id],
    }),
    catalogItem: one(tenantRunbookCatalog, {
      fields: [agentTemplateRunbookAssignments.catalog_id],
      references: [tenantRunbookCatalog.id],
    }),
  }),
);
