/**
 * Draft compile — agentic page rewrite for Brain-page enrichment review.
 *
 * Sibling to `runCompileJob` (compiler.ts). Different inputs and contract:
 *   - inputs: a target page (current body_md) + a list of synthesized
 *     candidate facts (Brain / Knowledge base / Web), already de-noised by
 *     upstream candidate synthesis but NOT deduped against the page body.
 *   - output: a structured proposed body + per-section change regions, where
 *     each region carries the contributing source family + citation so the
 *     review surface can show provenance.
 *
 * Why a sibling, not a flag on `runCompileJob`:
 *   - The default compile is cluster-driven over `memory_units`; this is
 *     candidate-driven over an explicit page.
 *   - Sharing a prompt would force false coupling. The job ledger
 *     (`wiki_compile_jobs`) and Lambda handler shell are reused — the
 *     prompt + contract are not.
 *
 * U1 ships this module **inert** — the wiki-compile handler dispatches to it
 * by trigger, but no caller enqueues `enrichment_draft` jobs in production
 * yet. U6 (origin plan) wires the producer; U5 wires the completion writeback.
 *
 * The Bedrock invocation is reachable via an injectable seam so unit tests
 * can exercise the full structural pipeline without a network call.
 */

import { invokeClaudeWithRetry } from "./bedrock.js";
import { slugifyTitle } from "./aliases.js";
import {
	completeCompileJob,
	getCompileJob,
	type WikiCompileJobRow,
} from "./repository.js";
import {
	writeDraftReviewFailure,
	writeDraftReviewNoOp,
	writeDraftReviewSuccess,
	type DraftWritebackContext,
	type DraftWritebackIO,
	type DraftWritebackResult,
} from "../brain/draft-review-writeback.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DraftCompileSourceFamily = "BRAIN" | "KNOWLEDGE_BASE" | "WEB";

export type DraftCompileRegionFamily = DraftCompileSourceFamily | "MIXED";

export type DraftCompilePageTable = "wiki_pages" | "tenant_entity_pages";

export interface DraftCompileCitation {
	uri?: string | null;
	label?: string | null;
}

export interface DraftCompileCandidate {
	id: string;
	title: string;
	summary: string;
	sourceFamily: DraftCompileSourceFamily;
	providerId?: string;
	citation?: DraftCompileCitation | null;
}

export interface DraftCompileInput {
	pageId: string;
	pageTable: DraftCompilePageTable;
	pageTitle: string;
	currentBodyMd: string;
	candidates: DraftCompileCandidate[];
}

/**
 * One section-grain region in the proposed body that the review surface can
 * accept or reject. `beforeMd` is the section content from the snapshot
 * (`currentBodyMd` at draft creation); `afterMd` is the section content from
 * the proposed body. For brand-new sections, `beforeMd` is empty. For removed
 * sections, `afterMd` is empty.
 */
export interface DraftCompileRegion {
	id: string;
	sectionSlug: string;
	sectionHeading: string;
	sourceFamily: DraftCompileRegionFamily;
	citation: DraftCompileCitation | null;
	beforeMd: string;
	afterMd: string;
	contributingCandidateIds: string[];
}

export interface DraftCompileResult {
	proposedBodyMd: string;
	snapshotMd: string;
	regions: DraftCompileRegion[];
	modelId: string;
	inputTokens: number;
	outputTokens: number;
}

/**
 * Bedrock seam — exists so unit tests can inject a deterministic responder
 * without touching the network. Production callers leave it unset; the module
 * falls through to `invokeClaudeWithRetry`.
 */
