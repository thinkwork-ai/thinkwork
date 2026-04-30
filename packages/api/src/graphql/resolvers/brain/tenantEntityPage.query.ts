import { asc, and, eq } from "drizzle-orm";
import {
	tenantEntityPages,
	tenantEntityPageSections,
} from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db } from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";
import { toTenantEntityPage } from "./mappers.js";

export const tenantEntityPage = async (
	_parent: unknown,
	args: { tenantId: string; pageId: string },
	ctx: GraphQLContext,
) => {
	const [page] = await db
		.select()
		.from(tenantEntityPages)
		.where(
			and(
				eq(tenantEntityPages.id, args.pageId),
				eq(tenantEntityPages.tenant_id, args.tenantId),
			),
		)
		.limit(1);
	if (!page) return null;
	await requireTenantAdmin(ctx, page.tenant_id);
	const sections = await db
		.select()
		.from(tenantEntityPageSections)
		.where(eq(tenantEntityPageSections.page_id, page.id))
		.orderBy(asc(tenantEntityPageSections.position));
	return toTenantEntityPage(page, sections);
};
