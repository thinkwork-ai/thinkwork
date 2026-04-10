/**
 * Message domain tables: messages, message_artifacts, documents.
 *
 * Messages belong directly to threads.
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
import { threads } from "./threads";
import { artifacts } from "./artifacts";

// ---------------------------------------------------------------------------
// 2.2 — messages
// ---------------------------------------------------------------------------

export const messages = pgTable(
	"messages",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		thread_id: uuid("thread_id")
			.references(() => threads.id)
			.notNull(),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		role: text("role").notNull(),
		content: text("content"),
		sender_type: text("sender_type"),
		sender_id: uuid("sender_id"),
		tool_calls: jsonb("tool_calls"),
		tool_results: jsonb("tool_results"),
		metadata: jsonb("metadata"),
		token_count: integer("token_count"),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		index("idx_messages_thread_id").on(table.thread_id),
		index("idx_messages_tenant_id_created_at").on(
			table.tenant_id,
			table.created_at,
		),
	],
);

// ---------------------------------------------------------------------------
// 2.3 — message_artifacts
// ---------------------------------------------------------------------------

export const messageArtifacts = pgTable("message_artifacts", {
	id: uuid("id")
		.primaryKey()
		.default(sql`gen_random_uuid()`),
	message_id: uuid("message_id")
		.references(() => messages.id)
		.notNull(),
	thread_id: uuid("thread_id")
		.references(() => threads.id)
		.notNull(),
	tenant_id: uuid("tenant_id")
		.references(() => tenants.id)
		.notNull(),
	artifact_type: text("artifact_type").notNull(),
	name: text("name"),
	content: text("content"),
	s3_key: text("s3_key"),
	mime_type: text("mime_type"),
	size_bytes: integer("size_bytes"),
	metadata: jsonb("metadata"),
	artifact_id: uuid("artifact_id"), // FK to artifacts table (added by migration)
	created_at: timestamp("created_at", { withTimezone: true })
		.notNull()
		.default(sql`now()`),
});

// ---------------------------------------------------------------------------
// 2.4 — documents
// ---------------------------------------------------------------------------

export const documents = pgTable("documents", {
	id: uuid("id")
		.primaryKey()
		.default(sql`gen_random_uuid()`),
	tenant_id: uuid("tenant_id")
		.references(() => tenants.id)
		.notNull(),
	thread_id: uuid("thread_id").references(() => threads.id),
	name: text("name").notNull(),
	content: text("content"),
	s3_key: text("s3_key"),
	mime_type: text("mime_type"),
	size_bytes: integer("size_bytes"),
	metadata: jsonb("metadata"),
	created_at: timestamp("created_at", { withTimezone: true })
		.notNull()
		.default(sql`now()`),
	updated_at: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.default(sql`now()`),
});

// ---------------------------------------------------------------------------
// Relations (for Drizzle query builder)
// ---------------------------------------------------------------------------

export const messagesRelations = relations(messages, ({ one, many }) => ({
	thread: one(threads, {
		fields: [messages.thread_id],
		references: [threads.id],
	}),
	tenant: one(tenants, {
		fields: [messages.tenant_id],
		references: [tenants.id],
	}),
	artifacts: many(messageArtifacts),
}));

export const messageArtifactsRelations = relations(
	messageArtifacts,
	({ one }) => ({
		message: one(messages, {
			fields: [messageArtifacts.message_id],
			references: [messages.id],
		}),
		thread: one(threads, {
			fields: [messageArtifacts.thread_id],
			references: [threads.id],
		}),
		tenant: one(tenants, {
			fields: [messageArtifacts.tenant_id],
			references: [tenants.id],
		}),
		artifact: one(artifacts, {
			fields: [messageArtifacts.artifact_id],
			references: [artifacts.id],
		}),
	}),
);

export const documentsRelations = relations(documents, ({ one }) => ({
	tenant: one(tenants, {
		fields: [documents.tenant_id],
		references: [tenants.id],
	}),
	thread: one(threads, {
		fields: [documents.thread_id],
		references: [threads.id],
	}),
}));
