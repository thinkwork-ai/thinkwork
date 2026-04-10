/**
 * Runtime domain tables (PRD-04, PRD-05): agent_runtime_state,
 * agent_task_sessions, wakeup_requests.
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

// ---------------------------------------------------------------------------
// 6.9 — agent_runtime_state
// ---------------------------------------------------------------------------

export const agentRuntimeState = pgTable(
	"agent_runtime_state",
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
		session_id: text("session_id").unique(),
		status: text("status").notNull().default("idle"),
		state: jsonb("state"),
		last_active_at: timestamp("last_active_at", { withTimezone: true }),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		index("idx_agent_runtime_state_agent_status").on(
			table.agent_id,
			table.status,
		),
	],
);

// ---------------------------------------------------------------------------
// 6.10 — agent_task_sessions
// ---------------------------------------------------------------------------

export const agentTaskSessions = pgTable("agent_task_sessions", {
	id: uuid("id")
		.primaryKey()
		.default(sql`gen_random_uuid()`),
	runtime_state_id: uuid("runtime_state_id")
		.references(() => agentRuntimeState.id)
		.notNull(),
	tenant_id: uuid("tenant_id")
		.references(() => tenants.id)
		.notNull(),
	thread_id: uuid("thread_id"),
	task_type: text("task_type"),
	status: text("status").notNull().default("pending"),
	input: jsonb("input"),
	output: jsonb("output"),
	started_at: timestamp("started_at", { withTimezone: true }),
	completed_at: timestamp("completed_at", { withTimezone: true }),
	error: text("error"),
	created_at: timestamp("created_at", { withTimezone: true })
		.notNull()
		.default(sql`now()`),
});

// ---------------------------------------------------------------------------
// 6.12 — wakeup_requests
// ---------------------------------------------------------------------------

export const wakeupRequests = pgTable(
	"wakeup_requests",
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
		reason: text("reason"),
		priority: text("priority").notNull().default("normal"),
		status: text("status").notNull().default("pending"),
		payload: jsonb("payload"),
		scheduled_for: timestamp("scheduled_for", { withTimezone: true }),
		processed_at: timestamp("processed_at", { withTimezone: true }),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		index("idx_wakeup_requests_status_scheduled").on(
			table.status,
			table.scheduled_for,
		),
	],
);

// ---------------------------------------------------------------------------
// Relations (for Drizzle query builder)
// ---------------------------------------------------------------------------

export const agentRuntimeStateRelations = relations(
	agentRuntimeState,
	({ one, many }) => ({
		tenant: one(tenants, {
			fields: [agentRuntimeState.tenant_id],
			references: [tenants.id],
		}),
		agent: one(agents, {
			fields: [agentRuntimeState.agent_id],
			references: [agents.id],
		}),
		taskSessions: many(agentTaskSessions),
	}),
);

export const agentTaskSessionsRelations = relations(
	agentTaskSessions,
	({ one }) => ({
		runtimeState: one(agentRuntimeState, {
			fields: [agentTaskSessions.runtime_state_id],
			references: [agentRuntimeState.id],
		}),
		tenant: one(tenants, {
			fields: [agentTaskSessions.tenant_id],
			references: [tenants.id],
		}),
	}),
);

export const wakeupRequestsRelations = relations(
	wakeupRequests,
	({ one }) => ({
		tenant: one(tenants, {
			fields: [wakeupRequests.tenant_id],
			references: [tenants.id],
		}),
		agent: one(agents, {
			fields: [wakeupRequests.agent_id],
			references: [agents.id],
		}),
	}),
);

