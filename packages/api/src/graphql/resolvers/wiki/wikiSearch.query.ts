/**
 * wikiSearch — Postgres FTS + exact-alias lookup over compiled pages in the
 * caller's readable scope: tenant-scoped pages (owner NULL) plus the
 * requesting user's own pages (plan 2026-06-09-004 U14 union read).
 *
 * Uses the `search_tsv` generated column on wiki_pages (GIN indexed). Alias
 * hits are OR'd in so users can search by a known alternate name and get
 * an exact match even if the prose doesn't contain the query terms.
 *
 * `plainto_tsquery` handles multi-word input without the caller having to
 * build tsquery syntax; empty queries return []. Results are ranked by
 * ts_rank, with a +1 boost for alias matches so exact-name hits come first.
 */

import type { GraphQLContext } from "../../context.js";
import { searchWikiForReadScope } from "../../../lib/wiki/search.js";
import { resolveWikiUnionReadScope } from "./auth.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export const wikiSearch = async (
  _parent: unknown,
  args: {
    tenantId: string;
    userId?: string | null;
    ownerId?: string | null;
    query: string;
    limit?: number;
  },
  ctx: GraphQLContext,
) => {
  const { tenantId, scope } = await resolveWikiUnionReadScope(ctx, args);

  const query = args.query.trim();
  if (query.length === 0) return [];
  const limit = Math.max(1, Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT));

  return searchWikiForReadScope({
    tenantId,
    scope,
    query,
    limit,
  });
};
