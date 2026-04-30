import { asc, eq } from "drizzle-orm";
import {
	tenantEntityPages,
	tenantEntityPageSections,
} from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db } from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";
import { toTenantEntitySection } from "./mappers.js";

export const tenantEntityFacets = async (
	_parent: unknown,
	args: { pageId: string; limit?: number | null; cursor?: string | null },
	ctx: GraphQLContext,
) => {
	const [page] = await db
		.select({ tenantId: tenantEntityPages.tenant_id })
		.from(tenantEntityPages)
		.where(eq(tenantEntityPages.id, args.pageId))
		.limit(1);
	if (!page) return { edges: [], pageInfo: { hasNextPage: false, endCursor: null } };
	await requireTenantAdmin(ctx, page.tenantId);
	const limit = Math.max(1, Math.min(args.limit ?? 20, 50));
	const rows = await db
		.select()
		.from(tenantEntityPageSections)
		.where(eq(tenantEntityPageSections.page_id, args.pageId))
		.orderBy(asc(tenantEntityPageSections.position))
		.limit(limit + 1);
	const edges = rows.slice(0, limit).map((row) => ({
		node: toTenantEntitySection(row),
		cursor: row.id,
	}));
	return {
		edges,
		pageInfo: {
			hasNextPage: rows.length > limit,
			endCursor: edges.at(-1)?.cursor ?? null,
		},
	};
};
