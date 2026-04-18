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
	ownerId: string;
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
		last_compiled_at: Date | null;
		created_at: Date;
		updated_at: Date;
	},
	extras: { sections: GraphQLWikiSection[]; aliases: string[] },
): GraphQLWikiPage {
	return {
		id: row.id,
		tenantId: row.tenant_id,
		ownerId: row.owner_id,
		type: toGraphQLType(row.type),
		slug: row.slug,
		title: row.title,
		summary: row.summary,
		bodyMd: row.body_md,
		status: row.status,
		lastCompiledAt: row.last_compiled_at?.toISOString() ?? null,
		createdAt: row.created_at.toISOString(),
		updatedAt: row.updated_at.toISOString(),
		sections: extras.sections,
		aliases: extras.aliases,
	};
}
