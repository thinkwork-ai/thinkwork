/**
 * places-service — find-or-create wiki_places rows for records that carry
 * Google place metadata, with hierarchy enrichment via the Google Places
 * API and auto-creation of backing wiki_pages.
 *
 * Core responsibility: given a memory record (or a list of them) inside a
 * (tenant, owner) scope, resolve a POI wiki_places row. When the Google
 * Places client is available (and its circuit breaker hasn't tripped),
 * also materialize the parent chain (city / state / country) as
 * derived_hierarchy rows and auto-create a backing topic/entity page for
 * each place tier.
 *
 * Graceful degradation: if the Google client is missing or its breaker is
 * tripped, fall back to a metadata-only POI row (source='journal_metadata',
 * parent_place_id=null). No hierarchy, no backing pages for tiers — but
 * the POI row is still persisted and can be linked to the invoking page.
 *
 * See docs/plans/2026-04-21-005-feat-wiki-place-capability-v2-plan.md Unit 5.
 */

import type { ThinkWorkMemoryRecord } from "../memory/types.js";
import {
	findPlaceByGooglePlaceId,
	upsertPage,
	upsertPlace,
	type UpsertWikiPlaceInput,
	type WikiPageRow,
	type WikiPlaceKind,
	type WikiPlaceRow,
	type WikiPlaceSource,
} from "./repository.js";
import { findExistingPageByTitleOrAlias } from "./page-lookup.js";
import { readPlaceMetadata, type PlaceMetadata } from "./readPlaceMetadata.js";
import { slugifyTitle, seedAliasesForTitle } from "./aliases.js";
import type {
	AddressComponent,
	GooglePlacesClient,
	PlaceDetailsResponse,
} from "./google-places-client.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PlacesServiceContext {
	tenantId: string;
	ownerId: string;
	/** Null when Google enrichment is disabled for this run (key missing,
	 * breaker tripped on a previous record, or compile explicitly opted
	 * out). Every record then gets a metadata-only row. */
	googlePlacesClient: GooglePlacesClient | null;
	logger?: Pick<Console, "warn" | "error" | "info">;
}

export interface ResolvedPlace {
	/** The POI place row — this is what `wiki_pages.place_id` should point to
	 * when a page is being written for this record. */
	poi: WikiPlaceRow;
	/** All wiki_places rows that were newly inserted this call (POI + any
	 * hierarchy parents that weren't already present in scope). Empty when
	 * every place was already cached. Useful for metrics. */
	created: WikiPlaceRow[];
	/** Wiki pages that were auto-created as backing pages for
	 * hierarchy-tier places (country / state / city topic pages, plus the
	 * POI entity page). Excludes page updates that just set place_id on
	 * an existing row. */
	backingPagesCreated: WikiPageRow[];
	/** Cheap-to-track signal for metrics: did the Google API actually get
	 * called for this record, or did we hit cache / fall back? */
	source: "cache" | "google_api" | "metadata_only";
}

// ---------------------------------------------------------------------------
// Place resolution
// ---------------------------------------------------------------------------

/**
 * Resolve (find or create) the wiki_places chain for a single record.
 *
 * Returns null when the record carries no recognizable place metadata —
 * callers should treat that as "this record has no place to link".
 */
export async function resolvePlaceForRecord(
	record: ThinkWorkMemoryRecord,
	ctx: PlacesServiceContext,
): Promise<ResolvedPlace | null> {
	const meta = readPlaceMetadata(record);
	if (!meta) return null;
	if (!meta.googlePlaceId) {
		// No Google id → we can't dedupe; just materialize a metadata-only
		// POI row with whatever coords / name we do have. It won't collide
		// with other records' POIs because there's no unique key without a
		// google_place_id.
		return await createMetadataOnlyPoi(meta, ctx);
	}

	// Step 1: cache check — has another record in this scope already
	// resolved this POI? If so, reuse and skip both Google + upsert work.
	const cached = await findPlaceByGooglePlaceId({
		tenantId: ctx.tenantId,
		ownerId: ctx.ownerId,
		googlePlaceId: meta.googlePlaceId,
	});
	if (cached) {
		return { poi: cached, created: [], backingPagesCreated: [], source: "cache" };
	}

	// Step 2: try Google, if we have an active client.
	const client = ctx.googlePlacesClient;
	const breakerOk = client ? client.breakerState().state === "closed" : false;
	if (client && breakerOk) {
		const details = await client.fetchPlaceDetails(meta.googlePlaceId);
		if (details) {
			return await materializeHierarchy(meta, details, ctx);
		}
		// Null response = NOT_FOUND, breaker just tripped, or retries
		// exhausted. Fall through to metadata-only.
	}

	// Step 3: fallback — metadata-only POI with whatever the record gave us.
	return await createMetadataOnlyPoi(meta, ctx);
}

