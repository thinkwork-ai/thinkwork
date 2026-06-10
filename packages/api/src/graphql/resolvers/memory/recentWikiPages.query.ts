/**
 * recentWikiPages — newest compiled wiki pages readable by a given user.
 *
 * Mobile Memories-tab feed (empty state) so users can see what's landing
 * in their memory before they know what to search for. Uses the same auth
 * shape as mobileWikiSearch: caller must own the user's tenant.
 *
 * Scope (plan 2026-06-09-004 U14): the transitional union — tenant-scoped
 * pages (owner NULL, graph materializer) plus the user's own pages.
 * Behavior for user pages is unchanged from the v1 owner-scope read.
 *
 * Ordered by last_compiled_at DESC (fall back to updated_at when the
 * page has never been compiled — new pages from the compile bootstrap
 * have no last_compiled_at until the first reconcile pass).
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { wikiPages } from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db } from "../../utils.js";
import { wikiReadScopeWhere } from "../../../lib/wiki/repository.js";
import { toGraphQLPage } from "../wiki/mappers.js";
import { requireMemoryUserScope } from "../core/require-user-scope.js";

export const recentWikiPages = async (
  _parent: unknown,
  args: {
    tenantId?: string;
    userId?: string;
    agentId?: string;
    limit?: number;
  },
  ctx: GraphQLContext,
) => {
  const { tenantId, userId } = await requireMemoryUserScope(ctx, {
    ...args,
    allowTenantAdmin: true,
  });

  const query = db
    .select()
    .from(wikiPages)
    .where(
      and(
        eq(wikiPages.tenant_id, tenantId),
        wikiReadScopeWhere(wikiPages.owner_id, {
          kind: "tenantUnion",
          userId,
        }),
        eq(wikiPages.status, "active"),
      ),
    )
    .orderBy(
      desc(
        sql`COALESCE(${wikiPages.last_compiled_at}, ${wikiPages.updated_at})`,
      ),
    )
    .$dynamic();

  const rows =
    typeof args.limit === "number"
      ? await query.limit(Math.max(1, Math.floor(args.limit)))
      : await query;

  // recentWikiPages is a listing surface — sections/aliases aren't
  // needed in the mobile card; fetch the single page via
  // `wikiPage(slug)` when the user taps in.
  return rows.map((r) => toGraphQLPage(r, { sections: [], aliases: [] }));
};
