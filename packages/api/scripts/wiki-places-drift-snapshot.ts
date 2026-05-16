#!/usr/bin/env -S tsx
/**
 * wiki-places-drift-snapshot.ts
 *
 * Measures R14's aggregation-planner drift budget for the wiki-places-v2
 * rollout: before and after the place-hierarchy edges land, snapshot each
 * active page's inbound-link count and `wiki_page_sections.aggregation`
 * jsonb. After the rollout, diff the two snapshots and report pages whose
 * `aggregation` field changed shape alongside pages whose inbound count
 * changed.
 *
 * R14 budget: ≤10% of pages with inbound-count deltas should also show
 * aggregation-shape deltas. Anything above that is a regression for the
 * aggregation planner prompt.
 *
 * Read-only. Two invocations:
 *
 *   # Pre-deploy
 *   tsx packages/api/scripts/wiki-places-drift-snapshot.ts \
 *     --tenant <uuid> --owner <uuid> --output /tmp/pre.jsonl
 *
 *   # Post-deploy
 *   tsx packages/api/scripts/wiki-places-drift-snapshot.ts \
 *     --tenant <uuid> --owner <uuid> --compare /tmp/pre.jsonl
 *
 * Exit code 0 if drift budget respected, 1 if exceeded, 2 on argv error.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "../src/lib/db.js";

interface CliArgs {
	tenantId: string | null;
	ownerId: string | null;
	output: string | null;
	compare: string | null;
	threshold: number;
}

function parseArgs(argv: string[]): CliArgs {
	const out: CliArgs = {
		tenantId: null,
		ownerId: null,
		output: null,
		compare: null,
		threshold: 0.1, // R14 default: 10%
	};
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--tenant") out.tenantId = argv[++i] ?? null;
		else if (argv[i] === "--owner") out.ownerId = argv[++i] ?? null;
		else if (argv[i] === "--output") out.output = argv[++i] ?? null;
		else if (argv[i] === "--compare") out.compare = argv[++i] ?? null;
		else if (argv[i] === "--threshold") {
			const n = Number(argv[++i]);
			if (Number.isFinite(n) && n >= 0 && n <= 1) out.threshold = n;
		}
	}
	return out;
}

export interface PageSnapshot {
	page_id: string;
	slug: string;
	title: string;
	inbound_link_count: number;
	inbound_link_ids: string[]; // sorted
	// One entry per section with a non-null aggregation jsonb. Serialized
	// compact JSON for stable diffing.
	section_aggregations: Array<{ section_slug: string; aggregation_json: string }>;
}

interface QueryRow {
	page_id: string;
	slug: string;
	title: string;
	inbound_link_count: string | number;
	inbound_link_ids: string[] | null;
	section_aggregations:
		| Array<{ section_slug: string; aggregation: unknown }>
		| null;
}

async function snapshot(
	tenantId: string,
	ownerId: string,
): Promise<PageSnapshot[]> {
	const result = await db.execute(sql`
		SELECT
			p.id AS "page_id",
			p.slug AS "slug",
			p.title AS "title",
			coalesce(
				(SELECT count(*) FROM wiki.page_links l
				 WHERE l.to_page_id = p.id AND l.kind = 'reference'),
				0
			) AS "inbound_link_count",
			coalesce(
				(SELECT array_agg(l.from_page_id::text ORDER BY l.from_page_id::text)
				 FROM wiki.page_links l
				 WHERE l.to_page_id = p.id AND l.kind = 'reference'),
				ARRAY[]::text[]
			) AS "inbound_link_ids",
			coalesce(
				(SELECT jsonb_agg(
					jsonb_build_object(
						'section_slug', s.section_slug,
						'aggregation', s.aggregation
					)
					ORDER BY s.section_slug
				)
				FROM wiki.page_sections s
				WHERE s.page_id = p.id AND s.aggregation IS NOT NULL),
				'[]'::jsonb
			) AS "section_aggregations"
		FROM wiki.pages p
		WHERE p.tenant_id = ${tenantId}::uuid
			AND p.owner_id = ${ownerId}::uuid
			AND p.status = 'active'
		ORDER BY p.id
	`);
	const rows = (result as unknown as { rows?: QueryRow[] }).rows ?? [];
	return rows.map((r) => ({
		page_id: r.page_id,
		slug: r.slug,
		title: r.title,
		inbound_link_count: Number(r.inbound_link_count),
		inbound_link_ids: r.inbound_link_ids ?? [],
		section_aggregations: (r.section_aggregations ?? []).map((row) => ({
			section_slug: row.section_slug,
			// Stable serialization — key order is not guaranteed by jsonb, but
			// for diffing we rely on JSON.stringify with sorted keys.
			aggregation_json: stableStringify(row.aggregation),
		})),
	}));
}

export function stableStringify(value: unknown): string {
	return JSON.stringify(value, (_k, v) => {
		if (v && typeof v === "object" && !Array.isArray(v)) {
			const entries = Object.entries(v as Record<string, unknown>).sort(
				([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
			);
			return Object.fromEntries(entries);
		}
		return v;
	});
}

export interface DriftReport {
	total_pages: number;
	inbound_count_changed: number;
	aggregation_changed: number;
	// Pages whose inbound counts shifted AND whose aggregation changed. This is
	// the R14 numerator. If > threshold × inbound_count_changed, the budget is
	// exceeded.
	aggregation_changed_on_affected: number;
	threshold_pct: number;
	budget_exceeded: boolean;
	affected_examples: Array<{
		page_id: string;
		title: string;
		inbound_before: number;
		inbound_after: number;
		sections_changed: string[];
	}>;
}

export function compareSnapshots(
	before: PageSnapshot[],
	after: PageSnapshot[],
	threshold: number,
): DriftReport {
	const byId = new Map(before.map((s) => [s.page_id, s]));
	let inboundChanged = 0;
	let aggChanged = 0;
	let aggChangedOnAffected = 0;
	const examples: DriftReport["affected_examples"] = [];

	for (const afterPage of after) {
		const beforePage = byId.get(afterPage.page_id);
		if (!beforePage) continue; // new page; skip for drift purposes

		const inboundDelta =
			afterPage.inbound_link_count !== beforePage.inbound_link_count;
		if (inboundDelta) inboundChanged += 1;

		const beforeAgg = new Map(
			beforePage.section_aggregations.map((a) => [
				a.section_slug,
				a.aggregation_json,
			]),
		);
		const afterAgg = new Map(
			afterPage.section_aggregations.map((a) => [
				a.section_slug,
				a.aggregation_json,
			]),
		);
		const sectionsChanged: string[] = [];
		for (const [slug, json] of afterAgg) {
			if (beforeAgg.get(slug) !== json) sectionsChanged.push(slug);
		}
		for (const slug of beforeAgg.keys()) {
			if (!afterAgg.has(slug)) sectionsChanged.push(`${slug} (removed)`);
		}
		if (sectionsChanged.length > 0) aggChanged += 1;

		if (inboundDelta && sectionsChanged.length > 0) {
			aggChangedOnAffected += 1;
			if (examples.length < 20) {
				examples.push({
					page_id: afterPage.page_id,
					title: afterPage.title,
					inbound_before: beforePage.inbound_link_count,
					inbound_after: afterPage.inbound_link_count,
					sections_changed: sectionsChanged,
				});
			}
		}
	}

	const budgetNumerator = aggChangedOnAffected;
	const budgetDenominator = Math.max(inboundChanged, 1);
	const ratio = budgetNumerator / budgetDenominator;
	return {
		total_pages: after.length,
		inbound_count_changed: inboundChanged,
		aggregation_changed: aggChanged,
		aggregation_changed_on_affected: aggChangedOnAffected,
		threshold_pct: threshold * 100,
		budget_exceeded: ratio > threshold,
		affected_examples: examples,
	};
}

function loadSnapshot(path: string): PageSnapshot[] {
	const body = readFileSync(path, "utf8");
	return body
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as PageSnapshot);
}

function writeSnapshot(path: string, snapshots: PageSnapshot[]): void {
	const body = snapshots.map((s) => JSON.stringify(s)).join("\n") + "\n";
	writeFileSync(path, body, "utf8");
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	if (!args.tenantId || !args.ownerId) {
		console.error(
			"error: --tenant <uuid> and --owner <uuid> are both required",
		);
		process.exit(2);
	}
	if (!args.output && !args.compare) {
		console.error(
			"error: exactly one of --output <path> (capture) or --compare <path> (diff) is required",
		);
		process.exit(2);
	}

	const snap = await snapshot(args.tenantId, args.ownerId);

	if (args.output) {
		writeSnapshot(args.output, snap);
		console.log(
			`# drift snapshot captured — ${snap.length} pages written to ${args.output}`,
		);
		return;
	}

	const before = loadSnapshot(args.compare ?? "");
	const report = compareSnapshots(before, snap, args.threshold);

	console.log(
		`# wiki places drift diff — ${new Date().toISOString()}\n` +
			`tenant: ${args.tenantId}\n` +
			`owner:  ${args.ownerId}\n`,
	);
	console.log(`pages (after): ${report.total_pages}`);
	console.log(`pages with inbound-count delta:       ${report.inbound_count_changed}`);
	console.log(`pages with aggregation delta:         ${report.aggregation_changed}`);
	console.log(
		`pages with BOTH (R14 numerator):      ${report.aggregation_changed_on_affected}`,
	);
	console.log(
		`threshold:                            ${report.threshold_pct.toFixed(1)}%`,
	);
	console.log(
		`budget status:                        ${report.budget_exceeded ? "EXCEEDED" : "ok"}`,
	);

	if (report.affected_examples.length > 0) {
		console.log(`\naffected (showing up to 20):`);
		for (const ex of report.affected_examples) {
			console.log(
				`  - ${ex.title} (${ex.page_id})` +
					` inbound ${ex.inbound_before}→${ex.inbound_after}` +
					` sections: ${ex.sections_changed.join(", ")}`,
			);
		}
	}

	console.log(`\nJSON: ${JSON.stringify(report)}`);
	process.exit(report.budget_exceeded ? 1 : 0);
}

const isDirectInvocation =
	typeof process !== "undefined" &&
	process.argv[1]?.endsWith("wiki-places-drift-snapshot.ts");

if (isDirectInvocation) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
