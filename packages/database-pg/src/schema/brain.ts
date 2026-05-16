/**
 * Brain (entity-pages) domain tables.
 *
 * Tenant-shared structured-knowledge pages for first-class business entities
 * (Customer / Opportunity / Order / Person). Structurally parallels the
 * owner-scoped wiki tables — pages, sections, links, aliases, section sources —
 * but the scoping is tenant-wide rather than per-user, and the data lifecycle
 * is enrichment-driven (LLM extraction + operator review) rather than
 * memory-compile-driven.
 *
 * Lives in the `brain.*` Postgres schema (extracted from `public.*` in 2026-05
 * — see docs/solutions/database-issues/feature-schema-extraction-pattern.md
 * and packages/database-pg/drizzle/NNNN_brain_schema_extraction.sql). Wiki
 * shipped in PR 1 of the 3-PR arc; this is PR 2.
 *
 * TS export identifiers (`tenantEntityPages`, `tenantEntityPageSections`,
 * etc.) remain stable across the schema move so consumer imports don't
 * churn; only the in-DB names changed (e.g., `public.tenant_entity_pages` →
 * `brain.pages`). The mobile SDK's `brain.ts` public API name is also
 * unchanged — its internal GraphQL queries observe no wire-format shift.
 *
 * The `tenant_entity_external_refs` table (formerly its own file) is
 * consolidated here as `brain.external_refs` since it's part of the same
 * feature surface.
 */

import {
	pgSchema,
	uuid,
	text,
	integer,
	timestamp,
	jsonb,
	customType,
	uniqueIndex,
	index,
	check,
	type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants } from "./core";

// ---------------------------------------------------------------------------
// Schema handle
// ---------------------------------------------------------------------------

export const brain = pgSchema("brain");

// ---------------------------------------------------------------------------
// Custom tsvector column helper (mirror of wiki.ts)
// ---------------------------------------------------------------------------

const tsvector = (name: string) =>
	customType<{ data: string; driverData: string }>({
		dataType() {
			return "tsvector";
		},
	})(name);

// ---------------------------------------------------------------------------
// Enum-shaped value sets (unchanged from pre-move)
// ---------------------------------------------------------------------------

export const TENANT_ENTITY_SUBTYPES = [
	"customer",
	"opportunity",
	"order",
	"person",
] as const;

export type TenantEntitySubtype = (typeof TENANT_ENTITY_SUBTYPES)[number];

export const TENANT_ENTITY_FACET_TYPES = [
	"operational",
	"relationship",
	"activity",
	"compiled",
	"kb_sourced",
	"external",
] as const;

export type TenantEntityFacetType = (typeof TENANT_ENTITY_FACET_TYPES)[number];

// ---------------------------------------------------------------------------
// brain.pages — tenant-shared structured entity pages
// ---------------------------------------------------------------------------

export const tenantEntityPages = brain.table(
	"pages",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id, { onDelete: "cascade" })
			.notNull(),
		type: text("type").notNull(),
		entity_subtype: text("entity_subtype").notNull(),
		slug: text("slug").notNull(),
		title: text("title").notNull(),
		summary: text("summary"),
		body_md: text("body_md"),
		search_tsv: tsvector("search_tsv").generatedAlwaysAs(
			sql`to_tsvector('english'::regconfig, regexp_replace(coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(body_md,''), '[^[:alnum:]]+', ' ', 'g'))`,
		),
		status: text("status").notNull().default("active"),
		parent_page_id: uuid("parent_page_id").references(
			(): AnyPgColumn => tenantEntityPages.id,
			{ onDelete: "set null" },
		),
		hubness_score: integer("hubness_score").notNull().default(0),
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
		uniqueIndex("uq_pages_tenant_type_subtype_slug").on(
			table.tenant_id,
			table.type,
			table.entity_subtype,
			table.slug,
		),
		index("idx_pages_tenant_type_status").on(
			table.tenant_id,
			table.type,
			table.status,
		),
		index("idx_pages_subtype").on(table.entity_subtype),
		index("idx_pages_last_compiled").on(table.last_compiled_at),
		index("idx_pages_search_tsv").using("gin", table.search_tsv),
		index("idx_pages_parent").on(table.parent_page_id),
		index("idx_pages_title_trgm").using(
			"gin",
			sql`${table.title} gin_trgm_ops`,
		),
		check(
			"pages_type_allowed",
			sql`${table.type} IN ('entity','topic','decision')`,
		),
		check(
			"pages_entity_subtype_allowed",
			sql`${table.entity_subtype} IN ('customer','opportunity','order','person')`,
		),
	],
);

