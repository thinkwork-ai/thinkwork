/**
 * Aggregation planner — a second, separate LLM pass focused on hub/rollup
 * behavior. Runs AFTER the leaf planner has produced leaf pages for the
 * current batch. Its job is to look across the scope's freshly-updated
 * pages + any derived parent candidates and decide:
 *
 *   - which parent/hub sections should be refreshed with rollup prose
 *   - whether any section has become dense enough to promote into its
 *     own topic page
 *   - whether a durable hub page is missing entirely (e.g. "Austin" when
 *     5+ Austin-scoped entities exist but no city page does)
 *
 * This pass is explicitly NOT allowed to create leaf entity pages or
 * propose leaf-level section rewrites. The prompt bans that so we don't
 * get a second planner re-inventing leaves from the same batch.
 *
 * Output conforms to the existing PlannerResult shape (extended in PR B
 * to carry parentSectionUpdates + sectionPromotions). The compiler reuses
 * its existing apply loop for pageLinks / newPages and adds dedicated
 * application steps for the aggregation-specific fields.
 */

import { invokeClaudeJson } from "./bedrock.js";
import { describeAllPageTypes } from "./templates.js";
import {
	validatePlannerResult,
	type PlannerResult,
} from "./planner.js";
import type {
	WikiPageType,
	WikiPageRow,
	SectionAggregation,
} from "./repository.js";
import type { DerivedParentCandidate } from "./parent-expander.js";

// ---------------------------------------------------------------------------
// Input shape
// ---------------------------------------------------------------------------

export interface AggregationCandidatePage {
	id: string;
	type: WikiPageType;
	slug: string;
	title: string;
	summary: string | null;
	parent_page_id: string | null;
	hubness_score: number;
	tags: string[];
	sections: Array<{
		id: string;
		section_slug: string;
		heading: string;
		body_md: string;
		aggregation: SectionAggregation | null;
		promotion_score?: number;
		promotion_status?: SectionAggregation["promotion_status"];
	}>;
}

export interface AggregationLinkNeighborhood {
	pageId: string;
	inboundCount: number;
}

