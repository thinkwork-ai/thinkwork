import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ThinkWorkMemoryRecord } from "../lib/memory/types.js";
import type {
	GooglePlacesClient,
	PlaceDetailsResponse,
} from "../lib/wiki/google-places-client.js";

// The service pulls in repository + page-lookup — mock both so we can
// exercise branching without touching the DB. Everything under test lives
// in places-service itself.
const mockRepo = vi.hoisted(() => ({
	findPlaceByGooglePlaceId: vi.fn(),
	findPlaceById: vi.fn(),
	upsertPlace: vi.fn(),
	upsertPage: vi.fn(),
}));
const mockLookup = vi.hoisted(() => ({
	findExistingPageByTitleOrAlias: vi.fn(),
}));

vi.mock("../lib/wiki/repository.js", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		findPlaceByGooglePlaceId: mockRepo.findPlaceByGooglePlaceId,
		findPlaceById: mockRepo.findPlaceById,
		upsertPlace: mockRepo.upsertPlace,
		upsertPage: mockRepo.upsertPage,
	};
});

vi.mock("../lib/wiki/page-lookup.js", () => ({
	findExistingPageByTitleOrAlias: mockLookup.findExistingPageByTitleOrAlias,
}));

// Real helpers — don't mock; they're pure.
// (aliases.ts, readPlaceMetadata.ts are imported by places-service.)

import { resolvePlaceForRecord } from "../lib/wiki/places-service.js";

function makeRecord(raw: Record<string, unknown>): ThinkWorkMemoryRecord {
	return {
		id: "rec-1",
		tenantId: "t-1",
		ownerId: "a-1",
		ownerType: "agent",
		kind: "unit",
		sourceType: "thread_turn",
		status: "active",
		content: { text: "" },
		backendRefs: [{ backend: "hindsight", ref: "u-1" }],
		createdAt: "2026-04-21T00:00:00Z",
		metadata: {
			bankId: "b-1",
			factType: "episodic",
			tags: null,
			confidence: null,
			eventDate: null,
			occurredStart: null,
			occurredEnd: null,
			mentionedAt: null,
			accessCount: null,
			proofCount: null,
			context: null,
			raw,
		} as any,
	};
}

function placeRow(overrides: Record<string, unknown> = {}) {
	return {
		id: "p-1",
		tenant_id: "t-1",
		owner_id: "a-1",
		name: "Sample",
		google_place_id: null,
		geo_lat: null,
		geo_lon: null,
		address: null,
		parent_place_id: null,
		place_kind: "poi",
		source: "journal_metadata",
		source_payload: null,
		created_at: new Date(),
		updated_at: new Date(),
		...overrides,
	};
}

function pageRow(overrides: Record<string, unknown> = {}) {
	return {
		id: "pg-1",
		tenant_id: "t-1",
		owner_id: "a-1",
		type: "entity",
		slug: "sample",
		title: "Sample",
		summary: null,
		body_md: null,
		status: "active",
		parent_page_id: null,
		place_id: null,
		hubness_score: 0,
		tags: [],
		last_compiled_at: null,
		created_at: new Date(),
		updated_at: new Date(),
		...overrides,
	};
}

function makeMockClient(overrides: Partial<GooglePlacesClient> = {}): GooglePlacesClient {
	return {
		fetchPlaceDetails: vi.fn().mockResolvedValue(null),
		breakerState: vi
			.fn()
			.mockReturnValue({ state: "closed", consecutive_failures: 0, trip_reason: null }),
		...overrides,
	};
}

const ctx = () => ({
	tenantId: "t-1",
	ownerId: "a-1",
	googlePlacesClient: null as GooglePlacesClient | null,
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
});

