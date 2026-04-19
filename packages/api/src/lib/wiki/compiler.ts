/**
 * Compiler orchestration — the engine that turns normalized memory records
 * into compiled wiki pages.
 *
 * One job runs for exactly one (tenant, owner) scope. Reads are bounded
 * (cursor paginated), writes are gated (caps on new pages, rewrites, and
 * token budget). Cursor advances only after a successful apply so a mid-job
 * failure is safe to re-run.
 *
 * See .prds/compounding-memory-v1-build-plan.md PR 3 for the step-by-step
 * specification this module implements.
 */

import type { MemoryAdapter } from "../memory/adapter.js";
import type { ThinkWorkMemoryRecord } from "../memory/types.js";
import { getMemoryServices } from "../memory/index.js";
import {
	completeCompileJob,
	emptySectionAggregation,
	findPageById,
	findPageBySlug,
	getCompileJob,
	getCursor,
	listOpenMentions,
	listPageSections,
	listPagesForScope,
	listRecentlyChangedPagesForAggregation,
	markUnresolvedPromoted,
	mergeSectionAggregation,
	recomputeHubness,
	setCursor,
	setParentPage,
	upsertPage,
	upsertPageLink,
	upsertSectionAggregation,
	upsertUnresolvedMention,
	normalizeAlias,
	type SectionAggregation,
	type WikiCompileJobRow,
	type WikiPageRow,
} from "./repository.js";
import { runPlanner, type PlannerResult } from "./planner.js";
import {
	isMeaningfulChange,
	writeSection,
	type SectionWriteResult,
} from "./section-writer.js";
import { slugifyTitle, seedAliasesForTitle } from "./aliases.js";
import {
	deriveParentCandidates,
	deriveParentCandidatesFromPageSummaries,
	mergeParentCandidates,
	type DerivedParentCandidate,
} from "./parent-expander.js";
import {
	runAggregationPlanner,
	type AggregationCandidatePage,
} from "./aggregation-planner.js";
import { scoreSectionAggregation } from "./promotion-scorer.js";
import { db as defaultDb } from "../db.js";
import { wikiPageSections, wikiPageLinks } from "@thinkwork/database-pg/schema";
import { and, eq, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Budgets / caps (from build plan PR 3 "Guardrails")
// ---------------------------------------------------------------------------

const RECORD_PAGE_SIZE = 50;
const MAX_RECORDS_PER_JOB = 500;
const MAX_NEW_PAGES_PER_JOB = 25;
const MAX_SECTIONS_REWRITTEN_PER_JOB = 100;

// Rough cost numbers for metrics only — not billing. Claude Haiku 4.5 pricing
// (subject to change); update if the model is swapped.
const HAIKU_INPUT_USD_PER_MTOKEN = 1.0;
const HAIKU_OUTPUT_USD_PER_MTOKEN = 5.0;

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

export interface RunJobResult {
	jobId: string;
	status: "succeeded" | "failed";
	metrics: {
		records_read: number;
		pages_upserted: number;
		sections_rewritten: number;
		sections_skipped: number;
		unresolved_upserted: number;
		unresolved_promoted: number;
		links_upserted?: number;
		planner_calls: number;
		section_writer_calls: number;
		input_tokens: number;
		output_tokens: number;
		cost_usd: number;
		latency_ms: number;
		cap_hit?: string;
		// --- Hierarchical-aggregation metrics (PR B) --------------------
		parent_sections_updated?: number;
		sections_promoted?: number;
		deterministic_parents_derived?: number;
		aggregation_planner_calls?: number;
		aggregation_input_tokens?: number;
		aggregation_output_tokens?: number;
		/** Set when the aggregation pass errored; leaf work still succeeded. */
		aggregation_error?: string;
	};
	error?: string;
}

/**
 * Feature flag for the aggregation pass. Defaults to false so it's opt-in
 * per deploy. Accepts 'true' / '1' / 'yes' (case-insensitive).
 */
export function isAggregationPassEnabled(): boolean {
	const raw = (process.env.WIKI_AGGREGATION_PASS_ENABLED ?? "").toLowerCase();
	return raw === "true" || raw === "1" || raw === "yes";
}

export interface RunCompileJobOpts {
	adapter?: MemoryAdapter;
	/**
	 * Per-job Bedrock model override. Threads through to `runPlanner`,
	 * `runAggregationPlanner`, and `writeSection` so the whole pipeline for
	 * this invocation lands on the same model. When unset the env var
	 * `BEDROCK_MODEL_ID` (or the code default) applies.
	 */
	modelId?: string;
}

/**
 * Execute a compile job end-to-end. Intended to be called from the Lambda
 * handler after it resolves which job to run.
 */
export async function runCompileJob(
	job: WikiCompileJobRow,
	opts: RunCompileJobOpts = {},
): Promise<RunJobResult> {
	const started = Date.now();
	const adapter = opts.adapter ?? getMemoryServices().adapter;

	if (!adapter.listRecordsUpdatedSince) {
		const msg = `adapter ${adapter.kind} does not implement listRecordsUpdatedSince`;
		await completeCompileJob({
			jobId: job.id,
			status: "failed",
			error: msg,
			metrics: { records_read: 0, pages_upserted: 0, cost_usd: 0 },
		});
		return makeResult(job.id, "failed", started, emptyMetrics(), msg);
	}

	const metrics = emptyMetrics();
	// Accumulate records across batches so the aggregation pass has the full
	// input slice (not just the last batch) when it derives parent candidates.
	const allRecordsThisJob: ThinkWorkMemoryRecord[] = [];
	const jobStartedAt = new Date();

	try {
		let cursor = await getCursor({
			tenantId: job.tenant_id,
			ownerId: job.owner_id,
		});

		while (metrics.records_read < MAX_RECORDS_PER_JOB) {
			const pageSize = Math.min(
				RECORD_PAGE_SIZE,
				MAX_RECORDS_PER_JOB - metrics.records_read,
			);
			const { records, nextCursor } = await adapter.listRecordsUpdatedSince({
				tenantId: job.tenant_id,
				ownerId: job.owner_id,
				sinceUpdatedAt: cursor.updatedAt ?? undefined,
				sinceRecordId: cursor.recordId ?? undefined,
				limit: pageSize,
			});

			if (records.length === 0) break;
			metrics.records_read += records.length;
			allRecordsThisJob.push(...records);

			const [candidatePages, openMentions] = await Promise.all([
				listPagesForScope({
					tenantId: job.tenant_id,
					ownerId: job.owner_id,
					limit: 200,
				}),
				listOpenMentions({
					tenantId: job.tenant_id,
					ownerId: job.owner_id,
					limit: 200,
				}),
			]);

			const plan = await runPlanner(
				{
					tenantId: job.tenant_id,
					ownerId: job.owner_id,
					records,
					candidatePages,
					openMentions: openMentions.map((m) => ({
						id: m.id,
						alias: m.alias,
						aliasNormalized: m.alias_normalized,
						mentionCount: m.mention_count,
						suggestedType: m.suggested_type,
					})),
				},
				{ modelId: opts.modelId },
			);
			metrics.planner_calls += 1;
			metrics.input_tokens += plan.usage.inputTokens;
			metrics.output_tokens += plan.usage.outputTokens;

			// Pre-compute the list of titles the section writer should linkify.
			// Includes pages that already exist in scope AND any brand-new pages
			// this batch is about to create — so prose on page X can reference
			// page Y even when both land in the same planner response.
			const knownPageTitles = [
				...candidatePages.map((p) => p.title),
				...plan.newPages.map((p) => p.title),
			];
			const capHit = await applyPlan({
				job,
				records,
				plan,
				metrics,
				modelId: opts.modelId,
				knownPageTitles,
			});

			// Advance cursor only after a clean apply.
			if (nextCursor) {
				await setCursor({
					tenantId: job.tenant_id,
					ownerId: job.owner_id,
					updatedAt: nextCursor.updatedAt,
					recordId: nextCursor.recordId,
				});
				cursor = { updatedAt: nextCursor.updatedAt, recordId: nextCursor.recordId };
			}

			if (capHit) {
				metrics.cap_hit = capHit;
				break;
			}

			// If we got fewer records than asked for, we've drained the cursor.
			if (records.length < pageSize) break;
		}

		// ---------------------------------------------------------------
		// Aggregation pass — one call per job after leaf work has landed.
		// Gated by the WIKI_AGGREGATION_PASS_ENABLED flag. Failures here are
		// caught and recorded in metrics, but do NOT fail the whole job —
		// the leaf writes are already durable and the aggregation pass can
		// retry cleanly on the next compile.
		// ---------------------------------------------------------------
		if (isAggregationPassEnabled() && allRecordsThisJob.length > 0) {
			try {
				await runAggregationPass({
					job,
					records: allRecordsThisJob,
					jobStartedAt,
					metrics,
					modelId: opts.modelId,
				});
			} catch (aggErr) {
				const msg = (aggErr as Error)?.message || String(aggErr);
				console.warn(
					`[wiki-compiler] aggregation pass failed for job=${job.id}: ${msg}`,
				);
				metrics.aggregation_error = msg;
			}
		}

		metrics.cost_usd = estimateCostUsd(
			metrics.input_tokens,
			metrics.output_tokens,
		);
		await completeCompileJob({
			jobId: job.id,
			status: "succeeded",
			metrics,
		});
		return makeResult(job.id, "succeeded", started, metrics);
	} catch (err) {
		const msg = (err as Error)?.message || String(err);
		metrics.cost_usd = estimateCostUsd(
			metrics.input_tokens,
			metrics.output_tokens,
		);
		await completeCompileJob({
			jobId: job.id,
			status: "failed",
			error: msg,
			metrics,
		});
		return makeResult(job.id, "failed", started, metrics, msg);
	}
}

/**
 * Load + run a job by id (used by the Lambda handler when enqueue dispatched
 * a specific job). Returns null when the job no longer exists or isn't in a
 * runnable state.
 */
export async function runJobById(
	jobId: string,
	opts: RunCompileJobOpts = {},
): Promise<RunJobResult | null> {
	const job = await getCompileJob(jobId);
	if (!job) return null;
	if (job.status === "succeeded" || job.status === "skipped") return null;
	return runCompileJob(job, opts);
}

// ---------------------------------------------------------------------------
// Plan application
// ---------------------------------------------------------------------------

interface ApplyPlanArgs {
	job: WikiCompileJobRow;
	records: ThinkWorkMemoryRecord[];
	plan: PlannerResult;
	metrics: RunJobResult["metrics"];
	modelId?: string;
	/** Titles of scope-active pages the section writer should linkify. */
	knownPageTitles?: string[];
}

/**
 * Apply a planner result to the database. Returns a cap-hit reason string
 * when a guardrail short-circuits the apply; the outer loop will stop and
 * surface that in metrics.
 */
async function applyPlan(args: ApplyPlanArgs): Promise<string | null> {
	const { job, records, plan, metrics } = args;
	const recordById = new Map(records.map((r) => [r.id, r]));

	// 1. Updates to existing pages
	for (const upd of plan.pageUpdates) {
		const existing = await findPageById(upd.pageId);
		if (!existing) continue; // page deleted / bad id; skip silently
		if (
			existing.tenant_id !== job.tenant_id ||
			existing.owner_id !== job.owner_id
		) {
			continue; // scope-isolation safety net
		}

		const existingSections = await listPageSections(existing.id);
		const existingBySlug = new Map(
			existingSections.map((s) => [s.section_slug, s]),
		);

		const sectionsToApply: Array<{
			section_slug: string;
			heading: string;
			body_md: string;
			position: number;
			sources?: Array<{ kind: "memory_unit"; ref: string }>;
		}> = [];

		for (const sec of upd.sections) {
			const existingSec = existingBySlug.get(sec.slug);
			const existingBody = existingSec?.body_md ?? null;

			if (!isMeaningfulChange(existingBody, sec.proposed_body_md)) {
				metrics.sections_skipped += 1;
				continue;
			}

			if (
				metrics.sections_rewritten >= MAX_SECTIONS_REWRITTEN_PER_JOB
			) {
				return "max_sections_rewritten";
			}

			// Provenance: only the records the planner explicitly cited for
			// this section — never the full batch. Zero refs → zero
			// provenance rows is preferred over polluting with unrelated
			// sibling records.
			const sectionSources = resolveCitedRecords(
				recordById,
				sec.source_refs,
			);

			const writeRes: SectionWriteResult = await writeSection({
				pageType: existing.type,
				pageTitle: existing.title,
				sectionSlug: sec.slug,
				sectionHeading:
					existingSec?.heading ?? formatHeadingFromSlug(sec.slug),
				existingBodyMd: existingBody,
				proposedBodyMd: sec.proposed_body_md,
				// Section writer only sees the cited records for grounding;
				// it used to see the whole batch which produced drift.
				sourceRecords: sectionSources,
				knownPageTitles: args.knownPageTitles,
				modelId: args.modelId,
			});
			metrics.section_writer_calls += 1;
			metrics.sections_rewritten += 1;
			metrics.input_tokens += writeRes.inputTokens;
			metrics.output_tokens += writeRes.outputTokens;

			sectionsToApply.push({
				section_slug: sec.slug,
				heading: existingSec?.heading ?? formatHeadingFromSlug(sec.slug),
				body_md: writeRes.body_md,
				position:
					existingSec?.position ??
					nextFreePosition(existingSections),
				sources: sectionSources.map((r) => ({
					kind: "memory_unit" as const,
					ref: r.id,
				})),
			});
		}

		if (sectionsToApply.length > 0) {
			await upsertPage({
				tenant_id: existing.tenant_id,
				owner_id: existing.owner_id,
				type: existing.type,
				slug: existing.slug,
				title: existing.title,
				summary: existing.summary,
				markCompiled: true,
				sections: sectionsToApply,
				aliases: (upd.aliases ?? []).map((a) => ({
					alias: normalizeAlias(a),
					source: "compiler",
				})),
			});
			metrics.pages_upserted += 1;
		}
	}

	// 2. New pages
	for (const np of plan.newPages) {
		if (metrics.pages_upserted >= MAX_NEW_PAGES_PER_JOB) {
			return "max_new_pages";
		}
		const slug = slugifyTitle(np.title) || np.slug;
		// Page-level source_refs act as a fallback for sections that don't
		// carry their own refs; both are narrowly resolved against the batch
		// so invented/out-of-batch ids are dropped.
		const pageFallbackSources = resolveCitedRecords(recordById, np.source_refs);
		await upsertPage({
			tenant_id: job.tenant_id,
			owner_id: job.owner_id,
			type: np.type,
			slug,
			title: np.title,
			summary: np.summary ?? null,
			markCompiled: true,
			sections: np.sections.map((s, i) => {
				const sectionSources =
					s.source_refs && s.source_refs.length > 0
						? resolveCitedRecords(recordById, s.source_refs)
						: pageFallbackSources;
				return {
					section_slug: s.slug,
					heading: s.heading,
					body_md: s.body_md,
					position: i + 1,
					sources: sectionSources.map((r) => ({
						kind: "memory_unit" as const,
						ref: r.id,
					})),
				};
			}),
			aliases: [
				...seedAliasesForTitle(np.title),
				...((np.aliases ?? []).map(normalizeAlias)),
			]
				.filter((a, i, arr) => a && arr.indexOf(a) === i)
				.map((alias) => ({ alias, source: "compiler" })),
		});
		metrics.pages_upserted += 1;
	}

	// 3. Unresolved mentions (cheap — accumulate only)
	for (const um of plan.unresolvedMentions) {
		await upsertUnresolvedMention({
			tenant_id: job.tenant_id,
			owner_id: job.owner_id,
			alias: um.alias,
			alias_normalized: normalizeAlias(um.alias),
			suggested_type: um.suggestedType ?? null,
			context: um.context
				? { quote: um.context, source_ref: um.source_ref }
				: undefined,
		});
		metrics.unresolved_upserted += 1;
	}

	// 4. Promotions
	for (const pr of plan.promotions) {
		if (metrics.pages_upserted >= MAX_NEW_PAGES_PER_JOB) {
			return "max_new_pages";
		}
		const slug = slugifyTitle(pr.title) || pr.slug;
		const page = await upsertPage({
			tenant_id: job.tenant_id,
			owner_id: job.owner_id,
			type: pr.type,
			slug,
			title: pr.title,
			markCompiled: true,
			sections: pr.sections.map((s, i) => {
				const sectionSources = resolveCitedRecords(
					recordById,
					s.source_refs,
				);
				return {
					section_slug: s.slug,
					heading: s.heading,
					body_md: s.body_md,
					position: i + 1,
					sources: sectionSources.map((r) => ({
						kind: "memory_unit" as const,
						ref: r.id,
					})),
				};
			}),
			aliases: seedAliasesForTitle(pr.title).map((alias) => ({
				alias,
				source: "compiler",
			})),
		});
		await markUnresolvedPromoted({
			mentionId: pr.mentionId,
			pageId: page.id,
		});
		metrics.pages_upserted += 1;
		metrics.unresolved_promoted += 1;
	}

	// 5. Page links — resolve (type, slug) pairs against the scope's active
	// pages AFTER all upserts/promotions have landed so a link can reference
	// any page created earlier in this same plan.
	if (plan.pageLinks && plan.pageLinks.length > 0) {
		for (const link of plan.pageLinks) {
			const from = await findPageBySlug({
				tenantId: job.tenant_id,
				ownerId: job.owner_id,
				type: link.fromType,
				slug: link.fromSlug,
			});
			if (!from) continue; // planner referenced a slug that isn't in scope
			const to = await findPageBySlug({
				tenantId: job.tenant_id,
				ownerId: job.owner_id,
				type: link.toType,
				slug: link.toSlug,
			});
			if (!to) continue;
			await upsertPageLink({
				fromPageId: from.id,
				toPageId: to.id,
				context: link.context ?? null,
			});
			metrics.links_upserted = (metrics.links_upserted ?? 0) + 1;
		}
	}

	return null;
}

// ---------------------------------------------------------------------------
// Aggregation pass (PR B)
// ---------------------------------------------------------------------------

const MAX_AGGREGATION_PAGES = 60;

interface AggregationArgs {
	job: WikiCompileJobRow;
	records: ThinkWorkMemoryRecord[];
	jobStartedAt: Date;
	metrics: RunJobResult["metrics"];
	modelId?: string;
}

/**
 * Run one aggregation pass over the scope's recently-changed pages. Errors
 * bubble up to the caller so the surrounding try/catch can record them
 * without failing the job.
 */
export async function runAggregationPass(args: AggregationArgs): Promise<void> {
	const { job, records, metrics, modelId } = args;

	// Load recent pages first — we want their summaries to feed the
	// page-summary-based parent expander, not just the current batch's
	// raw records. Without this, `deterministic_parents_derived` was
	// always 0 on real agent data: cities like Toronto / Austin spread
	// across many compile batches so no single batch ever hit
	// `minClusterSize`, but the scope as a whole clearly clusters.
	const recentPages = await listRecentlyChangedPagesForAggregation({
		tenantId: job.tenant_id,
		ownerId: job.owner_id,
		sinceUpdatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24),
		limit: MAX_AGGREGATION_PAGES,
	});

	const recordBasedCandidates = deriveParentCandidates(records);
	const pageBasedCandidates = deriveParentCandidatesFromPageSummaries(
		recentPages.map((p) => ({
			id: p.id,
			summary: p.summary,
			title: p.title,
			tags: p.tags ?? [],
		})),
	);
	const parentCandidates = mergeParentCandidates(
		recordBasedCandidates,
		pageBasedCandidates,
	);
	metrics.deterministic_parents_derived = parentCandidates.length;

	if (recentPages.length === 0 && parentCandidates.length === 0) {
		return;
	}

	const candidatePages = await hydrateAggregationCandidates(recentPages);
	const linkNeighborhoods = await computeLinkNeighborhoods(recentPages);

	const plan = await runAggregationPlanner(
		{
			tenantId: job.tenant_id,
			ownerId: job.owner_id,
			recentlyChangedPages: candidatePages,
			parentCandidates,
			linkNeighborhoods,
		},
		{ modelId },
	);

	metrics.aggregation_planner_calls =
		(metrics.aggregation_planner_calls ?? 0) + 1;
	metrics.aggregation_input_tokens =
		(metrics.aggregation_input_tokens ?? 0) + plan.usage.inputTokens;
	metrics.aggregation_output_tokens =
		(metrics.aggregation_output_tokens ?? 0) + plan.usage.outputTokens;

	const knownPageTitles = [
		...candidatePages.map((p) => p.title),
		...plan.newPages.map((p) => p.title),
	];
	await applyAggregationPlan({
		job,
		records,
		plan,
		metrics,
		modelId,
		knownPageTitles,
	});
}

