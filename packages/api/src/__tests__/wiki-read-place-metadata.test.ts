import { describe, expect, it } from "vitest";
import { readPlaceMetadata } from "../lib/wiki/readPlaceMetadata.js";

// The helper reads `metadata.raw.place_*`. Record shape matches what
// HindsightAdapter.mapUnit() produces.
function makeRecord(raw: Record<string, unknown> | null) {
	return {
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
		},
	};
}

describe("readPlaceMetadata", () => {
	it("parses a full journal-sourced place from metadata.raw", () => {
		const out = readPlaceMetadata(
			makeRecord({
				place_google_place_id: "ChIJD7fiBh9u5kcRYJSMaMOCCwQ",
				place_geo_lat: "48.8566",
				place_geo_lon: "2.3522",
				place_address: "75001 Paris, France",
				place_name: "Musée du Louvre",
				place_types: "museum,tourist_attraction,point_of_interest",
			}),
		);
		expect(out).not.toBeNull();
		expect(out!.googlePlaceId).toBe("ChIJD7fiBh9u5kcRYJSMaMOCCwQ");
		expect(out!.geoLat).toBeCloseTo(48.8566, 4);
		expect(out!.geoLon).toBeCloseTo(2.3522, 4);
		expect(out!.address).toBe("75001 Paris, France");
		expect(out!.name).toBe("Musée du Louvre");
		expect(out!.types).toEqual([
			"museum",
			"tourist_attraction",
			"point_of_interest",
		]);
	});

	it("returns null when metadata is missing", () => {
		expect(readPlaceMetadata({ metadata: undefined })).toBeNull();
	});

	it("returns null when metadata.raw is missing", () => {
		expect(
			readPlaceMetadata(makeRecord(null)),
		).toBeNull();
	});

	it("returns null when metadata.raw has no place_* keys", () => {
		expect(
			readPlaceMetadata(
				makeRecord({
					otherKey: "value",
					confidence: "0.9",
				}),
			),
		).toBeNull();
	});

	it("does NOT fall back to metadata.place_* at the top level (parent-expander bug path)", () => {
		// This is the deliberate mismatch the plan's Scope Boundaries section
		// calls out — existing parent-expander reads the wrong level; this
		// helper refuses to replicate that bug.
		const badRecord = {
			metadata: {
				place_google_place_id: "ChIJtop-level",
				place_geo_lat: "0",
				place_geo_lon: "0",
				place_address: "flat shape",
			},
		};
		expect(readPlaceMetadata(badRecord)).toBeNull();
	});

	it("treats empty-string place_google_place_id as absent", () => {
		const out = readPlaceMetadata(
			makeRecord({
				place_google_place_id: "",
				place_geo_lat: "10",
				place_geo_lon: "20",
			}),
		);
		expect(out).not.toBeNull();
		expect(out!.googlePlaceId).toBeNull();
		expect(out!.geoLat).toBe(10);
	});

	it("drops fields individually when parseFloat fails but keeps the others", () => {
		const out = readPlaceMetadata(
			makeRecord({
				place_google_place_id: "ChIJabc",
				place_geo_lat: "not_a_number",
				place_geo_lon: "5.5",
			}),
		);
		expect(out).not.toBeNull();
		expect(out!.googlePlaceId).toBe("ChIJabc");
		expect(out!.geoLat).toBeNull();
		expect(out!.geoLon).toBe(5.5);
	});

	it("accepts already-numeric lat/lon without re-parsing", () => {
		const out = readPlaceMetadata(
			makeRecord({
				place_google_place_id: "ChIJabc",
				place_geo_lat: 48.8566,
				place_geo_lon: 2.3522,
			}),
		);
		expect(out!.geoLat).toBe(48.8566);
		expect(out!.geoLon).toBe(2.3522);
	});

	it("handles Unicode place names verbatim (Bogotá, São Paulo, München)", () => {
		for (const name of ["Bogotá", "São Paulo", "München"]) {
			const out = readPlaceMetadata(
				makeRecord({
					place_google_place_id: "ChIJanything",
					place_geo_lat: "1",
					place_geo_lon: "2",
					place_name: name,
				}),
			);
			expect(out!.name).toBe(name);
		}
	});

	it("returns null when only empty/unparseable fields are present", () => {
		const out = readPlaceMetadata(
			makeRecord({
				place_google_place_id: "",
				place_geo_lat: "",
				place_geo_lon: "",
				place_address: "   ",
			}),
		);
		expect(out).toBeNull();
	});

	it("accepts arrays for place_types when present (not yet CSV)", () => {
		const out = readPlaceMetadata(
			makeRecord({
				place_google_place_id: "ChIJabc",
				place_types: ["locality", "political"],
			}),
		);
		expect(out!.types).toEqual(["locality", "political"]);
	});

	it("skips empty/whitespace entries in place_types CSV", () => {
		const out = readPlaceMetadata(
			makeRecord({
				place_google_place_id: "ChIJabc",
				place_types: "locality,  , political, ",
			}),
		);
		expect(out!.types).toEqual(["locality", "political"]);
	});
});
