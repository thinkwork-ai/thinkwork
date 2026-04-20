#!/usr/bin/env -S tsx
/**
 * wiki-parent-link-audit.ts
 *
 * Probe for the 2026-04-20 handoff item #2: why is
 * `links_written_deterministic = 0` on every compile?
 *
 * Read-only. Runs the summary-based parent-candidate expander against the
 * current scope's active pages, then for each derived candidate title
 * queries pg_trgm `similarity()` against every active page in scope. Prints
 * a report that answers three questions:
 *
 *   1. Does the expander actually produce candidates on this scope?
 *   2. For the candidates it produces, is there an exact-title match?
 *   3. If not, what does the fuzzy similarity distribution look like — in
 *      particular, at what threshold would each candidate resolve?
 *
 * Also surfaces a precision sanity check: for a sample of existing page
 * titles, report the closest scope-neighbor similarity. Lets us see
 * whether lowering the threshold would start accidentally collapsing
 * distinct titles.
 *
 * Usage:
 *   DATABASE_URL="...sslmode=no-verify" tsx packages/api/scripts/wiki-parent-link-audit.ts \
 *     --tenant <uuid> --owner <uuid> [--limit 200]
 *
 * Nothing is written to the DB. Output goes to stdout.
 */

import { sql } from "drizzle-orm";
import { db } from "../src/lib/db.js";
import { wikiPages } from "@thinkwork/database-pg/schema";
import { and, eq } from "drizzle-orm";
import { deriveParentCandidatesFromPageSummaries } from "../src/lib/wiki/parent-expander.js";

interface CliArgs {
	tenantId: string | null;
	ownerId: string | null;
	pageLimit: number;
}

function parseArgs(argv: string[]): CliArgs {
	const out: CliArgs = { tenantId: null, ownerId: null, pageLimit: 500 };
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--tenant") out.tenantId = argv[++i] ?? null;
		else if (argv[i] === "--owner") out.ownerId = argv[++i] ?? null;
		else if (argv[i] === "--limit") {
			const n = Number(argv[++i]);
			if (Number.isFinite(n) && n > 0) out.pageLimit = Math.min(n, 2000);
		}
	}
	return out;
}

interface ScopePage {
	id: string;
	type: "entity" | "topic" | "decision";
	slug: string;
	title: string;
	summary: string | null;
}

async function loadScopePages(
	tenantId: string,
	ownerId: string,
	limit: number,
): Promise<ScopePage[]> {
	const rows = await db
		.select({
			id: wikiPages.id,
			type: wikiPages.type,
			slug: wikiPages.slug,
			title: wikiPages.title,
			summary: wikiPages.summary,
		})
		.from(wikiPages)
		.where(
			and(
				eq(wikiPages.tenant_id, tenantId),
				eq(wikiPages.owner_id, ownerId),
				eq(wikiPages.status, "active"),
			),
		)
		.limit(limit);
	return rows as ScopePage[];
}

interface FuzzyRow {
	id: string;
	type: "entity" | "topic" | "decision";
	title: string;
	similarity: number;
}

async function fuzzyMatches(
	tenantId: string,
	ownerId: string,
	title: string,
	topN: number,
	minSim: number,
): Promise<FuzzyRow[]> {
	const result = await db.execute(sql`
		SELECT
			${wikiPages.id} AS "id",
			${wikiPages.type} AS "type",
			${wikiPages.title} AS "title",
			similarity(${wikiPages.title}, ${title}) AS "similarity"
		FROM ${wikiPages}
		WHERE ${wikiPages.tenant_id} = ${tenantId}
			AND ${wikiPages.owner_id} = ${ownerId}
			AND ${wikiPages.status} = 'active'
			AND similarity(${wikiPages.title}, ${title}) >= ${minSim}
		ORDER BY similarity(${wikiPages.title}, ${title}) DESC
		LIMIT ${topN}
	`);
	const rows =
		(
			result as unknown as {
				rows?: Array<{
					id: string;
					type: "entity" | "topic" | "decision";
					title: string;
					similarity: number | string;
				}>;
			}
		).rows ?? [];
	return rows.map((r) => ({
		id: r.id,
		type: r.type,
		title: r.title,
		similarity:
			typeof r.similarity === "string" ? Number(r.similarity) : r.similarity,
	}));
}

function fmt(n: number): string {
	return n.toFixed(3);
}

