/**
 * Routine domain table: routines (definitions only).
 *
 * routine_runs, routine_steps, and routine_triggers have been removed —
 * replaced by trigger_runs / trigger_run_events / triggers (see scheduled-jobs.ts).
 *
 * Step Functions migration: as of plan 2026-05-01-004 (Routines Phase A),
 * each routine carries an `engine` partition (legacy_python | step_functions).
 * Step-functions-engine routines also have state_machine_arn, alias_arn,
 * documentation_md, and current_version columns. The legacy Python
 * `code` field still lives in `config: jsonb` on legacy_python rows;
 * those rows are archived in Phase E (U15) but not deleted.
 */

import {
	pgTable,
	uuid,
	text,
	integer,
	timestamp,
	jsonb,
	index,
	check,
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
		// Engine partition. legacy_python rows pre-date Phase A; step_functions
		// rows are the new ASL-backed shape. CHECK constraint enforces the
		// enum at the DB layer so resolvers can filter without joining.
		engine: text("engine").notNull().default("legacy_python"),
		// Step Functions resource ARNs. Null for legacy_python routines.
		state_machine_arn: text("state_machine_arn"),
		state_machine_alias_arn: text("state_machine_alias_arn"),
		// Agent-authored markdown summary, regenerated on every publish.
		// Surfaced alongside the execution graph in the run UI.
		documentation_md: text("documentation_md"),
		// Pointer to the latest published version_number in routine_asl_versions.
		// Null for legacy_python; sequential starting at 1 for step_functions.
		current_version: integer("current_version"),
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
		index("idx_routines_engine").on(table.engine),
		check(
			"routines_engine_enum",
			sql`${table.engine} IN ('legacy_python', 'step_functions')`,
		),
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
