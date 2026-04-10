/**
 * User Quick Actions — per-user saved prompt shortcuts with optional workspace targeting.
 */

import {
	pgTable,
	uuid,
	text,
	integer,
	timestamp,
	index,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { users, tenants } from "./core";
import { agents } from "./agents";

export const userQuickActions = pgTable(
	"user_quick_actions",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		user_id: uuid("user_id")
			.references(() => users.id)
			.notNull(),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		title: text("title").notNull(),
		prompt: text("prompt").notNull(),
		workspace_agent_id: uuid("workspace_agent_id").references(() => agents.id),
		sort_order: integer("sort_order").notNull().default(0),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		index("idx_user_quick_actions_user").on(table.user_id),
		index("idx_user_quick_actions_tenant").on(table.tenant_id),
	],
);

export const userQuickActionsRelations = relations(userQuickActions, ({ one }) => ({
	user: one(users, {
		fields: [userQuickActions.user_id],
		references: [users.id],
	}),
	tenant: one(tenants, {
		fields: [userQuickActions.tenant_id],
		references: [tenants.id],
	}),
	workspaceAgent: one(agents, {
		fields: [userQuickActions.workspace_agent_id],
		references: [agents.id],
	}),
}));