export interface DraftCompileSeam {
	invokeModel: (args: {
		system: string;
		user: string;
		modelId?: string;
		signal?: AbortSignal;
	}) => Promise<{
		text: string;
		inputTokens: number;
		outputTokens: number;
		modelId: string;
	}>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const DRAFT_COMPILE_SYSTEM = `You refine a single Brain wiki page by integrating new candidate facts.

You receive: the page's current markdown body and a list of candidate facts that may add information. Your job:

1. Decide which candidate facts add real information not already substantively present in the body. Discard ones that are already covered.
2. Produce a refined version of the page that integrates the kept facts in the right sections.
3. Output the page as a JSON list of sections, each tagged with which candidate ids (if any) contributed to its content.

## Strict output format

Return ONLY valid JSON matching this schema — no preamble, no markdown fences, no commentary:

{
  "sections": [
    {
      "slug": "<stable section slug>",
      "heading": "<H2 heading text>",
      "afterMd": "<section body markdown — do NOT include the heading line>",
      "contributingCandidateIds": ["<candidate id>", ...],
      "sourceFamily": "BRAIN" | "KNOWLEDGE_BASE" | "WEB" | "MIXED" | null,
      "citation": { "uri": "<url>", "label": "<label>" } | null
    }
  ]
}

## Discipline

- Preserve sections from the existing body when they're correct, even if no candidate touched them — emit them with empty contributingCandidateIds.
- Do NOT invent facts not in the candidates or the existing body.
- Do NOT include scraped page chrome ("# back", "Sign in to", "Subscribe to", filter strings) in section bodies — paraphrase to clean prose.
- Do NOT include record ids, UUIDs, or hex identifiers in section bodies.
- Do NOT use [[wikilink]] bracket syntax. Plain prose only.
- If a candidate's fact is already substantively in the existing body, omit it — its information is already there.
- Section ordering should match the existing body's order; new sections go at the end unless a candidate clearly belongs in an existing section.
- Slugs must be stable: reuse existing section slugs verbatim. New sections get slugs derived from the heading (lowercase kebab).

If the page already covers all candidate facts, return the existing sections verbatim with empty contributingCandidateIds — DO NOT invent change.`;

/**
 * Run the draft compile against an injected (or default) Bedrock seam.
 *
 * Production callers (U5 completion writeback) pass no seam; tests pass a
 * fake seam returning a deterministic JSON payload.
 */
export async function runDraftCompile(
	input: DraftCompileInput,
	seam?: DraftCompileSeam,
): Promise<DraftCompileResult> {
	const snapshotMd = input.currentBodyMd;
	const existingSections = parseSections(snapshotMd);

	const userPrompt = buildUserPrompt({
		pageTitle: input.pageTitle,
		existingSections,
		candidates: input.candidates,
	});

	const invoke = seam?.invokeModel ?? defaultInvokeModel;
	const resp = await invoke({
		system: DRAFT_COMPILE_SYSTEM,
		user: userPrompt,
	});

	const parsed = parseModelResponse(resp.text);

	const proposedBodyMd = composeBodyFromSections(parsed.sections);
	const regions = computeRegions({
		existingSections,
		proposedSections: parsed.sections,
		candidates: input.candidates,
	});

	return {
		proposedBodyMd,
		snapshotMd,
		regions,
		modelId: resp.modelId,
		inputTokens: resp.inputTokens,
		outputTokens: resp.outputTokens,
	};
}

// ---------------------------------------------------------------------------
// Section parsing / composition
// ---------------------------------------------------------------------------

export interface ParsedSection {
	slug: string;
	heading: string;
	bodyMd: string;
}

/**
 * Parse a markdown body into H2-bounded sections. Content before the first
 * H2 (page preamble) is exposed as a synthetic section with slug `_preamble`
 * when present; if the body is empty the result is an empty array.
 *
 * H2 headings only — H1/H3+ stay inside their parent section's bodyMd.
 */
export function parseSections(bodyMd: string): ParsedSection[] {
	const trimmed = bodyMd.trimEnd();
	if (!trimmed) return [];

	const lines = trimmed.split("\n");
	const sections: ParsedSection[] = [];
	let preambleLines: string[] = [];
	let current: { heading: string; slug: string; lines: string[] } | null = null;

	const pushCurrent = () => {
		if (current) {
			sections.push({
				slug: current.slug,
				heading: current.heading,
				bodyMd: current.lines.join("\n").trim(),
			});
		}
	};

	for (const line of lines) {
		const h2Match = /^##\s+(.+?)\s*$/.exec(line);
		if (h2Match) {
			pushCurrent();
			const heading = h2Match[1]!.trim();
			current = {
				heading,
				slug: slugifyTitle(heading) || "section",
				lines: [],
			};
			continue;
		}
		if (current) {
			current.lines.push(line);
		} else {
			preambleLines.push(line);
		}
	}
	pushCurrent();

	const preamble = preambleLines.join("\n").trim();
	if (preamble) {
		sections.unshift({
			slug: "_preamble",
			heading: "",
			bodyMd: preamble,
		});
	}

	return sections;
}

/**
 * Recompose a markdown body from sections. The synthetic `_preamble` section
 * (heading === "") emits its body without an H2 header. All other sections
 * emit `## <heading>\n\n<body>`.
 */
export function composeBodyFromSections(
	sections: Array<{ slug: string; heading: string; afterMd?: string; bodyMd?: string }>,
): string {
	const parts: string[] = [];
	for (const section of sections) {
		const body = (section.afterMd ?? section.bodyMd ?? "").trim();
		if (!section.heading || section.slug === "_preamble") {
			if (body) parts.push(body);
			continue;
		}
		parts.push(`## ${section.heading}\n\n${body}`.trimEnd());
	}
	return parts.join("\n\n").trim();
}

// ---------------------------------------------------------------------------
// Region computation
// ---------------------------------------------------------------------------

interface ParsedModelSection {
	slug: string;
	heading: string;
	afterMd: string;
	contributingCandidateIds: string[];
	sourceFamily: DraftCompileRegionFamily | null;
	citation: DraftCompileCitation | null;
}

interface ComputeRegionsArgs {
	existingSections: ParsedSection[];
	proposedSections: ParsedModelSection[];
	candidates: DraftCompileCandidate[];
}

function computeRegions(args: ComputeRegionsArgs): DraftCompileRegion[] {
	const candidateById = new Map(args.candidates.map((c) => [c.id, c]));
	const existingBySlug = new Map(
		args.existingSections.map((s) => [s.slug, s]),
	);
	const proposedSlugs = new Set(args.proposedSections.map((s) => s.slug));

	const regions: DraftCompileRegion[] = [];

	for (const proposed of args.proposedSections) {
		const existing = existingBySlug.get(proposed.slug);
		const beforeMd = existing?.bodyMd ?? "";
		const afterMd = proposed.afterMd.trim();

		const contributorsTouched = proposed.contributingCandidateIds.length > 0;
		const textChanged = normalizeForCompare(beforeMd) !== normalizeForCompare(afterMd);

		if (!contributorsTouched && !textChanged) continue;

		const sourceFamily = resolveSourceFamily({
			declared: proposed.sourceFamily,
			candidateIds: proposed.contributingCandidateIds,
			candidateById,
		});

		const citation = resolveCitation({
			declared: proposed.citation,
			candidateIds: proposed.contributingCandidateIds,
			candidateById,
		});

		regions.push({
			id: `region-${proposed.slug}`,
			sectionSlug: proposed.slug,
			sectionHeading: proposed.heading,
			sourceFamily,
			citation,
			beforeMd,
			afterMd,
			contributingCandidateIds: proposed.contributingCandidateIds.slice(),
		});
	}

	// Removed sections (existed in snapshot, dropped from proposed) become
	// regions whose afterMd is empty, so the review surface can show "this
	// section will be removed if you accept."
	//
	// Skip `_preamble` — it's a synthetic slug for prose before the first H2,
	// and the merge path can't safely re-insert it at the end of the document
	// without an H2 header (composeBodyFromSections only treats preamble as
	// header-less when it appears first in the section list). If the model
	// wants to preserve or update preamble it can emit a section with slug
	// `_preamble`; otherwise we accept the model's drop silently.
	for (const existing of args.existingSections) {
		if (proposedSlugs.has(existing.slug)) continue;
		if (existing.slug === "_preamble") continue;
		regions.push({
			id: `region-${existing.slug}`,
			sectionSlug: existing.slug,
			sectionHeading: existing.heading,
			sourceFamily: "BRAIN",
			citation: null,
			beforeMd: existing.bodyMd,
			afterMd: "",
			contributingCandidateIds: [],
		});
	}

	return regions;
}

function resolveSourceFamily(args: {
	declared: DraftCompileRegionFamily | null;
	candidateIds: string[];
	candidateById: Map<string, DraftCompileCandidate>;
}): DraftCompileRegionFamily {
	if (args.declared) return args.declared;
	const families = new Set<DraftCompileSourceFamily>();
	for (const id of args.candidateIds) {
		const c = args.candidateById.get(id);
		if (c) families.add(c.sourceFamily);
	}
	if (families.size === 0) return "BRAIN";
	if (families.size > 1) return "MIXED";
	return [...families][0]!;
}

function resolveCitation(args: {
	declared: DraftCompileCitation | null;
	candidateIds: string[];
	candidateById: Map<string, DraftCompileCandidate>;
}): DraftCompileCitation | null {
	if (args.declared) return args.declared;
	for (const id of args.candidateIds) {
		const c = args.candidateById.get(id);
		if (c?.citation?.uri || c?.citation?.label) {
			return {
				uri: c.citation.uri ?? null,
				label: c.citation.label ?? null,
			};
		}
	}
	return null;
}

// ---------------------------------------------------------------------------
// Model response parsing
// ---------------------------------------------------------------------------

interface ParsedModelResponse {
	sections: ParsedModelSection[];
}

/**
 * Strict JSON parser for the model response. Rejects malformed payloads with
 * a clear error so the dispatcher can mark the job failed rather than
 * silently producing a broken draft.
 */
export function parseModelResponse(text: string): ParsedModelResponse {
	const cleaned = stripFences(text.trim());
	let raw: unknown;
	try {
		raw = JSON.parse(cleaned);
	} catch (err) {
		throw new Error(
			`draft-compile: model response is not valid JSON: ${(err as Error).message}`,
		);
	}
	if (!raw || typeof raw !== "object" || !Array.isArray((raw as { sections?: unknown }).sections)) {
		throw new Error("draft-compile: model response missing `sections` array");
	}

	const sections: ParsedModelSection[] = [];
	const seenSlugs = new Set<string>();
	for (const item of (raw as { sections: unknown[] }).sections) {
		if (!item || typeof item !== "object") continue;
		const obj = item as Record<string, unknown>;
		const slug = typeof obj.slug === "string" ? obj.slug.trim() : "";
		const heading = typeof obj.heading === "string" ? obj.heading.trim() : "";
		const afterMd = typeof obj.afterMd === "string" ? obj.afterMd : "";
		if (!slug || !heading) {
			throw new Error("draft-compile: section missing slug or heading");
		}
		// Reject duplicate slugs. The accept/reject envelope keys regions on
		// `region-<slug>`; collapsing two sections under one id would make the
		// user's per-region decision ambiguous and silently drop one section.
		if (seenSlugs.has(slug)) {
			throw new Error(
				`draft-compile: duplicate section slug '${slug}' in model output`,
			);
		}
		seenSlugs.add(slug);
		const ids = Array.isArray(obj.contributingCandidateIds)
			? obj.contributingCandidateIds.filter((v): v is string => typeof v === "string")
			: [];
		const sourceFamily = parseSourceFamily(obj.sourceFamily);
		const citation = parseCitation(obj.citation);
		sections.push({
			slug,
			heading,
			afterMd,
			contributingCandidateIds: ids,
			sourceFamily,
			citation,
		});
	}
	return { sections };
}

function parseSourceFamily(v: unknown): DraftCompileRegionFamily | null {
	if (v === "BRAIN" || v === "KNOWLEDGE_BASE" || v === "WEB" || v === "MIXED") {
		return v;
	}
	return null;
}

function parseCitation(v: unknown): DraftCompileCitation | null {
	if (!v || typeof v !== "object") return null;
	const obj = v as Record<string, unknown>;
	const uri = typeof obj.uri === "string" ? obj.uri : null;
	const label = typeof obj.label === "string" ? obj.label : null;
	if (!uri && !label) return null;
	return { uri, label };
}

function stripFences(text: string): string {
	if (text.startsWith("```")) {
		const firstNewline = text.indexOf("\n");
		if (firstNewline >= 0) {
			const inner = text.slice(firstNewline + 1);
			const closing = inner.lastIndexOf("```");
			if (closing >= 0) return inner.slice(0, closing).trim();
		}
	}
	return text;
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

function buildUserPrompt(args: {
	pageTitle: string;
	existingSections: ParsedSection[];
	candidates: DraftCompileCandidate[];
}): string {
	const existingBlock = args.existingSections.length === 0
		? "_(empty page — no existing sections)_"
		: args.existingSections
			.map(
				(s) =>
					s.slug === "_preamble"
						? `### Preamble (slug: _preamble)\n\n${s.bodyMd}`
						: `### ${s.heading} (slug: ${s.slug})\n\n${s.bodyMd}`,
			)
			.join("\n\n");

	const candidatesBlock = args.candidates.length === 0
		? "_(no candidates — return existing sections verbatim)_"
		: args.candidates
			.map((c) => {
				const cite = c.citation?.uri || c.citation?.label
					? `\n  citation: ${c.citation.label ?? ""} ${c.citation.uri ? `<${c.citation.uri}>` : ""}`
					: "";
				return `- id: ${c.id}\n  source: ${c.sourceFamily}${cite}\n  title: ${c.title}\n  summary: ${c.summary}`;
			})
			.join("\n");

	return [
		`Page: ${args.pageTitle}`,
		"",
		"## Existing sections",
		existingBlock,
		"",
		"## Candidate facts",
		candidatesBlock,
		"",
		"Return JSON per the system instructions.",
	].join("\n");
}

// ---------------------------------------------------------------------------
// Default Bedrock invocation
// ---------------------------------------------------------------------------

async function defaultInvokeModel(args: {
	system: string;
	user: string;
	modelId?: string;
	signal?: AbortSignal;
}): Promise<{
	text: string;
	inputTokens: number;
	outputTokens: number;
	modelId: string;
}> {
	const resp = await invokeClaudeWithRetry({
		system: args.system,
		user: args.user,
		maxTokens: 4096,
		temperature: 0,
		modelId: args.modelId,
		signal: args.signal,
	});
	return {
		text: resp.text,
		inputTokens: resp.inputTokens,
		outputTokens: resp.outputTokens,
		modelId: resp.modelId,
	};
}

// ---------------------------------------------------------------------------
// Job runner
// ---------------------------------------------------------------------------

export interface DraftCompileJobResult {
	ok: boolean;
	jobId: string;
	status: "succeeded" | "failed";
	result?: DraftCompileResult;
	writeback?: DraftWritebackResult;
	error?: string;
}

export interface DraftCompileRunOpts {
	modelId?: string;
	seam?: DraftCompileSeam;
	writebackIo?: DraftWritebackIO;
}

/**
 * Validate-and-shape a `wiki_compile_jobs.input` jsonb into the strict
 * DraftCompileInput shape. Throws when the payload is missing required fields,
 * which the runner treats as a job failure.
 */
export function parseDraftCompileInput(raw: unknown): DraftCompileInput {
	if (!raw || typeof raw !== "object") {
		throw new Error("draft-compile: job.input is missing or not an object");
	}
	const obj = raw as Record<string, unknown>;
	const pageId = typeof obj.pageId === "string" ? obj.pageId : "";
	const pageTable =
		obj.pageTable === "wiki_pages" || obj.pageTable === "tenant_entity_pages"
			? obj.pageTable
			: "";
	const pageTitle = typeof obj.pageTitle === "string" ? obj.pageTitle : "";
	const currentBodyMd =
		typeof obj.currentBodyMd === "string" ? obj.currentBodyMd : "";
	const candidatesRaw = Array.isArray(obj.candidates) ? obj.candidates : null;
	if (!pageId || !pageTable || !pageTitle || !candidatesRaw) {
		throw new Error(
			"draft-compile: job.input must include pageId, pageTable, pageTitle, candidates",
		);
	}
	const candidates: DraftCompileCandidate[] = [];
	for (const c of candidatesRaw) {
		if (!c || typeof c !== "object") continue;
		const co = c as Record<string, unknown>;
		const id = typeof co.id === "string" ? co.id : "";
		const title = typeof co.title === "string" ? co.title : "";
		const summary = typeof co.summary === "string" ? co.summary : "";
		const sourceFamily =
			co.sourceFamily === "BRAIN" ||
			co.sourceFamily === "KNOWLEDGE_BASE" ||
			co.sourceFamily === "WEB"
				? co.sourceFamily
				: null;
		if (!id || !sourceFamily) continue;
		candidates.push({
			id,
			title,
			summary,
			sourceFamily,
			providerId: typeof co.providerId === "string" ? co.providerId : undefined,
			citation: parseCitation(co.citation),
		});
	}
	return {
		pageId,
		pageTable,
		pageTitle,
		currentBodyMd,
		candidates,
	};
}

/**
 * Run a draft-compile job claimed from `wiki_compile_jobs`. As of U5, this
 * also dispatches the user-facing writeback (thread, workspace_run,
 * workspace_events, messages) before marking the job complete. The writeback
 * runs BEFORE `completeCompileJob` so a writeback failure surfaces as a
 * job-level failure that the reconciler can retry — otherwise we'd ship a
 * "succeeded" job ledger row whose user-visible artifacts never landed.
 */
export async function runDraftCompileJob(
	job: WikiCompileJobRow,
	opts: DraftCompileRunOpts = {},
): Promise<DraftCompileJobResult> {
	let parsedInput: DraftCompileInput | null = null;
	try {
		parsedInput = parseDraftCompileInput(job.input);
		const ctx: DraftWritebackContext = {
			job,
			pageTable: parsedInput.pageTable,
			pageId: parsedInput.pageId,
			pageTitle: parsedInput.pageTitle,
			candidates: parsedInput.candidates,
		};
		const result = await runDraftCompile(parsedInput, opts.seam);

		const writeback =
			result.regions.length === 0
				? await writeDraftReviewNoOp({ context: ctx, io: opts.writebackIo })
				: await writeDraftReviewSuccess({
						context: ctx,
						result,
						io: opts.writebackIo,
					});

		await completeCompileJob({
			jobId: job.id,
			status: "succeeded",
			metrics: {
				model_id: result.modelId,
				input_tokens: result.inputTokens,
				output_tokens: result.outputTokens,
				regions_count: result.regions.length,
				proposed_body_chars: result.proposedBodyMd.length,
				snapshot_chars: result.snapshotMd.length,
				writeback_thread_id: writeback.threadId,
				writeback_run_id: writeback.workspaceRunId,
			},
		});
		return { ok: true, jobId: job.id, status: "succeeded", result, writeback };
	} catch (err) {
		const msg = (err as Error)?.message || String(err);
		// Best-effort: surface failure in a thread so the user knows the run
		// happened. If we couldn't even parse the input, there's no thread
		// context to write — skip writeback and just mark the job failed.
		let writeback: DraftWritebackResult | undefined;
		if (parsedInput) {
			const ctx: DraftWritebackContext = {
				job,
				pageTable: parsedInput.pageTable,
				pageId: parsedInput.pageId,
				pageTitle: parsedInput.pageTitle,
				candidates: parsedInput.candidates,
			};
			try {
				writeback = await writeDraftReviewFailure({
					context: ctx,
					error: msg,
					io: opts.writebackIo,
				});
			} catch (wbErr) {
				console.warn(
					`[draft-compile] failure-path writeback errored: ${(wbErr as Error)?.message ?? wbErr}`,
				);
			}
		}
		await completeCompileJob({
			jobId: job.id,
			status: "failed",
			error: msg,
		});
		return {
			ok: false,
			jobId: job.id,
			status: "failed",
			error: msg,
			...(writeback ? { writeback } : {}),
		};
	}
}

/**
 * Convenience entry for the wiki-compile handler when invoked with a specific
 * jobId for an enrichment-draft job. Loads the row, then runs.
 */
export async function runDraftCompileJobById(
	jobId: string,
	opts: DraftCompileRunOpts = {},
): Promise<DraftCompileJobResult | null> {
	const job = await getCompileJob(jobId);
	if (!job) return null;
	if (job.trigger !== "enrichment_draft") {
		throw new Error(
			`runDraftCompileJobById: job ${jobId} has trigger=${job.trigger}, expected enrichment_draft`,
		);
	}
	// Terminal-state short-circuits. `failed` must short-circuit too — without
	// this guard, retrying the handler against an already-failed job would
	// re-run the agentic compile and double-complete the row.
	if (job.status === "succeeded" || job.status === "skipped") {
		return { ok: true, jobId: job.id, status: "succeeded" };
	}
	if (job.status === "failed") {
		return {
			ok: false,
			jobId: job.id,
			status: "failed",
			error: job.error ?? "previous attempt failed",
		};
	}
	return runDraftCompileJob(job, opts);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeForCompare(s: string): string {
	return s.trim().replace(/\s+/g, " ");
}
