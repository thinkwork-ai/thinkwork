#!/usr/bin/env -S tsx
/**
 * wiki-rebuild-verify.ts
 *
 * Post-rebuild verification report for a (tenant, owner) scope. Read-only.
 * Emits a human-friendly summary so the operator can eyeball whether the
 * hierarchical aggregation pipeline is producing the shapes we expect:
 *
 *   - pages by type (entity/topic/decision)
 *   - promoted children count (pages with parent_page_id set)
 *   - top-10 pages by hubness_score
 *   - top-10 sections by aggregation.promotion_score
 *   - section counts at each promotion_status
 *
 * Usage:
 *   DATABASE_URL=... tsx packages/api/scripts/wiki-rebuild-verify.ts \
 *     --tenant <uuid> --owner <uuid>
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../src/lib/db.js";
import {
	wikiPages,
	wikiPageSections,
} from "@thinkwork/database-pg/schema";
import { countWikiScope } from "../src/lib/wiki/repository.js";

interface CliArgs {
	tenantId: string | null;
	ownerId: string | null;
}

function parseArgs(argv: string[]): CliArgs {
	const out: CliArgs = { tenantId: null, ownerId: null };
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--tenant") out.tenantId = argv[++i] ?? null;
		else if (argv[i] === "--owner") out.ownerId = argv[++i] ?? null;
	}
	return out;
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	if (!args.tenantId || !args.ownerId) {
		console.error("error: --tenant <uuid> and --owner <uuid> are required");
		process.exit(2);
	}
	const { tenantId, ownerId } = args as { tenantId: string; ownerId: string };

	const counts = await countWikiScope({ tenantId, ownerId });

	// Pages by type
	const byType = await db
		.select({
			type: wikiPages.type,
			n: sql<number>`count(*)::int`,
		})
		.from(wikiPages)
		.where(
			and(eq(wikiPages.tenant_id, tenantId), eq(wikiPages.owner_id, ownerId)),
		)
		.groupBy(wikiPages.type);

	// Top-10 by hubness
	const topHubness = await db
		.select({
			type: wikiPages.type,
			slug: wikiPages.slug,
			title: wikiPages.title,
			hubness_score: wikiPages.hubness_score,
		})
		.from(wikiPages)
		.where(
			and(eq(wikiPages.tenant_id, tenantId), eq(wikiPages.owner_id, ownerId)),
		)
		.orderBy(desc(wikiPages.hubness_score))
		.limit(10);

	// Top-10 sections by promotion_score
	const topSections = await db
		.select({
			page_type: wikiPages.type,
			page_title: wikiPages.title,
			section_slug: wikiPageSections.section_slug,
			promotion_status: sql<string>`${wikiPageSections.aggregation}->>'promotion_status'`,
			promotion_score: sql<number>`((${wikiPageSections.aggregation}->>'promotion_score')::float)`,
			linked: sql<number>`coalesce(jsonb_array_length(${wikiPageSections.aggregation}->'linked_page_ids'),0)::int`,
			supporting: sql<number>`((${wikiPageSections.aggregation}->>'supporting_record_count')::int)`,
		})
		.from(wikiPageSections)
		.innerJoin(wikiPages, eq(wikiPageSections.page_id, wikiPages.id))
		.where(
			and(
				eq(wikiPages.tenant_id, tenantId),
				eq(wikiPages.owner_id, ownerId),
				sql`${wikiPageSections.aggregation} is not null`,
			),
		)
		.orderBy(
			desc(sql`((${wikiPageSections.aggregation}->>'promotion_score')::float)`),
		)
		.limit(10);

	console.log(`\n=== scope tenant=${tenantId} owner=${ownerId} ===`);
	console.log(`  pages                     ${counts.pages}`);
	console.log(`  sections                  ${counts.sections}`);
	console.log(`  links                     ${counts.links}`);
	console.log(`  aliases                   ${counts.aliases}`);
	console.log(`  unresolved_mentions       ${counts.unresolved_mentions}`);
	console.log(`  compile_jobs              ${counts.compile_jobs}`);
	console.log(`  pages_with_parent         ${counts.pages_with_parent}`);
	console.log(`  sections_promoted         ${counts.sections_promoted}`);
	console.log(`  sections_candidate        ${counts.sections_promotion_candidate}`);

	console.log(`\n=== pages by type ===`);
	for (const row of byType) {
		console.log(`  ${row.type.padEnd(10)} ${row.n}`);
	}

	console.log(`\n=== top 10 by hubness_score ===`);
	if (topHubness.length === 0) {
		console.log("  (none)");
	} else {
		for (const p of topHubness) {
			console.log(
				`  [${p.type}] ${p.title}  (slug=${p.slug}, hubness=${p.hubness_score})`,
			);
		}
	}

	console.log(`\n=== top 10 sections by promotion_score ===`);
	if (topSections.length === 0) {
		console.log("  (none)");
	} else {
		for (const s of topSections) {
			console.log(
				`  [${s.page_type}] ${s.page_title} › ${s.section_slug}  ` +
					`(score=${Number(s.promotion_score ?? 0).toFixed(3)}, ` +
					`status=${s.promotion_status ?? "none"}, linked=${s.linked}, records=${s.supporting})`,
			);
		}
	}
}

main().catch((err) => {
	console.error(`[wiki-rebuild-verify] fatal: ${(err as Error).stack ?? err}`);
	process.exit(1);
});
