export function toTenantEntitySection(row: any) {
	const aggregation = (row.aggregation ?? {}) as Record<string, unknown>;
	return {
		id: row.id,
		sectionSlug: row.section_slug,
		heading: row.heading,
		bodyMd: row.body_md,
		position: row.position,
		facetType:
			typeof aggregation.facet_type === "string" ? aggregation.facet_type : null,
		status: row.status,
		lastSourceAt: row.last_source_at?.toISOString?.() ?? null,
		updatedAt: row.updated_at?.toISOString?.() ?? null,
	};
}

export function toTenantEntityPage(row: any, sections: any[]) {
	return {
		id: row.id,
		tenantId: row.tenant_id,
		type: row.type,
		entitySubtype: row.entity_subtype,
		slug: row.slug,
		title: row.title,
		summary: row.summary,
		bodyMd: row.body_md,
		status: row.status,
		updatedAt: row.updated_at?.toISOString?.() ?? null,
		sections: sections.map(toTenantEntitySection),
	};
}
