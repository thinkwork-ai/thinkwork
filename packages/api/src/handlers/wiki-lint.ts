/**
 * wiki-lint Lambda — nightly hygiene sweep for the Compounding Memory wiki.
 *
 * v1 hygiene-only (no auto-mutation):
 *   - Broken links: wiki_page_links rows pointing at missing/archived pages
 *   - Duplicate aliases inside one (tenant, owner, type) scope
 *   - Stale pages: active pages untouched for 90+ days
 *   - Oversize pages: body_md > 8000 chars (~2000 tokens)
 *   - Promotion sweep: open unresolved mentions with mention_count ≥ 3 AND
 *     last_seen within 30 days — enqueue a compile job so the next compile
 *     handles promotion through the same (audited, provenanced) path.
 *
 * Output is logged as JSON so the metric filter can be simple. Job itself
 * does NOT mutate wiki tables — promotion goes through the compile pipeline.
 */

import { and, eq, gte, lt, sql } from "drizzle-orm";
import {
	wikiCompileJobs,
	wikiPageLinks,
	wikiPages,
	wikiUnresolvedMentions,
} from "@thinkwork/database-pg/schema";
import { db } from "../lib/db.js";
import { enqueueCompileJob } from "../lib/wiki/repository.js";

type WikiLintEvent = Record<string, never>;

export interface WikiLintResult {
	ok: boolean;
	broken_links: number;
	duplicate_aliases: number;
	stale_pages: number;
	oversize_pages: number;
	promotion_candidates: number;
	promotion_jobs_enqueued: number;
	error?: string;
}

const STALE_DAYS = 90;
const OVERSIZE_BODY_CHARS = 8000;
const PROMOTION_MIN_COUNT = 3;
const PROMOTION_WITHIN_DAYS = 30;

export async function handler(
	_event: WikiLintEvent = {},
): Promise<WikiLintResult> {
	const result: WikiLintResult = {
		ok: true,
		broken_links: 0,
		duplicate_aliases: 0,
		stale_pages: 0,
		oversize_pages: 0,
		promotion_candidates: 0,
		promotion_jobs_enqueued: 0,
	};

	try {
		// 1. Broken links
		const brokenLinks = await db
			.select({ count: sql<number>`count(*)::int` })
			.from(wikiPageLinks)
			.leftJoin(wikiPages, eq(wikiPageLinks.to_page_id, wikiPages.id))
			.where(
				sql`${wikiPages.id} IS NULL OR ${wikiPages.status} != 'active'`,
			);
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
		const dupRows = (dupAliases as unknown as { rows?: Array<{ count: number }> })
			.rows ?? [];
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

		// 5. Promotion sweep — collect unique (tenant, owner) pairs with any
		// candidate and enqueue one compile job per scope. The compile handler
		// will call listPromotionCandidates + include them in the next run.
		const recencyCutoff = new Date(
			Date.now() - PROMOTION_WITHIN_DAYS * 24 * 3600 * 1000,
		);
		const candidates = await db
			.select({
				tenant_id: wikiUnresolvedMentions.tenant_id,
				owner_id: wikiUnresolvedMentions.owner_id,
				count: sql<number>`count(*)::int`,
			})
			.from(wikiUnresolvedMentions)
			.where(
				and(
					eq(wikiUnresolvedMentions.status, "open"),
					gte(wikiUnresolvedMentions.mention_count, PROMOTION_MIN_COUNT),
					gte(wikiUnresolvedMentions.last_seen_at, recencyCutoff),
				),
			)
			.groupBy(
				wikiUnresolvedMentions.tenant_id,
				wikiUnresolvedMentions.owner_id,
			);

		result.promotion_candidates = candidates.reduce(
			(sum, c) => sum + (c.count ?? 0),
			0,
		);

		for (const c of candidates) {
			try {
				const { inserted } = await enqueueCompileJob({
					tenantId: c.tenant_id,
					ownerId: c.owner_id,
					trigger: "lint",
				});
				if (inserted) result.promotion_jobs_enqueued += 1;
			} catch (err) {
				console.warn(
					`[wiki-lint] enqueue failed for tenant=${c.tenant_id} owner=${c.owner_id}: ${(err as Error)?.message}`,
				);
			}
		}

		// Also prune old job rows (succeeded/skipped/failed > 30 days) so the
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

		console.log(
			`[wiki-lint] ${JSON.stringify(result)}`,
		);
		return result;
	} catch (err) {
		result.ok = false;
		result.error = (err as Error)?.message || String(err);
		console.error(`[wiki-lint] failed: ${result.error}`);
		return result;
	}
}
