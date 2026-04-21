/**
 * Deterministic link emitter for the compile pipeline. Takes parent-expander
 * candidates + the set of leaf pages touched in this batch and emits
 * `reference` links from each leaf to its matching parent page — provided
 * the candidate reason is strong (`city` / `journal` only in v1), an exact-
 * title page exists in scope, and the type-mismatch gate passes.
 *
 * The function is a pure coordinator — it takes a `lookupParentPages`
 * callback for exact-title page resolution and a `writeLink` callback for
 * the actual insert, so tests can exercise it without a database. Both
 * callbacks are injected by the compiler / backfill caller.
 */

import type { WikiPageType } from "./repository.js";
import type {
	DerivedParentCandidate,
	ParentCandidateReason,
} from "./parent-expander.js";

/** Leaf types we link from. Only entity pages get auto-parented; topic /
 * decision pages are the aggregation planner's call. */
const LINKABLE_LEAF_TYPES: ReadonlySet<WikiPageType> = new Set(["entity"]);

/** Parent types the type-mismatch gate accepts. Entities can hang under a
 * topic (e.g. `Café de Flore` → `Paris`) or, less commonly, another entity
 * hub. Decisions are intentionally excluded. */
const ALLOWED_PARENT_TYPES: ReadonlySet<WikiPageType> = new Set([
	"topic",
	"entity",
]);

export interface AffectedPage {
	id: string;
	type: WikiPageType;
	slug: string;
	title: string;
	/** Record ids from this batch that source sections on this page. Used to
	 * match against `candidate.sourceRecordIds` so we don't link pages that
	 * happened to be touched for an unrelated reason. */
	sourceRecordIds: string[];
}

export interface ParentPageLookupArgs {
	tenantId: string;
	ownerId: string;
	title: string;
}

/** Same shape as `ParentPageLookup` but with a similarity score attached.
 * Powers the trigram fallback when exact-title lookup returns empty — the
 * higher-recall path for cases like candidate `"Portland"` resolving to
 * existing page `"Portland, Oregon"`. */
export interface ParentPageFuzzyResult {
	id: string;
	type: WikiPageType;
	slug: string;
	title: string;
	similarity: number;
}

export type ParentPageFuzzyLookup = (
	args: ParentPageLookupArgs,
) => Promise<ParentPageFuzzyResult[]>;

export type ParentPageLookup = (
	args: ParentPageLookupArgs,
) => Promise<
	Array<{ id: string; type: WikiPageType; slug: string; title: string }>
>;

export interface WriteLinkArgs {
	fromPageId: string;
	toPageId: string;
	context: string;
}

export interface EmitDeterministicParentLinksArgs {
	scope: { tenantId: string; ownerId: string };
	candidates: DerivedParentCandidate[];
	affectedPages: AffectedPage[];
	/** Scope-wide leaf pool for summary-kind candidates. Unlike
	 * `affectedPages` (which is batch-scoped), `scopePages` holds every
	 * scope page whose summary the page-summary expander scanned — these
	 * pages may not have been touched in this batch. Required for
	 * summary-kind candidates to resolve leaves; ignored for record-kind
	 * ones. Omit when no summary-kind candidates are in the list (tests,
	 * backfill-without-summaries paths). */
	scopePages?: AffectedPage[];
	lookupParentPages: ParentPageLookup;
	/** Optional trigram-fallback lookup. Only invoked when
	 * `lookupParentPages` returned no hits for a candidate. Callers that
	 * want exact-only behavior (tests, isolated backfill runs) can omit
	 * this. Recall gains come from titles like `"Portland"` resolving to
	 * existing page `"Portland, Oregon"` at similarity ≥ 0.85. */
	lookupParentPagesFuzzy?: ParentPageFuzzyLookup;
	writeLink: (args: WriteLinkArgs) => Promise<void>;
}

export interface EmitDeterministicParentLinksResult {
	linksWritten: number;
	emissions: Array<{
		fromPageId: string;
		toPageId: string;
		reason: ParentCandidateReason;
		parentSlug: string;
	}>;
}

/** Per-memory directed-edge cap (plan Unit 3). A 4-page co-mention already
 * produces 12 directed edges — beyond this threshold we truncate rather
 * than writing a combinatorial fan-out for a single memory. Pages are
 * sorted slug-asc before truncation so the live compile and the backfill
 * converge on the same edge set. */
export const CO_MENTION_DIRECTED_EDGE_CAP = 10;

export interface CoMentionSource {
	memory_unit_id: string;
	page_id: string;
	page_type: WikiPageType;
	slug: string;
	title: string;
}

export interface LookupMemorySourcesArgs {
	tenantId: string;
	ownerId: string;
	memoryUnitIds: string[];
}

export type LookupMemorySources = (
	args: LookupMemorySourcesArgs,
) => Promise<CoMentionSource[]>;

export interface EmitCoMentionLinksArgs {
	scope: { tenantId: string; ownerId: string };
	memoryUnitIds: string[];
	lookupMemorySources: LookupMemorySources;
	writeLink: (args: WriteLinkArgs) => Promise<void>;
}

