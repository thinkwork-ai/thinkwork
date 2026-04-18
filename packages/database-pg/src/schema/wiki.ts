/**
 * Compounding Memory (wiki) domain tables.
 *
 * Canonical memory lives in Hindsight (normalized warehouse). The compile
 * pipeline reads changed memory records by cursor and materializes compiled
 * wiki pages into these tables. Pages are rebuildable from canonical memory;
 * these rows are a derived store optimized for read.
 *
 * v1 scope rule (see .prds/compounding-memory-scoping.md):
 *   - Every compiled object is strictly owner-scoped.
 *   - `owner_id` is NOT NULL on every compiled-memory table.
 *   - Type (`entity` | `topic` | `decision`) describes page *shape* (sections,
 *     semantics), NOT sharing. All three types belong to exactly one agent.
 *   - No tenant-shared pages, no `owner_id IS NULL` escape hatch.
 *   - Team/company scope is deferred to a future explicit `scope_type` model.
 *
 * See .prds/compiled-memory-layer-engineering-prd.md for the architectural
 * anchor (its tenant-shared entity scope is overridden by the scoping doc).
 * See .prds/compounding-memory-v1-build-plan.md for the settled decisions
 * driving this schema (cursor storage, dedupe window, feature flag, search
 * impl, embedding-column-present-but-null in v1).
 */

import {
	pgTable,
	uuid,
	text,
	integer,
	timestamp,
	jsonb,
	customType,
	primaryKey,
	uniqueIndex,
	index,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants } from "./core";
import { agents } from "./agents";

// ---------------------------------------------------------------------------
// Custom pgvector + tsvector column helpers
//
// Drizzle has no native `vector`/`tsvector` column types; these helpers emit
// the right SQL during migration generation. The tsvector column is wired up
// as a generated column via `.generatedAlwaysAs()` below.
// ---------------------------------------------------------------------------

const vector = (name: string, dimensions: number) =>
	customType<{ data: number[]; driverData: string }>({
		dataType() {
			return `vector(${dimensions})`;
		},
		toDriver(value: number[]): string {
			return `[${value.join(",")}]`;
		},
		fromDriver(value: string): number[] {
			return value
				.slice(1, -1)
				.split(",")
				.map((n) => Number(n));
		},
	})(name);

const tsvector = (name: string) =>
	customType<{ data: string; driverData: string }>({
		dataType() {
			return "tsvector";
		},
	})(name);

// ---------------------------------------------------------------------------
// wiki_pages — compiled pages (entity / topic / decision)
// ---------------------------------------------------------------------------

export const wikiPages = pgTable(
	"wiki_pages",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		owner_id: uuid("owner_id")
			.references(() => agents.id)
			.notNull(), // v1: every page is agent-scoped
		type: text("type").notNull(), // 'entity' | 'topic' | 'decision' — shape, not scope
		slug: text("slug").notNull(),
		title: text("title").notNull(),
		summary: text("summary"),
		body_md: text("body_md"),
		search_tsv: tsvector("search_tsv").generatedAlwaysAs(
			sql`to_tsvector('english'::regconfig, coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(body_md,''))`,
		),
		status: text("status").notNull().default("active"), // 'active' | 'archived'
		last_compiled_at: timestamp("last_compiled_at", { withTimezone: true }),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		// Slug uniqueness within a single (tenant, owner, type) scope.
		uniqueIndex("uq_wiki_pages_tenant_owner_type_slug").on(
			table.tenant_id,
			table.owner_id,
			table.type,
			table.slug,
		),
		// Read-path access is always (tenant, owner) first.
		index("idx_wiki_pages_tenant_owner_type_status").on(
			table.tenant_id,
			table.owner_id,
			table.type,
			table.status,
		),
		index("idx_wiki_pages_owner").on(table.owner_id),
		index("idx_wiki_pages_last_compiled").on(table.last_compiled_at),
		// Full-text search: GIN on the generated tsvector column.
		index("idx_wiki_pages_search_tsv").using("gin", table.search_tsv),
	],
);

// ---------------------------------------------------------------------------
// wiki_page_sections — one row per section; body_md patched incrementally
// ---------------------------------------------------------------------------

export const wikiPageSections = pgTable(
	"wiki_page_sections",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		page_id: uuid("page_id")
			.references(() => wikiPages.id, { onDelete: "cascade" })
			.notNull(),
		section_slug: text("section_slug").notNull(), // 'overview' | 'notes' | 'visits' | …
		heading: text("heading").notNull(),
		body_md: text("body_md").notNull(),
		position: integer("position").notNull(),
		body_embedding: vector("body_embedding", 1024), // present but NULL in v1
		last_source_at: timestamp("last_source_at", { withTimezone: true }),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		uniqueIndex("uq_wiki_page_sections_page_slug").on(
			table.page_id,
			table.section_slug,
		),
		index("idx_wiki_page_sections_page_position").on(
			table.page_id,
			table.position,
		),
	],
);

