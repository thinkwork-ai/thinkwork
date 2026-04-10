/**
 * Hive domain tables: hives, hive_agents, hive_users.
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
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants, users } from "./core";
import { agents } from "./agents";

// ---------------------------------------------------------------------------
// 3.1 — hives
// ---------------------------------------------------------------------------

export const hives = pgTable(
	"hives",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		name: text("name").notNull(),
		slug: text("slug").unique(),
		description: text("description"),
		type: text("type").notNull().default("team"),
		status: text("status").notNull().default("active"),
		budget_monthly_cents: integer("budget_monthly_cents"),
		metadata: jsonb("metadata"),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [index("idx_hives_tenant_id").on(table.tenant_id)],
);

// ---------------------------------------------------------------------------
// 3.2 — hive_agents
// ---------------------------------------------------------------------------

export const hiveAgents = pgTable(
	"hive_agents",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		hive_id: uuid("hive_id")
			.references(() => hives.id)
			.notNull(),
		agent_id: uuid("agent_id")
			.references(() => agents.id)
			.notNull(),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		role: text("role").notNull().default("member"),
		joined_at: timestamp("joined_at", { withTimezone: true }),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		uniqueIndex("uq_hive_agents_hive_agent").on(
			table.hive_id,
			table.agent_id,
		),
	],
);

// ---------------------------------------------------------------------------
// 3.3 — hive_users
// ---------------------------------------------------------------------------

export const hiveUsers = pgTable(
	"hive_users",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		hive_id: uuid("hive_id")
			.references(() => hives.id)
			.notNull(),
		user_id: uuid("user_id")
			.references(() => users.id)
			.notNull(),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		role: text("role").notNull().default("member"),
		joined_at: timestamp("joined_at", { withTimezone: true }),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		uniqueIndex("uq_hive_users_hive_user").on(
			table.hive_id,
			table.user_id,
		),
	],
);

// ---------------------------------------------------------------------------
// Relations (for Drizzle query builder)
// ---------------------------------------------------------------------------

export const hivesRelations = relations(hives, ({ one, many }) => ({
	tenant: one(tenants, {
		fields: [hives.tenant_id],
		references: [tenants.id],
	}),
	agents: many(hiveAgents),
	users: many(hiveUsers),
}));

export const hiveAgentsRelations = relations(
	hiveAgents,
	({ one }) => ({
		hive: one(hives, {
			fields: [hiveAgents.hive_id],
			references: [hives.id],
		}),
		agent: one(agents, {
			fields: [hiveAgents.agent_id],
			references: [agents.id],
		}),
		tenant: one(tenants, {
			fields: [hiveAgents.tenant_id],
			references: [tenants.id],
		}),
	}),
);

export const hiveUsersRelations = relations(hiveUsers, ({ one }) => ({
	hive: one(hives, {
		fields: [hiveUsers.hive_id],
		references: [hives.id],
	}),
	user: one(users, {
		fields: [hiveUsers.user_id],
		references: [users.id],
	}),
	tenant: one(tenants, {
		fields: [hiveUsers.tenant_id],
		references: [tenants.id],
	}),
}));