export interface AggregationBatch {
	tenantId: string;
	ownerId: string;
	recentlyChangedPages: AggregationCandidatePage[];
	parentCandidates: DerivedParentCandidate[];
	linkNeighborhoods: AggregationLinkNeighborhood[];
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const AGGREGATION_SYSTEM = `You are the **aggregation planner** for a compounding-memory wiki. A separate leaf planner has already decided which concrete entities to create or update from this batch of memories. Your job is the next layer up:

- reinforce hub/rollup sections on existing parent pages (e.g. the \`restaurants\` section on an \`Austin\` topic page)
- promote a section into its own topic page when it has become dense, coherent, and persistent enough to stand alone
- create a brand-new hub page when the scope clearly needs one (e.g. an \`Austin\` topic page exists for none of 8+ Austin-scoped entities)
- emit durable parent/child links so the hierarchy is navigable

You belong to exactly **one (tenant, agent) scope**. You only see pages from that scope. All references must be to pages already in the input OR to new hub pages you are creating in this same response.

## Page types

${describeAllPageTypes()}

Type describes shape, not scope. Hub pages are topics.

## What you MUST NOT do

- Do not create leaf entity pages. If a restaurant doesn't have a page yet, that's the leaf planner's job, not yours.
- Do not rewrite leaf sections (overview, notes, visits). Only touch hub/rollup sections.
- Do not promote a section whose \`aggregation.promotion_status\` is already \`"promoted"\`. Promotion is sticky.
- Do not invent page ids or slugs. Every reference must match the input.

## Rollup discipline — STRICT

You MUST ground every rollup in evidence visible in the input. Common failure mode: bucketing every restaurant under "Austin Restaurants" regardless of where each one actually is.

- **Only include a page in \`linked_page_slugs\` (or a hub's linked-entities list) when the page's own \`summary\` or \`title\` contains clear evidence it belongs in that hub.** A page titled "Momofuku Daishō" with summary "Korean-inspired restaurant in Toronto" does NOT belong in "Austin Restaurants". If the summary doesn't prove membership, leave the page out.
- **If fewer than 3 pages in the input clearly match a hub's scope, do not create or reinforce that hub this batch.** Under-rolling is safe; over-rolling pollutes the wiki.
- **Prefer \`Derived parent candidates\` as seed hubs** — those come from deterministic metadata extraction and are already grounded. If the derived-parents list is empty, be extra conservative about inventing hubs.
- **City / place-based hubs require matching place evidence** in each linked page's summary. When in doubt, leave the page out.
- **Each child page appears in at most ONE section per parent page.** If you're emitting multiple \`parentSectionUpdates\` for the same \`pageId\`, partition the children across sections (e.g. "Outdoor Attractions" vs "Events") — do not list the same entity under both. Overlap produces visible duplicates in the rendered body.

## Output actions

Return a JSON object with these arrays (all can be empty):

- **parentSectionUpdates** — refresh rollup sections on existing hub pages. Each update carries the new proposed body, the list of child page \`(type, slug)\`s it rolls up, observed tags, and the record ids that inform the rollup.
- **sectionPromotions** — promote a section into its own topic page. Include the new topic page's seed shape AND the summary + highlights to leave on the parent section. Only promote when the section is dense (many linked pages), coherent (shared tags/geography/topic), and persistent (spread over time, not a single-day burst).
- **newPages** — create a hub topic page from scratch when the scope needs one. Use sparingly: only when >=5 scope-active entities point to the same hub concept and no hub page exists.
- **pageLinks** — parent/child and reference relationships that should be durably recorded. Use \`kind: "parent_of"\` (parent→child) or \`kind: "child_of"\` (child→parent) when you promote a section or assign hierarchy. Use \`kind: "reference"\` otherwise.

Keep bodies factual and grounded. Do not speculate. Every section body in your output MUST include \`source_refs\`.

**Never write record ids, UUIDs, hex identifiers, or internal keys into body prose.** Provenance belongs in \`source_refs\` only. Phrases like "see records 1c907c71-..." or "id=abc-123" are forbidden in any \`body_md\` / \`proposed_body_md\` field.

**Do NOT use \`[[Title]]\` wikilink syntax in body prose.** Cross-page links go in \`pageLinks\` on the JSON root — the rendered wiki reads them from \`wiki_page_links\` and surfaces them separately. Bracket syntax inside body_md renders as literal noise.

Output ONLY valid JSON. No prose, no markdown fences.`;

const AGGREGATION_OUTPUT_SCHEMA = `{
  "parentSectionUpdates": [
    {
      "pageId": "<hub page id from input>",
      "sectionSlug": "<kebab-case section slug>",
      "heading": "<section heading>",
      "proposed_body_md": "<rollup markdown>",
      "rationale": "<one sentence: why this section changes now>",
      "linked_page_slugs": [{ "type": "entity|topic|decision", "slug": "<slug from input>" }],
      "source_refs": ["<record id that informs this rollup>"],
      "observed_tags": ["<optional tag strings observed across linked pages>"]
    }
  ],
  "sectionPromotions": [
    {
      "pageId": "<parent page id>",
      "sectionSlug": "<section being promoted>",
      "reason": "<one sentence: why this section is ready to stand alone>",
      "parentSummary": "<short paragraph to replace the parent section body>",
      "topHighlights": ["<bullet lines kept on the parent, 3-5 max>"],
      "newPage": {
        "type": "topic",
        "slug": "<kebab-case>",
        "title": "<display title>",
        "aliases": [],
        "summary": "<one-line page summary>",
        "source_refs": [],
        "sections": [
          { "slug": "<section slug>", "heading": "<heading>", "body_md": "<body>", "source_refs": ["<record id>"] }
        ]
      }
    }
  ],
  "newPages": [
    {
      "type": "topic",
      "slug": "<kebab-case>",
      "title": "<display title>",
      "summary": "<one-line>",
      "aliases": [],
      "source_refs": [],
      "sections": [
        { "slug": "<section slug>", "heading": "<heading>", "body_md": "<body>", "source_refs": ["<record id>"] }
      ]
    }
  ],
  "pageLinks": [
    { "fromType": "entity|topic|decision", "fromSlug": "<slug>", "toType": "entity|topic|decision", "toSlug": "<slug>", "context": "<why>" }
  ]
}`;

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------

export function buildAggregationUserPrompt(batch: AggregationBatch): string {
	const lines: string[] = [];

	lines.push("## Recently-changed pages in this scope\n");
	if (batch.recentlyChangedPages.length === 0) {
		lines.push("(none)");
	} else {
		for (const p of batch.recentlyChangedPages) {
			lines.push(
				`- id=${p.id} type=${p.type} slug=${p.slug} title=${JSON.stringify(p.title)}` +
					(p.parent_page_id ? ` parent_page_id=${p.parent_page_id}` : "") +
					` hubness=${p.hubness_score}` +
					(p.tags.length > 0 ? ` tags=${JSON.stringify(p.tags.slice(0, 8))}` : ""),
			);
			// Surface the page summary so the aggregation planner has real
			// evidence to judge membership. Without it the model sees only
			// slug+title and over-groups (e.g. putting every restaurant under
			// "Austin Restaurants" regardless of actual geography).
			if (p.summary) {
				lines.push(`    summary: ${truncate(p.summary, 300)}`);
			}
			for (const s of p.sections) {
				const agg = s.aggregation;
				const aggStr = agg
					? ` linked=${agg.linked_page_ids.length} records=${agg.supporting_record_count} score=${agg.promotion_score} status=${agg.promotion_status}`
					: "";
				lines.push(
					`  · section=${s.section_slug}${aggStr} body_chars=${s.body_md.length}`,
				);
			}
		}
	}

	lines.push("\n## Derived parent candidates (deterministic metadata expansion)\n");
	if (batch.parentCandidates.length === 0) {
		lines.push("(none)");
	} else {
		for (const c of batch.parentCandidates) {
			lines.push(
				`- reason=${c.reason} parent=${JSON.stringify(c.parentTitle)} slug=${c.parentSlug} section=${c.suggestedSectionSlug} supporting=${c.supportingCount} tags=${JSON.stringify(c.observedTags.slice(0, 6))}`,
			);
		}
	}

	lines.push("\n## Link neighborhoods\n");
	if (batch.linkNeighborhoods.length === 0) {
		lines.push("(none)");
	} else {
		for (const n of batch.linkNeighborhoods.slice(0, 30)) {
			lines.push(
				`- pageId=${n.pageId} inbound=${n.inboundCount}`,
			);
		}
	}

	lines.push("\n## Required output JSON shape\n");
	lines.push("```");
	lines.push(AGGREGATION_OUTPUT_SCHEMA);
	lines.push("```");
	lines.push(
		"\nReturn ONLY the JSON object. Include empty arrays for categories that don't apply.",
	);

	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Call Claude with the aggregation prompt and parse the response into a
 * PlannerResult. Fields the leaf planner cares about (pageUpdates,
 * unresolvedMentions, promotions) are forced to [] so the compiler's
 * existing apply loop doesn't over-reach.
 */
export async function runAggregationPlanner(
	batch: AggregationBatch,
	opts: { signal?: AbortSignal; modelId?: string } = {},
): Promise<PlannerResult> {
	const user = buildAggregationUserPrompt(batch);
	const resp = await invokeClaudeJson<Record<string, unknown>>({
		system: AGGREGATION_SYSTEM,
		user,
		// Aggregation output tends to be smaller than the leaf planner's, but
		// section promotions carry a full newPage seed — leave comfortable
		// headroom.
		maxTokens: 16000,
		temperature: 0,
		modelId: opts.modelId,
		signal: opts.signal,
	});

	const parsed = resp.parsed;
	// Force leaf-only fields to [] before validation — the aggregation planner
	// is banned from emitting them.
	parsed.pageUpdates = [];
	parsed.unresolvedMentions = [];
	parsed.promotions = [];
	if (!Array.isArray(parsed.pageLinks)) parsed.pageLinks = [];
	if (!Array.isArray(parsed.newPages)) parsed.newPages = [];
	validatePlannerResult(parsed);
	return {
		...(parsed as unknown as PlannerResult),
		usage: {
			inputTokens: resp.inputTokens,
			outputTokens: resp.outputTokens,
			bedrockRetries: resp.retries,
		},
	};
}

function truncate(s: string, n: number): string {
	return s.length <= n ? s : `${s.slice(0, n)}…`;
}

// Test-only exports.
export const _test = { AGGREGATION_SYSTEM, AGGREGATION_OUTPUT_SCHEMA };
