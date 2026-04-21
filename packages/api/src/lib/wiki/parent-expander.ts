/**
 * Deterministic parent expansion — derives candidate hub/rollup pages from
 * record metadata WITHOUT calling an LLM. Runs before planner invocations
 * so the model doesn't have to rediscover obvious containment every batch.
 *
 * Examples (from .prds/compounding-memory-aggregation-research-memo.md):
 *   - restaurant with `metadata.place.city = "Austin"` → candidate topic
 *     `Austin` with a `Restaurants` section
 *   - journal entries sharing `metadata.journal_id` → candidate trip topic
 *   - records tagged `restaurant` + `austin` → candidate collection page
 *
 * Output is suggestions, not writes. The compiler passes these to the
 * aggregation planner as extra grounding; the aggregation pass decides
 * whether to act.
 */

import type { ThinkWorkMemoryRecord } from "../memory/types.js";
import { slugifyTitle } from "./aliases.js";

export type ParentCandidateReason = "city" | "journal" | "place";
// Note: "place" is reserved for edge-context strings written by
// `emitPlaceHierarchyLinks` (deterministic-linker.ts) — the union is
// extended here so the switch-on-reason code paths downstream stay
// exhaustive. `deriveParentCandidates` and
// `deriveParentCandidatesFromPageSummaries` never produce "place"
// candidates; the hierarchy emitter bypasses this module entirely and
// walks `wiki_places.parent_place_id` directly.

/** Whether the candidate came from scanning batch memory records vs
 * scope-wide page summaries. Matters to the deterministic linker because
 * the leaf-resolution differs: record-kind leaves are pages touched in
 * THIS batch whose records source the candidate (keyed on record id);
 * summary-kind leaves are scope pages whose summaries produced the
 * candidate token (keyed on page id, bypassing the batch-touched gate). */
export type ParentCandidateSourceKind = "record" | "summary";

export interface DerivedParentCandidate {
	/** Why we proposed this candidate — used by the aggregation prompt. */
	reason: ParentCandidateReason;
	/** Parent page title to create/reinforce. Slug derived via slugifyTitle. */
	parentTitle: string;
	parentSlug: string;
	/** v1 taxonomy stays entity|topic|decision — parents are always topics. */
	parentType: "topic";
	/** Section on the parent that should accumulate this cluster. */
	suggestedSectionSlug: string;
	suggestedSectionHeading: string;
	/** Ids that back the candidacy. The id type depends on `sourceKind`:
	 *  - record: memory-record ids (provenance + record-based leaf lookup)
	 *  - summary: page ids (the pages whose summaries produced this token) */
	sourceRecordIds: string[];
	/** Observed tags across the supporting records (dedup'd). */
	observedTags: string[];
	/**
	 * Minimum cluster size required to warrant a suggestion. Exposed so the
	 * compiler can adapt thresholds in replay/testing without changing code.
	 */
	supportingCount: number;
	/** Source of the candidate — determines leaf-resolution semantics in
	 * the deterministic linker. See `ParentCandidateSourceKind`. Optional
	 * for back-compat with older test fixtures; the emitter treats `undefined`
	 * as `"record"` (the sole pre-existing path). */
	sourceKind?: ParentCandidateSourceKind;
}

export interface ParentExpanderOptions {
	/** Minimum records-per-cluster before we emit a candidate. */
	minClusterSize?: number;
}

const DEFAULT_MIN_CLUSTER_SIZE = 2;

/**
 * Core entry point. Returns candidates sorted by supportingCount desc so the
 * prompt shows the strongest signals first.
 */
