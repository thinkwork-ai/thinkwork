/**
 * skill_runs — audit log + idempotency surface for composition invocations.
 *
 * NOT an execution substrate: runs complete in-process inside a single
 * AgentCore Runtime session (plan D1). This table only records what was
 * invoked, by whom, with what inputs, how it finished, and what artifact
 * came out. Phase-level intermediates live in the composition runner's
 * process memory — nothing here tracks them.
 *
 * Dedup lives in a partial unique index on
 *   (tenant_id, invoker_user_id, skill_id, resolved_inputs_hash)
 *   WHERE status = 'running'
 * so that a second startSkillRun with identical inputs while the first is
 * still running returns the existing runId instead of kicking off a
 * duplicate.
 *
 * Retention: delete_at defaults now() + 30d, capped at 180d per the plan's
 * hard PII ceiling (R11). Nightly sweep job deletes rows past delete_at.
 */

import {
	pgTable,
	uuid,
	text,
	integer,
	timestamp,
	jsonb,
	index,
	uniqueIndex,
	check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants } from "./core";
import { agents } from "./agents";

// Allowed values for the status + invocation_source + feedback_signal
// columns. Enforced at the resolver boundary; kept as plain text for
// migration flexibility (matches scheduled_jobs.trigger_type convention).
export const SKILL_RUN_STATUSES = [
	"running",
	"complete",
	"failed",
	"cancelled",
	"invoker_deprovisioned",
	"skipped_disabled",
	"cost_bounded_error",
] as const;
export type SkillRunStatus = (typeof SKILL_RUN_STATUSES)[number];

export const SKILL_RUN_INVOCATION_SOURCES = [
	"chat",
	"scheduled",
	"catalog",
	"webhook",
] as const;
export type SkillRunInvocationSource =
	(typeof SKILL_RUN_INVOCATION_SOURCES)[number];

export const SKILL_RUN_FEEDBACK_SIGNALS = ["positive", "negative"] as const;
export type SkillRunFeedbackSignal =
	(typeof SKILL_RUN_FEEDBACK_SIGNALS)[number];

export const MAX_RETENTION_DAYS = 180;
export const DEFAULT_RETENTION_DAYS = 30;

export const skillRuns = pgTable(
	"skill_runs",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		// Optional — webhook-invoked runs associate with an agent owner, but
		// no agent is passed in the invocation envelope itself.
		agent_id: uuid("agent_id").references(() => agents.id),
		invoker_user_id: uuid("invoker_user_id").notNull(),
		skill_id: text("skill_id").notNull(),
		skill_version: integer("skill_version").notNull().default(1),
		invocation_source: text("invocation_source").notNull(),
		// Raw inputs as submitted (pre-resolver) — useful for debugging.
		inputs: jsonb("inputs").notNull().default(sql`'{}'::jsonb`),
		// Resolved inputs after entity lookup (e.g. customer slug → customer id).
		resolved_inputs: jsonb("resolved_inputs")
			.notNull()
			.default(sql`'{}'::jsonb`),
		// SHA256 of canonicalized resolved_inputs — backs the dedup partial
		// unique index so identical concurrent invocations converge.
		resolved_inputs_hash: text("resolved_inputs_hash").notNull(),
		// Set when this run was triggered by a task-completion webhook as the
		// next tick of a reconciler loop (D7a / Unit 8). Points back to the
		// earlier run whose composition spawned the completed task. Null for
		// the first tick of a loop and for all non-reconciler invocations.
		triggered_by_run_id: uuid("triggered_by_run_id"),
		status: text("status").notNull().default("running"),
		delivery_channels: jsonb("delivery_channels")
			.notNull()
			.default(sql`'[]'::jsonb`),
		started_at: timestamp("started_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		finished_at: timestamp("finished_at", { withTimezone: true }),
		// Opaque envelope the renderer step populated: {type, s3Key?, messageId?}.
		delivered_artifact_ref: jsonb("delivered_artifact_ref"),
		delete_at: timestamp("delete_at", { withTimezone: true })
			.notNull()
			.default(sql`now() + interval '${sql.raw(String(DEFAULT_RETENTION_DAYS))} days'`),
		// Invoker-submitted feedback on the run outcome.
		feedback_signal: text("feedback_signal"),
		feedback_note: text("feedback_note"),
		failure_reason: text("failure_reason"),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		// List-style navigation: admin UI "show me all runs for this tenant
		// in the last 7 days, newest first."
		index("idx_skill_runs_tenant_started").on(
			table.tenant_id,
			table.started_at,
		),
		// Per-user history.
		index("idx_skill_runs_invoker").on(table.invoker_user_id),
		// Per-skill analytics (powers compositionFeedbackSummary query).
		index("idx_skill_runs_tenant_skill").on(table.tenant_id, table.skill_id),
		// Reconciler-loop lookup: find the full tick chain for a given run.
		index("idx_skill_runs_triggered_by").on(table.triggered_by_run_id),
		// Retention sweeper.
		index("idx_skill_runs_delete_at").on(table.delete_at),
		// Dedup partial unique — only active runs collide. Once status flips
		// to any terminal value the row is no longer eligible for matching.
		uniqueIndex("uq_skill_runs_dedup_active")
			.on(
				table.tenant_id,
				table.invoker_user_id,
				table.skill_id,
				table.resolved_inputs_hash,
			)
			.where(sql`status = 'running'`),
		// Retention ceiling per plan R11 — a caller cannot extend delete_at
		// beyond the 180-day hard cap.
		check(
			"retention_ceiling",
			sql`delete_at <= started_at + interval '${sql.raw(String(MAX_RETENTION_DAYS))} days'`,
		),
		check(
			"status_allowed",
			sql`status IN ('running','complete','failed','cancelled','invoker_deprovisioned','skipped_disabled','cost_bounded_error')`,
		),
		check(
			"invocation_source_allowed",
			sql`invocation_source IN ('chat','scheduled','catalog','webhook')`,
		),
		check(
			"feedback_signal_allowed",
			sql`feedback_signal IS NULL OR feedback_signal IN ('positive','negative')`,
		),
	],
);

export const skillRunsRelations = relations(skillRuns, ({ one }) => ({
	tenant: one(tenants, {
		fields: [skillRuns.tenant_id],
		references: [tenants.id],
	}),
	agent: one(agents, {
		fields: [skillRuns.agent_id],
		references: [agents.id],
	}),
}));

export type SkillRun = typeof skillRuns.$inferSelect;
export type NewSkillRun = typeof skillRuns.$inferInsert;
