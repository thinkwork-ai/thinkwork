/**
 * Retry queue (PRD-09 §9.2): tracks stalled turns for retry dispatch.
 */

import {
	pgTable,
	uuid,
	text,
	integer,
	timestamp,
	index,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants } from "./core";
import { agents } from "./agents";
import { threads } from "./threads";

export const retryQueue = pgTable(
	"retry_queue",
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
		thread_id: uuid("thread_id").references(() => threads.id),
		attempt: integer("attempt").notNull().default(1),
		max_attempts: integer("max_attempts").notNull().default(5),
		status: text("status").notNull().default("pending"), // pending | dispatched | succeeded | exhausted
		scheduled_at: timestamp("scheduled_at", { withTimezone: true }).notNull(),
		last_error: text("last_error"),
		origin_turn_id: uuid("origin_turn_id"),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		index("idx_retry_queue_status_scheduled").on(
			table.status,
			table.scheduled_at,
		),
		index("idx_retry_queue_tenant").on(table.tenant_id),
		index("idx_retry_queue_origin_turn").on(table.origin_turn_id),
	],
);

export const retryQueueRelations = relations(retryQueue, ({ one }) => ({
	tenant: one(tenants, {
		fields: [retryQueue.tenant_id],
		references: [tenants.id],
	}),
	agent: one(agents, {
		fields: [retryQueue.agent_id],
		references: [agents.id],
	}),
	thread: one(threads, {
		fields: [retryQueue.thread_id],
		references: [threads.id],
	}),
}));