// ---------------------------------------------------------------------------
// brain.page_sections
// ---------------------------------------------------------------------------

export const tenantEntityPageSections = brain.table(
	"page_sections",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		page_id: uuid("page_id")
			.references(() => tenantEntityPages.id, { onDelete: "cascade" })
			.notNull(),
		section_slug: text("section_slug").notNull(),
		heading: text("heading").notNull(),
		body_md: text("body_md").notNull(),
		position: integer("position").notNull(),
		last_source_at: timestamp("last_source_at", { withTimezone: true }),
		aggregation: jsonb("aggregation"),
		status: text("status").notNull().default("active"),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		uniqueIndex("uq_page_sections_page_slug").on(
			table.page_id,
			table.section_slug,
		),
		index("idx_page_sections_page_position").on(
			table.page_id,
			table.position,
		),
		check(
			"page_sections_facet_type_allowed",
			sql`${table.aggregation}->>'facet_type' IS NULL OR ${table.aggregation}->>'facet_type' IN ('operational','relationship','activity','compiled','kb_sourced','external')`,
		),
	],
);

// ---------------------------------------------------------------------------
// brain.page_links
// ---------------------------------------------------------------------------

export const tenantEntityPageLinks = brain.table(
	"page_links",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		from_page_id: uuid("from_page_id")
			.references(() => tenantEntityPages.id, { onDelete: "cascade" })
			.notNull(),
		to_page_id: uuid("to_page_id")
			.references(() => tenantEntityPages.id, { onDelete: "cascade" })
			.notNull(),
		kind: text("kind").notNull().default("reference"),
		context: text("context"),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		uniqueIndex("uq_page_links_from_to_kind").on(
			table.from_page_id,
			table.to_page_id,
			table.kind,
		),
		index("idx_page_links_to").on(table.to_page_id),
		index("idx_page_links_kind").on(table.kind),
	],
);

// ---------------------------------------------------------------------------
// brain.page_aliases
// ---------------------------------------------------------------------------

export const tenantEntityPageAliases = brain.table(
	"page_aliases",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		page_id: uuid("page_id")
			.references(() => tenantEntityPages.id, { onDelete: "cascade" })
			.notNull(),
		alias: text("alias").notNull(),
		source: text("source").notNull(),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		uniqueIndex("uq_page_aliases_page_alias").on(
			table.page_id,
			table.alias,
		),
		index("idx_page_aliases_alias").on(table.alias),
		index("idx_page_aliases_alias_trgm").using(
			"gin",
			sql`${table.alias} gin_trgm_ops`,
		),
	],
);

// ---------------------------------------------------------------------------
// brain.section_sources — provenance for section content
// ---------------------------------------------------------------------------

export const tenantEntitySectionSources = brain.table(
	"section_sources",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id, { onDelete: "cascade" })
			.notNull(),
		section_id: uuid("section_id")
			.references(() => tenantEntityPageSections.id, { onDelete: "restrict" })
			.notNull(),
		source_kind: text("source_kind").notNull(),
		source_ref: text("source_ref").notNull(),
		first_seen_at: timestamp("first_seen_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		uniqueIndex("uq_section_sources_section_kind_ref").on(
			table.section_id,
			table.source_kind,
			table.source_ref,
		),
		index("idx_section_sources_tenant_kind_ref").on(
			table.tenant_id,
			table.source_kind,
			table.source_ref,
		),
	],
);

// ---------------------------------------------------------------------------
// brain.external_refs — provenance for facts pulled from external systems
//
// Consolidated into brain.ts from the prior tenant-entity-external-refs.ts;
// it's the same feature surface (ERP/CRM/support/KB enrichment provenance).
// ---------------------------------------------------------------------------

