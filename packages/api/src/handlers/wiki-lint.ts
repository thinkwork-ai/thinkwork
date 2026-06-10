/**
 * wiki-lint Lambda — nightly hygiene sweep for the Compounding Memory wiki.
 *
 * Hygiene-only (no auto-mutation):
 *   - Broken links: wiki_page_links rows pointing at missing/archived pages
 *   - Duplicate aliases inside one (tenant, owner, type) scope
 *   - Stale pages: active pages untouched for 90+ days
 *   - Oversize pages: body_md > 8000 chars (~2000 tokens)
 *   - Compile-job ledger pruning (terminal rows older than 30 days)
 *
 * The planner-era promotion sweep (open unresolved mentions → enqueue
 * compile jobs) was retired at the U11 cutover (plan 2026-06-09-004):
 * `wiki.unresolved_mentions` froze with the planner and the graph
 * materializer ignores promotion compile jobs.
 *
 * Output is logged as JSON so the metric filter can be simple. Job itself
 * does NOT mutate wiki content tables.
 */

import { and, eq, lt, sql } from "drizzle-orm";
import {
  wikiCompileJobs,
  wikiPageLinks,
  wikiPages,
} from "@thinkwork/database-pg/schema";
import { db } from "../lib/db.js";

type WikiLintEvent = Record<string, never>;

export interface WikiLintResult {
  ok: boolean;
  broken_links: number;
  duplicate_aliases: number;
  stale_pages: number;
  oversize_pages: number;
  error?: string;
}

const STALE_DAYS = 90;
const OVERSIZE_BODY_CHARS = 8000;

export async function handler(
  _event: WikiLintEvent = {},
): Promise<WikiLintResult> {
  const result: WikiLintResult = {
    ok: true,
    broken_links: 0,
    duplicate_aliases: 0,
    stale_pages: 0,
    oversize_pages: 0,
  };

  try {
    // 1. Broken links
    const brokenLinks = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(wikiPageLinks)
      .leftJoin(wikiPages, eq(wikiPageLinks.to_page_id, wikiPages.id))
      .where(sql`${wikiPages.id} IS NULL OR ${wikiPages.status} != 'active'`);
    result.broken_links = brokenLinks[0]?.count ?? 0;

    // 2. Duplicate aliases in the same (tenant, owner, type) scope.
    // Each unique (alias) should map to at most one page per scope; >1 is a
    // consistency smell (usually an alias accidentally pointing at two
    // pages after a rename).
    const dupAliases = await db.execute<{ count: number }>(sql`
			SELECT COUNT(*)::int AS count FROM (
				SELECT p.tenant_id, p.owner_id, p.type, pa.alias, COUNT(*)
				FROM wiki.page_aliases pa
				INNER JOIN wiki.pages p ON p.id = pa.page_id
				WHERE p.status = 'active'
				GROUP BY p.tenant_id, p.owner_id, p.type, pa.alias
				HAVING COUNT(*) > 1
			) dup
		`);
    const dupRows =
      (dupAliases as unknown as { rows?: Array<{ count: number }> }).rows ?? [];
    result.duplicate_aliases = dupRows[0]?.count ?? 0;

    // 3. Stale pages
    const staleCutoff = new Date(Date.now() - STALE_DAYS * 24 * 3600 * 1000);
    const stale = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(wikiPages)
      .where(
        and(
          eq(wikiPages.status, "active"),
          lt(wikiPages.updated_at, staleCutoff),
        ),
      );
    result.stale_pages = stale[0]?.count ?? 0;

    // 4. Oversize pages
    const oversize = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(wikiPages)
      .where(
        and(
          eq(wikiPages.status, "active"),
          sql`length(${wikiPages.body_md}) > ${OVERSIZE_BODY_CHARS}`,
        ),
      );
    result.oversize_pages = oversize[0]?.count ?? 0;

    // 5. Prune old job rows (succeeded/skipped/failed > 30 days) so the
    // ledger doesn't grow without bound.
    const jobCutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    await db
      .delete(wikiCompileJobs)
      .where(
        and(
          sql`${wikiCompileJobs.status} IN ('succeeded','skipped','failed')`,
          lt(wikiCompileJobs.created_at, jobCutoff),
        ),
      );

    console.log(`[wiki-lint] ${JSON.stringify(result)}`);
    return result;
  } catch (err) {
    result.ok = false;
    result.error = (err as Error)?.message || String(err);
    console.error(`[wiki-lint] failed: ${result.error}`);
    return result;
  }
}
