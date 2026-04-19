/**
 * Section writer — refines a single section body_md using Bedrock.
 *
 * Called by the compiler only for sections where the planner's proposed body
 * differs materially from the existing stored body (see `isMeaningfulChange`).
 * The model's job is narrow: take the planner's draft plus the existing body
 * and the page's overall section semantics, and produce the final body_md for
 * that one section. It is forbidden from rewriting other sections or changing
 * the section's slug/heading — the compiler enforces that by only applying
 * the returned body.
 *
 * v1 uses Haiku 4.5. Output is plain markdown (no JSON).
 */

import type { ThinkWorkMemoryRecord } from "../memory/types.js";
import { invokeClaude } from "./bedrock.js";
import { getTemplate } from "./templates.js";
import type { WikiPageType } from "./repository.js";

export interface SectionWriteArgs {
	pageType: WikiPageType;
	pageTitle: string;
	sectionSlug: string;
	sectionHeading: string;
	existingBodyMd: string | null;
	proposedBodyMd: string;
	/**
	 * Records the planner said informed this update. The writer uses them to
	 * ground the final body — not to invent new claims, just to prefer concrete
	 * quotes over rewrites that drift. Source record ids are intentionally NOT
	 * shown to the writer; it tends to splice them into prose.
	 */
	sourceRecords: ThinkWorkMemoryRecord[];
	/**
	 * Titles of other pages in the same (tenant, owner) scope. The writer is
	 * instructed to wrap matching names in `[[Title]]` so the rendered wiki
	 * can hyperlink. Pass at most ~50; the prompt truncates anyway.
	 */
	knownPageTitles?: string[];
	modelId?: string;
	signal?: AbortSignal;
}

export interface SectionWriteResult {
	body_md: string;
	inputTokens: number;
	outputTokens: number;
	modelId: string;
}

const SECTION_WRITER_SYSTEM = `You are rewriting a single section of a compounding-memory wiki page.

Your only output is the final markdown body for the named section. Do not return JSON, do not include the section heading, do not rewrite other sections. No preamble, no closing prose — just the body.

## Discipline

- Stay grounded in the cited source records. Do not invent facts.
- Preserve specific details (names, dates, places) from the existing body when they're still correct.
- Prefer short prose over bullet spam. Use bullets when the content is genuinely list-like.
- If the existing body is meaningfully correct and the new evidence only reinforces it, return the existing body (possibly with small factual updates).
- Never speculate, moralize, or summarize the user's emotions beyond what the records show.

## Formatting rules (strict)

- **Never write record ids, UUIDs, or hex identifiers into the prose.** Phrases like "see records 1c907c71-c17c-...", "(record id abc-123)", or any dump of Hindsight unit ids are forbidden. Provenance is stored separately — the body is for human-readable content only.
- **Do NOT use \`[[Title]]\` wikilink syntax anywhere in the body.** Write entity names as plain prose. Cross-page links are rendered separately from \`wiki_page_links\`; bracket syntax in the body renders as literal noise on mobile.
- Do not inline-cite with "(see record …)" or similar parenthetical references — those belong in \`source_refs\`, not the body.`;

/**
 * Quick heuristic: is the planner's proposed body different enough from the
 * existing body to justify a Bedrock call?
 *
 * Returns false when the two are effectively identical after trimming and
 * whitespace collapsing — a cheap way to short-circuit a few thousand cases.
 */
export function isMeaningfulChange(
	existing: string | null,
	proposed: string,
): boolean {
	const a = normalizeForCompare(existing ?? "");
	const b = normalizeForCompare(proposed);
	if (a === b) return false;
	if (a.length === 0 && b.length > 0) return true;
	if (b.length === 0) return false;
	// If they differ by < 5% of chars, treat as noise. Use a rough ratio.
	const delta = editDistanceLB(a, b);
	const scale = Math.max(a.length, b.length);
	return delta / scale > 0.05;
}

export async function writeSection(
	args: SectionWriteArgs,
): Promise<SectionWriteResult> {
	const template = getTemplate(args.pageType);
	const sectionTemplate = template.sections.find(
		(s) => s.slug === args.sectionSlug,
	);
	const sectionPrompt =
		sectionTemplate?.prompt ??
		"A named section on the page; respect its existing role.";

	const user = [
		`Page: ${args.pageTitle}  (type: ${args.pageType})`,
		`Section: ${args.sectionHeading}  (slug: ${args.sectionSlug})`,
		`Section purpose: ${sectionPrompt}`,
		"",
		"## Existing body",
		args.existingBodyMd?.trim() || "_(empty — this is a new section)_",
		"",
		"## Planner's proposed body",
		args.proposedBodyMd.trim(),
		"",
		"## Source records (grounding only — do NOT cite ids in the body)",
		args.sourceRecords.length === 0
			? "(none explicitly cited — stay close to the planner's draft)"
			: args.sourceRecords
					.map((r) => `- ${truncate(r.content.text, 400)}`)
					.join("\n"),
		"",
		"Return only the final markdown body for this one section. Do not include the heading line. Use plain prose — no [[wikilink]] brackets.",
	].join("\n");

	const resp = await invokeClaude({
		system: SECTION_WRITER_SYSTEM,
		user,
		maxTokens: 2048,
		temperature: 0,
		modelId: args.modelId,
		signal: args.signal,
	});
	return {
		body_md: resp.text.trim(),
		inputTokens: resp.inputTokens,
		outputTokens: resp.outputTokens,
		modelId: resp.modelId,
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeForCompare(s: string): string {
	return s.trim().replace(/\s+/g, " ");
}

/**
 * Lower-bound edit distance via length difference + matching-prefix/suffix
 * heuristic — fast and accurate enough for a 5% noise filter. Avoids pulling
 * a full Levenshtein implementation just to decide whether to skip a call.
 */
function editDistanceLB(a: string, b: string): number {
	const lenDiff = Math.abs(a.length - b.length);
	if (a === b) return 0;

	let commonPrefix = 0;
	const minLen = Math.min(a.length, b.length);
	while (commonPrefix < minLen && a[commonPrefix] === b[commonPrefix]) {
		commonPrefix++;
	}
	let commonSuffix = 0;
	while (
		commonSuffix < minLen - commonPrefix &&
		a[a.length - 1 - commonSuffix] === b[b.length - 1 - commonSuffix]
	) {
		commonSuffix++;
	}

	const aCore = a.length - commonPrefix - commonSuffix;
	const bCore = b.length - commonPrefix - commonSuffix;
	return Math.max(aCore, bCore, lenDiff);
}

function truncate(s: string, n: number): string {
	return s.length <= n ? s : `${s.slice(0, n)}…`;
}
