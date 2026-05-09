/**
 * Connector domain table: connectors.
 *
 * Connector rows are tenant-scoped configuration and lifecycle records. This
 * table is inert until the connector chassis starts reading it in a follow-up
 * PR; U1 only establishes the durable schema seam.
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
	check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants } from "./core";
import { connections } from "./integrations";

export const connectors = pgTable(
	"connectors",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id, { onDelete: "cascade" })
			.notNull(),
		type: text("type").notNull(),
		name: text("name").notNull(),
		description: text("description"),
		status: text("status").notNull().default("active"),
		connection_id: uuid("connection_id").references(() => connections.id, {
			onDelete: "set null",
		}),
		config: jsonb("config"),
		dispatch_target_type: text("dispatch_target_type").notNull(),
		dispatch_target_id: uuid("dispatch_target_id").notNull(),
		/**
		 * Stable pointer to the `tenant_connector_catalog.slug` row this
		 * connector represents. Lets the apps/computer Customize page match
		 * Connected items unambiguously to a catalog row, instead of the
		 * fragile `connectors.type` heuristic.
		 */
		catalog_slug: text("catalog_slug"),
		last_poll_at: timestamp("last_poll_at", { withTimezone: true }),
		last_poll_cursor: text("last_poll_cursor"),
		next_poll_at: timestamp("next_poll_at", { withTimezone: true }),
		eb_schedule_name: text("eb_schedule_name"),
		enabled: boolean("enabled").notNull().default(true),
		created_by_type: text("created_by_type"),
		created_by_id: text("created_by_id"),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		uniqueIndex("uq_connectors_tenant_name").on(table.tenant_id, table.name),
		uniqueIndex("uq_connectors_catalog_slug_per_computer")
			.on(table.tenant_id, table.dispatch_target_id, table.catalog_slug)
			.where(
				sql`${table.dispatch_target_type} = 'computer' AND ${table.catalog_slug} IS NOT NULL`,
			),
		index("idx_connectors_tenant_status").on(table.tenant_id, table.status),
		index("idx_connectors_tenant_type").on(table.tenant_id, table.type),
		index("idx_connectors_enabled").on(table.tenant_id, table.enabled),
		check(
			"connectors_status_enum",
			sql`${table.status} IN ('active', 'paused', 'unhealthy', 'archived')`,
		),
		check(
			"connectors_dispatch_target_type_enum_v2",
			sql`${table.dispatch_target_type} IN ('agent', 'routine', 'hybrid_routine', 'computer')`,
		),
	],
);

export const connectorsRelations = relations(connectors, ({ one }) => ({
	tenant: one(tenants, {
		fields: [connectors.tenant_id],
		references: [tenants.id],
	}),
	connection: one(connections, {
		fields: [connectors.connection_id],
		references: [connections.id],
	}),
}));
