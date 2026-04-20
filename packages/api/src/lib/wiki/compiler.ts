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
	countDuplicateTitleCandidates,
	emptySectionAggregation,
	findAliasMatches,
	findAliasMatchesFuzzy,
	findMemoryUnitPageSources,
	findPageById,
	findPageBySlug,
	bumpSectionLastSeen,
	DEDUPE_BUCKET_SECONDS,
	enqueueCompileJob,
	parseCompileDedupeBucket,
	findPagesByExactTitle,
	findPagesByFuzzyTitle,
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
	type WikiPageType,
} from "./repository.js";
import {
	emitCoMentionLinks,
	emitDeterministicParentLinks,
	type AffectedPage,
} from "./deterministic-linker.js";
import { BedrockRetryExhaustedError } from "./bedrock.js";
import { invokeWikiCompile } from "./enqueue.js";
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
/** Higher cap for `trigger='bootstrap_import'` jobs — the one-shot import
 * that feeds the whole agent history through the planner. Paired with
 * continuation chaining so a 5,000-record bootstrap still self-completes. */
const MAX_RECORDS_PER_BOOTSTRAP_JOB = 1000;
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
		/** newPages that got folded into an existing page via exact alias
		 * match, preventing duplicate entities like "Nana" + "Nana Restaurant". */
		alias_dedup_merged?: number;
		/** newPages that got folded into an existing page via trigram-fuzzy
		 * alias match (pg_trgm similarity ≥ 0.85, same type required).
		 * Tracked separately from `alias_dedup_merged` because fuzzy is the
		 * higher over-collapse risk and deserves its own time series. */
		fuzzy_dedupe_merges?: number;
		// --- Link densification metrics (2026-04-20) --------------------
		/** Reference links emitted by `emitDeterministicParentLinks` — a
		 * parent-expander candidate matched an existing active page in scope
		 * and passed the type-mismatch gate. */
		links_written_deterministic?: number;
		/** Reference links emitted by `emitCoMentionLinks` — reciprocal edges
		 * between entity pages sourced by the same memory_unit (entity↔entity
		 * only, capped at 10 per memory). */
		links_written_co_mention?: number;
		/** (title, owner_id) groups in `wiki_pages` with >1 active row — the
		 * R5 precision canary. Rising means densification may be creating
		 * duplicate hubs. */
		duplicate_candidates_count?: number;
		/** newPages the aggregation planner wanted to create but that would
		 * collide by title with an existing active page of a different type
		 * (e.g. entity `Portland, Oregon` + proposed topic `Portland, Oregon`).
		 * The applier skips these; the metric tells operators how often the
		 * planner is mid-air-collision-prone. */
		duplicate_candidates_cross_type?: number;
		/** Parent sections whose `aggregation.last_source_at` was refreshed
		 * because a child leaf was touched this batch. Lets the aggregation
		 * pass see freshly-touched parents even when the batch only updated
		 * leaves (no newPages, no promotions). */
		parent_sections_bumped?: number;
		/** Bootstrap-scale continuation jobs successfully enqueued at the end
		 * of this job (0 or 1 in v1). When >0, the chained job is running
		 * in the next dedupe bucket against the same (tenant, owner) scope. */
		continuation_enqueued?: number;
		/** True when `WIKI_DETERMINISTIC_LINKING_ENABLED` is false, so
		 * operators can distinguish "flag off" from "no candidates" at a
		 * glance. */
		deterministic_linking_flag_suppressed?: boolean;
		/** Total retry attempts across every Bedrock call this job — planner,
		 * aggregation planner, and section writer all feed into this counter.
		 * Successful calls with 0 retries contribute nothing. Rising values
		 * mean the model / quota is flaking; a Bedrock outage shows up here
		 * before it shows up as outright failures. */
		bedrock_retries?: number;
		/** Count of Bedrock calls that exhausted all 3 retry attempts and
		 * forced this job to fail. Effectively 0 or 1 — once the outer catch
		 * fires, the job is dead — but treated as a counter so it aggregates
		 * cleanly across jobs in downstream dashboards. */
		bedrock_retry_exhausted?: number;
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

/**
 * Feature flag for deterministic link emission (Unit 2 + Unit 3 of the
 * link-densification plan). Defaults to `true` so dev gets the denser graph
 * without an extra toggle; flip to `false` via terraform to kill-switch.
 */
