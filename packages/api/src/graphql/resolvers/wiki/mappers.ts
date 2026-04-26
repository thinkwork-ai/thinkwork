/**
 * DB-row → GraphQL-type mappers for wiki resolvers.
 */

export function toGraphQLType(dbType: string): string {
	return dbType.toUpperCase();
}

export interface GraphQLWikiSection {
	id: string;
	sectionSlug: string;
	heading: string;
	bodyMd: string;
	position: number;
	lastSourceAt: string | null;
}

export interface GraphQLWikiPage {
	id: string;
	tenantId: string;
	userId: string;
	ownerId?: string;
	type: string;
	slug: string;
	title: string;
	summary: string | null;
	bodyMd: string | null;
	status: string;
	lastCompiledAt: string | null;
	createdAt: string;
	updatedAt: string;
	sections: GraphQLWikiSection[];
	aliases: string[];
	// Backlinks are resolved lazily by the `WikiPage.backlinks` field resolver.
	// Internal-only: surfaced so Unit 8's `parent` / `promotedFromSection`
	// field resolvers don't have to re-query the page row. Not exposed on
	// the GraphQL schema.
	_parentPageId?: string | null;
}

// Timestamps may arrive as `Date` (drizzle's typed `select`) or as ISO
// strings (raw `db.execute(sql`…`)` through postgres-js), so normalize
// before serializing. `new Date(x).toISOString()` works for both shapes
// and preserves null.
function toIsoString(value: Date | string | null | undefined): string | null {
	if (value == null) return null;
	return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function toGraphQLPage(
	row: {
		id: string;
		tenant_id: string;
		owner_id: string;
		type: string;
		slug: string;
		title: string;
		summary: string | null;
		body_md: string | null;
		status: string;
		last_compiled_at: Date | string | null;
		created_at: Date | string;
		updated_at: Date | string;
		parent_page_id?: string | null;
	},
	extras: { sections: GraphQLWikiSection[]; aliases: string[] },
): GraphQLWikiPage {
	return {
		id: row.id,
		tenantId: row.tenant_id,
		userId: row.owner_id,
		ownerId: row.owner_id,
		type: toGraphQLType(row.type),
		slug: row.slug,
		title: row.title,
		summary: row.summary,
		bodyMd: row.body_md,
		status: row.status,
		lastCompiledAt: toIsoString(row.last_compiled_at),
		createdAt: toIsoString(row.created_at) as string,
		updatedAt: toIsoString(row.updated_at) as string,
		sections: extras.sections,
		aliases: extras.aliases,
		_parentPageId: row.parent_page_id ?? null,
	};
}
