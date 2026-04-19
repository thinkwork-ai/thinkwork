/**
 * Planner — the high-leverage target selector for the compile pipeline.
 *
 * Given a batch of normalized memory records (from the Hindsight cursor) plus
 * the candidate pages and open unresolved mentions in the caller's scope, the
 * planner produces a structured plan of what the compiler should do:
 *
 *   - pageUpdates: existing pages that should have sections refreshed
 *   - newPages: new pages to create (type + title + section seeds)
 *   - unresolvedMentions: ambiguous references to accumulate without creating
 *     a page yet
 *   - promotions: open unresolved mentions that now merit promotion
 *
 * Correctness bias: err toward `unresolvedMentions` over `newPages`. It is much
 * easier to promote later than to clean up page spam. See Spike D / threshold
 * policy in the build plan.
 *
 * v1 uses Haiku 4.5 (see `bedrock.ts`). Prompts live in this module as strings
 * so we can iterate on them alongside the code that parses their output.
 */

import type { ThinkWorkMemoryRecord } from "../memory/types.js";
import { invokeClaude, parseJsonResponse } from "./bedrock.js";
import { describeAllPageTypes } from "./templates.js";
import type { WikiPageType } from "./repository.js";

// ---------------------------------------------------------------------------
// Input + output types
// ---------------------------------------------------------------------------

export interface PlannerCandidatePage {
	id: string;
	type: WikiPageType;
	slug: string;
	title: string;
	summary: string | null;
	aliases: string[];
}

export interface PlannerOpenMention {
	id: string;
	alias: string;
	aliasNormalized: string;
	mentionCount: number;
	suggestedType: WikiPageType | null;
}

export interface PlannerBatch {
	tenantId: string;
	ownerId: string;
	records: ThinkWorkMemoryRecord[];
	candidatePages: PlannerCandidatePage[];
	openMentions: PlannerOpenMention[];
}

export interface PlannedSectionUpdate {
	slug: string;
	rationale: string;
	proposed_body_md: string;
	/**
	 * Which memory-record IDs actually inform THIS section's update. REQUIRED
	 * and narrowly scoped — per-section, not per-page — so the reverse lookup
	 * from a memory back to its citing pages stays truthful. The compiler
	 * writes one `wiki_section_sources` row per listed ref; omitting refs
	 * produces zero provenance rows for this section (preferred over wrongly
	 * citing every record in the batch, which produced a lot of noise
	 * pre-fix).
	 */
	source_refs: string[];
}

export interface PlannedPageUpdate {
	pageId: string;
	sections: PlannedSectionUpdate[];
	/** New aliases to register on the existing page. */
	aliases?: string[];
}

export interface PlannedNewPageSection {
	slug: string;
	heading: string;
	body_md: string;
	/** Per-section provenance — see PlannedSectionUpdate.source_refs. */
	source_refs: string[];
}

export interface PlannedNewPage {
	type: WikiPageType;
	slug: string;
	title: string;
	aliases?: string[];
	summary?: string | null;
	sections: PlannedNewPageSection[];
	/**
	 * Fallback provenance for sections that don't carry their own source_refs.
	 * Prefer per-section refs — this is only used as a secondary source when
	 * a section's `source_refs` is empty.
	 */
	source_refs: string[];
}

export interface PlannedUnresolvedMention {
	alias: string;
	suggestedType: WikiPageType | null;
	context: string;
	source_ref: string;
}

export interface PlannedPromotion {
	mentionId: string;
	reason: string;
	type: WikiPageType;
	title: string;
	slug: string;
	sections: PlannedNewPageSection[];
}

/**
 * Directed link between two pages in the same (tenant, owner) scope.
 * Referenced by `(type, slug)` so the planner doesn't need to know page IDs —
 * the compiler resolves them after applying all upserts in the batch, which
 * means a newly-created page can be the target of a link from another new
 * page in the same plan.
 */
export interface PlannedPageLink {
	fromType: WikiPageType;
	fromSlug: string;
	toType: WikiPageType;
	toSlug: string;
	/** One-line description of why the link exists (for backlink context). */
	context?: string;
}

/**
 * Update a section that lives on a parent/hub page and acts as a rollup
 * across multiple child entities. Emitted by the aggregation pass (not the
 * leaf planner) — the shape is parallel to PlannedSectionUpdate but carries
 * the additional linked-page set and optional tag observations so the
 * compiler can update `wiki_page_sections.aggregation` metadata in one go.
 */
