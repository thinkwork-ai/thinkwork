/**
 * Routine domain table: routines (definitions only).
 *
 * routine_runs, routine_steps, and routine_triggers have been removed —
 * replaced by trigger_runs / trigger_run_events / triggers (see scheduled-jobs.ts).
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
import { agents } from "./agents";
import { teams } from "./teams";

// ---------------------------------------------------------------------------
// routines — routine definitions (code/config stays, scheduling moved to triggers)
// ---------------------------------------------------------------------------

export const routines = pgTable(
	"routines",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		team_id: uuid("team_id").references(() => teams.id),
		agent_id: uuid("agent_id").references(() => agents.id),
		name: text("name").notNull(),
		description: text("description"),
		type: text("type").notNull().default("scheduled"),
		status: text("status").notNull().default("active"),
		schedule: text("schedule"),
		config: jsonb("config"),
		last_run_at: timestamp("last_run_at", { withTimezone: true }),
		next_run_at: timestamp("next_run_at", { withTimezone: true }),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		index("idx_routines_tenant_id").on(table.tenant_id),
		index("idx_routines_status").on(table.status),
	],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const routinesRelations = relations(routines, ({ one }) => ({
	tenant: one(tenants, {
		fields: [routines.tenant_id],
		references: [tenants.id],
	}),
	team: one(teams, {
		fields: [routines.team_id],
		references: [teams.id],
	}),
	agent: one(agents, {
		fields: [routines.agent_id],
		references: [agents.id],
	}),
}));
