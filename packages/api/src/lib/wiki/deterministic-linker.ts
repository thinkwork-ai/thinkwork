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

/** Reasons we emit deterministic links for in v1. `tag_cluster` is too
 * heuristic to trust without the coherence scoring owned by the broader
 * hierarchical-aggregation plan. */
const TRUSTED_REASONS: ReadonlySet<ParentCandidateReason> = new Set([
	"city",
	"journal",
]);

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
	lookupParentPages: ParentPageLookup;
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
	// source record id → pages, so a candidate can cheaply find the leaves
	// whose records motivated it.
	const leavesByRecord = new Map<string, AffectedPage[]>();
	for (const page of affectedPages) {
		if (!LINKABLE_LEAF_TYPES.has(page.type)) continue;
		for (const recordId of page.sourceRecordIds) {
			const bucket = leavesByRecord.get(recordId) ?? [];
			bucket.push(page);
			leavesByRecord.set(recordId, bucket);
		}
	}

	for (const candidate of candidates) {
		if (!TRUSTED_REASONS.has(candidate.reason)) continue;

		const matches = await lookupParentPages({
			tenantId: scope.tenantId,
			ownerId: scope.ownerId,
			title: candidate.parentTitle,
		});
		if (matches.length === 0) continue;
		if (matches.length > 1) {
			console.warn(
				`[deterministic-linker] title collision for "${candidate.parentTitle}"`
					+ ` in (tenant=${scope.tenantId}, owner=${scope.ownerId}): ${matches
						.map((m) => m.id)
						.join(", ")} — picking first`,
			);
		}
		const parent = matches[0]!;
		if (!ALLOWED_PARENT_TYPES.has(parent.type)) continue;

		const seenLeafIds = new Set<string>();
		for (const recordId of candidate.sourceRecordIds) {
			const leaves = leavesByRecord.get(recordId);
			if (!leaves) continue;
			for (const leaf of leaves) {
				if (seenLeafIds.has(leaf.id)) continue;
				seenLeafIds.add(leaf.id);
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
	}

	return result;
}