export function deriveParentCandidates(
	records: ThinkWorkMemoryRecord[],
	options: ParentExpanderOptions = {},
): DerivedParentCandidate[] {
	const min = options.minClusterSize ?? DEFAULT_MIN_CLUSTER_SIZE;

	type Accumulator = {
		reason: ParentCandidateReason;
		title: string;
		sectionSlug: string;
		sectionHeading: string;
		recordIds: Set<string>;
		tags: Set<string>;
	};

	const byKey = new Map<string, Accumulator>();

	const ensure = (
		key: string,
		seed: Omit<Accumulator, "recordIds" | "tags">,
	): Accumulator => {
		let entry = byKey.get(key);
		if (!entry) {
			entry = {
				...seed,
				recordIds: new Set<string>(),
				tags: new Set<string>(),
			};
			byKey.set(key, entry);
		}
		return entry;
	};

	for (const r of records) {
		const meta = (r.metadata ?? {}) as Record<string, unknown>;

		// --- City / place.city -----------------------------------------------
		// Accepts several metadata shapes seen in the wild:
		//   - nested: metadata.place.city (future/hindsight-adapter shape)
		//   - flat:   metadata.place_city / metadata.city
		//   - derive: extract city from metadata.place_address for journal
		//             imports ("123 Main St, Austin, TX 78701, USA")
		const city =
			readString(meta, ["place", "city"]) ??
			readString(meta, ["place_city"]) ??
			readString(meta, ["city"]) ??
			extractCityFromAddress(readString(meta, ["place_address"]));
		if (city) {
			const title = titleCase(city);
			const key = `city:${title.toLowerCase()}`;
			const sectionHint = sectionForPlaceTypes(readPlaceTypes(meta));
			const entry = ensure(key, {
				reason: "city",
				title,
				sectionSlug: sectionHint.slug,
				sectionHeading: sectionHint.heading,
			});
			entry.recordIds.add(r.id);
			for (const t of readTags(meta)) entry.tags.add(t);
		}

		// --- Journal / trip --------------------------------------------------
		const journalTitle =
			readString(meta, ["journal", "title"]) ??
			readString(meta, ["journal_title"]);
		const journalId =
			readString(meta, ["journal_id"]) ??
			readString(meta, ["journal", "id"]);
		if (journalId) {
			const title = journalTitle
				? journalTitle
				: `Journal ${journalId.slice(0, 8)}`;
			const key = `journal:${journalId}`;
			const entry = ensure(key, {
				reason: "journal",
				title,
				sectionSlug: "entries",
				sectionHeading: "Entries",
			});
			entry.recordIds.add(r.id);
			for (const t of readTags(meta)) entry.tags.add(t);
		}

	}

	const out: DerivedParentCandidate[] = [];
	for (const entry of byKey.values()) {
		if (entry.recordIds.size < min) continue;
		out.push({
			reason: entry.reason,
			parentTitle: entry.title,
			parentSlug: slugifyTitle(entry.title),
			parentType: "topic",
			suggestedSectionSlug: entry.sectionSlug,
			suggestedSectionHeading: entry.sectionHeading,
			sourceRecordIds: Array.from(entry.recordIds),
			observedTags: Array.from(entry.tags),
			supportingCount: entry.recordIds.size,
			sourceKind: "record",
		});
	}

	out.sort((a, b) => b.supportingCount - a.supportingCount);
	return out;
}

/**
 * Parent candidates derived from the SUMMARIES of recent scope pages rather
 * than the current job's raw records. Per-batch `deriveParentCandidates` is
 * batch-local — Marco's Toronto/Austin/Napa visits are spread across many
 * compile batches, so a single batch rarely has enough records to cross
 * `minClusterSize` even when the scope clearly has a durable city cluster.
 *
 * This expander side-steps that by scanning page summaries the aggregation
 * pass already hydrates. Summaries like "Korean-inspired restaurant in
 * Toronto" or "Cafe in Austin, TX" carry enough geography to seed city
 * hubs even when no record-level metadata is in the current batch.
 *
 * Deliberately cheap heuristic: looks for capitalized place-name tokens
 * after a preposition like "in / at / on". No LLM, no DB hit. Pages
 * whose summaries don't fit the pattern contribute nothing — that's
 * safer than over-grouping.
 */
export interface PageSummaryCandidateInput {
	id: string;
	summary: string | null;
	title: string;
	tags?: string[];
}