const THRESHOLDS = [0.85, 0.7, 0.55, 0.3];

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	if (!args.tenantId || !args.ownerId) {
		console.error(
			"error: --tenant <uuid> and --owner <uuid> are both required",
		);
		process.exit(2);
	}

	console.log(
		`# wiki parent-link audit — ${new Date().toISOString()}\n` +
			`tenant: ${args.tenantId}\n` +
			`owner:  ${args.ownerId}\n` +
			`page scan limit: ${args.pageLimit}\n`,
	);

	const pages = await loadScopePages(args.tenantId, args.ownerId, args.pageLimit);
	if (pages.length === 0) {
		console.log("No active pages in scope — nothing to audit.");
		return;
	}

	const byType = pages.reduce(
		(acc, p) => {
			acc[p.type] = (acc[p.type] ?? 0) + 1;
			return acc;
		},
		{} as Record<string, number>,
	);
	console.log(`scope: ${pages.length} active pages (${JSON.stringify(byType)})`);

	// ─── Section 1: candidates the expander would produce ───────────────────

	console.log(`\n## candidates derived by page-summary expander\n`);
	const candidates = deriveParentCandidatesFromPageSummaries(
		pages.map((p) => ({
			id: p.id,
			summary: p.summary,
			title: p.title,
		})),
		{ minClusterSize: 1 }, // surface everything for audit purposes
	);

	if (candidates.length === 0) {
		console.log(
			"Zero candidates derived — the summary expander isn't finding" +
				" city-like tokens in any page summary. Root cause is not the" +
				" threshold; it's that the expander doesn't match this scope's" +
				" summary shape. Inspect 5 sample summaries below to see why.\n",
		);
		for (const p of pages.slice(0, 5)) {
			console.log(
				`  - ${p.type}/${p.slug} "${p.title}": ${(p.summary ?? "(no summary)").slice(0, 160)}`,
			);
		}
		return;
	}
	console.log(`derived ${candidates.length} candidates (min_cluster=1)\n`);

	// ─── Section 2: per-candidate exact + fuzzy probe ───────────────────────

	console.log(`## per-candidate resolution\n`);
	console.log(
		`column legend: exact = pages in scope with exact-title match;` +
			` best = top fuzzy match title + similarity; emits@X = how many` +
			` candidates would emit a link at similarity ≥ X.\n`,
	);

	const thresholdHits: Record<number, number> = {};
	for (const t of THRESHOLDS) thresholdHits[t] = 0;

	for (const cand of candidates.slice(0, 40)) {
		const exact = await fuzzyMatches(
			args.tenantId,
			args.ownerId,
			cand.parentTitle,
			1,
			0.999, // "exact" = similarity ~= 1.0
		);
		const top5 = await fuzzyMatches(
			args.tenantId,
			args.ownerId,
			cand.parentTitle,
			5,
			0.3,
		);

		const best = top5[0];
		const bestStr = best
			? `"${best.title}" (${best.type}, sim=${fmt(best.similarity)})`
			: "(no match ≥ 0.30)";
		console.log(
			`- "${cand.parentTitle}" (support=${cand.supportingCount})` +
				` exact=${exact.length} best=${bestStr}`,
		);
		if (top5.length > 1) {
			for (const row of top5.slice(1)) {
				console.log(
					`    · "${row.title}" (${row.type}, sim=${fmt(row.similarity)})`,
				);
			}
		}

		for (const t of THRESHOLDS) {
			if (best && best.similarity >= t) thresholdHits[t] += 1;
		}
	}

	const sampled = Math.min(40, candidates.length);
	console.log(
		`\n## threshold recall (over ${sampled} sampled candidates)\n`,
	);
	for (const t of THRESHOLDS) {
		console.log(
			`  ≥ ${fmt(t)} → ${thresholdHits[t]}/${sampled} candidates would emit`,
		);
	}

	// ─── Section 3: precision sanity — page title self-neighbors ────────────

	console.log(`\n## precision sanity: existing-title nearest neighbors\n`);
	console.log(
		`Probes a sample of existing active-page titles to see how similar they` +
			` already are to their nearest scope-neighbor. If lots of titles have a` +
			` > 0.55 neighbor, lowering the fuzzy threshold for parent-linking` +
			` risks accidental cross-title collapse.\n`,
	);

	const sample = pages
		.filter((p) => p.type === "topic" || p.type === "entity")
		.slice(0, 30);
	const neighborBuckets = { "≥0.85": 0, "0.70–0.85": 0, "0.55–0.70": 0, "<0.55": 0 };
	for (const p of sample) {
		// Take top 2 — first is always the self-match at similarity = 1.0.
		const neighbors = await fuzzyMatches(
			args.tenantId,
			args.ownerId,
			p.title,
			2,
			0.0,
		);
		const nearest = neighbors.find((n) => n.id !== p.id);
		if (!nearest) continue;
		const sim = nearest.similarity;
		if (sim >= 0.85) neighborBuckets["≥0.85"] += 1;
		else if (sim >= 0.7) neighborBuckets["0.70–0.85"] += 1;
		else if (sim >= 0.55) neighborBuckets["0.55–0.70"] += 1;
		else neighborBuckets["<0.55"] += 1;
	}
	for (const [label, count] of Object.entries(neighborBuckets)) {
		console.log(`  ${label} → ${count}/${sample.length} pages`);
	}

	console.log(
		`\n(nearest-neighbor buckets at ≥0.85 likely represent existing duplicate` +
			` hubs; ≥0.55 without a 0.85 neighbor is the "Portland vs Portland,` +
			` Oregon" band — exactly what the threshold fix is trying to recover.)\n`,
	);
}

main()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error(err);
		process.exit(1);
	});
