/**
 * Team domain tables: teams, team_agents, team_users.
 *
 * Teams are organizational groupings within a tenant, with their own
 * budget controls and agent/user membership.
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
// teams
// ---------------------------------------------------------------------------

export const teams = pgTable(
	"teams",
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
	(table) => [index("idx_teams_tenant_id").on(table.tenant_id)],
);

// ---------------------------------------------------------------------------
// team_agents
// ---------------------------------------------------------------------------

export const teamAgents = pgTable(
	"team_agents",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		team_id: uuid("team_id")
			.references(() => teams.id)
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
		uniqueIndex("uq_team_agents_team_agent").on(
			table.team_id,
			table.agent_id,
		),
	],
);

// ---------------------------------------------------------------------------
// team_users
// ---------------------------------------------------------------------------

export const teamUsers = pgTable(
	"team_users",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		team_id: uuid("team_id")
			.references(() => teams.id)
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
		uniqueIndex("uq_team_users_team_user").on(
			table.team_id,
			table.user_id,
		),
	],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const teamsRelations = relations(teams, ({ one, many }) => ({
	tenant: one(tenants, {
		fields: [teams.tenant_id],
		references: [tenants.id],
	}),
	agents: many(teamAgents),
	users: many(teamUsers),
}));

export const teamAgentsRelations = relations(
	teamAgents,
	({ one }) => ({
		team: one(teams, {
			fields: [teamAgents.team_id],
			references: [teams.id],
		}),
		agent: one(agents, {
			fields: [teamAgents.agent_id],
			references: [agents.id],
		}),
		tenant: one(tenants, {
			fields: [teamAgents.tenant_id],
			references: [tenants.id],
		}),
	}),
);

export const teamUsersRelations = relations(teamUsers, ({ one }) => ({
	team: one(teams, {
		fields: [teamUsers.team_id],
		references: [teams.id],
	}),
	user: one(users, {
		fields: [teamUsers.user_id],
		references: [users.id],
	}),
	tenant: one(tenants, {
		fields: [teamUsers.tenant_id],
		references: [tenants.id],
	}),
}));
