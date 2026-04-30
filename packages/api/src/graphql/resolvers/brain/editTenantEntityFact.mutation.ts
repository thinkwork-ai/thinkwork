import { eq } from "drizzle-orm";
import {
	activityLog,
	tenantEntityPages,
	tenantEntityPageSections,
} from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db } from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import { toTenantEntitySection } from "./mappers.js";

export const editTenantEntityFact = async (
	_parent: unknown,
	args: { factId: string; content: string },
	ctx: GraphQLContext,
) => {
	const [row] = await db
		.select({
			section: tenantEntityPageSections,
			tenantId: tenantEntityPages.tenant_id,
			pageId: tenantEntityPages.id,
		})
		.from(tenantEntityPageSections)
		.innerJoin(
			tenantEntityPages,
			eq(tenantEntityPageSections.page_id, tenantEntityPages.id),
		)
		.where(eq(tenantEntityPageSections.id, args.factId))
		.limit(1);
	if (!row) throw new Error("Tenant entity fact not found");
	await requireTenantAdmin(ctx, row.tenantId);
	const [updated] = await db
		.update(tenantEntityPageSections)
		.set({ body_md: args.content, updated_at: new Date() })
		.where(eq(tenantEntityPageSections.id, args.factId))
		.returning();
	const caller = await resolveCallerUserId(ctx);
	if (caller) {
		await db.insert(activityLog).values({
			tenant_id: row.tenantId,
			actor_type: "user",
			actor_id: caller,
			action: "brain_fact_edited",
			entity_type: "tenant_entity_page",
			entity_id: row.pageId,
			changes: { before: row.section.body_md, after: args.content },
		});
	}
	return toTenantEntitySection(updated);
};
