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
 *     semantics), NOT sharing. All three types belong to exactly one user.
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
	numeric,
	timestamp,
	jsonb,
	customType,
	primaryKey,
	uniqueIndex,
	index,
	type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants, users } from "./core";

// ---------------------------------------------------------------------------
// Custom tsvector column helper
//
// Drizzle has no native `tsvector` column type; this helper emits the right
// SQL during migration generation. The tsvector column is wired up as a
// generated column via `.generatedAlwaysAs()` below.
// ---------------------------------------------------------------------------

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
			.references(() => users.id)
			.notNull(), // v1: every page is user-scoped
		type: text("type").notNull(), // 'entity' | 'topic' | 'decision' — shape, not scope
		slug: text("slug").notNull(),
		title: text("title").notNull(),
		summary: text("summary"),
		body_md: text("body_md"),
		search_tsv: tsvector("search_tsv").generatedAlwaysAs(
			sql`to_tsvector('english'::regconfig, regexp_replace(coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(body_md,''), '[^[:alnum:]]+', ' ', 'g'))`,
		),
		status: text("status").notNull().default("active"), // 'active' | 'archived'
		// Hierarchical aggregation: set when a page was promoted from a section
		// on another page. Nullable — most pages are top-level. Self-reference;
		// no cascade so promoted children survive parent archival.
		parent_page_id: uuid("parent_page_id").references(
			(): AnyPgColumn => wikiPages.id,
		),
		// Optional pointer into wiki_places. Zero or one place per page. Set by
		// the compile pipeline when a source record carries
		// place_google_place_id, and by the Phase C backfill for pre-existing
		// pages. Forward-declared here; wiki_places is defined below and the FK
		// is expressed via the `.references()` callback to break the circular
		// declaration order.
		place_id: uuid("place_id").references((): AnyPgColumn => wikiPlaces.id, {
			onDelete: "set null",
		}),
		// Cached hubness signal (inbound links + promoted child count +
		// section density). Recomputed on page upsert. Coarse monotonic ordering
		// only — don't treat as a precise ranking number.
		hubness_score: integer("hubness_score").notNull().default(0),
		// Soft tag hints (processor-derived or tenant-configurable). Used for
		// clustering/coherence signals. Never treated as ontology.
		tags: text("tags").array().notNull().default(sql`ARRAY[]::text[]`),
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
		// Fast lookup of child pages for hierarchy navigation.
		index("idx_wiki_pages_parent").on(table.parent_page_id),
		// Reverse lookup "page for a place". Partial — most pages don't carry
		// place_id, so the non-null partial keeps the index tight.
		index("idx_wiki_pages_place_id")
			.on(table.place_id)
			.where(sql`${table.place_id} IS NOT NULL`),
		// Trigram GIN index on title — powers fuzzy page lookup in the
		// compiler's newPage dedupe path. Requires `pg_trgm` extension.
		index("idx_wiki_pages_title_trgm").using(
			"gin",
			sql`${table.title} gin_trgm_ops`,
		),
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
		last_source_at: timestamp("last_source_at", { withTimezone: true }),
		// Hierarchical aggregation metadata. NULL on leaf-style sections that
		// don't act as rollups (overview, notes, etc.). Shape:
		//   {
		//     linked_page_ids: string[];       // child pages rolled up here
		//     supporting_record_count: number; // distinct citing records
		//     first_source_at: string | null;  // ISO
		//     last_source_at: string | null;   // ISO
		//     observed_tags: string[];
		//     promotion_status: "none"|"candidate"|"promoted"|"suppressed";
		//     promotion_score: number;         // 0..1
		//     promoted_page_id: string | null;
		//   }
		aggregation: jsonb("aggregation"),
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
		// Link discriminator. 'reference' is the historical default (wikilink /
		// [[Foo]] style). 'parent_of' / 'child_of' express durable hierarchy
		// created by section promotion.
		kind: text("kind").notNull().default("reference"),
		context: text("context"),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		// Uniqueness now includes kind so we can carry both a 'reference' and a
		// 'parent_of' between the same pages when that's semantically correct.
		uniqueIndex("uq_wiki_page_links_from_to_kind").on(
			table.from_page_id,
			table.to_page_id,
			table.kind,
		),
		index("idx_wiki_page_links_to").on(table.to_page_id),
		index("idx_wiki_page_links_kind").on(table.kind),
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
		// Trigram GIN on alias — powers fuzzy alias matching
		// (`findAliasMatchesFuzzy`) so variants like "Paris, France" collapse
		// onto existing "Paris" pages instead of splintering the wiki.
		index("idx_wiki_page_aliases_alias_trgm").using(
			"gin",
			sql`${table.alias} gin_trgm_ops`,
		),
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
			.references(() => users.id)
			.notNull(), // v1: mentions live inside one user scope
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
			.references(() => users.id)
			.notNull(), // v1: one compile job per (tenant, user) scope
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
			.references(() => users.id)
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
// wiki_places — canonical location identity (POI, city, state, country)
//
// First-class place records. Scoped per (tenant, owner) like every other
// wiki table. Pages reference places via the nullable
// `wiki_pages.place_id` FK declared above. Hierarchy is expressed by the
// `parent_place_id` self-FK (POI → city → state → country, with state only
// populated for US/CA).
//
// See docs/brainstorms/2026-04-21-wiki-place-capability-requirements.md and
// docs/plans/2026-04-21-005-feat-wiki-place-capability-v2-plan.md for the
// architectural rationale.
// ---------------------------------------------------------------------------

