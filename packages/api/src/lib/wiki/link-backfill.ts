/**
 * Orchestration for the one-off link backfill (plan Unit 4). Pure-ish
 * coordinator — every side effect is routed through an injected callback
 * so tests can drive it without a database.
 *
 * Phase A: reads all active pages in scope, derives parent candidates
 * from their summaries (reusing the aggregation pass's page-summary
 * expander), and fans `emitDeterministicParentLinks` across every active
 * entity page. Each entity page carries its own id as a "source record"
 * so the linker's overlap gate still applies.
 *
 * Phase B: collects every `memory_unit` id referenced by
 * `wiki_section_sources` in scope and calls `emitCoMentionLinks`
 * directly — same emitter the live compile uses, so the guardrails
 * match.
 *
 * Phase C (wiki-places-v2 Unit 8): for each active page in scope,
 * resolves a POI via the places-service from its source memory_units,
 * sets `wiki_pages.place_id` (COALESCE-guarded), and emits the
 * place-hierarchy edge inline via `emitPlaceHierarchyLinks`. Runs
 * separately from Phase A/B so operators can re-trigger just the
 * place work after the one-time Phase A/B backfill has shipped.
 */

import {
	deriveParentCandidatesFromPageSummaries,
	type PageSummaryCandidateInput,
} from "./parent-expander.js";
import {
	emitCoMentionLinks,
	emitDeterministicParentLinks,
	emitPlaceHierarchyLinks,
	type AffectedPage,
	type FindPageByPlaceId,
	type FindPlaceById,
	type LookupMemorySources,
	type ParentPageFuzzyLookup,
	type ParentPageLookup,
	type WriteLinkArgs,
} from "./deterministic-linker.js";
import { readPlaceMetadata } from "./readPlaceMetadata.js";
import type { WikiPageType } from "./repository.js";
import type { ThinkWorkMemoryRecord } from "../memory/types.js";

export interface BackfillPage {
	id: string;
	type: WikiPageType;
	slug: string;
	title: string;
	summary: string | null;
}

export interface RunLinkBackfillArgs {
	scope: { tenantId: string; ownerId: string };
	dryRun: boolean;
	listAllActivePages: () => Promise<BackfillPage[]>;
	listMemoryUnitIds: () => Promise<string[]>;
	lookupParentPages: ParentPageLookup;
	/** Optional trigram fallback for the parent lookup. Callers running the
	 * live compile wire this to `findPagesByFuzzyTitle`; tests can omit. */
	lookupParentPagesFuzzy?: ParentPageFuzzyLookup;
	lookupMemorySources: LookupMemorySources;
	upsertPageLink: (args: WriteLinkArgs) => Promise<void>;
	log?: (line: string) => void;
}

export interface RunLinkBackfillResult {
	pagesSeen: number;
	candidates: number;
	parentLinksWritten: number;
	memoryUnitsSeen: number;
	coMentionLinksWritten: number;
}

export async function runLinkBackfill(
	args: RunLinkBackfillArgs,
): Promise<RunLinkBackfillResult> {
	const log = args.log ?? (() => {});

	const writeLink = args.dryRun
		? async (link: WriteLinkArgs): Promise<void> => {
				log(
					`[dry-run] ${link.fromPageId} → ${link.toPageId}  ctx=${link.context}`,
				);
			}
		: args.upsertPageLink;

	// ─── Phase A: deterministic parent links from page summaries ──────
	const allPages = await args.listAllActivePages();
	log(`[phase-a] ${allPages.length} active pages in scope`);

	const summaryInputs: PageSummaryCandidateInput[] = allPages.map((p) => ({
		id: p.id,
		summary: p.summary,
		title: p.title,
	}));
	const candidates = deriveParentCandidatesFromPageSummaries(summaryInputs);
	log(`[phase-a] ${candidates.length} parent candidates derived from summaries`);

	// Backfill treats every active entity page as affected and identifies
	// it via its own id — the page-summary expander populates
	// `sourceRecordIds` with page ids, so the linker's overlap check lights
	// up on self-id for pages that actually contributed to the candidate.
	const affectedPages: AffectedPage[] = allPages
		.filter((p) => p.type === "entity")
		.map((p) => ({
			id: p.id,
			type: p.type,
			slug: p.slug,
			title: p.title,
			sourceRecordIds: [p.id],
		}));
	const parentEmission = await emitDeterministicParentLinks({
		scope: args.scope,
		candidates,
		affectedPages,
		lookupParentPages: args.lookupParentPages,
		lookupParentPagesFuzzy: args.lookupParentPagesFuzzy,
		writeLink,
	});
	log(
		`[phase-a] parent-emitter wrote ${parentEmission.linksWritten} links`,
	);

	// ─── Phase B: co-mention links from wiki_section_sources ───────────
	const memoryUnitIds = await args.listMemoryUnitIds();
	log(`[phase-b] ${memoryUnitIds.length} distinct memory_units in scope`);
	const coMentionEmission = await emitCoMentionLinks({
		scope: args.scope,
		memoryUnitIds,
		lookupMemorySources: args.lookupMemorySources,
		writeLink,
	});
	log(
		`[phase-b] co-mention-emitter wrote ${coMentionEmission.linksWritten} links`,
	);

	if (args.dryRun) {
		log(
			`[summary] dry-run complete — no rows written. ` +
				`Would emit ${parentEmission.linksWritten} parent links + ` +
				`${coMentionEmission.linksWritten} co-mention links.`,
		);
	}

	return {
		pagesSeen: allPages.length,
		candidates: candidates.length,
		parentLinksWritten: parentEmission.linksWritten,
		memoryUnitsSeen: memoryUnitIds.length,
		coMentionLinksWritten: coMentionEmission.linksWritten,
	};
}