export function isDeterministicLinkingEnabled(): boolean {
	const raw = (
		process.env.WIKI_DETERMINISTIC_LINKING_ENABLED ?? "true"
	).toLowerCase();
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

	const isBootstrap = job.trigger === "bootstrap_import";
	const maxRecordsThisJob = isBootstrap
		? MAX_RECORDS_PER_BOOTSTRAP_JOB
		: MAX_RECORDS_PER_JOB;
	// Set when the adapter returned fewer records than requested — signals
	// we've caught up to the scope's latest memory and no continuation is
	// needed. Stays false when the loop exits via `records_read >= cap`.
	let cursorDrained = false;

	try {
		let cursor = await getCursor({
			tenantId: job.tenant_id,
			ownerId: job.owner_id,
		});

		while (metrics.records_read < maxRecordsThisJob) {
			const pageSize = Math.min(
				RECORD_PAGE_SIZE,
				maxRecordsThisJob - metrics.records_read,
			);
			const { records, nextCursor } = await adapter.listRecordsUpdatedSince({
				tenantId: job.tenant_id,
				ownerId: job.owner_id,
				sinceUpdatedAt: cursor.updatedAt ?? undefined,
				sinceRecordId: cursor.recordId ?? undefined,
				limit: pageSize,
			});

			if (records.length === 0) {
				cursorDrained = true;
				break;
			}
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
			metrics.bedrock_retries =
				(metrics.bedrock_retries ?? 0) + (plan.usage.bedrockRetries ?? 0);

			// Pre-compute title + type + slug for every page that could be
			// referenced in a newPage / updated section's body. Two consumers:
			//   1. knownPageTitles — titles only, fed to the section writer.
			//   2. knownPageRefs — full (type, slug, title) triples, used by
			//      linkifyKnownEntities to wrap `**Title**` mentions in real
			//      markdown links so leaf-planner topic bodies are navigable,
			//      not dumb lists.
			const knownPageRefs = [
				...candidatePages.map((p) => ({
					type: p.type,
					slug: p.slug,
					title: p.title,
				})),
				...plan.newPages.map((p) => ({
					type: p.type,
					slug: p.slug,
					title: p.title,
				})),
			];
			const knownPageTitles = knownPageRefs.map((r) => r.title);
			const capHit = await applyPlan({
				job,
				records,
				plan,
				metrics,
				modelId: opts.modelId,
				knownPageTitles,
				knownPageRefs,
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
			if (records.length < pageSize) {
				cursorDrained = true;
				break;
			}
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
		// R5 canary — (owner, title) duplicate-page count. Tracked per-job
		// so any rise tied to the deterministic-linking flag is trivially
		// diffable from the CloudWatch time series. Errors here don't fail
		// the job; canary absence is safer than losing the compile.
		try {
			metrics.duplicate_candidates_count =
				await countDuplicateTitleCandidates({
					tenantId: job.tenant_id,
					ownerId: job.owner_id,
				});
		} catch (canaryErr) {
			console.warn(
				`[wiki-compiler] duplicate-candidates canary failed for job=${job.id}:`,
				(canaryErr as Error)?.message ?? canaryErr,
			);
		}
		// Continuation chaining — when we drained the cap but not the
		// cursor, enqueue a follow-up job into the next dedupe bucket so
		// bootstrap-scale imports self-complete. Preserves the parent's
		// trigger so the chained job inherits the higher bootstrap cap.
		//
		// Original Unit 3c trigger was
		// `records_read >= maxRecordsThisJob` — but `applyPlan` can also
		// early-return on `max_new_pages` / `max_sections_rewritten` with
		// `records_read` well below the records cap, and the cursor still
		// has work. Anchor on `!cursorDrained` so ANY early loop exit
		// chains forward.
		if (!cursorDrained) {
			try {
				// Anchor on the parent's *dedupe bucket*, not its
				// `created_at`. Earlier attempts (#296) used created_at,
				// but a chained job is INSERTed when its parent finishes —
				// so its `created_at` lands in the bucket BEFORE the one
				// its dedupe key encodes (dedupe = created_at + 300s).
				// Computing `created_at + 300` then collides with the
				// job's own dedupe bucket and ON CONFLICT DO NOTHING
				// drops the insert. Parsing the dedupe key gives us the
				// parent's actual bucket so `parentBucket + 1` is always
				// strictly ahead. Fall back to created_at for manually-
				// seeded keys that don't match the compiler format.
				const parentBucket =
					parseCompileDedupeBucket(job.dedupe_key) ??
					Math.floor(
						job.created_at.valueOf() /
							1000 /
							DEDUPE_BUCKET_SECONDS,
					);
				const nextBucketSeconds =
					(parentBucket + 1) * DEDUPE_BUCKET_SECONDS;
				const { inserted, job: chained } = await enqueueCompileJob({
					tenantId: job.tenant_id,
					ownerId: job.owner_id,
					trigger: job.trigger,
					nowEpochSeconds: nextBucketSeconds,
				});
				if (inserted) {
					await invokeWikiCompile(chained.id).catch((err) => {
						console.warn(
							`[wiki-compiler] continuation invoke failed for parent=${job.id} chained=${chained.id}:`,
							(err as Error)?.message ?? err,
						);
					});
					metrics.continuation_enqueued =
						(metrics.continuation_enqueued ?? 0) + 1;
				}
			} catch (chainErr) {
				console.warn(
					`[wiki-compiler] continuation enqueue failed for job=${job.id}:`,
					(chainErr as Error)?.message ?? chainErr,
				);
			}
		}
		await completeCompileJob({
			jobId: job.id,
			status: "succeeded",
			metrics,
		});
		return makeResult(job.id, "succeeded", started, metrics);
	} catch (err) {
		const msg = (err as Error)?.message || String(err);
		if (
			err instanceof BedrockRetryExhaustedError ||
			(err as Error | undefined)?.name === "BedrockRetryExhaustedError"
		) {
			metrics.bedrock_retry_exhausted =
				(metrics.bedrock_retry_exhausted ?? 0) + 1;
		}
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
	/** (type, slug, title) of every scope-active page — drives linkifyKnown. */
	knownPageRefs?: Array<{ type: WikiPageType; slug: string; title: string }>;
}

/**
 * Apply a planner result to the database. Returns a cap-hit reason string
 * when a guardrail short-circuits the apply; the outer loop will stop and
 * surface that in metrics.
 */
async function applyPlan(args: ApplyPlanArgs): Promise<string | null> {
	const { job, records, plan, metrics } = args;
	const recordById = new Map(records.map((r) => [r.id, r]));
	// Pages this call to applyPlan touched — fed into the deterministic
	// linker so we don't emit links for scope-level pages that weren't
	// actually part of this batch's work.
	const affectedPages: AffectedPage[] = [];
	const rememberAffected = (
		page: { id: string; type: WikiPageType; slug: string; title: string },
		sourceRecordIds: Iterable<string>,
	): void => {
		const recordIds = Array.from(new Set(sourceRecordIds));
		affectedPages.push({
			id: page.id,
			type: page.type,
			slug: page.slug,
			title: page.title,
			sourceRecordIds: recordIds,
		});
	};

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
			metrics.bedrock_retries =
				(metrics.bedrock_retries ?? 0) + (writeRes.bedrockRetries ?? 0);

			sectionsToApply.push({
				section_slug: sec.slug,
				heading: existingSec?.heading ?? formatHeadingFromSlug(sec.slug),
				body_md: linkifyKnownEntities(
					writeRes.body_md,
					args.knownPageRefs ?? [],
				),
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
			rememberAffected(
				existing,
				sectionsToApply.flatMap((s) => s.sources?.map((r) => r.ref) ?? []),
			);
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

		// Alias-dedup: before creating a new page, check whether an active
		// page in scope already claims this exact title as an alias.
		// The planner is told to update-don't-duplicate but still emits
		// collisions when the new title only differs by diacritic, case,
		// or punctuation from an existing page's alias. Routing to the
		// existing page keeps the wiki from splintering into "Momofuku
		// Daishō" + "Momofuku Daisho" or "Nana" + "Nana ". Only exact
		// normalized match triggers a merge — titles like "Eric" vs
		// "Eric Odom" are left alone because they're legitimately
		// different entities.
		const merged = await maybeMergeIntoExistingPage({
			proposed: np,
			proposedSlug: slug,
			job,
			recordById,
			knownPageRefs: args.knownPageRefs ?? [],
			pageFallbackSources,
		});
		if (merged) {
			metrics.pages_upserted += 1;
			if (merged === "exact") {
				metrics.alias_dedup_merged =
					(metrics.alias_dedup_merged ?? 0) + 1;
			} else {
				metrics.fuzzy_dedupe_merges =
					(metrics.fuzzy_dedupe_merges ?? 0) + 1;
			}
			continue;
		}

		const newPageSections = np.sections.map((s, i) => {
			const sectionSources =
				s.source_refs && s.source_refs.length > 0
					? resolveCitedRecords(recordById, s.source_refs)
					: pageFallbackSources;
			return {
				section_slug: s.slug,
				heading: s.heading,
				body_md: linkifyKnownEntities(
					s.body_md,
					args.knownPageRefs ?? [],
				),
				position: i + 1,
				sources: sectionSources.map((r) => ({
					kind: "memory_unit" as const,
					ref: r.id,
				})),
			};
		});
		const createdPage = await upsertPage({
			tenant_id: job.tenant_id,
			owner_id: job.owner_id,
			type: np.type,
			slug,
			title: np.title,
			summary: np.summary ?? null,
			markCompiled: true,
			sections: newPageSections,
			aliases: [
				...seedAliasesForTitle(np.title),
				...((np.aliases ?? []).map(normalizeAlias)),
			]
				.filter((a, i, arr) => a && arr.indexOf(a) === i)
				.map((alias) => ({ alias, source: "compiler" })),
		});
		metrics.pages_upserted += 1;
		rememberAffected(
			createdPage,
			newPageSections.flatMap((s) => s.sources.map((r) => r.ref)),
		);
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
		const promotionSections = pr.sections.map((s, i) => {
			const sectionSources = resolveCitedRecords(
				recordById,
				s.source_refs,
			);
			return {
				section_slug: s.slug,
				heading: s.heading,
				body_md: linkifyKnownEntities(
					s.body_md,
					args.knownPageRefs ?? [],
				),
				position: i + 1,
				sources: sectionSources.map((r) => ({
					kind: "memory_unit" as const,
					ref: r.id,
				})),
			};
		});
		const page = await upsertPage({
			tenant_id: job.tenant_id,
			owner_id: job.owner_id,
			type: pr.type,
			slug,
			title: pr.title,
			markCompiled: true,
			sections: promotionSections,
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
		rememberAffected(
			page,
			promotionSections.flatMap((s) => s.sources.map((r) => r.ref)),
		);
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

	// 6. Deterministic link emission — flag-gated. Two emitters:
	//    a) Parent links: `city` / `journal` candidates → exact-title parent.
	//    b) Co-mention links: reciprocal entity↔entity edges when the same
	//       memory_unit sourced ≥2 entity pages in this batch.
	// Both only look at pages this call touched; neither re-examines the
	// whole scope, so routine scope-wide compiles don't churn unrelated
	// links. Errors inside either emitter are swallowed per-candidate, so
	// the compile never fails on link-writing alone.
	if (!isDeterministicLinkingEnabled()) {
		metrics.deterministic_linking_flag_suppressed = true;
	} else if (affectedPages.length > 0 && records.length > 0) {
		const scope = { tenantId: job.tenant_id, ownerId: job.owner_id };
		const writeLink = (linkArgs: {
			fromPageId: string;
			toPageId: string;
			context: string;
		}): Promise<void> =>
			upsertPageLink({
				fromPageId: linkArgs.fromPageId,
				toPageId: linkArgs.toPageId,
				context: linkArgs.context,
			});

		const candidates = deriveParentCandidates(records);
		if (candidates.length > 0) {
			const parentEmission = await emitDeterministicParentLinks({
				scope,
				candidates,
				affectedPages,
				lookupParentPages: (lookupArgs) =>
					findPagesByExactTitle(lookupArgs),
				// Trigram fallback closes the Portland / "Portland, Oregon"
				// recall gap observed on 2026-04-20 Marco recompile.
				lookupParentPagesFuzzy: (lookupArgs) =>
					findPagesByFuzzyTitle(lookupArgs),
				writeLink,
			});
			metrics.links_written_deterministic =
				(metrics.links_written_deterministic ?? 0) +
				parentEmission.linksWritten;
		}

		// Co-mention emission runs on this batch's memory_unit ids — read
		// back via `wiki_section_sources` so we catch links through sections
		// this applyPlan just wrote.
		const batchMemoryIds = Array.from(
			new Set(
				affectedPages.flatMap((p) => p.sourceRecordIds),
			),
		);
		if (batchMemoryIds.length > 0) {
			const coMentionEmission = await emitCoMentionLinks({
				scope,
				memoryUnitIds: batchMemoryIds,
				lookupMemorySources: (lookupArgs) =>
					findMemoryUnitPageSources(lookupArgs),
				writeLink,
			});
			metrics.links_written_co_mention =
				(metrics.links_written_co_mention ?? 0) +
				coMentionEmission.linksWritten;
		}
	}

	// 7. Section activity — advance `aggregation.last_source_at` on any
	// parent section that already claims a leaf we just touched. Errors
	// here are benign (parent section may have drifted); log + continue so
	// the bump loop can't fail the compile.
	let parentSectionsBumped = 0;
	for (const page of affectedPages) {
		try {
			parentSectionsBumped += await bumpSectionLastSeen({ pageId: page.id });
		} catch (bumpErr) {
			console.warn(
				`[wiki-compiler] bumpSectionLastSeen failed for page=${page.id}:`,
				(bumpErr as Error)?.message ?? bumpErr,
			);
		}
	}
	if (parentSectionsBumped > 0) {
		metrics.parent_sections_bumped =
			(metrics.parent_sections_bumped ?? 0) + parentSectionsBumped;
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
	metrics.bedrock_retries =
		(metrics.bedrock_retries ?? 0) + (plan.usage.bedrockRetries ?? 0);

	const knownPageRefs = [
		...candidatePages.map((p) => ({
			type: p.type,
			slug: p.slug,
			title: p.title,
		})),
		...plan.newPages.map((p) => ({
			type: p.type,
			slug: p.slug,
			title: p.title,
		})),
	];
	const knownPageTitles = knownPageRefs.map((r) => r.title);
	await applyAggregationPlan({
		job,
		records,
		plan,
		metrics,
		modelId,
		knownPageTitles,
		knownPageRefs,
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
	knownPageRefs?: Array<{ type: WikiPageType; slug: string; title: string }>;
}

async function applyAggregationPlan(
	args: ApplyAggregationArgs,
): Promise<void> {
	const {
		job,
		records,
		plan,
		metrics,
		modelId,
		knownPageTitles,
		knownPageRefs,
	} = args;
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
		// Cross-type duplicate guard: even if the slug doesn't collide, an
		// active page of a *different* type may already claim this exact
		// title. The aggregation planner surfaced this bug on 2026-04-20
		// Marco recompile — `Portland, Oregon` entity existed and agg
		// planner emitted a new `topic` page with the same title,
		// splintering the graph. Surface the collision, skip creation, and
		// leave it to a future refinement (Unit 5 promotion path / manual
		// review) to reconcile.
		const titleCollisions = await findPagesByExactTitle({
			tenantId: job.tenant_id,
			ownerId: job.owner_id,
			title: np.title,
		});
		if (titleCollisions.length > 0) {
			metrics.duplicate_candidates_cross_type =
				(metrics.duplicate_candidates_cross_type ?? 0) + 1;
			console.warn(
				`[wiki-compiler] cross-type duplicate guard: agg planner proposed ` +
					`{type=${np.type}, title="${np.title}"} but ` +
					titleCollisions
						.map((p) => `${p.type}/${p.slug}=${p.id}`)
						.join(", ") +
					` already exists — skipping creation`,
			);
			// Track the existing pages so aggregation still links to them
			// when subsequent steps resolve by title.
			for (const c of titleCollisions) touchedPageIds.add(c.id);
			continue;
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
					body_md: linkifyKnownEntities(
						s.body_md,
						knownPageRefs ?? [],
					),
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
	// Track child pages already rolled up on each parent this job, so a
	// single page like "Austin Activities" doesn't list "Lady Bird Lake"
	// under "Overview" AND "Outdoor & Family Attractions". First section
	// to claim a child wins; later sections on the same parent drop the
	// duplicate.
	const claimedChildrenByParent = new Map<string, Set<string>>();
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

		// Resolve linked_page_slugs to full page rows for both (a) aggregation
		// metadata and (b) rollup body rendering. We need title + summary +
		// type for each child to render a clean markdown list.
		//
		// Dedupe against any child already rolled up under a prior section
		// on this same parent so the body doesn't repeat "Lady Bird Lake"
		// across "Overview" and "Outdoor & Family Attractions".
		const claimedOnParent =
			claimedChildrenByParent.get(parent.id) ?? new Set<string>();
		const linkedIds: string[] = [];
		const linkedChildren: Array<{
			type: WikiPageType;
			slug: string;
			title: string;
			summary: string | null;
		}> = [];
		for (const slugRef of upd.linked_page_slugs) {
			const child = await findPageBySlug({
				tenantId: job.tenant_id,
				ownerId: job.owner_id,
				type: slugRef.type,
				slug: slugRef.slug,
			});
			if (!child) continue;
			if (claimedOnParent.has(child.id)) continue; // drop dup
			claimedOnParent.add(child.id);
			linkedIds.push(child.id);
			linkedChildren.push({
				type: child.type,
				slug: child.slug,
				title: child.title,
				summary: child.summary,
			});
		}
		claimedChildrenByParent.set(parent.id, claimedOnParent);

		// For rollup sections with real children, render a deterministic
		// bullet list instead of calling the section-writer LLM. Users want
		// "a list of links with a summary", not flat prose — and the markdown
		// `[text](/wiki/<type>/<slug>)` links point at the mobile wiki route
		// so clients that hook onLinkPress can navigate internally.
		//
		// Fall back to the LLM path when no children resolved (nothing
		// concrete to list — the section is probably describing something
		// abstract).
		let bodyForUpsert: string;
		if (linkedChildren.length >= 1) {
			bodyForUpsert = renderRollupList(linkedChildren);
		} else {
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
			metrics.input_tokens += writeRes.inputTokens;
			metrics.output_tokens += writeRes.outputTokens;
			metrics.bedrock_retries =
				(metrics.bedrock_retries ?? 0) + (writeRes.bedrockRetries ?? 0);
			bodyForUpsert = writeRes.body_md;
		}
		metrics.sections_rewritten += 1;

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
					body_md: bodyForUpsert,
					position: existingSec?.position ?? nextFreePosition(existingSections),
					sources: citedRecords.map((r) => ({
						kind: "memory_unit" as const,
						ref: r.id,
					})),
				},
			],
		});

		// Make sure every linked child in the body is also a first-class
		// pageLink in the graph — the renderer uses this for backlinks /
		// navigation, and the body list on its own isn't enough for clients
		// that don't (yet) intercept markdown links.
		for (const childId of linkedIds) {
			await upsertPageLink({
				fromPageId: parent.id,
				toPageId: childId,
				context: `rolled up under ${upd.sectionSlug}`,
			});
			metrics.links_upserted = (metrics.links_upserted ?? 0) + 1;
		}

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
				bodyMd: bodyForUpsert,
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
					body_md: linkifyKnownEntities(
						s.body_md,
						knownPageRefs ?? [],
					),
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
		const promotedHref = `/wiki/${encodeURIComponent(promo.newPage.type)}/${encodeURIComponent(newSlug)}`;
		const newParentBody =
			[
				promo.parentSummary.trim(),
				highlights,
				`See: [${promo.newPage.title}](${promotedHref})`,
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
		links_written_deterministic: 0,
		links_written_co_mention: 0,
		duplicate_candidates_count: 0,
		fuzzy_dedupe_merges: 0,
		bedrock_retries: 0,
		bedrock_retry_exhausted: 0,
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

/**
 * Render a rollup/aggregation section body as a clean bullet list. Each
 * child becomes `- [**Title**](/wiki/<type>/<slug>) — summary-first-sentence`.
 * Markdown link target matches the mobile router path, so clients that
 * hook onLinkPress can navigate internally. Summaries are trimmed to the
 * first sentence so the list stays scannable — the full summary lives on
 * the child page.
 */
function renderRollupList(
	children: Array<{
		type: WikiPageType;
		slug: string;
		title: string;
		summary: string | null;
	}>,
): string {
	return children
		.map((c) => {
			const href = `/wiki/${encodeURIComponent(c.type)}/${encodeURIComponent(c.slug)}`;
			const firstSentence = firstSentenceOf(c.summary);
			const tail = firstSentence ? ` — ${firstSentence}` : "";
			return `- [**${c.title}**](${href})${tail}`;
		})
		.join("\n");
}

/**
 * Wrap `**Title**` mentions in body markdown with real markdown links
 * pointing at /wiki/<type>/<slug>. Turns leaf-planner-authored bulleted
 * lists (e.g. 2026 Orders showing "- **Order vqod414y** – ...") into
 * clickable rollups without requiring the aggregation pass to touch
 * them.
 *
 * Rules:
 * - Only rewrites `**Title**` where Title matches a known page's title
 *   exactly. Case-sensitive; partial matches are skipped.
 * - Longer titles are replaced before shorter ones so "Austin Nature
 *   & Science Center" doesn't get shadowed by a bare "Austin".
 * - Leaves existing `[**Title**](url)` patterns alone — the negative
 *   lookbehind / lookahead ensures we don't double-wrap anything the
 *   aggregation-pass already rendered.
 */
export function linkifyKnownEntities(
	body: string | null | undefined,
	refs: Array<{ type: WikiPageType; slug: string; title: string }>,
): string {
	if (!body) return "";
	if (refs.length === 0) return body;
	// Longest-first so nested / prefix titles don't clobber the full match.
	const sorted = [...refs].sort((a, b) => b.title.length - a.title.length);
	let out = body;
	for (const ref of sorted) {
		if (!ref.title) continue;
		const escaped = escapeRegExp(ref.title);
		const href = `/wiki/${encodeURIComponent(ref.type)}/${encodeURIComponent(ref.slug)}`;
		// Match **Title** that isn't already inside a markdown link.
		// `(?<!\[)` — not preceded by `[`
		// `(?!\]\()` after the closing `**` — not followed by `](` (i.e.
		// already in a markdown link). This keeps the swap idempotent
		// when a body gets re-compiled.
		const pattern = new RegExp(
			`(?<!\\[)\\*\\*${escaped}\\*\\*(?!\\]\\()`,
			"g",
		);
		out = out.replace(pattern, `[**${ref.title}**](${href})`);
	}
	return out;
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * If a `newPage` the leaf planner proposes collides (via its
 * normalised title) with an existing page's alias in the same
 * (tenant, owner) scope, merge the proposal into that existing page
 * instead of creating a duplicate. Returns `true` when a merge
 * happened so the caller can skip the normal newPage creation path
 * and bump the `alias_dedup_merged` metric.
 *
 * Matching rule: exact match on `normalizeAlias(title)` against the
 * existing page's alias set. Substring / prefix matches are NOT
 * merged — "Eric" and "Eric Odom" are legitimately different
 * entities and deserve separate pages.
 *
 * Merge strategy: keep the existing page's type/slug/title, apply
 * the proposal's sections (upsertSections diffs per-slug, so
 * overlapping slugs get rewritten and new slugs get inserted), union
 * aliases from the proposal into the existing set.
 */
/** Whether a merge landed via exact alias match or the trigram fuzzy
 * fallback. The caller uses this to increment the right metric — fuzzy
 * merges are higher-risk (over-collapse) and worth tracking separately. */
export type AliasMergeKind = "exact" | "fuzzy";

async function maybeMergeIntoExistingPage(args: {
	proposed: {
		type: WikiPageType;
		title: string;
		summary?: string | null;
		sections: Array<{
			slug: string;
			heading: string;
			body_md: string;
			source_refs?: string[];
		}>;
		aliases?: string[];
		source_refs?: string[];
	};
	proposedSlug: string;
	job: WikiCompileJobRow;
	recordById: Map<string, ThinkWorkMemoryRecord>;
	knownPageRefs: Array<{ type: WikiPageType; slug: string; title: string }>;
	pageFallbackSources: ThinkWorkMemoryRecord[];
}): Promise<AliasMergeKind | null> {
	const aliasNormalized = normalizeAlias(args.proposed.title);
	if (!aliasNormalized) return null;

	// Pass 1: exact alias match (existing behavior). Prefer same-type hits.
	const exactMatches = await findAliasMatches({
		tenantId: args.job.tenant_id,
		ownerId: args.job.owner_id,
		aliasNormalized,
	});
	let existing: WikiPageRow | null = null;
	let kind: AliasMergeKind = "exact";
	for (const m of exactMatches) {
		const candidate = await findPageById(m.pageId);
		if (!candidate) continue;
		if (
			candidate.tenant_id !== args.job.tenant_id ||
			candidate.owner_id !== args.job.owner_id
		) {
			continue;
		}
		if (candidate.status !== "active") continue;
		if (candidate.type === args.proposed.type) {
			existing = candidate;
			break;
		}
		if (!existing) existing = candidate;
	}

	// Pass 2: trigram-fuzzy fallback when exact didn't resolve a candidate.
	// Fuzzy is strict-same-type (the type-mismatch gate) because it's the
	// over-collapse risk — "Austin" the entity vs "Austin" the topic must
	// stay separate even if the aliases trigram-match. Archived pages are
	// filtered by the repo helper.
	if (!existing) {
		const fuzzyMatches = await findAliasMatchesFuzzy({
			tenantId: args.job.tenant_id,
			ownerId: args.job.owner_id,
			aliasNormalized,
		});
		for (const m of fuzzyMatches) {
			if (m.pageType !== args.proposed.type) continue;
			const candidate = await findPageById(m.pageId);
			if (!candidate) continue;
			if (
				candidate.tenant_id !== args.job.tenant_id ||
				candidate.owner_id !== args.job.owner_id
			) {
				continue;
			}
			if (candidate.status !== "active") continue;
			existing = candidate;
			kind = "fuzzy";
			console.log(
				`[wiki-compiler] fuzzy_dedupe_merged: "${args.proposed.title}" ` +
					`≈ "${m.aliasText}" (sim=${m.similarity.toFixed(3)}) → ` +
					`page ${candidate.id}`,
			);
			break;
		}
	}

	if (!existing) return null;
	// Don't merge when the existing page already has the exact slug
	// the proposal would generate — upsertPage's slug-based upsert
	// will handle that natively.
	if (existing.slug === args.proposedSlug) return null;

	if (kind === "exact") {
		console.log(
			`[wiki-compiler] alias_dedup_merged: proposed newPage "${args.proposed.title}" → existing page ${existing.id} (${existing.type}/${existing.slug})`,
		);
	}

	const existingSections = await listPageSections(existing.id);
	const basePosition = nextFreePosition(existingSections);

	await upsertPage({
		tenant_id: existing.tenant_id,
		owner_id: existing.owner_id,
		type: existing.type,
		slug: existing.slug,
		title: existing.title,
		summary: existing.summary ?? args.proposed.summary ?? null,
		markCompiled: true,
		sections: args.proposed.sections.map((s, i) => {
			const sectionSources =
				s.source_refs && s.source_refs.length > 0
					? resolveCitedRecords(args.recordById, s.source_refs)
					: args.pageFallbackSources;
			const existingSec = existingSections.find(
				(es) => es.section_slug === s.slug,
			);
			return {
				section_slug: s.slug,
				heading: existingSec?.heading ?? s.heading,
				body_md: linkifyKnownEntities(s.body_md, args.knownPageRefs),
				position: existingSec?.position ?? basePosition + i,
				sources: sectionSources.map((r) => ({
					kind: "memory_unit" as const,
					ref: r.id,
				})),
			};
		}),
		aliases: [
			normalizeAlias(args.proposed.title),
			...((args.proposed.aliases ?? []).map(normalizeAlias)),
		]
			.filter((a, i, arr) => a && arr.indexOf(a) === i)
			.map((alias) => ({ alias, source: "compiler" })),
	});
	return kind;
}

function firstSentenceOf(s: string | null): string {
	if (!s) return "";
	const trimmed = s.trim();
	if (trimmed.length === 0) return "";
	// Split on sentence enders; fall back to first ~160 chars.
	const match = trimmed.match(/^.*?[.!?](?=\s|$)/);
	if (match) return match[0].trim();
	return trimmed.length > 160 ? `${trimmed.slice(0, 160).trim()}…` : trimmed;
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
