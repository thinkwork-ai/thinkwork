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
	findPageById,
	findPageBySlug,
	getCompileJob,
	getCursor,
	listOpenMentions,
	listPageSections,
	listPagesForScope,
	markUnresolvedPromoted,
	setCursor,
	upsertPage,
	upsertPageLink,
	upsertUnresolvedMention,
	normalizeAlias,
	type WikiCompileJobRow,
} from "./repository.js";
import { runPlanner, type PlannerResult } from "./planner.js";
import {
	isMeaningfulChange,
	writeSection,
	type SectionWriteResult,
} from "./section-writer.js";
import { slugifyTitle, seedAliasesForTitle } from "./aliases.js";

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
	};
	error?: string;
}

/**
 * Execute a compile job end-to-end. Intended to be called from the Lambda
 * handler after it resolves which job to run.
 */
export async function runCompileJob(
	job: WikiCompileJobRow,
	opts: { adapter?: MemoryAdapter } = {},
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

			const plan = await runPlanner({
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
			});
			metrics.planner_calls += 1;
			metrics.input_tokens += plan.usage.inputTokens;
			metrics.output_tokens += plan.usage.outputTokens;

			const capHit = await applyPlan({
				job,
				records,
				plan,
				metrics,
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
	opts: { adapter?: MemoryAdapter } = {},
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
