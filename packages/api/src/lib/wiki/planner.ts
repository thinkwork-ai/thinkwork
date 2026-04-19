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
}

export interface PlannedNewPage {
	type: WikiPageType;
	slug: string;
	title: string;
	aliases?: string[];
	summary?: string | null;
	sections: PlannedNewPageSection[];
	/** Which record IDs fed this page — used for provenance. */
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

export interface PlannerResult {
	pageUpdates: PlannedPageUpdate[];
	newPages: PlannedNewPage[];
	unresolvedMentions: PlannedUnresolvedMention[];
	promotions: PlannedPromotion[];
	pageLinks: PlannedPageLink[];
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

1. Ground every proposed body in cited records. Include a \`source_refs\` list of record IDs for new pages and promotions.
2. Never invent record IDs, page IDs, or mention IDs — only use the ones in the input.
3. Prefer short, factual section bodies. No speculation, no generalization beyond the records.
4. When a record clearly refers to an existing candidate page (by slug, alias, or title), update that page. Don't duplicate.
5. If unsure whether a subject is an entity / topic / decision, treat it as an unresolved mention.
6. Links should only reference \`(type, slug)\` pairs that exist in \`candidatePages\` OR are being created in this same response's \`newPages\`. Never invent pages by link alone.
7. Output **only valid JSON**. No prose, no markdown fences.`;

const PLANNER_OUTPUT_SCHEMA = `{
  "pageUpdates": [
    {
      "pageId": "<existing page id from input>",
      "aliases": ["<new alias strings to register, optional>"],
      "sections": [
        {
          "slug": "<section slug from the page type>",
          "rationale": "<one sentence: why this section changes>",
          "proposed_body_md": "<full markdown body for the section>"
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
      "source_refs": ["<record id>"],
      "sections": [
        {
          "slug": "<section slug>",
          "heading": "<section heading>",
          "body_md": "<section body markdown>"
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
        { "slug": "<section slug>", "heading": "<heading>", "body_md": "<body>" }
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
		maxTokens: 8192,
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

	for (const l of v.pageLinks as unknown[]) {
		if (!l || typeof l !== "object") throw new Error("pageLinks entry not object");
		const link = l as Record<string, unknown>;
		if (!isPageType(link.fromType)) {
			throw new Error(`pageLinks.fromType invalid: ${link.fromType}`);
		}
		if (!isPageType(link.toType)) {
			throw new Error(`pageLinks.toType invalid: ${link.toType}`);
		}
		if (typeof link.fromSlug !== "string" || link.fromSlug.length === 0) {
			throw new Error("pageLinks.fromSlug missing");
		}
		if (typeof link.toSlug !== "string" || link.toSlug.length === 0) {
			throw new Error("pageLinks.toSlug missing");
		}
	}

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
