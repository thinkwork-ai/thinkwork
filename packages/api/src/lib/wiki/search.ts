import { sql } from "drizzle-orm";
import { db } from "../../graphql/utils.js";
import {
  toGraphQLPage,
  type GraphQLWikiPage,
} from "../../graphql/resolvers/wiki/mappers.js";

export interface UserWikiSearchResult {
  page: GraphQLWikiPage;
  score: number;
  matchedAlias: string | null;
}

const FUZZY_TERM_THRESHOLD = 0.55;
const WIKI_SEARCH_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "at",
  "for",
  "from",
  "in",
  "is",
  "me",
  "my",
  "of",
  "on",
  "the",
  "to",
  "what",
  "what's",
  "whats",
  "with",
]);

interface WikiSearchRow {
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
  score: number;
  matched_alias: string | null;
}

export function normalizeWikiSearchTerms(query: string): string[] {
  const seen = new Set<string>();
  const terms = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const term of terms) {
    if (term.length < 2) continue;
    if (WIKI_SEARCH_STOPWORDS.has(term)) continue;
    seen.add(term);
  }
  return [...seen];
}

export function buildPrefixTsQuery(query: string): string | null {
  const terms = normalizeWikiSearchTerms(query);
  if (terms.length === 0) return null;
  return terms.map((term) => `${term}:*`).join(" & ");
}

export async function searchWikiForUser(args: {
  tenantId: string;
  userId: string;
  query: string;
  limit: number;
}): Promise<UserWikiSearchResult[]> {
  const query = args.query.trim();
  if (query.length === 0) return [];
  const prefixQuery = buildPrefixTsQuery(query);
  if (!prefixQuery) return [];

  const limit = Math.max(1, args.limit);
  const aliasNeedle = query.toLowerCase();
  const fuzzyTerms = normalizeWikiSearchTerms(query);

  const result = await db.execute(sql`
		WITH search_terms AS (
			SELECT unnest(${fuzzyTerms}::text[]) AS term
		), alias_hits AS (
			SELECT DISTINCT a.page_id, a.alias
			FROM wiki_page_aliases a
			INNER JOIN wiki_pages p ON p.id = a.page_id
			WHERE p.tenant_id = ${args.tenantId}
			  AND p.owner_id = ${args.userId}
			  AND p.status = 'active'
			  AND (a.alias = ${aliasNeedle} OR a.alias ILIKE ${`%${aliasNeedle}%`})
		)
		SELECT
			p.id, p.tenant_id, p.owner_id, p.type, p.slug,
			p.title, p.summary, p.body_md, p.status,
			p.last_compiled_at, p.created_at, p.updated_at,
			(
				COALESCE(ts_rank(p.search_tsv, plainto_tsquery('english', ${query})), 0)
				+ (COALESCE(ts_rank(p.search_tsv, to_tsquery('english', ${prefixQuery})), 0) * 0.5)
				+ CASE WHEN ah.page_id IS NOT NULL THEN 1.0 ELSE 0.0 END
				+ CASE
					WHEN fuzzy.fuzzy_term_count > 0
					 AND fuzzy.fuzzy_match_count >= fuzzy.fuzzy_term_count
					THEN 0.35 + (fuzzy.fuzzy_match_count::float * 0.05)
					ELSE 0.0
				  END
			)::float AS score,
			ah.alias AS matched_alias
		FROM wiki_pages p
		LEFT JOIN alias_hits ah ON ah.page_id = p.id
		CROSS JOIN LATERAL (
			SELECT lower(concat_ws(' ', p.title, p.summary, p.body_md)) AS haystack
		) doc
		CROSS JOIN LATERAL (
			SELECT
				COUNT(*)::int AS fuzzy_match_count,
				(SELECT COUNT(*)::int FROM search_terms) AS fuzzy_term_count
			FROM search_terms st
			WHERE EXISTS (
				SELECT 1
				FROM regexp_split_to_table(doc.haystack, '[^a-z0-9]+') AS token(value)
				WHERE token.value = st.term
				   OR (
				     length(st.term) >= 5
				     AND length(token.value) >= 5
				     AND similarity(st.term, token.value) >= ${FUZZY_TERM_THRESHOLD}
				   )
			)
		) fuzzy
		WHERE p.tenant_id = ${args.tenantId}
		  AND p.owner_id = ${args.userId}
		  AND p.status = 'active'
		  AND (
		    p.search_tsv @@ plainto_tsquery('english', ${query})
		    OR p.search_tsv @@ to_tsquery('english', ${prefixQuery})
		    OR ah.page_id IS NOT NULL
		    OR (
		      fuzzy.fuzzy_term_count > 0
		      AND fuzzy.fuzzy_match_count >= fuzzy.fuzzy_term_count
		    )
		  )
		ORDER BY score DESC, p.last_compiled_at DESC NULLS LAST
		LIMIT ${limit}
	`);

  const rows = ((result as unknown as { rows?: WikiSearchRow[] }).rows ??
    []) as WikiSearchRow[];
  return rows.map((r) => ({
    page: toGraphQLPage(
      {
        id: r.id,
        tenant_id: r.tenant_id,
        owner_id: r.owner_id,
        type: r.type,
        slug: r.slug,
        title: r.title,
        summary: r.summary,
        body_md: r.body_md,
        status: r.status,
        last_compiled_at: r.last_compiled_at,
        created_at: r.created_at,
        updated_at: r.updated_at,
      },
      { sections: [], aliases: [] },
    ),
    score: r.score,
    matchedAlias: r.matched_alias,
  }));
}