export interface PlannedParentSectionUpdate {
	pageId: string; // existing parent/hub page id (must be in candidatePages)
	sectionSlug: string;
	heading: string;
	proposed_body_md: string;
	rationale: string;
	linked_page_slugs: Array<{ type: WikiPageType; slug: string }>;
	source_refs: string[];
	observed_tags?: string[];
}

/**
 * Promote a section on a parent page into its own topic page. The compiler
 * creates the new page, rewrites the parent section down to the summary +
 * highlights, and links parent ⇄ child with kind='parent_of'/'child_of'.
 * Promotion is sticky — the aggregation planner must not re-promote an
 * already-promoted section.
 */
export interface PlannedSectionPromotion {
	pageId: string;
	sectionSlug: string;
	reason: string;
	newPage: PlannedNewPage;
	parentSummary: string;
	topHighlights: string[];
}

export interface PlannerResult {
	pageUpdates: PlannedPageUpdate[];
	newPages: PlannedNewPage[];
	unresolvedMentions: PlannedUnresolvedMention[];
	promotions: PlannedPromotion[];
	pageLinks: PlannedPageLink[];
	/**
	 * Hub/rollup section updates on existing parent pages. Emitted primarily
	 * by the aggregation pass; the leaf planner may also set them but should
	 * stay conservative — mis-rollups are expensive to unwind.
	 */
	parentSectionUpdates: PlannedParentSectionUpdate[];
	/**
	 * Sections that have earned promotion into their own topic pages. Applied
	 * after parentSectionUpdates so the planner sees fresh aggregation metadata
	 * before deciding which sections to promote.
	 */
	sectionPromotions: PlannedSectionPromotion[];
	usage: { inputTokens: number; outputTokens: number };
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const PLANNER_SYSTEM = `You are the **planner** for a compounding-memory wiki. Your job is to take a batch of raw memory records (short notes, events, reflections) and decide how they should update an agent's compiled knowledge base.

You always belong to exactly **one (tenant, agent) scope**. All pages you reference are inside that scope; you never propose cross-agent links. Do not invent records or pages — only work with what you are given.

## Page types

${describeAllPageTypes()}

Type describes page *shape*, not sharing. All pages are owner-scoped.

## Output actions

Return a JSON object with these five arrays. Any can be empty. Bias toward \`unresolvedMentions\` over \`newPages\`: creating noise is expensive; holding an alias costs almost nothing.

- **pageUpdates** — existing pages whose sections should be refreshed. Only include a section when its body materially changes given the new evidence. Do not rewrite for stylistic polish.
- **newPages** — new pages backed by strong evidence. Use this only when (a) the subject is durable, (b) at least two records reinforce it, and (c) no existing candidate page covers it.
- **unresolvedMentions** — alias references the records make that aren't clearly covered by an existing page or strong enough for a new one. Hold them for later promotion.
- **promotions** — open mentions that should now become real pages because the batch pushes them past the threshold (≥3 mentions, recent activity).
- **pageLinks** — directed relationships between pages. Emit a link whenever one page *meaningfully references* another in the same scope. Examples to be aggressive about:
    - a restaurant entity → the topic page for the trip/journal it appears in ("Momofuku Daishō → Toronto Life")
    - a place inside a city or park → the parent place ("Barton Springs Pool → Zilker Metropolitan Park")
    - a person → the organization or family they belong to
    - a decision → the subject entities it references
    - a topic → each of its constituent entities
  You may reference pages from \`candidatePages\` input AND any \`newPages\` you're creating in this same response. Links are directional — emit both directions if they're both meaningful.

## Rules

1. Ground every proposed body in cited records. **Every section MUST include a \`source_refs\` array listing the specific record IDs that inform THAT section.** Don't put a record's id on a section whose prose doesn't draw from that record. If a section's update isn't backed by at least one record in this batch, omit the section.
2. Never invent record IDs, page IDs, or mention IDs — only use the ones in the input.
3. Prefer short, factual section bodies. No speculation, no generalization beyond the records.
4. When a record clearly refers to an existing candidate page (by slug, alias, or title), update that page. Don't duplicate.
5. If unsure whether a subject is an entity / topic / decision, treat it as an unresolved mention.
6. Links should only reference \`(type, slug)\` pairs that exist in \`candidatePages\` OR are being created in this same response's \`newPages\`. Never invent pages by link alone.
7. **Never write record IDs, UUIDs, hex identifiers, or internal keys into section prose.** Phrases like "see records 1c907c71-...", "id=abc-123", or dumps of Hindsight unit ids are forbidden in \`proposed_body_md\` / \`body_md\`. Provenance belongs in \`source_refs\` only; the body is for human-readable content.
8. **Use wikilinks in the prose when referring to another page in scope.** Write \`[[Title]]\` around any name that matches a page in \`candidatePages\` or a \`newPages\` entry you are creating. Example: instead of "Marco is an AI assistant powered by ThinkWork", write "[[Marco]] is an AI assistant powered by [[ThinkWork]]" when those pages exist in scope. This makes cross-page references clickable in the rendered wiki.
9. Output **only valid JSON**. No prose, no markdown fences.`;

const PLANNER_OUTPUT_SCHEMA = `{
  "pageUpdates": [
    {
      "pageId": "<existing page id from input>",
      "aliases": ["<new alias strings to register, optional>"],
      "sections": [
        {
          "slug": "<section slug from the page type>",
          "rationale": "<one sentence: why this section changes>",
          "proposed_body_md": "<full markdown body for the section>",
          "source_refs": ["<record id that inform THIS section>"]
        }
      ]
    }
  ],
  "newPages": [
    {
      "type": "entity | topic | decision",
      "slug": "<kebab-case slug>",
      "title": "<display title>",
      "aliases": ["<optional alternate names>"],
      "summary": "<one-line page summary>",
      "source_refs": ["<optional page-level fallback record ids>"],
      "sections": [
        {
          "slug": "<section slug>",
          "heading": "<section heading>",
          "body_md": "<section body markdown>",
          "source_refs": ["<record id that inform THIS section>"]
        }
      ]
    }
  ],
  "unresolvedMentions": [
    {
      "alias": "<the name as seen>",
      "suggestedType": "entity | topic | decision | null",
      "context": "<a short quote or summary of where it appeared>",
      "source_ref": "<record id>"
    }
  ],
  "pageLinks": [
    {
      "fromType": "entity | topic | decision",
      "fromSlug": "<slug of source page; must exist in candidatePages or newPages>",
      "toType": "entity | topic | decision",
      "toSlug": "<slug of target page; must exist in candidatePages or newPages>",
      "context": "<one-line description of why the link exists; shown to the user on backlinks>"
    }
  ],
  "promotions": [
    {
      "mentionId": "<id from openMentions input>",
      "reason": "<one sentence: why now>",
      "type": "entity | topic | decision",
      "title": "<page title>",
      "slug": "<kebab-case slug>",
      "sections": [
        { "slug": "<section slug>", "heading": "<heading>", "body_md": "<body>", "source_refs": ["<record id>"] }
      ]
    }
  ]
}`;

// ---------------------------------------------------------------------------
// Prompt assembly + parsing
// ---------------------------------------------------------------------------

export function buildPlannerUserPrompt(batch: PlannerBatch): string {
	const lines: string[] = [];
	lines.push("## Memory records in this batch\n");
	for (const r of batch.records) {
		const meta =
			r.metadata && Object.keys(r.metadata).length > 0
				? ` metadata=${JSON.stringify(compactMetadata(r.metadata))}`
				: "";
		const when = r.updatedAt || r.createdAt;
		lines.push(
			`- id=${r.id} kind=${r.kind} when=${when}${meta}\n  text: ${truncate(r.content.text, 800)}`,
		);
	}

	lines.push("\n## Candidate pages already in this scope\n");
	if (batch.candidatePages.length === 0) {
		lines.push("(none)");
	} else {
		for (const p of batch.candidatePages) {
			lines.push(
				`- id=${p.id} type=${p.type} slug=${p.slug} title=${JSON.stringify(p.title)}` +
					(p.summary ? ` summary=${JSON.stringify(truncate(p.summary, 200))}` : "") +
					(p.aliases.length > 0 ? ` aliases=${JSON.stringify(p.aliases.slice(0, 8))}` : ""),
			);
		}
	}

	lines.push("\n## Open unresolved mentions in this scope\n");
	if (batch.openMentions.length === 0) {
		lines.push("(none)");
	} else {
		for (const m of batch.openMentions) {
			lines.push(
				`- id=${m.id} alias=${JSON.stringify(m.alias)} count=${m.mentionCount}` +
					(m.suggestedType ? ` suggestedType=${m.suggestedType}` : ""),
			);
		}
	}

	lines.push("\n## Required output JSON shape\n");
	lines.push("```");
	lines.push(PLANNER_OUTPUT_SCHEMA);
	lines.push("```");
	lines.push(
		"\nReturn ONLY the JSON object. No prose, no fences. Include empty arrays for categories that don't apply.",
	);

	return lines.join("\n");
}

/**
 * Call Claude with the planner prompt and parse the response. Throws if the
 * model returns unparseable output — the compiler catches that and marks the
 * job failed without advancing the cursor, so we re-try cleanly.
 */
export async function runPlanner(
	batch: PlannerBatch,
	opts: { signal?: AbortSignal; modelId?: string } = {},
): Promise<PlannerResult> {
	const user = buildPlannerUserPrompt(batch);
	const resp = await invokeClaude({
		system: PLANNER_SYSTEM,
		user,
		// Planner output grows with batch complexity + link proposals + per-
		// section source_refs. 8k was tight enough to truncate on 50-record
		// batches with 20+ new pages; 24k gives comfortable headroom without
		// changing models. Haiku 4.5 supports up to 32k output tokens.
		maxTokens: 24000,
		temperature: 0,
		modelId: opts.modelId,
		signal: opts.signal,
	});

	const parsed = parseJsonResponse<PlannerResult>(resp.text);
	validatePlannerResult(parsed);
	return {
		...parsed,
		usage: {
			inputTokens: resp.inputTokens,
			outputTokens: resp.outputTokens,
		},
	};
}

// ---------------------------------------------------------------------------
// Validation — refuse malformed plans so the compiler never writes garbage
// ---------------------------------------------------------------------------

export function validatePlannerResult(value: unknown): asserts value is PlannerResult {
	if (!value || typeof value !== "object") {
		throw new Error("planner response is not an object");
	}
	const v = value as Record<string, unknown>;
	requireArray(v, "pageUpdates");
	requireArray(v, "newPages");
	requireArray(v, "unresolvedMentions");
	requireArray(v, "promotions");
	// pageLinks is newer than the other fields — accept plans that omit it.
	if (v.pageLinks === undefined) {
		v.pageLinks = [];
	} else if (!Array.isArray(v.pageLinks)) {
		throw new Error("planner response pageLinks must be an array");
	}

	// parentSectionUpdates / sectionPromotions are PR-B additions. The leaf
	// planner prompt does not ask for them, so default to [] when absent.
	if (v.parentSectionUpdates === undefined) {
		v.parentSectionUpdates = [];
	} else if (!Array.isArray(v.parentSectionUpdates)) {
		throw new Error("planner response parentSectionUpdates must be an array");
	}
	if (v.sectionPromotions === undefined) {
		v.sectionPromotions = [];
	} else if (!Array.isArray(v.sectionPromotions)) {
		throw new Error("planner response sectionPromotions must be an array");
	}

	for (const p of v.parentSectionUpdates as unknown[]) {
		if (!p || typeof p !== "object") {
			throw new Error("parentSectionUpdates entry not object");
		}
		const psu = p as Record<string, unknown>;
		if (typeof psu.pageId !== "string" || psu.pageId.length === 0) {
			throw new Error("parentSectionUpdates.pageId missing");
		}
		if (
			typeof psu.sectionSlug !== "string" ||
			psu.sectionSlug.length === 0
		) {
			throw new Error("parentSectionUpdates.sectionSlug missing");
		}
		if (!Array.isArray(psu.linked_page_slugs)) {
			psu.linked_page_slugs = [];
		}
		if (!Array.isArray(psu.source_refs)) {
			psu.source_refs = [];
		}
	}

	for (const p of v.sectionPromotions as unknown[]) {
		if (!p || typeof p !== "object") {
			throw new Error("sectionPromotions entry not object");
		}
		const sp = p as Record<string, unknown>;
		if (typeof sp.pageId !== "string" || sp.pageId.length === 0) {
			throw new Error("sectionPromotions.pageId missing");
		}
		if (typeof sp.sectionSlug !== "string" || sp.sectionSlug.length === 0) {
			throw new Error("sectionPromotions.sectionSlug missing");
		}
		if (!sp.newPage || typeof sp.newPage !== "object") {
			throw new Error("sectionPromotions.newPage missing");
		}
		const np = sp.newPage as Record<string, unknown>;
		if (!isPageType(np.type)) {
			throw new Error(
				`sectionPromotions.newPage.type invalid: ${np.type}`,
			);
		}
		if (typeof np.title !== "string" || np.title.length === 0) {
			throw new Error("sectionPromotions.newPage.title missing");
		}
		if (typeof np.slug !== "string" || np.slug.length === 0) {
			throw new Error("sectionPromotions.newPage.slug missing");
		}
		if (!Array.isArray(np.sections)) {
			throw new Error("sectionPromotions.newPage.sections missing");
		}
		if (!Array.isArray(sp.topHighlights)) {
			sp.topHighlights = [];
		}
	}

	// Filter bad pageLinks silently instead of failing the whole plan. Some
	// models (smaller Nova / OSS variants) occasionally invent a page type
	// like `vehicle` or a blank slug; better to drop that one link than lose
	// every update in the batch. The compiler already tolerates missing
	// link targets via findPageBySlug returning null.
	v.pageLinks = (v.pageLinks as unknown[]).filter((l) => {
		if (!l || typeof l !== "object") return false;
		const link = l as Record<string, unknown>;
		if (!isPageType(link.fromType) || !isPageType(link.toType)) {
			console.warn(
				`[planner] dropping pageLink with invalid type fromType=${link.fromType} toType=${link.toType}`,
			);
			return false;
		}
		if (typeof link.fromSlug !== "string" || link.fromSlug.length === 0) {
			console.warn(`[planner] dropping pageLink with missing fromSlug`);
			return false;
		}
		if (typeof link.toSlug !== "string" || link.toSlug.length === 0) {
			console.warn(`[planner] dropping pageLink with missing toSlug`);
			return false;
		}
		return true;
	});

	for (const u of v.pageUpdates as unknown[]) {
		if (!u || typeof u !== "object") throw new Error("pageUpdates entry not object");
		const up = u as Record<string, unknown>;
		if (typeof up.pageId !== "string" || up.pageId.length === 0) {
			throw new Error("pageUpdates.pageId missing");
		}
		requireArray(up, "sections");
	}

	for (const p of v.newPages as unknown[]) {
		if (!p || typeof p !== "object") throw new Error("newPages entry not object");
		const np = p as Record<string, unknown>;
		if (!isPageType(np.type)) throw new Error(`newPages.type invalid: ${np.type}`);
		if (typeof np.title !== "string" || np.title.length === 0) {
			throw new Error("newPages.title missing");
		}
		if (typeof np.slug !== "string" || np.slug.length === 0) {
			throw new Error("newPages.slug missing");
		}
		requireArray(np, "sections");
	}

	for (const m of v.unresolvedMentions as unknown[]) {
		if (!m || typeof m !== "object") {
			throw new Error("unresolvedMentions entry not object");
		}
		const um = m as Record<string, unknown>;
		if (typeof um.alias !== "string" || um.alias.length === 0) {
			throw new Error("unresolvedMentions.alias missing");
		}
	}

	for (const pr of v.promotions as unknown[]) {
		if (!pr || typeof pr !== "object") throw new Error("promotions entry not object");
		const p = pr as Record<string, unknown>;
		if (typeof p.mentionId !== "string" || p.mentionId.length === 0) {
			throw new Error("promotions.mentionId missing");
		}
		if (!isPageType(p.type)) throw new Error(`promotions.type invalid: ${p.type}`);
	}
}

function requireArray(obj: Record<string, unknown>, key: string): void {
	if (!Array.isArray(obj[key])) {
		throw new Error(`planner response missing array field: ${key}`);
	}
}

function isPageType(v: unknown): v is WikiPageType {
	return v === "entity" || v === "topic" || v === "decision";
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function truncate(s: string, n: number): string {
	return s.length <= n ? s : `${s.slice(0, n)}…`;
}

/**
 * Strip bulky metadata fields (like Google Places photo arrays) so the planner
 * prompt stays focused on what's useful. Keeps names, tags, geo, dates.
 */
function compactMetadata(meta: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(meta)) {
		if (k === "photos" || k === "raw") continue;
		if (v == null) continue;
		if (typeof v === "object" && !Array.isArray(v)) {
			const sub: Record<string, unknown> = {};
			for (const [sk, sv] of Object.entries(v as Record<string, unknown>)) {
				if (sk === "photos" || sk === "raw") continue;
				if (typeof sv === "string" && sv.length > 400) continue;
				sub[sk] = sv;
			}
			out[k] = sub;
			continue;
		}
		if (typeof v === "string" && v.length > 400) continue;
		out[k] = v;
	}
	return out;
}

// Test-only exports — not part of the public surface.
export const _test = { PLANNER_SYSTEM, PLANNER_OUTPUT_SCHEMA, compactMetadata };
