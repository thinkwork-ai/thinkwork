/**
 * Activity log — audit trail for tenant-scoped actions.
 */

import {
	pgTable,
	uuid,
	text,
	timestamp,
	jsonb,
	index,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants } from "./core";

export const activityLog = pgTable(
	"activity_log",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		actor_type: text("actor_type").notNull(),
		actor_id: uuid("actor_id").notNull(),
		action: text("action").notNull(),
		entity_type: text("entity_type"),
		entity_id: uuid("entity_id"),
		changes: jsonb("changes"),
		metadata: jsonb("metadata"),
		ip_address: text("ip_address"),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		index("idx_activity_log_tenant_created").on(
			table.tenant_id,
			table.created_at,
		),
		index("idx_activity_log_entity").on(
			table.entity_type,
			table.entity_id,
		),
		index("idx_activity_log_actor").on(
			table.actor_type,
			table.actor_id,
		),
	],
);

export const activityLogRelations = relations(activityLog, ({ one }) => ({
	tenant: one(tenants, {
		fields: [activityLog.tenant_id],
		references: [tenants.id],
	}),
}));
