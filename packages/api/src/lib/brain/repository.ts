import { and, eq, sql } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import {
	tenantEntityPages,
	tenantEntityPageAliases,
	tenantEntityPageSections,
	tenantEntitySectionSources,
} from "@thinkwork/database-pg/schema";
import { db as defaultDb } from "../db.js";
import {
	canPromote,
	deriveSourceFacetType,
	isKnownEntitySubtype,
	isKnownSectionSourceKind,
	isTenantEntitySubtype,
	type FactCitation,
	type FacetType,
	type TenantEntitySubtype,
} from "./facet-types.js";

export type DbClient = typeof defaultDb | PgTransaction<any, any, any>;

export interface TenantEntityPageRow {
	id: string;
	tenant_id: string;
	type: "entity" | "topic" | "decision";
	entity_subtype: TenantEntitySubtype;
	slug: string;
	title: string;
	summary: string | null;
	body_md: string | null;
	status: "active" | "archived";
	created_at: Date;
	updated_at: Date;
}

export interface FindOrCreateTenantEntityPageInput {
	tenantId: string;
	type?: "entity" | "topic" | "decision";
	subtype: string;
	slug: string;
	title: string;
	summary?: string | null;
	bodyMd?: string | null;
	aliases?: string[];
}

export interface WriteFacetSectionInput {
	tenantId: string;
	pageId: string;
	facetType: FacetType;
	sectionSlug: string;
	heading: string;
	content: string;
	sources: FactCitation[];
	position?: number;
	allowPromotion?: boolean;
}

export interface AcrossSurfaceSourceHit {
	pageTable: "wiki_pages" | "tenant_entity_pages";
	pageId: string;
	sectionId: string;
	sourceKind: string;
	sourceRef: string;
	title: string;
	slug: string;
	entitySubtype: string | null;
}

export async function findOrCreateTenantEntityPage(
	input: FindOrCreateTenantEntityPageInput,
	db: DbClient = defaultDb,
): Promise<TenantEntityPageRow> {
	const subtype = normalizeTenantSubtype(input.subtype);
	const slug = normalizeSlug(input.slug);
	const title = input.title.trim();
	if (!slug) throw new Error("tenant entity slug is required");
	if (!title) throw new Error("tenant entity title is required");

	const existing = await db
		.select()
		.from(tenantEntityPages)
		.where(
			and(
				eq(tenantEntityPages.tenant_id, input.tenantId),
				eq(tenantEntityPages.type, input.type ?? "entity"),
				eq(tenantEntityPages.entity_subtype, subtype),
				eq(tenantEntityPages.slug, slug),
			),
		)
		.limit(1);
	if (existing[0]) return existing[0] as TenantEntityPageRow;

	const [page] = await db
		.insert(tenantEntityPages)
		.values({
			tenant_id: input.tenantId,
			type: input.type ?? "entity",
			entity_subtype: subtype,
			slug,
			title,
			summary: input.summary ?? null,
			body_md: input.bodyMd ?? null,
		})
		.returning();

	const aliases = [...new Set([...(input.aliases ?? []), title].map(normalizeAlias))]
		.filter(Boolean)
		.map((alias) => ({
			page_id: page.id,
			alias,
			source: "brain",
		}));
	if (aliases.length > 0) {
		await db.insert(tenantEntityPageAliases).values(aliases).onConflictDoNothing();
	}

	return page as TenantEntityPageRow;
}

export async function recordTenantEntitySectionSources(
	args: {
		tenantId: string;
		sectionId: string;
		sources: FactCitation[];
	},
	db: DbClient = defaultDb,
): Promise<void> {
	if (args.sources.length === 0) return;
	for (const source of args.sources) {
		if (!isKnownSectionSourceKind(source.kind)) {
			throw new Error(`unknown Brain source kind: ${source.kind}`);
		}
		if (!source.ref.trim()) {
			throw new Error(`source_ref is required for ${source.kind}`);
		}
	}
	await db
		.insert(tenantEntitySectionSources)
		.values(
			args.sources.map((source) => ({
				tenant_id: args.tenantId,
				section_id: args.sectionId,
				source_kind: source.kind,
				source_ref: source.ref,
			})),
		)
		.onConflictDoNothing();
}