export interface EmitCoMentionLinksResult {
	linksWritten: number;
	emissions: Array<{
		fromPageId: string;
		toPageId: string;
		memoryUnitId: string;
	}>;
}

/**
 * Emit reciprocal `reference` links between entity pages sourced by the
 * same `memory_unit`. Reads `wiki_section_sources` via the injected
 * `lookupMemorySources` callback so the live compile and the Unit 4
 * backfill share one code path. Topic and decision endpoints are
 * filtered out — their relationships are the LLM aggregation planner's
 * call, not co-mention evidence.
 */
export async function emitCoMentionLinks(
	args: EmitCoMentionLinksArgs,
): Promise<EmitCoMentionLinksResult> {
	const { scope, memoryUnitIds, lookupMemorySources, writeLink } = args;
	const result: EmitCoMentionLinksResult = {
		linksWritten: 0,
		emissions: [],
	};
	if (memoryUnitIds.length === 0) return result;

	const rows = await lookupMemorySources({
		tenantId: scope.tenantId,
		ownerId: scope.ownerId,
		memoryUnitIds,
	});

	// Group entity-type sources by memory_unit, dedup'd by page_id.
	const byMemory = new Map<string, Map<string, CoMentionSource>>();
	for (const row of rows) {
		if (!LINKABLE_LEAF_TYPES.has(row.page_type)) continue;
		let pages = byMemory.get(row.memory_unit_id);
		if (!pages) {
			pages = new Map();
			byMemory.set(row.memory_unit_id, pages);
		}
		if (!pages.has(row.page_id)) pages.set(row.page_id, row);
	}

	for (const [memoryUnitId, pageMap] of byMemory) {
		if (pageMap.size < 2) continue;

		// Deterministic slug-asc ordering — so truncation to
		// CO_MENTION_DIRECTED_EDGE_CAP picks the same edges whether we're
		// running live or backfilling.
		const pages = Array.from(pageMap.values()).sort((a, b) =>
			a.slug.localeCompare(b.slug),
		);

		const pairs: Array<[CoMentionSource, CoMentionSource]> = [];
		outer: for (let i = 0; i < pages.length; i++) {
			for (let j = 0; j < pages.length; j++) {
				if (i === j) continue;
				pairs.push([pages[i]!, pages[j]!]);
				if (pairs.length >= CO_MENTION_DIRECTED_EDGE_CAP) break outer;
			}
		}

		const context = `co_mention:${memoryUnitId}`;
		for (const [from, to] of pairs) {
			try {
				await writeLink({
					fromPageId: from.page_id,
					toPageId: to.page_id,
					context,
				});
				result.linksWritten += 1;
				result.emissions.push({
					fromPageId: from.page_id,
					toPageId: to.page_id,
					memoryUnitId,
				});
			} catch (err) {
				const msg = (err as Error)?.message || String(err);
				console.warn(
					`[co-mention-linker] writeLink failed from=${from.page_id} `
						+ `to=${to.page_id} mem=${memoryUnitId}: ${msg}`,
				);
			}
		}
	}

	return result;
}

/**
 * Precision gate for fuzzy parent matches. Accepts a fuzzy hit only when
 * the target page title starts with the candidate title as a whole word
 * AND carries a `", Region"` suffix — the Google-Places "City, ST" shape.
 * This filters out same-starting-token false positives (e.g. candidate
 * `"Austin"` vs entity `"Austin Reggae Fest"` both score ~0.5) while
 * keeping the cases the lower fuzzy threshold was designed to catch
 * (`"Austin"` → `"Austin, Texas"`, `"Paris"` → `"Paris, France"`).
 *
 * Exported so `wiki-deterministic-linker.test.ts` can exercise the gate
 * matrix directly — less brittle than faking similarity rows.
 */
export function isGeoQualifiedExtension(
	candidate: string,
	target: string,
): boolean {
	if (!candidate || !target) return false;
	const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const prefixRe = new RegExp(`^${escaped}\\b`, "iu");
	if (!prefixRe.test(target)) return false;
	// Require a comma-delimited region suffix ("City, ST", "City, Country").
	return /,\s+\S/.test(target);
}

