#!/usr/bin/env -S tsx
/**
 * wiki-link-backfill.ts
 *
 * Apply Units 2 + 3 of the link-densification plan to the existing
 * wiki corpus for a single (tenant, owner) scope without re-running the
 * LLM compile. Phase A emits deterministic `reference` links derived
 * from page summaries; Phase B emits reciprocal entity↔entity
 * co-mention links via `wiki_section_sources`. Phase C (wiki-places-v2
 * Unit 8, opt-out) walks every active page, resolves a POI via the
 * places-service, sets `wiki_pages.place_id`, and emits one hierarchy
 * edge per page.
 *
 * Usage:
 *   DATABASE_URL=... tsx packages/api/scripts/wiki-link-backfill.ts \
 *     --tenant <uuid> --owner <uuid> [--dry-run] [--no-phase-c]
 *
 * Flags:
 *   --tenant     (required) tenant_id — scope safety rail.
 *   --owner      (required) owner/agent_id — scope safety rail.
 *   --dry-run    Skip writes; log the plan (candidates and edge counts).
 *                Phase C dry-run short-circuits the places-service — no
 *                Google API calls, no DB writes, only a projected
 *                enrichment count.
 *   --no-phase-c Skip the wiki-places-v2 Phase C pass; run only Phases A + B.
 *
 * Idempotency: `upsertPageLink` uses `onConflictDoNothing` on the
 * `(from_page_id, to_page_id, kind)` unique index, so re-running the
 * script is a no-op beyond read traffic.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "../src/lib/db.js";
import {
	wikiPageLinks,
	wikiPageSections,
	wikiPages,
	wikiSectionSources,
} from "@thinkwork/database-pg/schema";
import {
	findMemoryUnitPageSources,
	findPageByPlaceId,
	findPagesByExactTitle,
	findPagesByFuzzyTitle,
	findPlaceById,
	PARENT_TITLE_FUZZY_THRESHOLD,
	upsertPageLink,
	type WikiPageRow,
	type WikiPageType,
	type WikiPlaceRow,
} from "../src/lib/wiki/repository.js";
import {
	runLinkBackfill,
	runPhaseCPlaceBackfill,
	type PhaseCPage,
	type PhaseCSourceRecord,
	type RunPhaseCPlaceBackfillResult,
} from "../src/lib/wiki/link-backfill.js";
import { loadGooglePlacesClientFromSsm } from "../src/lib/wiki/google-places-client.js";
import {
	resolvePlaceForRecord,
	type PlacesServiceContext,
} from "../src/lib/wiki/places-service.js";

interface CliArgs {
	tenantId: string | null;
	ownerId: string | null;
	dryRun: boolean;
	phaseC: boolean;
}

function parseArgs(argv: string[]): CliArgs {
	const out: CliArgs = {
		tenantId: null,
		ownerId: null,
		dryRun: false,
		phaseC: true,
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		switch (a) {
			case "--tenant":
				out.tenantId = argv[++i] ?? null;
				break;
			case "--owner":
				out.ownerId = argv[++i] ?? null;
				break;
			case "--dry-run":
				out.dryRun = true;
				break;
			case "--phase-c":
				out.phaseC = true;
				break;
			case "--no-phase-c":
				out.phaseC = false;
				break;
			case "--help":
			case "-h":
				printHelp();
				process.exit(0);
		}
	}
	return out;
}

function printHelp(): void {
	console.log(`wiki-link-backfill.ts

Usage:
  tsx packages/api/scripts/wiki-link-backfill.ts \\
    --tenant <uuid> --owner <uuid> [--dry-run] [--no-phase-c]

Flags:
  --tenant      (required) tenant_id scope.
  --owner       (required) owner/agent_id scope.
  --dry-run     Log candidates + counts without writing links.
                Phase C dry-run short-circuits the places-service
                (no Google API calls, no DB writes).
  --no-phase-c  Skip the wiki-places-v2 Phase C pass (default is on).
`);
}

async function listAllActivePages(args: {
	tenantId: string;
	ownerId: string;
}): Promise<
	Array<{
		id: string;
		type: "entity" | "topic" | "decision";
		slug: string;
		title: string;
		summary: string | null;
	}>
> {
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
				eq(wikiPages.tenant_id, args.tenantId),
				eq(wikiPages.owner_id, args.ownerId),
				eq(wikiPages.status, "active"),
			),
		);
	return rows as Array<{
		id: string;
		type: "entity" | "topic" | "decision";
		slug: string;
		title: string;
		summary: string | null;
	}>;
}

async function listMemoryUnitIdsInScope(args: {
	tenantId: string;
	ownerId: string;
}): Promise<string[]> {
	const result = await db.execute(sql`
		SELECT DISTINCT ${wikiSectionSources.source_ref}::text AS memory_unit_id
		FROM ${wikiSectionSources}
		JOIN ${wikiPageSections}
			ON ${wikiPageSections.id} = ${wikiSectionSources.section_id}
		JOIN ${wikiPages} ON ${wikiPages.id} = ${wikiPageSections.page_id}
		WHERE ${wikiSectionSources.source_kind} = 'memory_unit'
			AND ${wikiPages.tenant_id} = ${args.tenantId}
			AND ${wikiPages.owner_id} = ${args.ownerId}
			AND ${wikiPages.status} = 'active'
	`);
	const rows =
		(result as unknown as { rows?: Array<{ memory_unit_id: string }> })
			.rows ?? [];
	return rows.map((r) => r.memory_unit_id);
}

async function countReferenceLinks(scope: {
	tenantId: string;
	ownerId: string;
}): Promise<number> {
	const result = await db.execute(sql`
		SELECT COUNT(*)::int AS n
		FROM ${wikiPageLinks} wpl
		JOIN ${wikiPages} wp ON wp.id = wpl.from_page_id
		WHERE wpl.kind = 'reference'
			AND wp.tenant_id = ${scope.tenantId}
			AND wp.owner_id = ${scope.ownerId}
	`);
	const rows =
		(result as unknown as { rows?: Array<{ n: number }> }).rows ?? [];
	return rows[0]?.n ?? 0;
}

async function listActivePagesForPhaseC(scope: {
	tenantId: string;
	ownerId: string;
}): Promise<PhaseCPage[]> {
	const rows = await db
		.select({
			id: wikiPages.id,
			type: wikiPages.type,
			slug: wikiPages.slug,
			title: wikiPages.title,
			place_id: wikiPages.place_id,
		})
		.from(wikiPages)
		.where(
			and(
				eq(wikiPages.tenant_id, scope.tenantId),
				eq(wikiPages.owner_id, scope.ownerId),
				eq(wikiPages.status, "active"),
			),
		);
	return rows.map((r) => ({
		id: r.id,
		type: r.type as WikiPageType,
		slug: r.slug,
		title: r.title,
		place_id: r.place_id ?? null,
	}));
}

/**
 * Fetch source memory_unit records for a given page_id, joining through
 * `wiki_section_sources → wiki_page_sections` and reading each unit's
 * raw `metadata` JSONB directly off `hindsight.memory_units`.
 *
 * Returns records in the `{ id, metadata: { raw: <...> } }` shape that
 * `readPlaceMetadata` expects — mirrors the HindsightAdapter's `mapUnit`
 * nesting so the places-service doesn't have to care whether it's being
 * called from the compile pipeline or the backfill script.
 */