describe("resolvePlaceForRecord", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockLookup.findExistingPageByTitleOrAlias.mockResolvedValue(null);
	});

	it("returns null when the record carries no place metadata", async () => {
		const rec = makeRecord({ otherKey: "value" });
		const out = await resolvePlaceForRecord(rec, ctx());
		expect(out).toBeNull();
		expect(mockRepo.upsertPlace).not.toHaveBeenCalled();
	});

	it("reuses an existing place when google_place_id matches (cache hit)", async () => {
		const cached = placeRow({
			id: "p-cached",
			google_place_id: "ChIJabc",
			source: "google_api",
		});
		mockRepo.findPlaceByGooglePlaceId.mockResolvedValue(cached);
		const rec = makeRecord({
			place_google_place_id: "ChIJabc",
			place_geo_lat: "1",
			place_geo_lon: "2",
		});
		const out = await resolvePlaceForRecord(rec, ctx());
		expect(out?.poi).toEqual(cached);
		expect(out?.source).toBe("cache");
		expect(out?.created).toEqual([]);
		expect(mockRepo.upsertPlace).not.toHaveBeenCalled();
	});

	it("creates a metadata-only POI when Google client is null", async () => {
		mockRepo.findPlaceByGooglePlaceId.mockResolvedValue(null);
		mockRepo.upsertPlace.mockImplementation(async (input: any) => ({
			row: placeRow({
				id: "p-new",
				google_place_id: input.google_place_id,
				name: input.name,
				source: input.source,
				place_kind: input.place_kind,
			}),
			inserted: true,
		}));
		const rec = makeRecord({
			place_google_place_id: "ChIJnew",
			place_name: "Café",
			place_geo_lat: "48.85",
			place_geo_lon: "2.35",
		});
		const out = await resolvePlaceForRecord(rec, ctx());
		expect(out?.source).toBe("metadata_only");
		expect(out?.poi.source).toBe("journal_metadata");
		expect(out?.poi.place_kind).toBe("poi");
		expect(mockRepo.upsertPlace).toHaveBeenCalledTimes(1);
	});

	it("falls back to metadata-only when the breaker is tripped", async () => {
		mockRepo.findPlaceByGooglePlaceId.mockResolvedValue(null);
		mockRepo.upsertPlace.mockImplementation(async () => ({
			row: placeRow({ source: "journal_metadata" }),
			inserted: true,
		}));
		const client = makeMockClient({
			breakerState: () => ({
				state: "tripped",
				consecutive_failures: 5,
				trip_reason: "quota exhausted",
			}),
		});
		const rec = makeRecord({
			place_google_place_id: "ChIJnew",
			place_geo_lat: "1",
			place_geo_lon: "2",
		});
		const out = await resolvePlaceForRecord(rec, { ...ctx(), googlePlacesClient: client });
		expect(out?.source).toBe("metadata_only");
		expect(client.fetchPlaceDetails).not.toHaveBeenCalled();
	});

	it("falls back to metadata-only when fetchPlaceDetails returns null", async () => {
		mockRepo.findPlaceByGooglePlaceId.mockResolvedValue(null);
		mockRepo.upsertPlace.mockImplementation(async () => ({
			row: placeRow({ source: "journal_metadata" }),
			inserted: true,
		}));
		const client = makeMockClient({
			fetchPlaceDetails: vi.fn().mockResolvedValue(null),
		});
		const rec = makeRecord({
			place_google_place_id: "ChIJrotated",
			place_geo_lat: "1",
			place_geo_lon: "2",
		});
		const out = await resolvePlaceForRecord(rec, { ...ctx(), googlePlacesClient: client });
		expect(out?.source).toBe("metadata_only");
		expect(client.fetchPlaceDetails).toHaveBeenCalledWith("ChIJrotated");
	});

	it("materializes country + state + city hierarchy for a US POI", async () => {
		mockRepo.findPlaceByGooglePlaceId.mockResolvedValue(null);

		const placesCreated: any[] = [];
		mockRepo.upsertPlace.mockImplementation(async (input: any) => {
			const row = placeRow({
				id: `p-${placesCreated.length + 1}`,
				name: input.name,
				google_place_id: input.google_place_id,
				place_kind: input.place_kind,
				source: input.source,
				parent_place_id: input.parent_place_id,
			});
			placesCreated.push(row);
			return { row, inserted: true };
		});
		mockRepo.upsertPage.mockImplementation(async (input: any) =>
			pageRow({
				id: `pg-${input.slug}`,
				slug: input.slug,
				title: input.title,
				type: input.type,
				place_id: input.place_id,
			}),
		);
		const details: PlaceDetailsResponse = {
			id: "ChIJaustin",
			displayName: { text: "Franklin Barbecue" },
			formattedAddress: "900 E 11th St, Austin, TX, USA",
			addressComponents: [
				{
					longText: "Austin",
					shortText: "Austin",
					types: ["locality", "political"],
				},
				{
					longText: "Travis County",
					shortText: "Travis County",
					types: ["administrative_area_level_2", "political"],
				},
				{
					longText: "Texas",
					shortText: "TX",
					types: ["administrative_area_level_1", "political"],
				},
				{
					longText: "United States",
					shortText: "US",
					types: ["country", "political"],
				},
			],
			location: { latitude: 30.2701, longitude: -97.7313 },
		};
		const client = makeMockClient({
			fetchPlaceDetails: vi.fn().mockResolvedValue(details),
		});
		const rec = makeRecord({
			place_google_place_id: "ChIJaustin",
			place_geo_lat: "30.2701",
			place_geo_lon: "-97.7313",
		});
		const out = await resolvePlaceForRecord(rec, { ...ctx(), googlePlacesClient: client });
		expect(out?.source).toBe("google_api");
		expect(out?.poi.place_kind).toBe("poi");
		expect(out?.poi.source).toBe("google_api");
		// 4 places created: country + state + city + POI
		expect(out?.created.length).toBe(4);
		// 4 backing pages created
		expect(out?.backingPagesCreated.length).toBe(4);
		// parent_place_id chain is set correctly at each tier
		const country = placesCreated.find((p) => p.place_kind === "country");
		const state = placesCreated.find((p) => p.place_kind === "state");
		const city = placesCreated.find((p) => p.place_kind === "city");
		const poi = placesCreated.find((p) => p.place_kind === "poi");
		expect(country.parent_place_id).toBeNull();
		expect(state.parent_place_id).toBe(country.id);
		expect(city.parent_place_id).toBe(state.id);
		expect(poi.parent_place_id).toBe(city.id);
	});

	it("skips the state tier for non-US/CA countries", async () => {
		mockRepo.findPlaceByGooglePlaceId.mockResolvedValue(null);
		const placesCreated: any[] = [];
		mockRepo.upsertPlace.mockImplementation(async (input: any) => {
			const row = placeRow({
				id: `p-${placesCreated.length + 1}`,
				name: input.name,
				place_kind: input.place_kind,
				source: input.source,
				parent_place_id: input.parent_place_id,
			});
			placesCreated.push(row);
			return { row, inserted: true };
		});
		mockRepo.upsertPage.mockImplementation(async (input: any) =>
			pageRow({ id: `pg-${input.slug}`, place_id: input.place_id }),
		);
		const details: PlaceDetailsResponse = {
			id: "ChIJparis",
			displayName: { text: "Musée du Louvre" },
			formattedAddress: "Paris, France",
			addressComponents: [
				{ longText: "Paris", shortText: "Paris", types: ["locality", "political"] },
				{
					longText: "Île-de-France",
					shortText: "IDF",
					types: ["administrative_area_level_1", "political"],
				},
				{ longText: "France", shortText: "FR", types: ["country", "political"] },
			],
		};
		const client = makeMockClient({
			fetchPlaceDetails: vi.fn().mockResolvedValue(details),
		});
		const rec = makeRecord({ place_google_place_id: "ChIJparis" });
		const out = await resolvePlaceForRecord(rec, { ...ctx(), googlePlacesClient: client });
		// country + city + POI = 3 (NO state)
		expect(out?.created.length).toBe(3);
		const kinds = placesCreated.map((p) => p.place_kind).sort();
		expect(kinds).toEqual(["city", "country", "poi"]);
	});

	it("handles city-states by skipping the city tier (Singapore)", async () => {
		mockRepo.findPlaceByGooglePlaceId.mockResolvedValue(null);
		const placesCreated: any[] = [];
		mockRepo.upsertPlace.mockImplementation(async (input: any) => {
			const row = placeRow({
				id: `p-${placesCreated.length + 1}`,
				name: input.name,
				place_kind: input.place_kind,
				parent_place_id: input.parent_place_id,
			});
			placesCreated.push(row);
			return { row, inserted: true };
		});
		mockRepo.upsertPage.mockImplementation(async (input: any) =>
			pageRow({ id: `pg-${input.slug}`, place_id: input.place_id }),
		);
		const details: PlaceDetailsResponse = {
			id: "ChIJsg",
			displayName: { text: "Marina Bay Sands" },
			addressComponents: [
				{
					longText: "Singapore",
					shortText: "Singapore",
					types: ["locality", "political"],
				},
				{
					longText: "Singapore",
					shortText: "SG",
					types: ["country", "political"],
				},
			],
		};
		const client = makeMockClient({
			fetchPlaceDetails: vi.fn().mockResolvedValue(details),
		});
		const rec = makeRecord({ place_google_place_id: "ChIJsg" });
		const out = await resolvePlaceForRecord(rec, { ...ctx(), googlePlacesClient: client });
		// country + POI = 2 (no city tier for Singapore)
		expect(out?.created.length).toBe(2);
		const poi = placesCreated.find((p) => p.place_kind === "poi");
		const country = placesCreated.find((p) => p.place_kind === "country");
		expect(poi.parent_place_id).toBe(country.id);
	});

	it("falls back to postal_town when locality is absent (UK)", async () => {
		mockRepo.findPlaceByGooglePlaceId.mockResolvedValue(null);
		const placesCreated: any[] = [];
		mockRepo.upsertPlace.mockImplementation(async (input: any) => {
			const row = placeRow({
				id: `p-${placesCreated.length + 1}`,
				name: input.name,
				place_kind: input.place_kind,
				parent_place_id: input.parent_place_id,
			});
			placesCreated.push(row);
			return { row, inserted: true };
		});
		mockRepo.upsertPage.mockImplementation(async (input: any) =>
			pageRow({ id: `pg-${input.slug}`, place_id: input.place_id }),
		);
		const details: PlaceDetailsResponse = {
			id: "ChIJlondon",
			addressComponents: [
				{ longText: "London", shortText: "London", types: ["postal_town"] },
				{
					longText: "England",
					shortText: "England",
					types: ["administrative_area_level_1", "political"],
				},
				{
					longText: "United Kingdom",
					shortText: "GB",
					types: ["country", "political"],
				},
			],
		};
		const client = makeMockClient({
			fetchPlaceDetails: vi.fn().mockResolvedValue(details),
		});
		const rec = makeRecord({ place_google_place_id: "ChIJlondon" });
		const out = await resolvePlaceForRecord(rec, { ...ctx(), googlePlacesClient: client });
		expect(out?.source).toBe("google_api");
		const city = placesCreated.find((p) => p.place_kind === "city");
		expect(city?.name).toBe("London");
		// GB is not US/CA, so no state tier.
		expect(
			placesCreated.find((p) => p.place_kind === "state"),
		).toBeUndefined();
	});

	it("reuses an existing backing page when findExistingPageByTitleOrAlias hits", async () => {
		mockRepo.findPlaceByGooglePlaceId.mockResolvedValue(null);
		mockRepo.upsertPlace.mockImplementation(async (input: any) => ({
			row: placeRow({
				id: `p-${input.place_kind}`,
				name: input.name,
				place_kind: input.place_kind,
			}),
			inserted: true,
		}));
		mockRepo.upsertPage.mockImplementation(async (input: any) =>
			pageRow({ id: `pg-${input.slug}`, place_id: input.place_id }),
		);

		// A pre-existing page for "Paris" with no place_id yet.
		const existingParisPage = pageRow({
			id: "pg-existing-paris",
			type: "topic",
			slug: "paris",
			title: "Paris",
			place_id: null,
		});
		mockLookup.findExistingPageByTitleOrAlias.mockImplementation(async (args: any) => {
			if (args.title === "Paris") {
				return { page: existingParisPage, kind: "exact" };
			}
			return null;
		});

		const details: PlaceDetailsResponse = {
			id: "ChIJlouvre",
			displayName: { text: "Musée du Louvre" },
			addressComponents: [
				{ longText: "Paris", shortText: "Paris", types: ["locality", "political"] },
				{ longText: "France", shortText: "FR", types: ["country", "political"] },
			],
		};
		const client = makeMockClient({
			fetchPlaceDetails: vi.fn().mockResolvedValue(details),
		});
		const rec = makeRecord({ place_google_place_id: "ChIJlouvre" });
		const out = await resolvePlaceForRecord(rec, { ...ctx(), googlePlacesClient: client });

		// Paris backing page WAS NOT newly created — just linked via
		// upsertPage's place_id update path.
		const parisCreate = out?.backingPagesCreated.find(
			(p) => p.slug === "paris",
		);
		expect(parisCreate).toBeUndefined();
		// But the upsertPage with place_id should have been called to
		// set it on the existing row.
		const calls = (mockRepo.upsertPage as any).mock.calls.map((c: any[]) => c[0]);
		const parisLinkCall = calls.find(
			(c: any) => c.slug === existingParisPage.slug,
		);
		expect(parisLinkCall).toBeDefined();
		expect(parisLinkCall.place_id).toBeDefined();
	});

	it("continues with POI even when hierarchy walk throws", async () => {
		mockRepo.findPlaceByGooglePlaceId.mockResolvedValue(null);
		const placesCreated: any[] = [];
		mockRepo.upsertPlace.mockImplementation(async (input: any) => {
			const row = placeRow({
				id: `p-${placesCreated.length + 1}`,
				name: input.name,
				place_kind: input.place_kind,
				source: input.source,
			});
			placesCreated.push(row);
			return { row, inserted: true };
		});
		mockRepo.upsertPage.mockImplementation(async (input: any) =>
			pageRow({ id: `pg-${input.slug}`, place_id: input.place_id }),
		);

		// Break the hierarchy walk by making find-existing-page throw for
		// the country tier. The hierarchy walk catches the error; the POI
		// is still persisted.
		mockLookup.findExistingPageByTitleOrAlias.mockImplementation(async (args: any) => {
			if (args.title === "France") throw new Error("boom");
			return null;
		});

		const details: PlaceDetailsResponse = {
			id: "ChIJparis",
			displayName: { text: "Musée du Louvre" },
			addressComponents: [
				{ longText: "Paris", shortText: "Paris", types: ["locality"] },
				{ longText: "France", shortText: "FR", types: ["country"] },
			],
		};
		const client = makeMockClient({
			fetchPlaceDetails: vi.fn().mockResolvedValue(details),
		});
		const rec = makeRecord({ place_google_place_id: "ChIJparis" });
		const out = await resolvePlaceForRecord(rec, { ...ctx(), googlePlacesClient: client });
		expect(out).not.toBeNull();
		expect(out?.poi).toBeDefined();
		expect(out?.poi.place_kind).toBe("poi");
	});
});