// ─── Phase C: place backfill (wiki-places-v2 plan Unit 8) ──────────────────

/** Page shape consumed by Phase C. `place_id` indicates whether the page
 * already has a place — pages with a non-null `place_id` skip the
 * resolve step and go straight to hierarchy-edge emission. */
export interface PhaseCPage {
	id: string;
	slug: string;
	title: string;
	type: WikiPageType;
	place_id: string | null;
}

/** Minimum shape the orchestrator needs from a source record — enough for
 * `readPlaceMetadata` (dry-run path) and `resolvePlaceForRecord`
 * (wet-run path) to consume. Kept narrower than `ThinkWorkMemoryRecord`
 * so callers don't have to round-trip through a full adapter fetch when
 * they only have `hindsight.memory_units.metadata` JSONB to hand back. */
export type PhaseCSourceRecord = Pick<ThinkWorkMemoryRecord, "id" | "metadata">;

/** Result of the wet-run place-service call for a single record. The
 * orchestrator only needs the POI id to wire `wiki_pages.place_id`; the
 * hierarchy walk is re-entered via `emitPlaceHierarchyLinks` afterwards. */
export interface PhaseCResolvedPlace {
	poi: { id: string };
}

export interface RunPhaseCPlaceBackfillArgs {
	scope: { tenantId: string; ownerId: string };
	dryRun: boolean;
	/** Active pages in scope. Phase C runs across all active pages (entity
	 * + topic + decision) — the hierarchy link is emitted on any page that
	 * carries a place_id, regardless of type. */
	listActivePages: () => Promise<PhaseCPage[]>;
	/** Returns the source memory_unit records for a given page, in
	 * whatever order the caller prefers. The orchestrator stops at the
	 * first record that resolves to a place (first-seen-wins per plan D6). */
	fetchRecordsForPage: (pageId: string) => Promise<PhaseCSourceRecord[]>;
	/** Wet-run only. Resolves a place row for a record via the
	 * places-service, materializing hierarchy + backing pages as a
	 * side effect. Unused in dry-run. */
	resolvePlaceForRecord: (
		record: PhaseCSourceRecord,
	) => Promise<PhaseCResolvedPlace | null>;
	/** Wet-run only. UPDATE wiki_pages SET place_id = COALESCE(place_id, $new)
	 * WHERE id = $page.id. Returns the canonical place_id now on the row
	 * (may differ from the input when another writer got there first). */
	setPagePlaceId: (args: {
		pageId: string;
		placeId: string;
	}) => Promise<string>;
	/** Used by `emitPlaceHierarchyLinks` for each page that has (or just
	 * gained) a place_id. Same dependency the compile pipeline injects. */
	findPlaceById: FindPlaceById;
	findPageByPlaceId: FindPageByPlaceId;
	/** Hierarchy-edge writer. Returns `true` when a new row was inserted
	 * (ON CONFLICT DO NOTHING fires → false); metric counts only new
	 * inserts so re-runs don't double-count. */
	writeLink: (
		args: WriteLinkArgs & { kind: "reference" },
	) => Promise<boolean>;
	/** Optional probe for the Google Places client circuit-breaker state.
	 * When provided, the final summary surfaces whether the breaker
	 * tripped during this run so operators can correlate a lower-than-
	 * projected enrichment count with an upstream rate-limit. */
	breakerState?: () => { state: "closed" | "tripped" };
	log?: (line: string) => void;
}

export interface RunPhaseCPlaceBackfillResult {
	pages_processed: number;
	pages_enriched: number;
	/** Subset of `pages_enriched` where at least one source record carries
	 * `place_google_place_id`. Matches `wiki-places-audit.ts`'s
	 * `unlinked_with_place_data` count within ±5% — pages without
	 * `google_place_id` still get a `place_id` but produce a metadata-only
	 * POI (`source='journal_metadata'`) with no hierarchy parents. */
	pages_with_google_place_id: number;
	hierarchy_edges_written: number;
	collisions: number;
	breaker_tripped: boolean;
}