async function fetchPageSourceRecords(
	pageId: string,
): Promise<PhaseCSourceRecord[]> {
	const result = await db.execute(sql`
		SELECT DISTINCT m.id::text AS id, m.metadata
		FROM hindsight.memory_units m
		JOIN wiki_section_sources ss ON ss.source_ref = m.id::text
		JOIN wiki_page_sections ps ON ps.id = ss.section_id
		WHERE ps.page_id = ${pageId}::uuid
			AND ss.source_kind = 'memory_unit'
	`);
	const rows =
		(result as unknown as {
			rows?: Array<{ id: string; metadata: unknown }>;
		}).rows ?? [];
	return rows.map((r) => ({
		id: r.id,
		metadata: { raw: r.metadata ?? null },
	}));
}

async function setPagePlaceIdInDb(args: {
	pageId: string;
	placeId: string;
}): Promise<string> {
	const result = await db.execute(sql`
		UPDATE ${wikiPages}
		SET place_id = COALESCE(place_id, ${args.placeId}::uuid),
			updated_at = now()
		WHERE id = ${args.pageId}::uuid
		RETURNING place_id
	`);
	const rows =
		(result as unknown as { rows?: Array<{ place_id: string }> }).rows ?? [];
	return rows[0]?.place_id ?? args.placeId;
}

