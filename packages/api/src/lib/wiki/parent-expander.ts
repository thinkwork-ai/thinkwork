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

export type ParentCandidateReason = "city" | "journal" | "tag_cluster";

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
	/** Record ids that back the candidacy. Provenance for the aggregation pass. */
	sourceRecordIds: string[];
	/** Observed tags across the supporting records (dedup'd). */
	observedTags: string[];
	/**
	 * Minimum cluster size required to warrant a suggestion. Exposed so the
	 * compiler can adapt thresholds in replay/testing without changing code.
	 */
	supportingCount: number;
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

		// --- Tag cluster -----------------------------------------------------
		// Any tag repeated across records is a weak signal; downstream filtering
		// on supportingCount >= min keeps ephemeral one-offs out.
		for (const tag of readTags(meta)) {
			const title = titleCase(tag);
			const key = `tag:${title.toLowerCase()}`;
			const entry = ensure(key, {
				reason: "tag_cluster",
				title,
				sectionSlug: slugifyTitle(title) || "overview",
				sectionHeading: title,
			});
			entry.recordIds.add(r.id);
			entry.tags.add(tag);
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
		const city = extractCityFromSummary(p.summary);
		if (!city) continue;
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
			// These are page ids, not memory-record ids — same semantic role
			// as "source of this candidacy" so we reuse the field.
			sourceRecordIds: Array.from(entry.pageIds),
			observedTags: Array.from(entry.tags),
			supportingCount: entry.pageIds.size,
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
 */
function extractCityFromSummary(summary: string): string | null {
	// "… in Toronto", "located in Austin, TX", "on the outskirts of Napa"
	const re =
		/\b(?:in|at|on|near|from|of)\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)(?:,\s*[A-Z]{2})?\b/;
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
 * state+zip pattern (two capital letters, optionally followed by a postal
 * code). Falls back to the second-to-last part for non-US formats, and
 * returns null if we can't isolate a plausible city.
 */
function extractCityFromAddress(address: string | null): string | null {
	if (!address) return null;
	const parts = address
		.split(",")
		.map((p) => p.trim())
		.filter((p) => p.length > 0);
	if (parts.length < 2) return null;

	for (let i = parts.length - 1; i > 0; i--) {
		// Matches "TX 78701", "ON M6J 1G1", and bare two-letter codes like "UK".
		if (/^[A-Z]{2}(\s|$)/.test(parts[i]!)) {
			return parts[i - 1] ?? null;
		}
	}
	// Fallback: "..., City, Country" shape.
	return parts[parts.length - 2] ?? null;
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
