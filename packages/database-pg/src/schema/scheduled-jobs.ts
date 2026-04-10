/**
 * Scheduled Jobs domain tables: scheduled_jobs, thread_turns, thread_turn_events.
 *
 * A scheduled job is anything that initiates agent or routine work on a timer:
 *   - agent_heartbeat, agent_reminder, agent_scheduled (timer-based)
 *   - routine_schedule, routine_one_time (timer-based)
 *   - manual, webhook, event (non-timer — schedule fields nullable)
 *
 * Replaces: routine_triggers, heartbeat_runs, heartbeat_run_events,
 * routine_runs, routine_steps.
 *
 * agent_wakeup_requests stays as the event-driven work queue.
 */

import {
	pgTable,
	uuid,
	text,
	integer,
	timestamp,
	jsonb,
	boolean,
	bigserial,
	index,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants } from "./core";
import { agents } from "./agents";
import { teams } from "./teams";
import { routines } from "./routines";
import { webhooks } from "./webhooks";

// ---------------------------------------------------------------------------
// scheduled_jobs — unified scheduled job definitions
// ---------------------------------------------------------------------------

export const scheduledJobs = pgTable(
	"scheduled_jobs",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		trigger_type: text("trigger_type").notNull(), // agent_heartbeat | agent_reminder | agent_scheduled | routine_schedule | routine_one_time | manual | webhook | event
		agent_id: uuid("agent_id").references(() => agents.id),
		routine_id: uuid("routine_id").references(() => routines.id),
		team_id: uuid("team_id").references(() => teams.id),
		name: text("name").notNull(),
		description: text("description"),
		prompt: text("prompt"), // null for heartbeats; set for reminders/scheduled
		config: jsonb("config"), // active_hours, wakeOnComment, webhook_secret, etc.
		schedule_type: text("schedule_type"), // rate | cron | at | webhook | manual | event — nullable for non-timer jobs
		schedule_expression: text("schedule_expression"), // rate(5 minutes) | cron(...) | at(...) — nullable for non-timer jobs
		timezone: text("timezone").notNull().default("UTC"),
		enabled: boolean("enabled").notNull().default(true),
		eb_schedule_name: text("eb_schedule_name"), // tracks EventBridge resource
		last_run_at: timestamp("last_run_at", { withTimezone: true }),
		next_run_at: timestamp("next_run_at", { withTimezone: true }),
		created_by_type: text("created_by_type"), // system | user | agent
		created_by_id: text("created_by_id"),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		index("idx_scheduled_jobs_tenant_type").on(table.tenant_id, table.trigger_type),
		index("idx_scheduled_jobs_agent").on(table.agent_id),
		index("idx_scheduled_jobs_routine").on(table.routine_id),
		index("idx_scheduled_jobs_enabled").on(table.tenant_id, table.enabled),
	],
);

// ---------------------------------------------------------------------------
// thread_turns — execution record for each job invocation
// ---------------------------------------------------------------------------

