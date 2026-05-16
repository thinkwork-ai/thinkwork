#!/usr/bin/env -S tsx
/**
 * wiki-places-audit.ts
 *
 * Measures the addressable ceiling for the place-hierarchy capability on a
 * given scope (R13 in the wiki-places-v2 plan).
 *
 * For every active entity page in scope, checks whether the page is currently
 * unlinked (zero inbound wiki_page_links rows) and whether any of its source
 * memory_units carry `place_google_place_id` in their raw Hindsight metadata.
 * The ratio of unlinked-pages-with-place-data to total-active-entity-pages is
 * the projected lift cap — this is the number the Phase C backfill (PR B) is
 * expected to approach, not exceed.
 *
 * Read-only. Queries `hindsight.memory_units.metadata` directly via SQL, so it
 * sees the flat dict (no HindsightAdapter nesting under `.raw`).
 *
 * Usage:
 *   DATABASE_URL="...sslmode=no-verify" \
 *     tsx packages/api/scripts/wiki-places-audit.ts --tenant <uuid> --owner <uuid>
 */

import { sql } from "drizzle-orm";
import { db } from "../src/lib/db.js";

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

export interface AuditResult {
	active_entity_pages: number;
	unlinked_entity_pages: number;
	unlinked_with_place_data: number;
	addressable_ceiling_pct: number;
	projected_lift_pp: number;
	current_linked_pct: number;
	projected_linked_pct: number;
}

interface CountRow {
	active_entity_pages: string | number;
	unlinked_entity_pages: string | number;
	unlinked_with_place_data: string | number;
}

// Exported so a smoke test can build the result object without running SQL.
export function summarize(row: CountRow): AuditResult {
	const active = Number(row.active_entity_pages);
	const unlinked = Number(row.unlinked_entity_pages);
	const addressable = Number(row.unlinked_with_place_data);
	const linked = active - unlinked;

	const currentLinkedPct = active === 0 ? 0 : (linked / active) * 100;
	const projectedLinkedPct =
		active === 0 ? 0 : ((linked + addressable) / active) * 100;

	return {
		active_entity_pages: active,
		unlinked_entity_pages: unlinked,
		unlinked_with_place_data: addressable,
		addressable_ceiling_pct:
			unlinked === 0 ? 0 : (addressable / unlinked) * 100,
		projected_lift_pp: projectedLinkedPct - currentLinkedPct,
		current_linked_pct: currentLinkedPct,
		projected_linked_pct: projectedLinkedPct,
	};
}

async function auditScope(
	tenantId: string,
	ownerId: string,
): Promise<AuditResult> {
	// Three correlated subqueries:
	//   - active entity pages in scope
	//   - of those, ones with zero inbound reference links (proxy for "unlinked")
	//   - of those unlinked, ones whose source memory_units (joined via
	//     wiki_section_sources → hindsight.memory_units) carry a non-empty
	//     `place_google_place_id` in metadata
	const result = await db.execute(sql`
		WITH active_entities AS (
			SELECT id
			FROM wiki.pages
			WHERE tenant_id = ${tenantId}::uuid
				AND owner_id = ${ownerId}::uuid
				AND type = 'entity'
				AND status = 'active'
		),
		unlinked AS (
			SELECT p.id
			FROM active_entities p
			WHERE NOT EXISTS (
				SELECT 1 FROM wiki.page_links l
				WHERE l.from_page_id = p.id AND l.kind = 'reference'
			)
		),
		unlinked_with_place AS (
			SELECT DISTINCT u.id
			FROM unlinked u
			JOIN wiki.page_sections s ON s.page_id = u.id
			JOIN wiki.section_sources ss ON ss.section_id = s.id
			JOIN hindsight.memory_units m ON m.id::text = ss.source_ref
			WHERE ss.source_kind = 'memory_unit'
				AND m.metadata ->> 'place_google_place_id' IS NOT NULL
				AND m.metadata ->> 'place_google_place_id' <> ''
		)
		SELECT
			(SELECT count(*) FROM active_entities) AS "active_entity_pages",
			(SELECT count(*) FROM unlinked) AS "unlinked_entity_pages",
			(SELECT count(*) FROM unlinked_with_place) AS "unlinked_with_place_data"
	`);
	const row = (
		result as unknown as {
			rows?: CountRow[];
		}
	).rows?.[0];
	if (!row) {
		throw new Error("audit query returned no rows");
	}
	return summarize(row);
}

function formatPct(n: number): string {
	return `${n.toFixed(1)}%`;
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	if (!args.tenantId || !args.ownerId) {
		console.error(
			"error: --tenant <uuid> and --owner <uuid> are both required",
		);
		process.exit(2);
	}

	const out = await auditScope(args.tenantId, args.ownerId);

	console.log(
		`# wiki places audit — ${new Date().toISOString()}\n` +
			`tenant: ${args.tenantId}\n` +
			`owner:  ${args.ownerId}\n`,
	);
	console.log(`active entity pages:       ${out.active_entity_pages}`);
	console.log(
		`unlinked entity pages:     ${out.unlinked_entity_pages} (${formatPct((out.unlinked_entity_pages / Math.max(out.active_entity_pages, 1)) * 100)})`,
	);
	console.log(
		`└─ with place_google_place_id in sources: ${out.unlinked_with_place_data}`,
	);
	console.log(`\ncurrent linked%:   ${formatPct(out.current_linked_pct)}`);
	console.log(`projected linked%: ${formatPct(out.projected_linked_pct)}`);
	console.log(
		`projected lift:    +${out.projected_lift_pp.toFixed(1)}pp` +
			` (R13 addressable ceiling = ${formatPct(out.addressable_ceiling_pct)} of the unlinked tail)`,
	);

	// Machine-readable summary on the last line for pipeline use.
	console.log(`\nJSON: ${JSON.stringify(out)}`);
}

// Run when invoked directly; `import.meta.url === import.meta.resolve(process.argv[1])`
// isn't reliable under tsx so we check argv[1] instead.
const isDirectInvocation =
	typeof process !== "undefined" &&
	process.argv[1]?.endsWith("wiki-places-audit.ts");

if (isDirectInvocation) {
	main()
		.then(() => process.exit(0))
		.catch((err) => {
			console.error(err);
			process.exit(1);
		});
}