async function runPhaseCAgainstDb(
	scope: { tenantId: string; ownerId: string },
	dryRun: boolean,
): Promise<RunPhaseCPlaceBackfillResult> {
	const googleClient = dryRun ? null : await loadGooglePlacesClientFromSsm();
	const placesCtx: PlacesServiceContext = {
		tenantId: scope.tenantId,
		ownerId: scope.ownerId,
		googlePlacesClient: googleClient,
		logger: console,
	};

	return runPhaseCPlaceBackfill({
		scope,
		dryRun,
		listActivePages: () => listActivePagesForPhaseC(scope),
		fetchRecordsForPage: (pageId) => fetchPageSourceRecords(pageId),
		resolvePlaceForRecord: async (record) => {
			// places-service resolver wants a full ThinkWorkMemoryRecord; it
			// only reads `metadata`, so the minimal shape is safe.
			const resolved = await resolvePlaceForRecord(record as any, placesCtx);
			if (!resolved) return null;
			return { poi: { id: resolved.poi.id } };
		},
		setPagePlaceId: (a) => setPagePlaceIdInDb(a),
		findPlaceById: (a): Promise<WikiPlaceRow | null> => findPlaceById(a),
		findPageByPlaceId: (a): Promise<WikiPageRow | null> => findPageByPlaceId(a),
		writeLink: (link) =>
			upsertPageLink({
				fromPageId: link.fromPageId,
				toPageId: link.toPageId,
				context: link.context,
				kind: link.kind,
			}),
		breakerState: googleClient ? () => googleClient.breakerState() : undefined,
		log: (msg) => console.log(msg),
	});
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	if (!args.tenantId || !args.ownerId) {
		console.error("error: --tenant <uuid> and --owner <uuid> are required");
		process.exit(2);
	}
	const scope = { tenantId: args.tenantId, ownerId: args.ownerId };

	console.log(
		`[wiki-link-backfill] scope tenant=${scope.tenantId} owner=${scope.ownerId}` +
			(args.dryRun ? " (DRY RUN)" : ""),
	);

	const baseline = args.dryRun ? null : await countReferenceLinks(scope);

	await runLinkBackfill({
		scope,
		dryRun: args.dryRun,
		listAllActivePages: () => listAllActivePages(scope),
		listMemoryUnitIds: () => listMemoryUnitIdsInScope(scope),
		lookupParentPages: (lookupArgs) => findPagesByExactTitle(lookupArgs),
		lookupParentPagesFuzzy: (lookupArgs) =>
			findPagesByFuzzyTitle({
				...lookupArgs,
				threshold: PARENT_TITLE_FUZZY_THRESHOLD,
				limit: 5,
			}),
		lookupMemorySources: (lookupArgs) => findMemoryUnitPageSources(lookupArgs),
		upsertPageLink: async (linkArgs) => {
			await upsertPageLink({
				fromPageId: linkArgs.fromPageId,
				toPageId: linkArgs.toPageId,
				context: linkArgs.context,
			});
		},
		log: (msg) => console.log(msg),
	});

	if (args.phaseC) {
		console.log(
			`[wiki-link-backfill] Phase C start${args.dryRun ? " (DRY RUN)" : ""}`,
		);
		const phaseCResult = await runPhaseCAgainstDb(scope, args.dryRun);
		console.log(`[summary] phase-c ${JSON.stringify(phaseCResult)}`);
	} else {
		console.log(`[wiki-link-backfill] Phase C skipped (--no-phase-c)`);
	}

	if (!args.dryRun && baseline !== null) {
		const after = await countReferenceLinks(scope);
		console.log(
			`[summary] reference-link count: ${baseline} → ${after}` +
				` (+${after - baseline})`,
		);
	}
}

main().catch((err) => {
	console.error(
		`[wiki-link-backfill] fatal: ${(err as Error).stack ?? err}`,
	);
	process.exit(1);
});