// ---------------------------------------------------------------------------
// wiki_page_links — explicit page-to-page references ([[Foo]] resolution)
// ---------------------------------------------------------------------------

export const wikiPageLinks = pgTable(
	"wiki_page_links",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		from_page_id: uuid("from_page_id")
			.references(() => wikiPages.id, { onDelete: "cascade" })
			.notNull(),
		to_page_id: uuid("to_page_id")
			.references(() => wikiPages.id, { onDelete: "cascade" })
			.notNull(),
		context: text("context"),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		uniqueIndex("uq_wiki_page_links_from_to").on(
			table.from_page_id,
			table.to_page_id,
		),
		index("idx_wiki_page_links_to").on(table.to_page_id),
	],
);

// ---------------------------------------------------------------------------
// wiki_page_aliases — alternate names that resolve to a page
// ---------------------------------------------------------------------------

export const wikiPageAliases = pgTable(
	"wiki_page_aliases",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		page_id: uuid("page_id")
			.references(() => wikiPages.id, { onDelete: "cascade" })
			.notNull(),
		alias: text("alias").notNull(), // normalized: lowercase, punctuation-stripped
		source: text("source").notNull(), // 'compiler' | 'manual' | 'import'
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		uniqueIndex("uq_wiki_page_aliases_page_alias").on(
			table.page_id,
			table.alias,
		),
		index("idx_wiki_page_aliases_alias").on(table.alias),
	],
);

// ---------------------------------------------------------------------------
// wiki_unresolved_mentions — first-class middle state; promote when trusted
// ---------------------------------------------------------------------------

export const wikiUnresolvedMentions = pgTable(
	"wiki_unresolved_mentions",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		owner_id: uuid("owner_id")
			.references(() => agents.id)
			.notNull(), // v1: mentions live inside one agent scope
		alias: text("alias").notNull(),
		alias_normalized: text("alias_normalized").notNull(),
		mention_count: integer("mention_count").notNull().default(1),
		first_seen_at: timestamp("first_seen_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		last_seen_at: timestamp("last_seen_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		sample_contexts: jsonb("sample_contexts").notNull().default([]), // array of { quote, source_ref, seen_at }, capped at 5
		suggested_type: text("suggested_type"), // 'entity' | 'topic' | 'decision'
		status: text("status").notNull().default("open"), // 'open' | 'promoted' | 'ignored'
		promoted_page_id: uuid("promoted_page_id").references(() => wikiPages.id),
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		uniqueIndex("uq_wiki_unresolved_mentions_scope_alias_status").on(
			table.tenant_id,
			table.owner_id,
			table.alias_normalized,
			table.status,
		),
		index("idx_wiki_unresolved_mentions_tenant_owner_status").on(
			table.tenant_id,
			table.owner_id,
			table.status,
		),
		index("idx_wiki_unresolved_mentions_status_last_seen").on(
			table.status,
			table.last_seen_at,
		),
	],
);

// ---------------------------------------------------------------------------
// wiki_section_sources — provenance: which memory records built a section
// ---------------------------------------------------------------------------

export const wikiSectionSources = pgTable(
	"wiki_section_sources",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		section_id: uuid("section_id")
			.references(() => wikiPageSections.id, { onDelete: "cascade" })
			.notNull(),
		source_kind: text("source_kind").notNull(), // 'memory_unit' | 'artifact' | 'journal_idea'
		source_ref: text("source_ref").notNull(), // normalized memory record id / external ref
		first_seen_at: timestamp("first_seen_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		uniqueIndex("uq_wiki_section_sources_section_kind_ref").on(
			table.section_id,
			table.source_kind,
			table.source_ref,
		),
		index("idx_wiki_section_sources_kind_ref").on(
			table.source_kind,
			table.source_ref,
		),
	],
);

// ---------------------------------------------------------------------------
// wiki_compile_jobs — job ledger (idempotency, retries, observability)
// ---------------------------------------------------------------------------

