/**
 * Routine ASL versions domain table: routine_asl_versions.
 *
 * Mirrors the canonical ASL JSON for query/audit. Step Functions versions
 * + aliases are the source of truth for what runs; this table exists so
 * the run UI and validator don't pay AWS API calls per render.
 *
 * Each row corresponds to a published version (state machine version
 * created via PublishStateMachineVersion). The alias either points at
 * this version (when published) or a later one (after pointer-flip).
 *
 * Plan: docs/plans/2026-05-01-004-feat-routines-phase-a-substrate-plan.md (U2).
 */

import {
	pgTable,
	uuid,
	text,
	timestamp,
	jsonb,
	integer,
	uniqueIndex,
	index,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants } from "./core";
import { routines } from "./routines";

export const routineAslVersions = pgTable(
	"routine_asl_versions",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		routine_id: uuid("routine_id")
			.references(() => routines.id)
			.notNull(),
		// Sequential per-routine version number, starting at 1 on createRoutine.
		version_number: integer("version_number").notNull(),
		state_machine_arn: text("state_machine_arn").notNull(),
		// Step Functions PublishStateMachineVersion returns a versioned ARN
		// like arn:aws:states:...stateMachine:NAME:1
		version_arn: text("version_arn").notNull(),
		// Snapshot of which version the alias was pointing at when this
		// version was published (audit only).
		alias_was_pointing: text("alias_was_pointing"),
		// Canonical ASL JSON the chat builder agent emitted.
		asl_json: jsonb("asl_json").notNull(),
		// Agent-authored markdown summary for human readers. Regenerated
		// whenever the routine is edited; not auto-derived from ASL.
		markdown_summary: text("markdown_summary").notNull(),
		// Structured step manifest: list of { nodeId, recipeType, displayTitle }
		// the run UI consumes to render the execution graph without re-parsing
		// ASL on every render.
		step_manifest_json: jsonb("step_manifest_json").notNull(),
		// Validator output (warnings only — errors block publish so are
		// never persisted). Rendered as advisory pills on the version.
		validation_warnings_json: jsonb("validation_warnings_json"),
		// Who published this version. For a chat-built routine this is the
		// authenticated user; for an agent-stamped routine this is the agent
		// id. ThinkWork-eng-promoted versions get actor_type='operator'.
		published_by_actor_id: uuid("published_by_actor_id"),
		published_by_actor_type: text("published_by_actor_type"), // user | agent | operator
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		uniqueIndex("idx_routine_asl_versions_routine_version").on(
			table.routine_id,
			table.version_number,
		),
		index("idx_routine_asl_versions_tenant_routine").on(
			table.tenant_id,
			table.routine_id,
		),
	],
);

export const routineAslVersionsRelations = relations(
	routineAslVersions,
	({ one }) => ({
		tenant: one(tenants, {
			fields: [routineAslVersions.tenant_id],
			references: [tenants.id],
		}),
		routine: one(routines, {
			fields: [routineAslVersions.routine_id],
			references: [routines.id],
		}),
	}),
);
