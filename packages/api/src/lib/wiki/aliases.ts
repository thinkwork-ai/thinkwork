/**
 * Alias + slug helpers for the compiler.
 *
 * The heavy lifting (DB lookups) lives in repository.ts — `findAliasMatches`
 * and `upsertUnresolvedMention`. This module wraps the planner-side string
 * transforms so the compiler doesn't have to know the normalization rules
 * directly, and so tests can pin them down without touching drizzle.
 */

import { normalizeAlias as normalizeAliasRepo } from "./repository.js";

/** Re-export so consumers only import from this module. */
export const normalizeAlias = normalizeAliasRepo;

/**
 * Generate a URL-safe slug from a free-form title. Stable so the same title
 * always resolves to the same slug (important for dedupe during upsert).
 *
 * Matches the unique index on `wiki_pages(tenant_id, owner_id, type, slug)` —
 * if two records would produce the same slug, the compiler picks the
 * existing page instead of creating a duplicate.
 */
export function slugifyTitle(title: string): string {
	return title
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "") // strip combining diacritics
		.toLowerCase()
		.replace(/[^a-z0-9\s-]+/g, " ") // drop symbols/punctuation
		.trim()
		.replace(/\s+/g, "-") // whitespace → single dash
		.replace(/-+/g, "-") // collapse runs of dashes
		.replace(/^-+|-+$/g, "") // trim leading/trailing dashes
		.slice(0, 120); // keep slugs indexable
}

/**
 * Suggest additional aliases the compiler should register for a page based
 * on metadata it already has. The planner may propose its own aliases; these
 * are deterministic additions.
 *
 * Current heuristic:
 * - title itself (in normalized form)
 * - shortened forms that strip common suffixes ("The Foo Restaurant" → "foo")
 *   are deferred — too noisy without real examples to tune against.
 */
export function seedAliasesForTitle(title: string): string[] {
	const primary = normalizeAlias(title);
	return primary ? [primary] : [];
}