export function deriveParentCandidatesFromPageSummaries(
	pages: PageSummaryCandidateInput[],
	options: ParentExpanderOptions = {},
): DerivedParentCandidate[] {
	const min = options.minClusterSize ?? DEFAULT_MIN_CLUSTER_SIZE;
	const byCity = new Map<
		string,
		{
			title: string;
			pageIds: Set<string>;
			tags: Set<string>;
		}
	>();

	for (const p of pages) {
		if (!p.summary) continue;
		// Try two extractors in order:
		// 1. Preposition pattern catches "restaurant in Toronto" /
		//    "located on Queen Street in Austin".
		// 2. Address-style fallback reuses extractCityFromAddress on the
		//    summary itself, since LLM-generated summaries frequently include
		//    full postal addresses inline ("… at 785 Queen St W, Toronto,
		//    ON M6J 1G1, Canada."). Without this fallback the expander misses
		//    every address-style page on real data.
		const city =
			extractCityFromSummary(p.summary) ??
			extractCityFromAddress(p.summary);
		if (!city) continue;
		// Precision filter for the summary-expander feed into the deterministic
		// linker (2026-04-20). The 04-20 audit surfaced noise titles like
		// "Prospect Interested In The Full PVL Product Line" and street-name
		// false positives like "Congress Ave" — safe to drop before they
		// become link candidates.
		if (!isLikelyCityToken(city)) continue;
		const title = titleCase(city);
		const key = title.toLowerCase();
		let entry = byCity.get(key);
		if (!entry) {
			entry = { title, pageIds: new Set(), tags: new Set() };
			byCity.set(key, entry);
		}
		entry.pageIds.add(p.id);
		for (const t of p.tags ?? []) entry.tags.add(t);
	}

	const out: DerivedParentCandidate[] = [];
	for (const entry of byCity.values()) {
		if (entry.pageIds.size < min) continue;
		out.push({
			reason: "city",
			parentTitle: entry.title,
			parentSlug: slugifyTitle(entry.title),
			parentType: "topic",
			suggestedSectionSlug: "overview",
			suggestedSectionHeading: "Overview",
			// These are page ids, not memory-record ids — sourceKind: "summary"
			// tells the deterministic linker to resolve leaves by page id
			// against the scope-pages index instead of the batch-records index.
			sourceRecordIds: Array.from(entry.pageIds),
			observedTags: Array.from(entry.tags),
			supportingCount: entry.pageIds.size,
			sourceKind: "summary",
		});
	}
	out.sort((a, b) => b.supportingCount - a.supportingCount);
	return out;
}

/**
 * Merge two candidate lists keyed on parentSlug. Later entries union their
 * sourceRecordIds + observedTags into earlier ones, bumping supportingCount
 * to reflect the combined evidence.
 */
export function mergeParentCandidates(
	...lists: DerivedParentCandidate[][]
): DerivedParentCandidate[] {
	const bySlug = new Map<string, DerivedParentCandidate>();
	for (const list of lists) {
		for (const c of list) {
			const existing = bySlug.get(c.parentSlug);
			if (!existing) {
				bySlug.set(c.parentSlug, {
					...c,
					sourceRecordIds: [...c.sourceRecordIds],
					observedTags: [...c.observedTags],
				});
				continue;
			}
			const ids = new Set([
				...existing.sourceRecordIds,
				...c.sourceRecordIds,
			]);
			const tags = new Set([...existing.observedTags, ...c.observedTags]);
			existing.sourceRecordIds = Array.from(ids);
			existing.observedTags = Array.from(tags);
			existing.supportingCount = ids.size;
		}
	}
	return Array.from(bySlug.values()).sort(
		(a, b) => b.supportingCount - a.supportingCount,
	);
}

/**
 * Pull a city-like token out of a page summary. Looks for "in / at / on"
 * followed by a capitalized word or pair ("Austin", "Mexico City",
 * "New York"). Optional trailing ", ST" is stripped. Returns null when
 * nothing plausibly looks like a place.
 *
 * Uses `\p{L}` (any Unicode letter) and `\p{Lu}` (uppercase letter) so
 * accented city names like "Bogotá" and "Montréal" survive — the earlier
 * `[A-Za-z]+` character class truncated them at the first accented char.
 */
function extractCityFromSummary(summary: string): string | null {
	// "… in Toronto", "located in Austin, TX", "on the outskirts of Napa"
	// `\p{Lu}\p{L}+` catches capitalized Unicode letter runs. The trailing
	// lookahead is deliberately `(?=[^\p{L}]|$)` — a bare `\b` anchors on
	// ASCII word-chars even under `/u`, which truncated "Bogotá" to
	// "Bogot" before this fix.
	const re =
		/\b(?:in|at|on|near|from|of)\s+(\p{Lu}\p{L}+(?:\s+\p{Lu}\p{L}+)?)(?:,\s*[A-Z]{2,4})?(?=[^\p{L}]|$)/u;
	const match = summary.match(re);
	if (!match) return null;
	const token = match[1]!.trim();
	// Filter out obvious false positives we see on real data.
	const blocklist = new Set([
		"The",
		"A",
		"An",
		"This",
		"These",
		"That",
		"It",
		"My",
		"His",
		"Her",
		"Their",
		"Our",
		"Your",
		"I",
	]);
	if (blocklist.has(token)) return null;
	return token;
}

