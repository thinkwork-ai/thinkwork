/**
 * Thread domain tables (PRD-01): threads, thread_comments, thread_labels,
 * thread_attachments, thread_label_assignments.
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
import { messages } from "./messages";
import { threadDependencies } from "./thread-dependencies";

// ---------------------------------------------------------------------------
// 6.1 — threads
// ---------------------------------------------------------------------------

export const threads = pgTable(
	"threads",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		agent_id: uuid("agent_id").references(() => agents.id),
		number: integer("number").notNull(),
		identifier: text("identifier"),
		title: text("title").notNull(),
		description: text("description"),
		status: text("status").notNull().default("backlog"),
		priority: text("priority").notNull().default("medium"),
		type: text("type").notNull().default("task"),
		channel: text("channel").notNull().default("manual"),
		parent_id: uuid("parent_id"),
		assignee_type: text("assignee_type"),
		assignee_id: uuid("assignee_id"),
		reporter_id: uuid("reporter_id").references(() => users.id),
		checkout_run_id: text("checkout_run_id"),
		checkout_version: integer("checkout_version").notNull().default(0),
		billing_code: text("billing_code"),
		labels: jsonb("labels"),
		metadata: jsonb("metadata"),
		due_at: timestamp("due_at", { withTimezone: true }),
		started_at: timestamp("started_at", { withTimezone: true }),
		completed_at: timestamp("completed_at", { withTimezone: true }),
		cancelled_at: timestamp("cancelled_at", { withTimezone: true }),
		closed_at: timestamp("closed_at", { withTimezone: true }),
		archived_at: timestamp("archived_at", { withTimezone: true }),
		last_turn_completed_at: timestamp("last_turn_completed_at", { withTimezone: true }),
		last_response_preview: text("last_response_preview"),
		last_read_at: timestamp("last_read_at", { withTimezone: true }),
		created_by_type: text("created_by_type"),
		created_by_id: text("created_by_id"),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		uniqueIndex("uq_threads_tenant_number").on(
			table.tenant_id,
			table.number,
		),
		// idx_threads_tenant_status + idx_threads_parent_id were retired by U5
		// (drizzle/0031_thread_cleanup_drops.sql) — admin U7 dropped the only
		// list-view filter that used the status index, and parent/child thread
		// queries are gone too. The columns themselves remain (status is still
		// used by the Strands `update_thread_status` skill); only the indices
		// went away.
		index("idx_threads_assignee").on(
			table.assignee_type,
			table.assignee_id,
		),
		index("idx_threads_checkout_run_id").on(table.checkout_run_id),
		index("idx_threads_tenant_channel").on(table.tenant_id, table.channel),
	],
);

// thread_comments was retired by U2 (escalateThread / delegateThread refactored
// onto thread_turns kind=system_event) and dropped by U5
// (drizzle/0031_thread_cleanup_drops.sql). No live writes remain; the
// timeline renders system-event turns directly.

// ---------------------------------------------------------------------------
// 6.3 — thread_labels
// ---------------------------------------------------------------------------

export const threadLabels = pgTable(
	"thread_labels",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		name: text("name").notNull(),
		color: text("color"),
		description: text("description"),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		uniqueIndex("uq_thread_labels_tenant_name").on(
			table.tenant_id,
			table.name,
		),
	],
);

// ---------------------------------------------------------------------------
// 6.4 — thread_attachments
// ---------------------------------------------------------------------------

export const threadAttachments = pgTable("thread_attachments", {
	id: uuid("id")
		.primaryKey()
		.default(sql`gen_random_uuid()`),
	thread_id: uuid("thread_id")
		.references(() => threads.id)
		.notNull(),
	tenant_id: uuid("tenant_id")
		.references(() => tenants.id)
		.notNull(),
	name: text("name"),
	s3_key: text("s3_key"),
	mime_type: text("mime_type"),
	size_bytes: integer("size_bytes"),
	uploaded_by: uuid("uploaded_by"),
	created_at: timestamp("created_at", { withTimezone: true })
		.notNull()
		.default(sql`now()`),
});

// ---------------------------------------------------------------------------
// 6.5 — thread_label_assignments (junction table)
// ---------------------------------------------------------------------------

export const threadLabelAssignments = pgTable(
	"thread_label_assignments",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		thread_id: uuid("thread_id")
			.notNull()
			.references(() => threads.id, { onDelete: "cascade" }),
		label_id: uuid("label_id")
			.notNull()
			.references(() => threadLabels.id, { onDelete: "cascade" }),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		uniqueIndex("uq_thread_label_assignment").on(
			table.thread_id,
			table.label_id,
		),
	],
);

// ---------------------------------------------------------------------------
// Relations (for Drizzle query builder)
// ---------------------------------------------------------------------------

export const threadsRelations = relations(threads, ({ one, many }) => ({
	tenant: one(tenants, {
		fields: [threads.tenant_id],
		references: [tenants.id],
	}),
	agent: one(agents, {
		fields: [threads.agent_id],
		references: [agents.id],
	}),
	reporter: one(users, {
		fields: [threads.reporter_id],
		references: [users.id],
	}),
	parent: one(threads, {
		fields: [threads.parent_id],
		references: [threads.id],
		relationName: "parentChild",
	}),
	children: many(threads, { relationName: "parentChild" }),
	messages: many(messages),
	attachments: many(threadAttachments),
	labelAssignments: many(threadLabelAssignments),
	// PRD-09: Dependency relations
	dependencies: many(threadDependencies, { relationName: "dependencyBlockedBy" }),
	blocks: many(threadDependencies, { relationName: "dependencyBlocks" }),
}));

export const threadLabelsRelations = relations(threadLabels, ({ one, many }) => ({
	tenant: one(tenants, {
		fields: [threadLabels.tenant_id],
		references: [tenants.id],
	}),
	assignments: many(threadLabelAssignments),
}));

export const threadLabelAssignmentsRelations = relations(
	threadLabelAssignments,
	({ one }) => ({
		thread: one(threads, {
			fields: [threadLabelAssignments.thread_id],
			references: [threads.id],
		}),
		label: one(threadLabels, {
			fields: [threadLabelAssignments.label_id],
			references: [threadLabels.id],
		}),
		tenant: one(tenants, {
			fields: [threadLabelAssignments.tenant_id],
			references: [tenants.id],
		}),
	}),
);

export const threadAttachmentsRelations = relations(
	threadAttachments,
	({ one }) => ({
		thread: one(threads, {
			fields: [threadAttachments.thread_id],
			references: [threads.id],
		}),
		tenant: one(tenants, {
			fields: [threadAttachments.tenant_id],
			references: [tenants.id],
		}),
	}),
);
