/**
 * Guardrails domain tables: guardrails (Bedrock Guardrail config),
 * guardrail_blocks (audit trail of blocked content).
 */

import {
	pgTable,
	uuid,
	text,
	timestamp,
	jsonb,
	boolean,
	index,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants } from "./core";
import { agents } from "./agents";

// ---------------------------------------------------------------------------
// guardrails — Bedrock Guardrail definitions
// ---------------------------------------------------------------------------

export const guardrails = pgTable(
	"guardrails",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		name: text("name").notNull(),
		description: text("description"),
		bedrock_guardrail_id: text("bedrock_guardrail_id"),
		bedrock_version: text("bedrock_version"),
		is_default: boolean("is_default").notNull().default(false),
		status: text("status").notNull().default("active"),
		config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [index("idx_guardrails_tenant").on(table.tenant_id)],
);

// ---------------------------------------------------------------------------
// guardrail_blocks — audit trail of blocked content
// ---------------------------------------------------------------------------

export const guardrailBlocks = pgTable(
	"guardrail_blocks",
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
		guardrail_id: uuid("guardrail_id")
			.references(() => guardrails.id)
			.notNull(),
		thread_id: uuid("thread_id"),
		message_id: uuid("message_id"),
		block_type: text("block_type").notNull(),
		action: text("action").notNull(),
		blocked_topics: text("blocked_topics").array(),
		content_filters: jsonb("content_filters"),
		raw_response: jsonb("raw_response"),
		user_message: text("user_message"),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		index("idx_guardrail_blocks_tenant").on(table.tenant_id),
		index("idx_guardrail_blocks_agent").on(table.agent_id),
		index("idx_guardrail_blocks_guardrail").on(table.guardrail_id),
		index("idx_guardrail_blocks_created").on(table.created_at),
	],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const guardrailsRelations = relations(guardrails, ({ one, many }) => ({
	tenant: one(tenants, {
		fields: [guardrails.tenant_id],
		references: [tenants.id],
	}),
	blocks: many(guardrailBlocks),
	agents: many(agents),
}));

export const guardrailBlocksRelations = relations(
	guardrailBlocks,
	({ one }) => ({
		tenant: one(tenants, {
			fields: [guardrailBlocks.tenant_id],
			references: [tenants.id],
		}),
		agent: one(agents, {
			fields: [guardrailBlocks.agent_id],
			references: [agents.id],
		}),
		guardrail: one(guardrails, {
			fields: [guardrailBlocks.guardrail_id],
			references: [guardrails.id],
		}),
	}),
);
