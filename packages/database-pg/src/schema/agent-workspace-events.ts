import {
	bigint,
	bigserial,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants } from "./core";
import { agents } from "./agents";
import { agentWakeupRequests } from "./heartbeats";
import { threadTurns } from "./scheduled-jobs";

export const WORKSPACE_RUN_STATUSES = [
	"pending",
	"claimed",
	"processing",
	"completed",
	"failed",
	"awaiting_review",
	"awaiting_subrun",
	"cancelled",
	"expired",
] as const;

export const WORKSPACE_EVENT_TYPES = [
	"work.requested",
	"run.started",
	"run.blocked",
	"run.completed",
	"run.failed",
	"review.requested",
	"memory.changed",
	"event.rejected",
] as const;

export const agentWorkspaceRuns = pgTable(
	"agent_workspace_runs",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		agent_id: uuid("agent_id")
			.references(() => agents.id)
			.notNull(),
		target_path: text("target_path").notNull().default(""),
		status: text("status").notNull().default("pending"),
		source_object_key: text("source_object_key"),
		request_object_key: text("request_object_key"),
		current_wakeup_request_id: uuid("current_wakeup_request_id").references(
			() => agentWakeupRequests.id,
		),
		current_thread_turn_id: uuid("current_thread_turn_id").references(
			() => threadTurns.id,
		),
		parent_run_id: uuid("parent_run_id").references(
			(): any => agentWorkspaceRuns.id,
		),
		depth: integer("depth").notNull().default(0),
		inbox_write_count: integer("inbox_write_count").notNull().default(0),
		wakeup_retry_count: integer("wakeup_retry_count").notNull().default(0),
		last_event_at: timestamp("last_event_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		completed_at: timestamp("completed_at", { withTimezone: true }),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		index("idx_agent_workspace_runs_agent_target_status").on(
			table.tenant_id,
			table.agent_id,
			table.target_path,
			table.status,
		),
		index("idx_agent_workspace_runs_status_last_event").on(
			table.status,
			table.last_event_at,
		),
		index("idx_agent_workspace_runs_parent").on(table.parent_run_id),
	],
);

export const agentWorkspaceEvents = pgTable(
	"agent_workspace_events",
	{
		id: bigserial("id", { mode: "number" }).primaryKey(),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		agent_id: uuid("agent_id").references(() => agents.id),
		run_id: uuid("run_id").references(() => agentWorkspaceRuns.id),
		event_type: text("event_type").notNull(),
		idempotency_key: text("idempotency_key").notNull(),
		bucket: text("bucket").notNull(),
		source_object_key: text("source_object_key").notNull(),
		audit_object_key: text("audit_object_key"),
		object_etag: text("object_etag"),
		object_version_id: text("object_version_id"),
		sequencer: text("sequencer").notNull(),
		mirror_status: text("mirror_status").notNull().default("ok"),
		reason: text("reason"),
		payload: jsonb("payload"),
		actor_type: text("actor_type"),
		actor_id: text("actor_id"),
		parent_event_id: bigint("parent_event_id", { mode: "number" }).references(
			(): any => agentWorkspaceEvents.id,
		),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		uniqueIndex("uq_agent_workspace_events_tenant_idempotency").on(
			table.tenant_id,
			table.idempotency_key,
		),
		index("idx_agent_workspace_events_run_created").on(
			table.run_id,
			table.created_at,
		),
		index("idx_agent_workspace_events_pending").on(
			table.tenant_id,
			table.event_type,
			table.created_at,
		),
		index("idx_agent_workspace_events_parent").on(table.parent_event_id),
	],
);

export const agentWorkspaceWaits = pgTable(
	"agent_workspace_waits",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		waiting_run_id: uuid("waiting_run_id")
			.references(() => agentWorkspaceRuns.id)
			.notNull(),
		wait_for_run_id: uuid("wait_for_run_id").references(
			() => agentWorkspaceRuns.id,
		),
		wait_for_target_path: text("wait_for_target_path"),
		status: text("status").notNull().default("waiting"),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		satisfied_at: timestamp("satisfied_at", { withTimezone: true }),
	},
	(table) => [
		index("idx_agent_workspace_waits_waiting").on(
			table.tenant_id,
			table.waiting_run_id,
			table.status,
		),
		index("idx_agent_workspace_waits_wait_for").on(
			table.tenant_id,
			table.wait_for_run_id,
			table.status,
		),
	],
);

export const agentWorkspaceRunsRelations = relations(
	agentWorkspaceRuns,
	({ one, many }) => ({
		tenant: one(tenants, {
			fields: [agentWorkspaceRuns.tenant_id],
			references: [tenants.id],
		}),
		agent: one(agents, {
			fields: [agentWorkspaceRuns.agent_id],
			references: [agents.id],
		}),
		currentWakeupRequest: one(agentWakeupRequests, {
			fields: [agentWorkspaceRuns.current_wakeup_request_id],
			references: [agentWakeupRequests.id],
		}),
		currentThreadTurn: one(threadTurns, {
			fields: [agentWorkspaceRuns.current_thread_turn_id],
			references: [threadTurns.id],
		}),
		parentRun: one(agentWorkspaceRuns, {
			fields: [agentWorkspaceRuns.parent_run_id],
			references: [agentWorkspaceRuns.id],
		}),
		events: many(agentWorkspaceEvents),
		waits: many(agentWorkspaceWaits),
	}),
);

export const agentWorkspaceEventsRelations = relations(
	agentWorkspaceEvents,
	({ one }) => ({
		tenant: one(tenants, {
			fields: [agentWorkspaceEvents.tenant_id],
			references: [tenants.id],
		}),
		agent: one(agents, {
			fields: [agentWorkspaceEvents.agent_id],
			references: [agents.id],
		}),
		run: one(agentWorkspaceRuns, {
			fields: [agentWorkspaceEvents.run_id],
			references: [agentWorkspaceRuns.id],
		}),
	}),
);

export const agentWorkspaceWaitsRelations = relations(
	agentWorkspaceWaits,
	({ one }) => ({
		tenant: one(tenants, {
			fields: [agentWorkspaceWaits.tenant_id],
			references: [tenants.id],
		}),
		waitingRun: one(agentWorkspaceRuns, {
			fields: [agentWorkspaceWaits.waiting_run_id],
			references: [agentWorkspaceRuns.id],
		}),
		waitForRun: one(agentWorkspaceRuns, {
			fields: [agentWorkspaceWaits.wait_for_run_id],
			references: [agentWorkspaceRuns.id],
		}),
	}),
);