export async function emitDeterministicParentLinks(
	args: EmitDeterministicParentLinksArgs,
): Promise<EmitDeterministicParentLinksResult> {
	const { scope, candidates, affectedPages, lookupParentPages, writeLink } =
		args;

	const result: EmitDeterministicParentLinksResult = {
		linksWritten: 0,
		emissions: [],
	};

	// Precompute leaf pages eligible for linking (entity type) keyed by
	// source record id → pages, so a record-kind candidate can cheaply find
	// the leaves whose records motivated it.
	const leavesByRecord = new Map<string, AffectedPage[]>();
	for (const page of affectedPages) {
		if (!LINKABLE_LEAF_TYPES.has(page.type)) continue;
		for (const recordId of page.sourceRecordIds) {
			const bucket = leavesByRecord.get(recordId) ?? [];
			bucket.push(page);
			leavesByRecord.set(recordId, bucket);
		}
	}

	// Summary-kind leaf index: keyed by page id. Consults both
	// affectedPages (batch-touched) and scopePages (scope-wide pool) so
	// summary-kind candidates can resolve leaves that weren't touched this
	// batch. Deduplicated on page id — affectedPages wins on collision
	// since its sourceRecordIds field is populated.
	const leavesById = new Map<string, AffectedPage>();
	for (const page of args.scopePages ?? []) {
		if (!LINKABLE_LEAF_TYPES.has(page.type)) continue;
		leavesById.set(page.id, page);
	}
	for (const page of affectedPages) {
		if (!LINKABLE_LEAF_TYPES.has(page.type)) continue;
		leavesById.set(page.id, page);
	}

	const { lookupParentPagesFuzzy } = args;

	for (const candidate of candidates) {
		const matches = await lookupParentPages({
			tenantId: scope.tenantId,
			ownerId: scope.ownerId,
			title: candidate.parentTitle,
		});
		let parent:
			| { id: string; type: WikiPageType; slug: string; title: string }
			| undefined;
		if (matches.length > 0) {
			if (matches.length > 1) {
				console.warn(
					`[deterministic-linker] title collision for "${candidate.parentTitle}"`
						+ ` in (tenant=${scope.tenantId}, owner=${scope.ownerId}): ${matches
							.map((m) => m.id)
							.join(", ")} — picking first`,
				);
			}
			parent = matches[0];
		} else if (lookupParentPagesFuzzy) {
			// Trigram fallback — closes the "Austin" candidate vs existing
			// "Austin, Texas" page gap surfaced on Marco recompile. A
			// geo-suffix gate (`isGeoQualifiedExtension`) filters out
			// similarly-scoring non-geographic hits like "Austin Reggae Fest"
			// or "Toronto Life" — without it, the lower threshold (0.50 vs
			// alias-dedupe 0.85) would emit false positives on entity pages
			// that happen to start with a city token. Same-type gate below
			// still applies.
			const fuzzy = await lookupParentPagesFuzzy({
				tenantId: scope.tenantId,
				ownerId: scope.ownerId,
				title: candidate.parentTitle,
			});
			const best = fuzzy.find((row) =>
				isGeoQualifiedExtension(candidate.parentTitle, row.title),
			);
			if (best) {
				console.log(
					`[deterministic-linker] fuzzy parent match: "${candidate.parentTitle}" ` +
						`≈ "${best.title}" (sim=${best.similarity.toFixed(3)}) → ` +
						`page ${best.id}`,
				);
				parent = {
					id: best.id,
					type: best.type,
					slug: best.slug,
					title: best.title,
				};
			} else if (fuzzy.length > 0) {
				// Useful when tuning: the lookup returned hits but none had a
				// "City, Region" shape — surfaces the precision gate filtering.
				const top = fuzzy[0]!;
				console.log(
					`[deterministic-linker] fuzzy parent rejected (no geo suffix): ` +
						`"${candidate.parentTitle}" ≈ "${top.title}" ` +
						`(sim=${top.similarity.toFixed(3)})`,
				);
			}
		}
		if (!parent) continue;
		if (!ALLOWED_PARENT_TYPES.has(parent.type)) continue;

		// Resolve leaf pages based on candidate kind. Record-kind candidates
		// carry memory-record ids, summary-kind candidates carry page ids
		// directly — see `ParentCandidateSourceKind`.
		const candidateLeaves: AffectedPage[] = [];
		const seenCandidateLeafIds = new Set<string>();
		const kind = candidate.sourceKind ?? "record";
		if (kind === "summary") {
			for (const pageId of candidate.sourceRecordIds) {
				if (seenCandidateLeafIds.has(pageId)) continue;
				seenCandidateLeafIds.add(pageId);
				const leaf = leavesById.get(pageId);
				if (leaf) candidateLeaves.push(leaf);
			}
		} else {
			for (const recordId of candidate.sourceRecordIds) {
				const leaves = leavesByRecord.get(recordId);
				if (!leaves) continue;
				for (const leaf of leaves) {
					if (seenCandidateLeafIds.has(leaf.id)) continue;
					seenCandidateLeafIds.add(leaf.id);
					candidateLeaves.push(leaf);
				}
			}
		}

		for (const leaf of candidateLeaves) {
			if (leaf.id === parent.id) continue; // no self-links

			const context = `deterministic:${candidate.reason}:${candidate.parentSlug}`;
			try {
				await writeLink({
					fromPageId: leaf.id,
					toPageId: parent.id,
					context,
				});
				result.linksWritten += 1;
				result.emissions.push({
					fromPageId: leaf.id,
					toPageId: parent.id,
					reason: candidate.reason,
					parentSlug: candidate.parentSlug,
				});
			} catch (err) {
				const msg = (err as Error)?.message || String(err);
				console.warn(
					`[deterministic-linker] writeLink failed leaf=${leaf.id} `
						+ `parent=${parent.id}: ${msg}`,
				);
			}
		}
	}

	return result;
}
