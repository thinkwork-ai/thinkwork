/**
 * Tenant-shared Brain entity pages.
 *
 * These tables intentionally parallel the owner-scoped wiki tables without
 * widening wiki_pages. A Customer/Opportunity/Order/Person is tenant durable
 * state; personal concepts and reflections remain in wiki_pages.
 */

import {
	pgTable,
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

const tsvector = (name: string) =>
	customType<{ data: string; driverData: string }>({
		dataType() {
			return "tsvector";
		},
	})(name);

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

export const tenantEntityPages = pgTable(
	"tenant_entity_pages",
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
		uniqueIndex("uq_tenant_entity_pages_tenant_type_subtype_slug").on(
			table.tenant_id,
			table.type,
			table.entity_subtype,
			table.slug,
		),
		index("idx_tenant_entity_pages_tenant_type_status").on(
			table.tenant_id,
			table.type,
			table.status,
		),
		index("idx_tenant_entity_pages_subtype").on(table.entity_subtype),
		index("idx_tenant_entity_pages_last_compiled").on(table.last_compiled_at),
		index("idx_tenant_entity_pages_search_tsv").using("gin", table.search_tsv),
		index("idx_tenant_entity_pages_parent").on(table.parent_page_id),
		index("idx_tenant_entity_pages_title_trgm").using(
			"gin",
			sql`${table.title} gin_trgm_ops`,
		),
		check(
			"tenant_entity_pages_type_allowed",
			sql`${table.type} IN ('entity','topic','decision')`,
		),
		check(
			"tenant_entity_pages_entity_subtype_allowed",
			sql`${table.entity_subtype} IN ('customer','opportunity','order','person')`,
		),
	],
);

export const tenantEntityPageSections = pgTable(
	"tenant_entity_page_sections",
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
		uniqueIndex("uq_tenant_entity_page_sections_page_slug").on(
			table.page_id,
			table.section_slug,
		),
		index("idx_tenant_entity_page_sections_page_position").on(
			table.page_id,
			table.position,
		),
		check(
			"tenant_entity_page_sections_facet_type_allowed",
			sql`${table.aggregation}->>'facet_type' IS NULL OR ${table.aggregation}->>'facet_type' IN ('operational','relationship','activity','compiled','kb_sourced','external')`,
		),
	],
);

export const tenantEntityPageLinks = pgTable(
	"tenant_entity_page_links",
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
		uniqueIndex("uq_tenant_entity_page_links_from_to_kind").on(
			table.from_page_id,
			table.to_page_id,
			table.kind,
		),
		index("idx_tenant_entity_page_links_to").on(table.to_page_id),
		index("idx_tenant_entity_page_links_kind").on(table.kind),
	],
);

export const tenantEntityPageAliases = pgTable(
	"tenant_entity_page_aliases",
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
		uniqueIndex("uq_tenant_entity_page_aliases_page_alias").on(
			table.page_id,
			table.alias,
		),
		index("idx_tenant_entity_page_aliases_alias").on(table.alias),
		index("idx_tenant_entity_page_aliases_alias_trgm").using(
			"gin",
			sql`${table.alias} gin_trgm_ops`,
		),
	],
);

export const tenantEntitySectionSources = pgTable(
	"tenant_entity_section_sources",
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
		uniqueIndex("uq_tenant_entity_section_sources_section_kind_ref").on(
			table.section_id,
			table.source_kind,
			table.source_ref,
		),
		index("idx_tenant_entity_section_sources_tenant_kind_ref").on(
			table.tenant_id,
			table.source_kind,
			table.source_ref,
		),
	],
);

export const tenantEntityPagesRelations = relations(
	tenantEntityPages,
	({ one, many }) => ({
		tenant: one(tenants, {
			fields: [tenantEntityPages.tenant_id],
			references: [tenants.id],
		}),
		parentPage: one(tenantEntityPages, {
			relationName: "tenant_entity_parent_page",
			fields: [tenantEntityPages.parent_page_id],
			references: [tenantEntityPages.id],
		}),
		childPages: many(tenantEntityPages, {
			relationName: "tenant_entity_parent_page",
		}),
		sections: many(tenantEntityPageSections),
		outgoingLinks: many(tenantEntityPageLinks, {
			relationName: "tenant_entity_from_page",
		}),
		incomingLinks: many(tenantEntityPageLinks, {
			relationName: "tenant_entity_to_page",
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
			relationName: "tenant_entity_from_page",
			fields: [tenantEntityPageLinks.from_page_id],
			references: [tenantEntityPages.id],
		}),
		toPage: one(tenantEntityPages, {
			relationName: "tenant_entity_to_page",
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
