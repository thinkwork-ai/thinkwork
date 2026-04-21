import { describe, expect, it, vi } from "vitest";
import {
	parseArgs,
	runPlacesRefresh,
	validateArgs,
	type RefreshDeps,
} from "../../scripts/wiki-places-refresh.js";
import type { PlaceDetailsResponse } from "../lib/wiki/google-places-client.js";
import type { WikiPlaceRow } from "../lib/wiki/repository.js";

function placeRow(over: Partial<WikiPlaceRow>): WikiPlaceRow {
	// Explicit `in` checks so callers can pass `null` to override defaults
	// (important for google_place_id, which is nullable on derived_hierarchy
	// rows).
	const base: WikiPlaceRow = {
		id: "p-1",
		tenant_id: "t1",
		owner_id: "a1",
		name: "Default place",
		google_place_id: "gp-1",
		geo_lat: null,
		geo_lon: null,
		address: null,
		parent_place_id: null,
		place_kind: "poi",
		source: "google_api",
		source_payload: null,
		created_at: new Date("2026-01-01"),
		updated_at: new Date("2026-01-01"),
	};
	return { ...base, ...over };
}

function detailsFor(id: string): PlaceDetailsResponse {
	return {
		id,
		displayName: { text: `Updated ${id}` },
		formattedAddress: `123 Fake St, ${id}`,
		location: { latitude: 40, longitude: -74 },
		addressComponents: [],
		types: ["restaurant"],
	};
}

function buildDeps(over: Partial<RefreshDeps> = {}): RefreshDeps {
	return {
		apply: false,
		listCandidates: async () => [],
		fetchPlaceDetails: async () => null,
		breakerState: () => ({ state: "closed" }),
		applyRowUpdate: async () => undefined,
		...over,
	};
}

// ─── parseArgs / validateArgs ────────────────────────────────────────────