// ---------------------------------------------------------------------------
// Helpers — intentionally forgiving because metadata shapes drift between
// sources (Hindsight turn facts, journal imports, connector events).
// ---------------------------------------------------------------------------

function readString(
	obj: Record<string, unknown>,
	path: string[],
): string | null {
	let cur: unknown = obj;
	for (const key of path) {
		if (cur && typeof cur === "object" && key in cur) {
			cur = (cur as Record<string, unknown>)[key];
		} else {
			return null;
		}
	}
	if (typeof cur === "string" && cur.trim().length > 0) return cur.trim();
	return null;
}

function readPlaceTypes(meta: Record<string, unknown>): string[] {
	const direct = meta["place_types"];
	if (Array.isArray(direct)) {
		return direct.filter((x): x is string => typeof x === "string");
	}
	// Journal-import shape emits place_types as a comma-separated string
	// (e.g. "restaurant, food"). Accept that too so clustering works.
	if (typeof direct === "string") {
		return splitCsv(direct);
	}
	const nested = (meta["place"] as Record<string, unknown> | undefined)?.[
		"types"
	];
	if (Array.isArray(nested)) {
		return nested.filter((x): x is string => typeof x === "string");
	}
	if (typeof nested === "string") {
		return splitCsv(nested);
	}
	return [];
}

function readTags(meta: Record<string, unknown>): string[] {
	const out: string[] = [];
	const append = (raw: unknown): void => {
		if (Array.isArray(raw)) {
			for (const x of raw) if (typeof x === "string") out.push(x);
		} else if (typeof raw === "string") {
			out.push(...splitCsv(raw));
		}
	};
	// `tags` is the canonical key; `idea_tags` shows up on journal-import
	// shaped records. Merge whatever is present; dedup happens downstream.
	append(meta["tags"]);
	append(meta["idea_tags"]);
	return out;
}