export const tenantEntityExternalRefs = brain.table(
	"external_refs",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id, { onDelete: "cascade" })
			.notNull(),
		source_kind: text("source_kind").notNull(),
		external_id: text("external_id"),
		source_payload: jsonb("source_payload"),
		as_of: timestamp("as_of", { withTimezone: true }).notNull(),
		ttl_seconds: integer("ttl_seconds").notNull(),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		uniqueIndex("uq_external_refs_source")
			.on(table.tenant_id, table.source_kind, table.external_id)
			.where(sql`${table.external_id} IS NOT NULL`),
		index("idx_external_refs_tenant_source").on(
			table.tenant_id,
			table.source_kind,
		),
		// Constraint excludes tracker_issue / tracker_ticket per the OSS-connector
		// retirement (originally 0087's responsibility). 0090 absorbs 0087's
		// tracker cleanup as part of the schema move: DELETE tracker rows, drop
		// the prior constraint (whichever name — _v2 or _kind_allowed), re-add
		// without tracker entries and without the _v2 suffix. This makes 0087's
		// connector-related schema work (specifically the external_refs piece)
		// redundant — 0087's DROP TABLE statements for computer_delegations /
		// connector_executions / connectors / tenant_connector_catalog remain
		// out of scope here.
		check(
			"external_refs_kind_allowed",
			sql`${table.source_kind} IN ('erp_customer','crm_opportunity','erp_order','crm_person','support_case','bedrock_kb')`,
		),
		check(
			"external_refs_ttl_positive",
			sql`${table.ttl_seconds} > 0`,
		),
	],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const tenantEntityPagesRelations = relations(
	tenantEntityPages,
	({ one, many }) => ({
		tenant: one(tenants, {
			fields: [tenantEntityPages.tenant_id],
			references: [tenants.id],
		}),
		parentPage: one(tenantEntityPages, {
			relationName: "brain_parent_page",
			fields: [tenantEntityPages.parent_page_id],
			references: [tenantEntityPages.id],
		}),
		childPages: many(tenantEntityPages, {
			relationName: "brain_parent_page",
		}),
		sections: many(tenantEntityPageSections),
		outgoingLinks: many(tenantEntityPageLinks, {
			relationName: "brain_from_page",
		}),
		incomingLinks: many(tenantEntityPageLinks, {
			relationName: "brain_to_page",
		}),
		aliases: many(tenantEntityPageAliases),
	}),
);

export const tenantEntityPageSectionsRelations = relations(
	tenantEntityPageSections,
	({ one, many }) => ({
		page: one(tenantEntityPages, {
			fields: [tenantEntityPageSections.page_id],
			references: [tenantEntityPages.id],
		}),
		sources: many(tenantEntitySectionSources),
	}),
);

export const tenantEntityPageLinksRelations = relations(
	tenantEntityPageLinks,
	({ one }) => ({
		fromPage: one(tenantEntityPages, {
			relationName: "brain_from_page",
			fields: [tenantEntityPageLinks.from_page_id],
			references: [tenantEntityPages.id],
		}),
		toPage: one(tenantEntityPages, {
			relationName: "brain_to_page",
			fields: [tenantEntityPageLinks.to_page_id],
			references: [tenantEntityPages.id],
		}),
	}),
);

export const tenantEntityPageAliasesRelations = relations(
	tenantEntityPageAliases,
	({ one }) => ({
		page: one(tenantEntityPages, {
			fields: [tenantEntityPageAliases.page_id],
			references: [tenantEntityPages.id],
		}),
	}),
);

export const tenantEntitySectionSourcesRelations = relations(
	tenantEntitySectionSources,
	({ one }) => ({
		tenant: one(tenants, {
			fields: [tenantEntitySectionSources.tenant_id],
			references: [tenants.id],
		}),
		section: one(tenantEntityPageSections, {
			fields: [tenantEntitySectionSources.section_id],
			references: [tenantEntityPageSections.id],
		}),
	}),
);

export const tenantEntityExternalRefsRelations = relations(
	tenantEntityExternalRefs,
	({ one }) => ({
		tenant: one(tenants, {
			fields: [tenantEntityExternalRefs.tenant_id],
			references: [tenants.id],
		}),
	}),
);
