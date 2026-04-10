import {
	pgTable, uuid, text, timestamp, jsonb, index,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants } from "./core";
import { agents } from "./agents";
import { threads } from "./threads";
import { messages } from "./messages";

export const recipes = pgTable(
	"recipes",
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
		summary: text("summary"),

		// Recipe definition
		server: text("server").notNull(),
		tool: text("tool").notNull(),
		params: jsonb("params").notNull(),
		genui_type: text("genui_type").notNull(),
		templates: jsonb("templates"),

		// Execution state
		cached_result: jsonb("cached_result"),
		last_refreshed: timestamp("last_refreshed", { withTimezone: true }),
		last_error: text("last_error"),

		// Lineage
		source_message_id: uuid("source_message_id").references(() => messages.id),

		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		index("idx_recipes_tenant_id").on(table.tenant_id),
		index("idx_recipes_thread_id").on(table.thread_id),
		index("idx_recipes_agent_id").on(table.agent_id),
	],
);

export const recipesRelations = relations(recipes, ({ one }) => ({
	tenant: one(tenants, {
		fields: [recipes.tenant_id],
		references: [tenants.id],
	}),
	agent: one(agents, {
		fields: [recipes.agent_id],
		references: [agents.id],
	}),
	thread: one(threads, {
		fields: [recipes.thread_id],
		references: [threads.id],
	}),
	sourceMessage: one(messages, {
		fields: [recipes.source_message_id],
		references: [messages.id],
	}),
}));