function splitCsv(raw: string): string[] {
	return raw
		.split(/[,;]/)
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

/**
 * Extract a city from a postal-style address. The usual shape from Google
 * Places is "<street>, <city>, <state/region zip>, <country>" — we walk the
 * comma-separated parts from the end and pick the token directly before a
 * state/region code. Falls back to the second-to-last part for non-US
 * formats (e.g. "Avignon, France"), and returns null if we can't isolate a
 * plausible city.
 *
 * Post-processes the chosen part with `stripLeadingPostcode` so European
 * "ZIPCODE City" tokens (`"75006 Paris"`, `"26110 Vinsobres"`,
 * `"06000 Ciudad de México"`) collapse to the bare city — the Marco
 * 2026-04-20 recompile exposed ~880 addresses in this shape that were
 * producing unusable candidate titles.
 *
 * Accepts 2- to 4-letter region codes so "CDMX" (Mexico), "NSW" (Australia),
 * "BC" / "ON" (Canada), and "TX" / "CA" (US) all terminate the walk.
 */
function extractCityFromAddress(address: string | null): string | null {
	if (!address) return null;
	const parts = address
		.split(",")
		.map((p) => p.trim())
		.filter((p) => p.length > 0);
	if (parts.length < 2) return null;

	// Walk starts at `parts.length - 2` — never at the last part. The last
	// slot is conventionally the country (`"USA"`, `"Mexico"`, `"Canada"`,
	// `"France"`) and expanding the char class to `{2,4}` made bare country
	// tokens accidentally match when scanned. Skipping the country preserves
	// the "state/region code is the slot before the country" invariant.
	for (let i = parts.length - 2; i > 0; i--) {
		// Matches "TX 78701", "ON M6J 1G1", bare "CDMX", bare "UK", etc.
		if (/^[A-Z]{2,4}(\s|$)/.test(parts[i]!)) {
			return stripLeadingPostcode(parts[i - 1] ?? "") || null;
		}
		// Dotted region abbreviations — Spanish-language addresses like
		// "..., 37700 San Miguel de Allende, Gto., Mexico" (Guanajuato) and
		// "..., Cancún, Q.R., Mexico" (Quintana Roo), plus Canadian "B.C."
		// and Australian "N.S.W." usage. The 04-20 Marco audit surfaced 54
		// records producing "Gto." / "Q.R." candidates because the walk fell
		// through to the fallback.
		if (isDottedRegionAbbr(parts[i]!)) {
			return stripLeadingPostcode(parts[i - 1] ?? "") || null;
		}
	}
	// Fallback: "..., City, Country" shape (e.g. "Avignon, France" or
	// "26110 Vinsobres, France" where the region code walk found nothing).
	return stripLeadingPostcode(parts[parts.length - 2] ?? "") || null;
}

/** True for short dotted region abbreviations: "Gto.", "Q.R.", "B.C.",
 * "N.S.W.". Accepts 1-4 capitalized groups of 1-3 letters each, separated
 * and trailed by dots; capped at 10 chars so "Mr. Jones" etc. never match. */
function isDottedRegionAbbr(s: string): boolean {
	return s.length <= 10 && /^([A-Z][a-z]{0,2}\.){1,4}$/.test(s);
}

/** Drop a leading numeric/alphanumeric postcode from a city part.
 * Examples: `"75006 Paris"` → `"Paris"`, `"06000 Ciudad de México"` →
 * `"Ciudad de México"`, `"Austin"` → `"Austin"` (no change). */
function stripLeadingPostcode(s: string): string {
	return s.replace(/^[0-9][0-9A-Za-z-]*\s+/, "").trim();
}

/** Common English street-suffix tokens. Cities never end in these; pages
 * that do are street names or building addresses the summary-extractor
 * shouldn't promote into geographic candidates. Case-insensitive match on
 * the final whitespace-separated token. */
const STREET_SUFFIXES = new Set([
	"ave",
	"avenue",
	"blvd",
	"boulevard",
	"st",
	"street",
	"rd",
	"road",
	"ln",
	"lane",
	"dr",
	"drive",
	"way",
	"place",
	"ct",
	"court",
	"pkwy",
	"parkway",
]);

/** Coarse "is this a plausible city name?" filter for the summary-expander
 * feed into the deterministic linker. Drops obvious noise:
 * - ≥ 5 words (sentence fragments like "Prospect Interested In The Full PVL Product Line")
 * - < 3 chars (abbreviations like "St")
 * - Street-suffix endings ("Congress Ave", "Queen St")
 * Intentionally liberal otherwise — real cities are varied. */
function isLikelyCityToken(raw: string): boolean {
	const s = raw.trim();
	if (s.length < 3) return false;
	const tokens = s.split(/\s+/).filter((t) => t.length > 0);
	if (tokens.length === 0 || tokens.length > 4) return false;
	const last = tokens[tokens.length - 1]!.toLowerCase().replace(/\.$/, "");
	if (STREET_SUFFIXES.has(last)) return false;
	return true;
}

/**
 * Pick a sensible rollup section for a record's place types. Kept narrow on
 * purpose — unknown place types fall back to a generic "overview" section
 * which the aggregation planner can rename if it chooses to emit an update.
 */
function sectionForPlaceTypes(types: string[]): {
	slug: string;
	heading: string;
} {
	const set = new Set(types.map((t) => t.toLowerCase()));
	// Check narrower categories first — Google Places tags often include
	// "food" alongside "cafe" for coffee shops, which would otherwise get
	// routed to the generic restaurants rollup.
	if (set.has("cafe") || set.has("coffee")) {
		return { slug: "coffee", heading: "Coffee" };
	}
	if (set.has("restaurant") || set.has("food") || set.has("meal_takeaway")) {
		return { slug: "restaurants", heading: "Restaurants" };
	}
	if (set.has("park") || set.has("natural_feature")) {
		return { slug: "parks-and-outdoors", heading: "Parks & Outdoors" };
	}
	if (set.has("lodging") || set.has("hotel")) {
		return { slug: "lodging", heading: "Lodging" };
	}
	return { slug: "overview", heading: "Overview" };
}

function titleCase(raw: string): string {
	return raw
		.trim()
		.split(/\s+/)
		.map((w) => (w.length > 0 ? w[0]!.toUpperCase() + w.slice(1) : w))
		.join(" ");
}
