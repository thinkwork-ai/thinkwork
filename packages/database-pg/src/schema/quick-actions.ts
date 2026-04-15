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
		// Discriminator for which surface the action applies to: "thread"
		// (the default — Start-a-thread footer) or "task" (the Tasks-tab
		// footer). Existing rows backfill to "thread" via the column
		// default so current users see no behavior change. sort_order is
		// per-surface so reordering one list doesn't shuffle the other.
		scope: text("scope").notNull().default("thread"),
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
		// Scope filtering is the common read path after this change. The
		// composite index lets the userQuickActions query hit a single
		// index instead of filtering + scope-matching.
		index("idx_user_quick_actions_user_tenant_scope").on(
			table.user_id,
			table.tenant_id,
			table.scope,
		),
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
