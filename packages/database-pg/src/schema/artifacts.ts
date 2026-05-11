/**
 * Artifacts table: durable, markdown-first agent output.
 *
 * Content is stored as markdown — rendered to other formats at delivery time.
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
import { threads } from "./threads";
import { messages, messageArtifacts } from "./messages";

// ---------------------------------------------------------------------------
// artifacts
// ---------------------------------------------------------------------------

export const artifacts = pgTable(
	"artifacts",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		agent_id: uuid("agent_id").references(() => agents.id),
		thread_id: uuid("thread_id").references(() => threads.id),

		// Identity
		title: text("title").notNull(),
		type: text("type").notNull(), // data_view | note | report | plan | draft | digest
		status: text("status").notNull().default("final"), // draft | final | superseded

		// Content (markdown)
		content: text("content"),
		s3_key: text("s3_key"),
		summary: text("summary"),

		// Lineage
		source_message_id: uuid("source_message_id").references(() => messages.id),
		metadata: jsonb("metadata"),

		// Favorites: nullable timestamp. Set when the user stars the
		// artifact; cleared to un-favorite. Drives the apps/computer
		// sidebar Favorites section.
		favorited_at: timestamp("favorited_at", { withTimezone: true }),

		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		index("idx_artifacts_tenant_id").on(table.tenant_id),
		index("idx_artifacts_thread_id").on(table.thread_id),
		index("idx_artifacts_agent_id").on(table.agent_id),
		index("idx_artifacts_type").on(table.tenant_id, table.type),
		// The matching DB index is a partial
		// (`WHERE favorited_at IS NOT NULL`) declared in
		// drizzle/0084_artifacts_favorited_at.sql; drizzle's index() helper
		// doesn't model partial predicates, so we record the column-only
		// form here for type-graph completeness and rely on the
		// hand-rolled SQL for the real partial index in production.
		index("idx_artifacts_favorited_at").on(
			table.tenant_id,
			table.favorited_at,
		),
	],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const artifactsRelations = relations(artifacts, ({ one, many }) => ({
	messageArtifacts: many(messageArtifacts),
	tenant: one(tenants, {
		fields: [artifacts.tenant_id],
		references: [tenants.id],
	}),
	agent: one(agents, {
		fields: [artifacts.agent_id],
		references: [agents.id],
	}),
	thread: one(threads, {
		fields: [artifacts.thread_id],
		references: [threads.id],
	}),
	sourceMessage: one(messages, {
		fields: [artifacts.source_message_id],
		references: [messages.id],
	}),
}));

