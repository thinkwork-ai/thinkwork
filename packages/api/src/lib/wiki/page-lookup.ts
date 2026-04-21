/**
 * Cross-cutting "does a page already exist for this title?" helper.
 *
 * Extracted from `compiler.ts::maybeMergeIntoExistingPage` so the
 * places-service (auto-backing-page creator) can reuse the same two-pass
 * alias machinery without pulling in the compiler's merge side effects
 * (section re-seed, alias write).
 *
 * Lives in its own module — not repository.ts — because call sites mock
 * `findAliasMatches` / `findAliasMatchesFuzzy` via vi.mock on
 * repository.js, and vi.mock only intercepts cross-module imports. A
 * helper in a separate file gets the mocked implementations when those
 * tests run.
 */

import {
	findAliasMatches,
	findAliasMatchesFuzzy,
	findPageById,
	normalizeAlias,
	type WikiPageRow,
	type WikiPageType,
} from "./repository.js";

export type PageLookupKind = "exact" | "fuzzy";

export interface PageLookupHit {
	page: WikiPageRow;
	kind: PageLookupKind;
	/** Populated only for kind='fuzzy' — the matched alias text + similarity,
	 * so call sites can log the near-miss for observability. */
	matchedAlias?: { text: string; similarity: number };
}

/**
 * Two-pass lookup: exact alias match (prefers same-type) → trigram-fuzzy
 * at FUZZY_ALIAS_THRESHOLD (strict same-type to prevent over-collapse).
 * Returns null when no active page in scope matches.
 *
 * Pure lookup — no upsert side effects. Callers that want to merge
 * should call this for discovery, then run their own upsert/merge logic
 * with the returned page.
 */
export async function findExistingPageByTitleOrAlias(args: {
	tenantId: string;
	ownerId: string;
	type: WikiPageType;
	title: string;
}): Promise<PageLookupHit | null> {
	const aliasNormalized = normalizeAlias(args.title);
	if (!aliasNormalized) return null;

	// Pass 1: exact alias match. Prefer same-type hits; fall back to
	// cross-type only when no same-type candidate is present.
	const exactMatches = await findAliasMatches({
		tenantId: args.tenantId,
		ownerId: args.ownerId,
		aliasNormalized,
	});
	let fallback: WikiPageRow | null = null;
	for (const m of exactMatches) {
		const candidate = await findPageById(m.pageId);
		if (!candidate) continue;
		if (
			candidate.tenant_id !== args.tenantId ||
			candidate.owner_id !== args.ownerId
		) {
			continue;
		}
		if (candidate.status !== "active") continue;
		if (candidate.type === args.type) return { page: candidate, kind: "exact" };
		if (!fallback) fallback = candidate;
	}
	if (fallback) return { page: fallback, kind: "exact" };

	// Pass 2: trigram-fuzzy fallback. Strict same-type to prevent
	// cross-type over-collapse (entity "Austin" vs topic "Austin").
	const fuzzyMatches = await findAliasMatchesFuzzy({
		tenantId: args.tenantId,
		ownerId: args.ownerId,
		aliasNormalized,
	});
	for (const m of fuzzyMatches) {
		if (m.pageType !== args.type) continue;
		const candidate = await findPageById(m.pageId);
		if (!candidate) continue;
		if (
			candidate.tenant_id !== args.tenantId ||
			candidate.owner_id !== args.ownerId
		) {
			continue;
		}
		if (candidate.status !== "active") continue;
		return {
			page: candidate,
			kind: "fuzzy",
			matchedAlias: { text: m.aliasText, similarity: m.similarity },
		};
	}

	return null;
}
