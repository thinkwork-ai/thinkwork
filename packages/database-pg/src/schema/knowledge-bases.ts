/**
 * Knowledge Base domain tables: knowledge_bases, agent_knowledge_bases.
 * Supports document-backed RAG via AWS Bedrock Knowledge Bases.
 */

import {
	pgTable,
	uuid,
	text,
	integer,
	timestamp,
	jsonb,
	boolean,
	uniqueIndex,
	index,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants } from "./core";
import { agents } from "./agents";

// ---------------------------------------------------------------------------
// knowledge_bases
// ---------------------------------------------------------------------------

export const knowledgeBases = pgTable(
	"knowledge_bases",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		name: text("name").notNull(),
		slug: text("slug").notNull(),
		description: text("description"),
		embedding_model: text("embedding_model")
			.notNull()
			.default("amazon.titan-embed-text-v2:0"),
		chunking_strategy: text("chunking_strategy")
			.notNull()
			.default("FIXED_SIZE"),
		chunk_size_tokens: integer("chunk_size_tokens").default(300),
		chunk_overlap_percent: integer("chunk_overlap_percent").default(20),
		status: text("status").notNull().default("creating"),
		aws_kb_id: text("aws_kb_id"),
		aws_data_source_id: text("aws_data_source_id"),
		last_sync_at: timestamp("last_sync_at", { withTimezone: true }),
		last_sync_status: text("last_sync_status"),
		document_count: integer("document_count").default(0),
		error_message: text("error_message"),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		index("idx_knowledge_bases_tenant").on(table.tenant_id),
		uniqueIndex("uq_knowledge_bases_tenant_slug").on(
			table.tenant_id,
			table.slug,
		),
	],
);

// ---------------------------------------------------------------------------
// agent_knowledge_bases (many-to-many join)
// ---------------------------------------------------------------------------

export const agentKnowledgeBases = pgTable(
	"agent_knowledge_bases",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		agent_id: uuid("agent_id")
			.references(() => agents.id)
			.notNull(),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		knowledge_base_id: uuid("knowledge_base_id")
			.references(() => knowledgeBases.id)
			.notNull(),
		enabled: boolean("enabled").notNull().default(true),
		search_config: jsonb("search_config"),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		uniqueIndex("uq_agent_kb").on(table.agent_id, table.knowledge_base_id),
	],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const knowledgeBasesRelations = relations(
	knowledgeBases,
	({ one, many }) => ({
		tenant: one(tenants, {
			fields: [knowledgeBases.tenant_id],
			references: [tenants.id],
		}),
		agentKnowledgeBases: many(agentKnowledgeBases),
	}),
);

export const agentKnowledgeBasesRelations = relations(
	agentKnowledgeBases,
	({ one }) => ({
		agent: one(agents, {
			fields: [agentKnowledgeBases.agent_id],
			references: [agents.id],
		}),
		tenant: one(tenants, {
			fields: [agentKnowledgeBases.tenant_id],
			references: [tenants.id],
		}),
		knowledgeBase: one(knowledgeBases, {
			fields: [agentKnowledgeBases.knowledge_base_id],
			references: [knowledgeBases.id],
		}),
	}),
);
