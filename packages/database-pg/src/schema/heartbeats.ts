/**
 * Agent wakeup requests — event-driven work queue for agent invocations.
 *
 * This is the only table remaining from the original heartbeats module.
 * heartbeat_runs and heartbeat_run_events have been replaced by
 * trigger_runs and trigger_run_events (see scheduled-jobs.ts).
 */

import {
	pgTable,
	uuid,
	text,
	integer,
	timestamp,
	jsonb,
	index,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants } from "./core";
import { agents } from "./agents";
import { threadTurns } from "./scheduled-jobs";

// ---------------------------------------------------------------------------
// agent_wakeup_requests — trigger queue for agent wakeups
// ---------------------------------------------------------------------------

export const agentWakeupRequests = pgTable(
	"agent_wakeup_requests",
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
		source: text("source").notNull(),
		trigger_detail: text("trigger_detail"),
		reason: text("reason"),
		payload: jsonb("payload"),
		status: text("status").notNull().default("queued"),
		coalesced_count: integer("coalesced_count").notNull().default(0),
		idempotency_key: text("idempotency_key"),
		requested_by_actor_type: text("requested_by_actor_type"),
		requested_by_actor_id: text("requested_by_actor_id"),
		run_id: uuid("run_id"),
		requested_at: timestamp("requested_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		claimed_at: timestamp("claimed_at", { withTimezone: true }),
		finished_at: timestamp("finished_at", { withTimezone: true }),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		index("idx_agent_wakeup_requests_status").on(
			table.tenant_id,
			table.status,
		),
	],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const agentWakeupRequestsRelations = relations(
	agentWakeupRequests,
	({ one }) => ({
		tenant: one(tenants, {
			fields: [agentWakeupRequests.tenant_id],
			references: [tenants.id],
		}),
		agent: one(agents, {
			fields: [agentWakeupRequests.agent_id],
			references: [agents.id],
		}),
		run: one(threadTurns, {
			fields: [agentWakeupRequests.run_id],
			references: [threadTurns.id],
		}),
	}),
);