/**
 * Batch-level convenience: given the records backing a single page, find
 * the first one that resolves to a POI and return its place_id. Subsequent
 * records in the batch are intentionally skipped — a page has at most one
 * `place_id`, and first-seen-wins is the policy (see plan D6).
 *
 * Returns null when no record in the batch carries place metadata OR when
 * every record returns null (e.g., all metadata-only with no
 * `place_google_place_id` and no enrichment path). Callers should treat
 * null as "leave this page's place_id unchanged".
 *
 * This helper is the seam the compile pipeline uses; the places-service
 * handles each call's retries, cache hits, and breaker-trip fallbacks.
 */
export async function resolveBatchPlace(
	records: ThinkWorkMemoryRecord[],
	ctx: PlacesServiceContext,
): Promise<{ placeId: string } | null> {
	for (const record of records) {
		const resolved = await resolvePlaceForRecord(record, ctx);
		if (resolved) return { placeId: resolved.poi.id };
	}
	return null;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function createMetadataOnlyPoi(
	meta: PlaceMetadata,
	ctx: PlacesServiceContext,
): Promise<ResolvedPlace> {
	const name = meta.name ?? meta.address ?? meta.googlePlaceId ?? "Unknown place";
	const { row, inserted } = await upsertPlace({
		tenant_id: ctx.tenantId,
		owner_id: ctx.ownerId,
		name,
		google_place_id: meta.googlePlaceId,
		geo_lat: meta.geoLat,
		geo_lon: meta.geoLon,
		address: meta.address,
		parent_place_id: null,
		place_kind: "poi",
		source: "journal_metadata",
		source_payload: null,
	});
	return {
		poi: row,
		created: inserted ? [row] : [],
		backingPagesCreated: [],
		source: "metadata_only",
	};
}

/**
 * Walk Google's addressComponents and materialize the parent chain:
 *
 *   country (always) → state (US/CA only) → city (locality / postal_town /
 *   sublocality_level_1) → POI (the record itself)
 *
 * Each tier gets a wiki_places row plus a backing wiki_page. Existing
 * rows are reused (first-seen-wins at the partial unique level; for rows
 * without google_place_id, name-based matching via
 * findExistingPageByTitleOrAlias is the dedup path). Errors in the walk
 * never throw — unexpected shapes fall back to POI-only.
 */
async function materializeHierarchy(
	meta: PlaceMetadata,
	details: PlaceDetailsResponse,
	ctx: PlacesServiceContext,
): Promise<ResolvedPlace> {
	const created: WikiPlaceRow[] = [];
	const backingPagesCreated: WikiPageRow[] = [];
	const components = details.addressComponents ?? [];

	let country: WikiPlaceRow | null = null;
	let state: WikiPlaceRow | null = null;
	let city: WikiPlaceRow | null = null;

	try {
		// Country — always a top-level hierarchy tier when present.
		const countryComponent = findComponent(components, ["country"]);
		if (countryComponent) {
			country = await findOrCreateHierarchyPlace({
				ctx,
				name: countryComponent.longText,
				kind: "country",
				parentPlaceId: null,
				created,
			});
			await ensureBackingPage(country, "topic", details, ctx, backingPagesCreated);
		}

		// State — only materialized for US / CA where the level_1 admin maps
		// cleanly to a "state" concept. Elsewhere it's too inconsistent to
		// be worth a tier (see plan D3).
		const countryCode = countryComponent?.shortText;
		if (country && (countryCode === "US" || countryCode === "CA")) {
			const stateComponent = findComponent(components, [
				"administrative_area_level_1",
			]);
			if (stateComponent) {
				state = await findOrCreateHierarchyPlace({
					ctx,
					name: stateComponent.longText,
					kind: "state",
					parentPlaceId: country.id,
					created,
				});
				await ensureBackingPage(
					state,
					"topic",
					details,
					ctx,
					backingPagesCreated,
				);
			}
		}

		// City — locality first, then postal_town (UK), then
		// sublocality_level_1 (JP/KR/IN). Skip for city-states where the
		// country IS the city (Singapore / Monaco / Vatican).
		const cityComponent = findComponent(components, [
			"locality",
			"postal_town",
			"sublocality_level_1",
		]);
		const isCityState =
			cityComponent && countryComponent
				? cityComponent.longText === countryComponent.longText
				: false;
		if (cityComponent && !isCityState) {
			city = await findOrCreateHierarchyPlace({
				ctx,
				name: cityComponent.longText,
				kind: "city",
				parentPlaceId: state?.id ?? country?.id ?? null,
				created,
			});
			await ensureBackingPage(
				city,
				"topic",
				details,
				ctx,
				backingPagesCreated,
			);
		}
	} catch (err) {
		(ctx.logger ?? console).warn(
			`[places-service] hierarchy_walk_failed: ${(err as Error)?.message ?? err}` +
				` — falling back to POI-only`,
		);
	}

	// POI row — always created at the tail.
	const poiName =
		details.displayName?.text ??
		meta.name ??
		meta.address ??
		meta.googlePlaceId ??
		"Unknown place";
	const { row: poi, inserted: poiInserted } = await upsertPlace({
		tenant_id: ctx.tenantId,
		owner_id: ctx.ownerId,
		name: poiName,
		google_place_id: meta.googlePlaceId,
		geo_lat: details.location?.latitude ?? meta.geoLat,
		geo_lon: details.location?.longitude ?? meta.geoLon,
		address: details.formattedAddress ?? meta.address,
		parent_place_id: city?.id ?? state?.id ?? country?.id ?? null,
		place_kind: "poi",
		source: "google_api",
		source_payload: details as unknown,
	});
	if (poiInserted) created.push(poi);
	await ensureBackingPage(poi, "entity", details, ctx, backingPagesCreated);

	return {
		poi,
		created,
		backingPagesCreated,
		source: "google_api",
	};
}

async function findOrCreateHierarchyPlace(args: {
	ctx: PlacesServiceContext;
	name: string;
	kind: WikiPlaceKind;
	parentPlaceId: string | null;
	created: WikiPlaceRow[];
}): Promise<WikiPlaceRow> {
	const { ctx, name, kind, parentPlaceId, created } = args;
	// Hierarchy tiers don't carry google_place_id (we never fetched Place
	// Details for them), so we can't use findPlaceByGooglePlaceId. Dedup
	// via the existing backing-page alias machinery: if a page with this
	// title already exists in scope and it has a place_id, reuse that
	// place.
	const existingPage = await findExistingPageByTitleOrAlias({
		tenantId: ctx.tenantId,
		ownerId: ctx.ownerId,
		type: "topic",
		title: name,
	});
	if (existingPage?.page.place_id) {
		const existing = await lookupPlaceById(
			ctx,
			existingPage.page.place_id,
		);
		if (existing && existing.place_kind === kind) {
			return existing;
		}
		// Same-named page but different tier — fall through and create a
		// distinct place. This is rare (e.g., a "Paris" entity page for an
		// unrelated POI).
	}

	const input: UpsertWikiPlaceInput = {
		tenant_id: ctx.tenantId,
		owner_id: ctx.ownerId,
		name,
		google_place_id: null,
		geo_lat: null,
		geo_lon: null,
		address: null,
		parent_place_id: parentPlaceId,
		place_kind: kind,
		source: "derived_hierarchy",
		source_payload: null,
	};
	const { row, inserted } = await upsertPlace(input);
	if (inserted) created.push(row);
	return row;
}

async function lookupPlaceById(
	ctx: PlacesServiceContext,
	id: string,
): Promise<WikiPlaceRow | null> {
	// Small indirection so the test mock only has to stub one repo fn.
	const { findPlaceById } = await import("./repository.js");
	return await findPlaceById({
		tenantId: ctx.tenantId,
		ownerId: ctx.ownerId,
		id,
	});
}

async function ensureBackingPage(
	place: WikiPlaceRow,
	pageType: "topic" | "entity",
	details: PlaceDetailsResponse | null,
	ctx: PlacesServiceContext,
	createdOut: WikiPageRow[],
): Promise<void> {
	const title = place.name;
	const hit = await findExistingPageByTitleOrAlias({
		tenantId: ctx.tenantId,
		ownerId: ctx.ownerId,
		type: pageType,
		title,
	});

	if (hit) {
		// Page exists — link it to this place (first-seen-wins). No new
		// backing page, no section mutation.
		if (!hit.page.place_id) {
			await upsertPage({
				tenant_id: hit.page.tenant_id,
				owner_id: hit.page.owner_id,
				type: hit.page.type,
				slug: hit.page.slug,
				title: hit.page.title,
				summary: hit.page.summary,
				place_id: place.id,
			});
		}
		return;
	}

	// Create a fresh backing page with a single Overview section.
	const slug = slugifyTitle(title);
	const summary = pageType === "entity"
		? (details?.formattedAddress ?? `${title} — location record.`)
		: `Location hub for ${title}.`;
	const overviewBody = pageType === "entity"
		? `${summary}\n\nCoordinates: ${place.geo_lat ?? "?"}, ${place.geo_lon ?? "?"}.`
		: `${summary}`;

	const row = await upsertPage({
		tenant_id: ctx.tenantId,
		owner_id: ctx.ownerId,
		type: pageType,
		slug,
		title,
		summary,
		place_id: place.id,
		sections: [
			{
				section_slug: "overview",
				heading: "Overview",
				body_md: overviewBody,
				position: 0,
			},
		],
		aliases: seedAliasesForTitle(title).map((alias) => ({
			alias,
			source: "compiler" as const,
		})),
	});
	createdOut.push(row);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Walk addressComponents in order and return the first component whose
 * `types` array contains any of the requested component types. Matches
 * Google's convention that components list from most- to least-specific.
 */
function findComponent(
	components: AddressComponent[],
	requestedTypes: string[],
): AddressComponent | null {
	for (const c of components) {
		if (!c || !Array.isArray(c.types)) continue;
		for (const t of requestedTypes) {
			if (c.types.includes(t)) return c;
		}
	}
	return null;
}
