/**
 * Read place metadata from a Hindsight-sourced ThinkWorkMemoryRecord.
 *
 * The HindsightAdapter nests the raw memory_units.metadata dict under
 * `record.metadata.raw` (see
 * packages/api/src/lib/memory/adapters/hindsight-adapter.ts `mapUnit`, where
 * `raw: unit.metadata ?? null` lands inside the `metadata` object that ships
 * on the normalized record). Journal-import writes flat keys like
 * `place_google_place_id` / `place_geo_lat` into that raw dict, so code that
 * wants those fields has to read through the `.raw` step.
 *
 * This helper centralizes the read path for the new wiki_places capability
 * so individual call sites (places-service, Phase C backfill, audit scripts
 * that go through the adapter) don't reimplement the nesting dance.
 *
 * NB: `packages/api/src/lib/wiki/parent-expander.ts` today reads
 * `record.metadata.place_*` at the top level — that's the wrong path against
 * live Hindsight data and is why the regex extractor underperforms in
 * practice. Fixing that is a deliberate follow-up (see the v2 plan's Scope
 * Boundaries / Deferred section); this helper does NOT accept the wrong
 * path, so it won't entangle with the expander's baseline.
 */

import type { ThinkWorkMemoryRecord } from "../memory/types.js";

export interface PlaceMetadata {
	googlePlaceId: string | null;
	geoLat: number | null;
	geoLon: number | null;
	address: string | null;
	name: string | null;
	types: string[];
}

interface RawShape {
	place_google_place_id?: unknown;
	place_geo_lat?: unknown;
	place_geo_lon?: unknown;
	place_address?: unknown;
	place_name?: unknown;
	place_types?: unknown;
}

export function readPlaceMetadata(
	record: Pick<ThinkWorkMemoryRecord, "metadata">,
): PlaceMetadata | null {
	const meta = record.metadata as { raw?: unknown } | undefined;
	if (!meta || typeof meta !== "object") return null;
	const raw = (meta as { raw?: unknown }).raw;
	if (!raw || typeof raw !== "object") return null;

	const r = raw as RawShape;
	const googlePlaceId = cleanString(r.place_google_place_id);
	const geoLat = cleanNumber(r.place_geo_lat);
	const geoLon = cleanNumber(r.place_geo_lon);
	const address = cleanString(r.place_address);
	const name = cleanString(r.place_name);
	const types = cleanTypes(r.place_types);

	if (
		googlePlaceId === null &&
		geoLat === null &&
		geoLon === null &&
		address === null &&
		name === null &&
		types.length === 0
	) {
		return null;
	}

	return {
		googlePlaceId,
		geoLat,
		geoLon,
		address,
		name,
		types,
	};
}

function cleanString(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length === 0 ? null : trimmed;
}

function cleanNumber(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (trimmed.length === 0) return null;
		const n = Number.parseFloat(trimmed);
		return Number.isFinite(n) ? n : null;
	}
	return null;
}

function cleanTypes(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value
			.map((t) => (typeof t === "string" ? t.trim() : ""))
			.filter((t) => t.length > 0);
	}
	// Hindsight stringifies arrays as CSV (journal-import.ts:386 folds
	// place_types via `setIf()` which stringifies).
	if (typeof value === "string") {
		return value
			.split(",")
			.map((t) => t.trim())
			.filter((t) => t.length > 0);
	}
	return [];
}