export const threadTurns = pgTable(
	"thread_turns",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		trigger_id: uuid("trigger_id").references(() => scheduledJobs.id), // nullable for event-driven wakeups
		agent_id: uuid("agent_id").references(() => agents.id), // denormalized
		routine_id: uuid("routine_id").references(() => routines.id), // denormalized
		invocation_source: text("invocation_source").notNull().default("schedule"),
		trigger_detail: text("trigger_detail"),
		wakeup_request_id: uuid("wakeup_request_id"),
		thread_id: uuid("thread_id"),
		turn_number: integer("turn_number"),
		status: text("status").notNull().default("queued"), // queued | running | succeeded | failed | cancelled | timed_out | skipped
		started_at: timestamp("started_at", { withTimezone: true }),
		finished_at: timestamp("finished_at", { withTimezone: true }),
		error: text("error"),
		error_code: text("error_code"),
		usage_json: jsonb("usage_json"),
		result_json: jsonb("result_json"),
		context_snapshot: jsonb("context_snapshot"),
		// agent-specific
		session_id_before: text("session_id_before"),
		session_id_after: text("session_id_after"),
		external_run_id: text("external_run_id"),
		// log storage
		log_store: text("log_store"),
		log_ref: text("log_ref"),
		log_bytes: integer("log_bytes"),
		log_sha256: text("log_sha256"),
		log_compressed: boolean("log_compressed"),
		stdout_excerpt: text("stdout_excerpt"),
		stderr_excerpt: text("stderr_excerpt"),
		// PRD-19: Webhook FK
		webhook_id: uuid("webhook_id").references(() => webhooks.id),
		// PRD-09: Stall detection + retry tracking
		last_activity_at: timestamp("last_activity_at", { withTimezone: true }),
		retry_attempt: integer("retry_attempt").default(0),
		origin_turn_id: uuid("origin_turn_id"),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		index("idx_thread_turns_tenant_agent").on(
			table.tenant_id,
			table.agent_id,
			table.started_at,
		),
		index("idx_thread_turns_tenant_routine").on(
			table.tenant_id,
			table.routine_id,
			table.started_at,
		),
		index("idx_thread_turns_trigger").on(table.trigger_id),
		index("idx_thread_turns_status").on(table.tenant_id, table.status),
		index("idx_thread_turns_thread").on(table.thread_id),
		index("idx_thread_turns_webhook").on(table.webhook_id),
	],
);

// ---------------------------------------------------------------------------
// thread_turn_events — high-volume append-only event log
// ---------------------------------------------------------------------------

export const threadTurnEvents = pgTable(
	"thread_turn_events",
	{
		id: bigserial("id", { mode: "number" }).primaryKey(),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		run_id: uuid("run_id")
			.references(() => threadTurns.id)
			.notNull(),
		agent_id: uuid("agent_id").references(() => agents.id),
		seq: integer("seq").notNull(),
		event_type: text("event_type").notNull(),
		stream: text("stream"), // system | stdout | stderr | step
		level: text("level"),
		color: text("color"),
		message: text("message"),
		payload: jsonb("payload"),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		index("idx_thread_turn_events_run_seq").on(table.run_id, table.seq),
		index("idx_thread_turn_events_tenant_created").on(
			table.tenant_id,
			table.created_at,
		),
	],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const scheduledJobsRelations = relations(
	scheduledJobs,
	({ one, many }) => ({
		tenant: one(tenants, {
			fields: [scheduledJobs.tenant_id],
			references: [tenants.id],
		}),
		agent: one(agents, {
			fields: [scheduledJobs.agent_id],
			references: [agents.id],
		}),
		routine: one(routines, {
			fields: [scheduledJobs.routine_id],
			references: [routines.id],
		}),
		team: one(teams, {
			fields: [scheduledJobs.team_id],
			references: [teams.id],
		}),
		runs: many(threadTurns),
	}),
);

export const threadTurnsRelations = relations(
	threadTurns,
	({ one, many }) => ({
		tenant: one(tenants, {
			fields: [threadTurns.tenant_id],
			references: [tenants.id],
		}),
		scheduledJob: one(scheduledJobs, {
			fields: [threadTurns.trigger_id],
			references: [scheduledJobs.id],
		}),
		agent: one(agents, {
			fields: [threadTurns.agent_id],
			references: [agents.id],
		}),
		routine: one(routines, {
			fields: [threadTurns.routine_id],
			references: [routines.id],
		}),
		webhook: one(webhooks, {
			fields: [threadTurns.webhook_id],
			references: [webhooks.id],
		}),
		events: many(threadTurnEvents),
	}),
);

export const threadTurnEventsRelations = relations(
	threadTurnEvents,
	({ one }) => ({
		run: one(threadTurns, {
			fields: [threadTurnEvents.run_id],
			references: [threadTurns.id],
		}),
		tenant: one(tenants, {
			fields: [threadTurnEvents.tenant_id],
			references: [tenants.id],
		}),
		agent: one(agents, {
			fields: [threadTurnEvents.agent_id],
			references: [agents.id],
		}),
	}),
);

// Backward-compat alias — remove once all imports are updated
export const triggers = scheduledJobs;