export async function runPhaseCPlaceBackfill(
	args: RunPhaseCPlaceBackfillArgs,
): Promise<RunPhaseCPlaceBackfillResult> {
	const log = args.log ?? (() => {});
	const result: RunPhaseCPlaceBackfillResult = {
		pages_processed: 0,
		pages_enriched: 0,
		pages_with_google_place_id: 0,
		hierarchy_edges_written: 0,
		collisions: 0,
		breaker_tripped: false,
	};

	const pages = await args.listActivePages();
	log(`[phase-c] ${pages.length} active pages in scope`);

	for (const page of pages) {
		result.pages_processed += 1;

		// Branch 1: page already carries a place_id — skip enrichment,
		// still try to emit the hierarchy edge (idempotent when it's
		// already there).
		if (page.place_id) {
			if (!args.dryRun) {
				result.hierarchy_edges_written += await emitHierarchyForSinglePage(
					args,
					page.id,
					page.place_id,
				);
			}
			continue;
		}

		// Branch 2: page needs a place_id. Fetch source records.
		let records: PhaseCSourceRecord[];
		try {
			records = await args.fetchRecordsForPage(page.id);
		} catch (err) {
			log(
				`[phase-c] fetch_records_failed page=${page.id}: ${(err as Error)?.message ?? err}`,
			);
			continue;
		}
		if (records.length === 0) continue;

		if (args.dryRun) {
			// Projection — inspect source records for place metadata and
			// count two bands: any metadata (broad; pages that will gain a
			// place_id) and `place_google_place_id`-bearing (strict; the
			// subset that will enrich via Google + produce hierarchy edges,
			// matching the wiki-places-audit addressable ceiling).
			let hasAnyMeta = false;
			let hasGoogleId = false;
			for (const record of records) {
				const meta = readPlaceMetadata(record);
				if (meta) hasAnyMeta = true;
				if (meta?.googlePlaceId) hasGoogleId = true;
				if (hasGoogleId) break; // strict subset is sufficient to break
			}
			if (hasAnyMeta) result.pages_enriched += 1;
			if (hasGoogleId) result.pages_with_google_place_id += 1;
			continue;
		}

		// Wet-run: first record with a resolvable place wins. Subsequent
		// records are intentionally skipped (plan D6).
		if (records.some((r) => readPlaceMetadata(r)?.googlePlaceId)) {
			result.pages_with_google_place_id += 1;
		}
		let enriched = false;
		for (const record of records) {
			let resolved: PhaseCResolvedPlace | null;
			try {
				resolved = await args.resolvePlaceForRecord(record);
			} catch (err) {
				// Partial-unique collision (or any other upsert error) —
				// caught, logged, skip this record. Plan test scenario:
				// "two pages would claim the same google_place_id".
				log(
					`[phase-c] resolve_failed page=${page.id} record=${record.id}: ${(err as Error)?.message ?? err}`,
				);
				result.collisions += 1;
				continue;
			}
			if (!resolved) continue;

			try {
				await args.setPagePlaceId({
					pageId: page.id,
					placeId: resolved.poi.id,
				});
				result.pages_enriched += 1;
				enriched = true;
			} catch (err) {
				log(
					`[phase-c] set_place_id_failed page=${page.id} place=${resolved.poi.id}: ${(err as Error)?.message ?? err}`,
				);
				result.collisions += 1;
				break;
			}

			result.hierarchy_edges_written += await emitHierarchyForSinglePage(
				args,
				page.id,
				resolved.poi.id,
			);
			break;
		}

		if (!enriched && args.breakerState?.().state === "tripped") {
			// Breaker tripped mid-run — places-service now returns
			// metadata-only rows for remaining records, but we've done all
			// we can on this page. Keep iterating; downstream pages still
			// get metadata-only POIs with parent_place_id=null.
			result.breaker_tripped = true;
		}
	}

	if (args.breakerState?.().state === "tripped") {
		result.breaker_tripped = true;
	}

	log(
		`[phase-c] summary ${JSON.stringify(result)}`,
	);
	return result;
}

async function emitHierarchyForSinglePage(
	args: RunPhaseCPlaceBackfillArgs,
	pageId: string,
	placeId: string,
): Promise<number> {
	const emission = await emitPlaceHierarchyLinks({
		scope: args.scope,
		affectedPages: [
			{
				id: pageId,
				tenant_id: args.scope.tenantId,
				owner_id: args.scope.ownerId,
				place_id: placeId,
			},
		],
		findPlaceById: args.findPlaceById,
		findPageByPlaceId: args.findPageByPlaceId,
		writeLink: args.writeLink,
	});
	return emission.linksWritten;
}