export const wikiPlaces = pgTable(
	"wiki_places",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		owner_id: uuid("owner_id")
			.references(() => users.id)
			.notNull(),
		name: text("name").notNull(),
		// Google's identifier, when known. Non-null rows in a (tenant, owner)
		// scope are uniqueness-constrained via a partial unique index below —
		// first-seen-wins for Google-sourced places.
		google_place_id: text("google_place_id"),
		// Canonical coordinates. numeric(9,6) = ~11cm precision at the equator
		// and matches what Google Places returns. Drizzle returns numeric as
		// strings to preserve precision — callers coerce with Number() when
		// they need to operate on them.
		geo_lat: numeric("geo_lat", { precision: 9, scale: 6 }),
		geo_lon: numeric("geo_lon", { precision: 9, scale: 6 }),
		address: text("address"),
		// Self-reference: expresses hierarchy (POI → city → state → country).
		// ON DELETE SET NULL so losing a parent doesn't cascade-nuke
		// descendants; we'd rather have orphaned rows to audit than silent
		// data loss.
		parent_place_id: uuid("parent_place_id").references(
			(): AnyPgColumn => wikiPlaces.id,
			{ onDelete: "set null" },
		),
		// 'country' | 'region' | 'state' | 'city' | 'neighborhood' | 'poi' |
		// 'custom'. Sentinel text (not an enum) to match the rest of the wiki
		// schema's convention for small, additive value sets.
		place_kind: text("place_kind"),
		// Provenance of the row. Drives compile-time and refresh-time behavior
		// (e.g., 'manual' rows are never overwritten by Google refresh).
		// 'google_api' | 'journal_metadata' | 'manual' | 'derived_hierarchy'.
		source: text("source").notNull(),
		// Verbatim cache of the Google Places response for 'google_api' rows,
		// or free-form creator-provided data for 'manual' rows. Frozen after
		// first write per plan D7; manual refresh only via
		// packages/api/scripts/wiki-places-refresh.ts.
		source_payload: jsonb("source_payload"),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		// Read-path access is always (tenant, owner) first.
		index("idx_wiki_places_tenant_owner").on(
			table.tenant_id,
			table.owner_id,
		),
		// Hierarchy walk from parent → children.
		index("idx_wiki_places_parent").on(table.parent_place_id),
		// Partial unique: enforces first-seen-wins for Google-sourced places
		// within a (tenant, owner) scope, while allowing many metadata-only
		// rows (source='journal_metadata', google_place_id IS NULL).
		uniqueIndex("uq_wiki_places_scope_google_place_id")
			.on(table.tenant_id, table.owner_id, table.google_place_id)
			.where(sql`${table.google_place_id} IS NOT NULL`),
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
	owner: one(users, {
		fields: [wikiPages.owner_id],
		references: [users.id],
	}),
	parentPage: one(wikiPages, {
		relationName: "parent_page",
		fields: [wikiPages.parent_page_id],
		references: [wikiPages.id],
	}),
	childPages: many(wikiPages, { relationName: "parent_page" }),
	place: one(wikiPlaces, {
		fields: [wikiPages.place_id],
		references: [wikiPlaces.id],
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
		owner: one(users, {
			fields: [wikiUnresolvedMentions.owner_id],
			references: [users.id],
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
		owner: one(users, {
			fields: [wikiCompileJobs.owner_id],
			references: [users.id],
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
		owner: one(users, {
			fields: [wikiCompileCursors.owner_id],
			references: [users.id],
		}),
	}),
);

export const wikiPlacesRelations = relations(wikiPlaces, ({ one, many }) => ({
	tenant: one(tenants, {
		fields: [wikiPlaces.tenant_id],
		references: [tenants.id],
	}),
	owner: one(users, {
		fields: [wikiPlaces.owner_id],
		references: [users.id],
	}),
	parentPlace: one(wikiPlaces, {
		relationName: "parent_place",
		fields: [wikiPlaces.parent_place_id],
		references: [wikiPlaces.id],
	}),
	childPlaces: many(wikiPlaces, { relationName: "parent_place" }),
	pages: many(wikiPages),
}));
