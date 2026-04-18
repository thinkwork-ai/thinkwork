/**
 * resetWikiCursor — admin-only replay control.
 *
 * - `force=false` (default): clear the compile cursor for (tenant, owner).
 *   Next compile re-reads all changed records since the beginning of time.
 *   Idempotent compile upserts mean this is safe to run anytime.
 * - `force=true`: additionally archive every active page in the scope so
 *   the next compile rebuilds from scratch instead of merging onto
 *   existing pages. Destructive — use only when the compiler output is
 *   known-bad and you want to start over.
 */

import { and, eq, sql } from "drizzle-orm";
import { wikiPages } from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db } from "../../utils.js";
import { resetCursor } from "../../../lib/wiki/repository.js";
import { assertCanAdminWikiScope } from "./auth.js";

interface ResetWikiCursorArgs {
	tenantId: string;
	ownerId: string;
	force?: boolean | null;
}

export const resetWikiCursor = async (
	_parent: unknown,
	args: ResetWikiCursorArgs,
	ctx: GraphQLContext,
) => {
	await assertCanAdminWikiScope(ctx, {
		tenantId: args.tenantId,
		ownerId: args.ownerId,
	});

	await resetCursor({ tenantId: args.tenantId, ownerId: args.ownerId });

	let pagesArchived = 0;
	if (args.force) {
		const result = await db
			.update(wikiPages)
			.set({ status: "archived", updated_at: sql`now()` as any })
			.where(
				and(
					eq(wikiPages.tenant_id, args.tenantId),
					eq(wikiPages.owner_id, args.ownerId),
					eq(wikiPages.status, "active"),
				),
			)
			.returning({ id: wikiPages.id });
		pagesArchived = result.length;
	}

	return {
		tenantId: args.tenantId,
		ownerId: args.ownerId,
		cursorCleared: true,
		pagesArchived,
	};
};