describe("wiki-places-refresh — arg parsing", () => {
	it("parses --place-id + --apply", () => {
		const args = parseArgs(["--place-id", "p-abc", "--apply"]);
		expect(args.placeId).toBe("p-abc");
		expect(args.apply).toBe(true);
		expect(validateArgs(args)).toBeNull();
	});

	it("parses --tenant + --owner + --stale-before", () => {
		const args = parseArgs([
			"--tenant",
			"t1",
			"--owner",
			"a1",
			"--stale-before",
			"2026-01-01T00:00:00Z",
		]);
		expect(args.tenantId).toBe("t1");
		expect(args.ownerId).toBe("a1");
		expect(args.staleBefore?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
		expect(args.apply).toBe(false);
		expect(validateArgs(args)).toBeNull();
	});

	it("rejects missing target flags", () => {
		const args = parseArgs(["--apply"]);
		expect(validateArgs(args)).toMatch(/--place-id/);
	});

	it("rejects combined --place-id and --tenant", () => {
		const args = parseArgs([
			"--place-id",
			"p-1",
			"--tenant",
			"t1",
			"--owner",
			"a1",
		]);
		expect(validateArgs(args)).toMatch(/cannot combine/);
	});

	it("rejects --stale-before without scope", () => {
		const args = parseArgs([
			"--place-id",
			"p-1",
			"--stale-before",
			"2026-01-01",
		]);
		expect(validateArgs(args)).toMatch(/--stale-before/);
	});

	it("rejects half-scope (tenant without owner)", () => {
		const args = parseArgs(["--tenant", "t1"]);
		expect(validateArgs(args)).toMatch(/--tenant and --owner/);
	});

	it("throws on malformed --stale-before", () => {
		expect(() => parseArgs(["--stale-before", "not-a-date"])).toThrow(
			/invalid date/,
		);
	});
});

// ─── happy paths ─────────────────────────────────────────────────────────

describe("wiki-places-refresh — happy paths", () => {
	it("applies a single-row refresh when --apply is set", async () => {
		const row = placeRow({ id: "p-1", google_place_id: "gp-1" });
		const update = vi.fn();
		const result = await runPlacesRefresh(
			buildDeps({
				apply: true,
				listCandidates: async () => [row],
				fetchPlaceDetails: async () => detailsFor("gp-1"),
				applyRowUpdate: update,
			}),
		);
		expect(result.updated).toBe(1);
		expect(result.skipped).toBe(0);
		expect(result.errors).toBe(0);
		expect(update).toHaveBeenCalledWith(
			expect.objectContaining({ placeId: "p-1" }),
		);
	});

	it("iterates a scope-wide refresh and updates every eligible row", async () => {
		const rows = [
			placeRow({ id: "p-1", google_place_id: "gp-1" }),
			placeRow({ id: "p-2", google_place_id: "gp-2" }),
			placeRow({ id: "p-3", google_place_id: "gp-3" }),
		];
		const update = vi.fn();
		const result = await runPlacesRefresh(
			buildDeps({
				apply: true,
				listCandidates: async () => rows,
				fetchPlaceDetails: async (gpid) => detailsFor(gpid),
				applyRowUpdate: update,
			}),
		);
		expect(result.updated).toBe(3);
		expect(update).toHaveBeenCalledTimes(3);
	});
});

// ─── source-based skips ──────────────────────────────────────────────────

describe("wiki-places-refresh — source-based skips", () => {
	it("skips source='manual' rows without calling Google", async () => {
		const fetchSpy = vi.fn();
		const updateSpy = vi.fn();
		const result = await runPlacesRefresh(
			buildDeps({
				apply: true,
				listCandidates: async () => [
					placeRow({ id: "p-manual", source: "manual" }),
				],
				fetchPlaceDetails: fetchSpy,
				applyRowUpdate: updateSpy,
			}),
		);
		expect(result.skipped).toBe(1);
		expect(result.outcomes[0]).toMatchObject({
			kind: "skipped",
			reason: "manual_source",
		});
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(updateSpy).not.toHaveBeenCalled();
	});

	it("skips source='journal_metadata' rows without calling Google", async () => {
		const fetchSpy = vi.fn();
		const result = await runPlacesRefresh(
			buildDeps({
				apply: true,
				listCandidates: async () => [
					placeRow({ id: "p-meta", source: "journal_metadata" }),
				],
				fetchPlaceDetails: fetchSpy,
			}),
		);
		expect(result.skipped).toBe(1);
		expect(result.outcomes[0]).toMatchObject({
			kind: "skipped",
			reason: "journal_metadata_source",
		});
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("skips derived_hierarchy rows with no google_place_id", async () => {
		const fetchSpy = vi.fn();
		const result = await runPlacesRefresh(
			buildDeps({
				apply: true,
				listCandidates: async () => [
					placeRow({
						id: "p-city",
						source: "derived_hierarchy",
						google_place_id: null,
					}),
				],
				fetchPlaceDetails: fetchSpy,
			}),
		);
		expect(result.skipped).toBe(1);
		expect(result.outcomes[0]).toMatchObject({
			kind: "skipped",
			reason: "no_google_place_id",
		});
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});

// ─── NOT_FOUND and breaker-trip ──────────────────────────────────────────

describe("wiki-places-refresh — upstream failures", () => {
	it("marks a row skipped with reason=not_found when fetchPlaceDetails returns null", async () => {
		const result = await runPlacesRefresh(
			buildDeps({
				apply: true,
				listCandidates: async () => [placeRow({ id: "p-1" })],
				fetchPlaceDetails: async () => null,
			}),
		);
		expect(result.skipped).toBe(1);
		expect(result.updated).toBe(0);
		expect(result.outcomes[0]).toMatchObject({
			kind: "skipped",
			reason: "not_found",
		});
	});

	it("aborts the batch when the breaker trips mid-run and reports pending", async () => {
		const rows = [
			placeRow({ id: "p-1", google_place_id: "gp-1" }),
			placeRow({ id: "p-2", google_place_id: "gp-2" }),
			placeRow({ id: "p-3", google_place_id: "gp-3" }),
		];
		let state: "closed" | "tripped" = "closed";
		const result = await runPlacesRefresh(
			buildDeps({
				apply: true,
				listCandidates: async () => rows,
				fetchPlaceDetails: async (gpid) => {
					if (gpid === "gp-1") return detailsFor(gpid);
					state = "tripped";
					return null;
				},
				breakerState: () => ({ state }),
				applyRowUpdate: async () => undefined,
			}),
		);
		expect(result.updated).toBe(1);
		expect(result.pending_on_breaker_trip).toBeGreaterThan(0);
		expect(result.errors + result.skipped).toBeGreaterThanOrEqual(2);
	});
});

// ─── dry-run ────────────────────────────────────────────────────────────

describe("wiki-places-refresh — dry-run", () => {
	it("does not call fetchPlaceDetails or applyRowUpdate when --apply is false", async () => {
		const fetchSpy = vi.fn();
		const updateSpy = vi.fn();
		const result = await runPlacesRefresh(
			buildDeps({
				apply: false,
				listCandidates: async () => [placeRow({ id: "p-1" })],
				fetchPlaceDetails: fetchSpy,
				applyRowUpdate: updateSpy,
			}),
		);
		expect(result.skipped).toBe(1);
		expect(result.updated).toBe(0);
		expect(result.outcomes[0]).toMatchObject({
			kind: "skipped",
			reason: "dry_run",
		});
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(updateSpy).not.toHaveBeenCalled();
	});
});

// ─── error in applyRowUpdate ───────────────────────────────────────────

describe("wiki-places-refresh — write failures", () => {
	it("records an error when applyRowUpdate throws but keeps iterating", async () => {
		const rows = [
			placeRow({ id: "p-1" }),
			placeRow({ id: "p-2" }),
		];
		const result = await runPlacesRefresh(
			buildDeps({
				apply: true,
				listCandidates: async () => rows,
				fetchPlaceDetails: async (gpid) => detailsFor(gpid),
				applyRowUpdate: async ({ placeId }) => {
					if (placeId === "p-1") throw new Error("conflict");
				},
			}),
		);
		expect(result.errors).toBe(1);
		expect(result.updated).toBe(1);
		expect(result.outcomes[0]).toMatchObject({
			kind: "error",
			placeId: "p-1",
		});
		expect(result.outcomes[1]).toMatchObject({
			kind: "updated",
			placeId: "p-2",
		});
	});
});