async function hydrateAggregationCandidates(
	pages: WikiPageRow[],
): Promise<AggregationCandidatePage[]> {
	const out: AggregationCandidatePage[] = [];
	for (const p of pages) {
		const sections = await defaultDb
			.select({
				id: wikiPageSections.id,
				section_slug: wikiPageSections.section_slug,
				heading: wikiPageSections.heading,
				body_md: wikiPageSections.body_md,
				aggregation: wikiPageSections.aggregation,
			})
			.from(wikiPageSections)
			.where(eq(wikiPageSections.page_id, p.id));
		out.push({
			id: p.id,
			type: p.type,
			slug: p.slug,
			title: p.title,
			summary: p.summary,
			parent_page_id: p.parent_page_id,
			hubness_score: p.hubness_score,
			tags: p.tags ?? [],
			sections: sections.map((s) => ({
				id: s.id,
				section_slug: s.section_slug,
				heading: s.heading,
				body_md: s.body_md,
				aggregation: (s.aggregation as SectionAggregation | null) ?? null,
				promotion_score:
					(s.aggregation as SectionAggregation | null)?.promotion_score ??
					undefined,
				promotion_status:
					(s.aggregation as SectionAggregation | null)?.promotion_status ??
					undefined,
			})),
		});
	}
	return out;
}