export async function writeFacetSection(
	input: WriteFacetSectionInput,
	db: DbClient = defaultDb,
): Promise<{ sectionId: string; sourceFacetType: FacetType }> {
	if (input.sources.length === 0) {
		throw new Error("brain facet writes require at least one source citation");
	}
	const sourceFacetType = deriveSourceFacetType(input.sources);
	if (!input.allowPromotion && !canPromote(sourceFacetType, input.facetType)) {
		throw new Error(
			`cannot write ${sourceFacetType} sources into ${input.facetType} facet without explicit promotion`,
		);
	}

	const aggregation = {
		facet_type: input.facetType,
		source_facet_type: sourceFacetType,
	};
	const [section] = await db
		.insert(tenantEntityPageSections)
		.values({
			page_id: input.pageId,
			section_slug: input.sectionSlug,
			heading: input.heading,
			body_md: input.content,
			position: input.position ?? 0,
			aggregation,
			last_source_at: new Date(),
		})
		.onConflictDoUpdate({
			target: [
				tenantEntityPageSections.page_id,
				tenantEntityPageSections.section_slug,
			],
			set: {
				heading: input.heading,
				body_md: input.content,
				aggregation,
				last_source_at: new Date(),
				updated_at: new Date(),
			},
		})
		.returning({ id: tenantEntityPageSections.id });

	await recordTenantEntitySectionSources(
		{
			tenantId: input.tenantId,
			sectionId: section.id,
			sources: input.sources,
		},
		db,
	);

	return { sectionId: section.id, sourceFacetType };
}

export async function findPageSourcesAcrossSurfaces(
	args: {
		tenantId: string;
		sourceKind: string;
		sourceRef: string;
		ownerId?: string | null;
	},
	db: DbClient = defaultDb,
): Promise<AcrossSurfaceSourceHit[]> {
	const ownerPredicate = args.ownerId
		? sql`AND wp.owner_id = ${args.ownerId}`
		: sql``;
	const result = await db.execute(sql`
		SELECT
			'wiki_pages'::text AS "pageTable",
			wp.id AS "pageId",
			ws.id AS "sectionId",
			wss.source_kind AS "sourceKind",
			wss.source_ref AS "sourceRef",
			wp.title,
			wp.slug,
			wp.entity_subtype AS "entitySubtype"
		FROM wiki_section_sources wss
		INNER JOIN wiki_page_sections ws ON ws.id = wss.section_id
		INNER JOIN wiki_pages wp ON wp.id = ws.page_id
		WHERE wp.tenant_id = ${args.tenantId}
			${ownerPredicate}
			AND wp.status = 'active'
			AND wss.source_kind = ${args.sourceKind}
			AND wss.source_ref = ${args.sourceRef}
		UNION ALL
		SELECT
			'tenant_entity_pages'::text AS "pageTable",
			tep.id AS "pageId",
			teps.id AS "sectionId",
			tess.source_kind AS "sourceKind",
			tess.source_ref AS "sourceRef",
			tep.title,
			tep.slug,
			tep.entity_subtype AS "entitySubtype"
		FROM tenant_entity_section_sources tess
		INNER JOIN tenant_entity_page_sections teps ON teps.id = tess.section_id
		INNER JOIN tenant_entity_pages tep ON tep.id = teps.page_id
		WHERE tess.tenant_id = ${args.tenantId}
			AND tep.status = 'active'
			AND tess.source_kind = ${args.sourceKind}
			AND tess.source_ref = ${args.sourceRef}
	`);
	return ((result as unknown as { rows?: AcrossSurfaceSourceHit[] }).rows ?? []);
}

export function normalizeTenantSubtype(subtype: string): TenantEntitySubtype {
	if (!isKnownEntitySubtype(subtype) || !isTenantEntitySubtype(subtype)) {
		throw new Error(`unsupported tenant entity subtype: ${subtype}`);
	}
	return subtype;
}

function normalizeSlug(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function normalizeAlias(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}