export const wikiCompileJobs = pgTable(
	"wiki_compile_jobs",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		owner_id: uuid("owner_id")
			.references(() => agents.id)
			.notNull(), // v1: one compile job per (tenant, agent) scope
		// `${tenant}:${owner}:${floor(created_epoch_s/300)}` — collapses post-turn storms
		dedupe_key: text("dedupe_key").notNull().unique(),
		status: text("status").notNull().default("pending"), // 'pending'|'running'|'succeeded'|'failed'|'skipped'
		trigger: text("trigger").notNull(), // 'memory_retain' | 'bootstrap_import' | 'admin' | 'lint'
		attempt: integer("attempt").notNull().default(0),
		claimed_at: timestamp("claimed_at", { withTimezone: true }),
		started_at: timestamp("started_at", { withTimezone: true }),
		finished_at: timestamp("finished_at", { withTimezone: true }),
		error: text("error"),
		metrics: jsonb("metrics"), // { records_read, pages_upserted, sections_rewritten, latency_ms, cost_usd }
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		index("idx_wiki_compile_jobs_scope_status_created").on(
			table.tenant_id,
			table.owner_id,
			table.status,
			table.created_at,
		),
		index("idx_wiki_compile_jobs_status_created").on(
			table.status,
			table.created_at,
		),
	],
);

// ---------------------------------------------------------------------------
// wiki_compile_cursors — one row per (tenant, owner) scope (both required)
// ---------------------------------------------------------------------------

export const wikiCompileCursors = pgTable(
	"wiki_compile_cursors",
	{
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		owner_id: uuid("owner_id")
			.references(() => agents.id)
			.notNull(),
		last_record_updated_at: timestamp("last_record_updated_at", {
			withTimezone: true,
		}),
		last_record_id: text("last_record_id"), // tiebreaker for same-timestamp records
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		primaryKey({
			name: "wiki_compile_cursors_pkey",
			columns: [table.tenant_id, table.owner_id],
		}),
	],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const wikiPagesRelations = relations(wikiPages, ({ one, many }) => ({
	tenant: one(tenants, {
		fields: [wikiPages.tenant_id],
		references: [tenants.id],
	}),
	owner: one(agents, {
		fields: [wikiPages.owner_id],
		references: [agents.id],
	}),
	sections: many(wikiPageSections),
	outgoingLinks: many(wikiPageLinks, { relationName: "from_page" }),
	incomingLinks: many(wikiPageLinks, { relationName: "to_page" }),
	aliases: many(wikiPageAliases),
}));

export const wikiPageSectionsRelations = relations(
	wikiPageSections,
	({ one, many }) => ({
		page: one(wikiPages, {
			fields: [wikiPageSections.page_id],
			references: [wikiPages.id],
		}),
		sources: many(wikiSectionSources),
	}),
);

export const wikiPageLinksRelations = relations(wikiPageLinks, ({ one }) => ({
	fromPage: one(wikiPages, {
		relationName: "from_page",
		fields: [wikiPageLinks.from_page_id],
		references: [wikiPages.id],
	}),
	toPage: one(wikiPages, {
		relationName: "to_page",
		fields: [wikiPageLinks.to_page_id],
		references: [wikiPages.id],
	}),
}));

export const wikiPageAliasesRelations = relations(
	wikiPageAliases,
	({ one }) => ({
		page: one(wikiPages, {
			fields: [wikiPageAliases.page_id],
			references: [wikiPages.id],
		}),
	}),
);

export const wikiUnresolvedMentionsRelations = relations(
	wikiUnresolvedMentions,
	({ one }) => ({
		tenant: one(tenants, {
			fields: [wikiUnresolvedMentions.tenant_id],
			references: [tenants.id],
		}),
		owner: one(agents, {
			fields: [wikiUnresolvedMentions.owner_id],
			references: [agents.id],
		}),
		promotedPage: one(wikiPages, {
			fields: [wikiUnresolvedMentions.promoted_page_id],
			references: [wikiPages.id],
		}),
	}),
);

export const wikiSectionSourcesRelations = relations(
	wikiSectionSources,
	({ one }) => ({
		section: one(wikiPageSections, {
			fields: [wikiSectionSources.section_id],
			references: [wikiPageSections.id],
		}),
	}),
);

export const wikiCompileJobsRelations = relations(
	wikiCompileJobs,
	({ one }) => ({
		tenant: one(tenants, {
			fields: [wikiCompileJobs.tenant_id],
			references: [tenants.id],
		}),
		owner: one(agents, {
			fields: [wikiCompileJobs.owner_id],
			references: [agents.id],
		}),
	}),
);

export const wikiCompileCursorsRelations = relations(
	wikiCompileCursors,
	({ one }) => ({
		tenant: one(tenants, {
			fields: [wikiCompileCursors.tenant_id],
			references: [tenants.id],
		}),
		owner: one(agents, {
			fields: [wikiCompileCursors.owner_id],
			references: [agents.id],
		}),
	}),
);
