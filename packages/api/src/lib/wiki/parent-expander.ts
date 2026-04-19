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
		const city = readString(meta, ["place", "city"]) ?? readString(meta, ["city"]);
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
	const nested = (meta["place"] as Record<string, unknown> | undefined)?.[
		"types"
	];
	if (Array.isArray(nested)) {
		return nested.filter((x): x is string => typeof x === "string");
	}
	return [];
}

function readTags(meta: Record<string, unknown>): string[] {
	const tags = meta["tags"];
	if (!Array.isArray(tags)) return [];
	return tags.filter((x): x is string => typeof x === "string");
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
	if (set.has("restaurant") || set.has("food") || set.has("meal_takeaway")) {
		return { slug: "restaurants", heading: "Restaurants" };
	}
	if (set.has("cafe") || set.has("coffee")) {
		return { slug: "coffee", heading: "Coffee" };
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