async function computeLinkNeighborhoods(
	pages: WikiPageRow[],
): Promise<
	Array<{
		pageId: string;
		inboundCount: number;
		outboundSlugs: Array<{ type: "entity" | "topic" | "decision"; slug: string }>;
	}>
> {
	const out: Array<{
		pageId: string;
		inboundCount: number;
		outboundSlugs: Array<{
			type: "entity" | "topic" | "decision";
			slug: string;
		}>;
	}> = [];
	for (const p of pages) {
		const [inbound] = await defaultDb
			.select({ count: sql<number>`count(*)::int` })
			.from(wikiPageLinks)
			.where(eq(wikiPageLinks.to_page_id, p.id));
		out.push({
			pageId: p.id,
			inboundCount: inbound?.count ?? 0,
			outboundSlugs: [],
		});
	}
	return out;
}

interface ApplyAggregationArgs {
	job: WikiCompileJobRow;
	records: ThinkWorkMemoryRecord[];
	plan: PlannerResult;
	metrics: RunJobResult["metrics"];
	modelId?: string;
	knownPageTitles?: string[];
}

async function applyAggregationPlan(
	args: ApplyAggregationArgs,
): Promise<void> {
	const { job, records, plan, metrics, modelId, knownPageTitles } = args;
	const recordById = new Map(records.map((r) => [r.id, r]));

	// Track pages touched by this pass so we can recompute hubness at the end.
	const touchedPageIds = new Set<string>();

	// 1. Create new hub pages first so later steps can link to them.
	for (const np of plan.newPages) {
		const existing = await findPageBySlug({
			tenantId: job.tenant_id,
			ownerId: job.owner_id,
			type: np.type,
			slug: np.slug,
		});
		if (existing) {
			touchedPageIds.add(existing.id);
			continue; // never resurrect a hub the leaf planner already built
		}
		const slug = slugifyTitle(np.title) || np.slug;
		const sources = resolveCitedRecords(recordById, np.source_refs);
		const created = await upsertPage({
			tenant_id: job.tenant_id,
			owner_id: job.owner_id,
			type: np.type,
			slug,
			title: np.title,
			summary: np.summary ?? null,
			markCompiled: true,
			sections: np.sections.map((s, i) => {
				const sectionSources =
					s.source_refs && s.source_refs.length > 0
						? resolveCitedRecords(recordById, s.source_refs)
						: sources;
				return {
					section_slug: s.slug,
					heading: s.heading,
					body_md: s.body_md,
					position: i + 1,
					sources: sectionSources.map((r) => ({
						kind: "memory_unit" as const,
						ref: r.id,
					})),
				};
			}),
			aliases: [
				...seedAliasesForTitle(np.title),
				...((np.aliases ?? []).map(normalizeAlias)),
			]
				.filter((a, i, arr) => a && arr.indexOf(a) === i)
				.map((alias) => ({ alias, source: "compiler" })),
		});
		touchedPageIds.add(created.id);
		metrics.pages_upserted += 1;
	}

	// 2. Parent section updates — rewrite rollup sections on hub pages.
	for (const upd of plan.parentSectionUpdates) {
		const parent = await findPageById(upd.pageId);
		if (!parent) continue;
		if (
			parent.tenant_id !== job.tenant_id ||
			parent.owner_id !== job.owner_id
		) {
			continue; // scope safety net
		}

		const existingSections = await listPageSections(parent.id);
		const existingSec = existingSections.find(
			(s) => s.section_slug === upd.sectionSlug,
		);
		const existingBody = existingSec?.body_md ?? null;

		if (!isMeaningfulChange(existingBody, upd.proposed_body_md)) {
			metrics.sections_skipped += 1;
			continue;
		}

		const citedRecords = resolveCitedRecords(recordById, upd.source_refs);

		const writeRes: SectionWriteResult = await writeSection({
			pageType: parent.type,
			pageTitle: parent.title,
			sectionSlug: upd.sectionSlug,
			sectionHeading: existingSec?.heading ?? upd.heading,
			existingBodyMd: existingBody,
			proposedBodyMd: upd.proposed_body_md,
			sourceRecords: citedRecords,
			knownPageTitles,
			modelId,
		});
		metrics.section_writer_calls += 1;
		metrics.sections_rewritten += 1;
		metrics.input_tokens += writeRes.inputTokens;
		metrics.output_tokens += writeRes.outputTokens;

		// Resolve linked_page_slugs → page ids for aggregation metadata.
		const linkedIds: string[] = [];
		for (const slugRef of upd.linked_page_slugs) {
			const child = await findPageBySlug({
				tenantId: job.tenant_id,
				ownerId: job.owner_id,
				type: slugRef.type,
				slug: slugRef.slug,
			});
			if (child) linkedIds.push(child.id);
		}

		await upsertPage({
			tenant_id: parent.tenant_id,
			owner_id: parent.owner_id,
			type: parent.type,
			slug: parent.slug,
			title: parent.title,
			summary: parent.summary,
			markCompiled: true,
			sections: [
				{
					section_slug: upd.sectionSlug,
					heading: existingSec?.heading ?? upd.heading,
					body_md: writeRes.body_md,
					position: existingSec?.position ?? nextFreePosition(existingSections),
					sources: citedRecords.map((r) => ({
						kind: "memory_unit" as const,
						ref: r.id,
					})),
				},
			],
		});

		const refreshedSections = await listPageSections(parent.id);
		const freshSection = refreshedSections.find(
			(s) => s.section_slug === upd.sectionSlug,
		);
		if (freshSection) {
			const nowIso = new Date().toISOString();
			const current: SectionAggregation =
				existingSec?.aggregation ?? emptySectionAggregation();
			const merged = mergeSectionAggregation(current, {
				linked_page_ids: linkedIds,
				supporting_record_count:
					current.supporting_record_count + citedRecords.length,
				first_source_at: current.first_source_at ?? nowIso,
				last_source_at: nowIso,
				observed_tags: upd.observed_tags ?? current.observed_tags,
			});
			const scoreResult = scoreSectionAggregation({
				aggregation: merged,
				bodyMd: writeRes.body_md,
			});
			const promotion_status: SectionAggregation["promotion_status"] =
				merged.promotion_status === "promoted"
					? "promoted" // sticky
					: scoreResult.status === "promote_ready" ||
						  scoreResult.status === "candidate"
						? "candidate"
						: "none";
			await upsertSectionAggregation({
				sectionId: freshSection.id,
				patch: {
					...merged,
					promotion_score: scoreResult.score,
					promotion_status,
				},
			});
		}

		metrics.parent_sections_updated =
			(metrics.parent_sections_updated ?? 0) + 1;
		touchedPageIds.add(parent.id);
	}

	// 3. Section promotions — spin off dense sections into their own pages.
	for (const promo of plan.sectionPromotions) {
		const parent = await findPageById(promo.pageId);
		if (!parent) continue;
		if (
			parent.tenant_id !== job.tenant_id ||
			parent.owner_id !== job.owner_id
		) {
			continue;
		}
		const parentSections = await listPageSections(parent.id);
		const parentSection = parentSections.find(
			(s) => s.section_slug === promo.sectionSlug,
		);
		if (!parentSection) continue;

		// Hysteresis: never re-promote a section that's already been promoted.
		const currentAgg =
			parentSection.aggregation ?? emptySectionAggregation();
		if (currentAgg.promotion_status === "promoted") continue;

		const newSlug = slugifyTitle(promo.newPage.title) || promo.newPage.slug;
		const pageFallbackSources = resolveCitedRecords(
			recordById,
			promo.newPage.source_refs,
		);
		const newPage = await upsertPage({
			tenant_id: job.tenant_id,
			owner_id: job.owner_id,
			type: promo.newPage.type,
			slug: newSlug,
			title: promo.newPage.title,
			summary: promo.newPage.summary ?? null,
			markCompiled: true,
			sections: promo.newPage.sections.map((s, i) => {
				const sectionSources =
					s.source_refs && s.source_refs.length > 0
						? resolveCitedRecords(recordById, s.source_refs)
						: pageFallbackSources;
				return {
					section_slug: s.slug,
					heading: s.heading,
					body_md: s.body_md,
					position: i + 1,
					sources: sectionSources.map((r) => ({
						kind: "memory_unit" as const,
						ref: r.id,
					})),
				};
			}),
			aliases: [
				...seedAliasesForTitle(promo.newPage.title),
				...((promo.newPage.aliases ?? []).map(normalizeAlias)),
			]
				.filter((a, i, arr) => a && arr.indexOf(a) === i)
				.map((alias) => ({ alias, source: "compiler" })),
		});
		metrics.pages_upserted += 1;

		// Wire hierarchy: parent_page_id + parent_of / child_of links.
		await setParentPage({
			pageId: newPage.id,
			parentPageId: parent.id,
		});

		// Rewrite the parent section to summary + highlights, leaving the
		// detailed rollup on the promoted page.
		const highlights = promo.topHighlights
			.map((h) => `- ${h.replace(/^[-•\s]+/, "")}`)
			.join("\n");
		const newParentBody =
			[
				promo.parentSummary.trim(),
				highlights,
				`See: [[${promo.newPage.title}]]`,
			]
				.filter((x) => x && x.length > 0)
				.join("\n\n") + "\n";

		await upsertPage({
			tenant_id: parent.tenant_id,
			owner_id: parent.owner_id,
			type: parent.type,
			slug: parent.slug,
			title: parent.title,
			summary: parent.summary,
			markCompiled: true,
			sections: [
				{
					section_slug: parentSection.section_slug,
					heading: parentSection.heading,
					body_md: newParentBody,
					position: parentSection.position,
				},
			],
		});

		// Freshen the aggregation record with the promoted pointer.
		const refreshedSections = await listPageSections(parent.id);
		const freshSection = refreshedSections.find(
			(s) => s.section_slug === promo.sectionSlug,
		);
		if (freshSection) {
			await upsertSectionAggregation({
				sectionId: freshSection.id,
				patch: {
					promotion_status: "promoted",
					promoted_page_id: newPage.id,
				},
			});
		}

		metrics.sections_promoted = (metrics.sections_promoted ?? 0) + 1;
		touchedPageIds.add(parent.id);
		touchedPageIds.add(newPage.id);
	}

	// 4. Page links (aggregation-pass can emit references + hierarchy links).
	if (plan.pageLinks && plan.pageLinks.length > 0) {
		for (const link of plan.pageLinks) {
			const from = await findPageBySlug({
				tenantId: job.tenant_id,
				ownerId: job.owner_id,
				type: link.fromType,
				slug: link.fromSlug,
			});
			if (!from) continue;
			const to = await findPageBySlug({
				tenantId: job.tenant_id,
				ownerId: job.owner_id,
				type: link.toType,
				slug: link.toSlug,
			});
			if (!to) continue;
			await upsertPageLink({
				fromPageId: from.id,
				toPageId: to.id,
				context: link.context ?? null,
			});
			metrics.links_upserted = (metrics.links_upserted ?? 0) + 1;
		}
	}

	// 5. Refresh hubness for every touched page. Cheap enough to batch.
	for (const pageId of touchedPageIds) {
		await recomputeHubness(pageId);
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyMetrics(): RunJobResult["metrics"] {
	return {
		records_read: 0,
		pages_upserted: 0,
		sections_rewritten: 0,
		sections_skipped: 0,
		unresolved_upserted: 0,
		unresolved_promoted: 0,
		planner_calls: 0,
		section_writer_calls: 0,
		input_tokens: 0,
		output_tokens: 0,
		cost_usd: 0,
		latency_ms: 0,
	};
}

function makeResult(
	jobId: string,
	status: "succeeded" | "failed",
	started: number,
	metrics: RunJobResult["metrics"],
	error?: string,
): RunJobResult {
	return {
		jobId,
		status,
		metrics: { ...metrics, latency_ms: Date.now() - started },
		error,
	};
}

function estimateCostUsd(inputTokens: number, outputTokens: number): number {
	const usd =
		(inputTokens / 1_000_000) * HAIKU_INPUT_USD_PER_MTOKEN +
		(outputTokens / 1_000_000) * HAIKU_OUTPUT_USD_PER_MTOKEN;
	// Round to 4 decimals so metrics JSON stays compact.
	return Math.round(usd * 10_000) / 10_000;
}

function formatHeadingFromSlug(slug: string): string {
	return slug
		.split(/[_-]+/)
		.map((w) => (w.length > 0 ? w[0]!.toUpperCase() + w.slice(1) : w))
		.join(" ");
}

function nextFreePosition(
	sections: Array<{ position: number }>,
): number {
	return sections.length === 0
		? 1
		: Math.max(...sections.map((s) => s.position)) + 1;
}

/**
 * Resolve explicitly-cited record IDs to full records from the batch. Unlike
 * the earlier `resolveSourceRecords` helper this does NOT fall back to "all
 * records in the batch" when the planner omits refs or cites unknown ids —
 * blank provenance is preferred over wrongly citing every sibling record,
 * which produced spurious memory→wiki links pre-fix.
 */
function resolveCitedRecords(
	byId: Map<string, ThinkWorkMemoryRecord>,
	ids: string[] | undefined,
): ThinkWorkMemoryRecord[] {
	if (!ids || ids.length === 0) return [];
	const out: ThinkWorkMemoryRecord[] = [];
	for (const id of ids) {
		const r = byId.get(id);
		if (r) out.push(r);
	}
	return out;
}
