/**
 * Wiki (Compounding Memory) repository — DB primitives for the compile pipeline.
 *
 * This module is the only place that talks to the `wiki_*` tables directly.
 * The compiler, GraphQL resolvers, admin mutations, lint job, export job, and
 * bootstrap importer all route their writes and reads through here.
 *
 * v1 scope rule (see .prds/compounding-memory-scoping.md):
 *   - Every compiled object is strictly owner-scoped. `ownerId` is required on
 *     every public function. There is no null-owner code path.
 *   - `entity`, `topic`, and `decision` pages all live inside a single
 *     `(tenant, owner)` scope. Type describes shape, not sharing.
 *
 * Dedupe/debounce: compile jobs dedupe on `${tenant}:${owner}:${bucket}` where
 * bucket = floor(epoch_s / 300) — a 5-minute wall-clock window. See
 * .prds/compounding-memory-v1-build-plan.md.
 */

import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import {
	wikiPages,
	wikiPageSections,
	wikiPageLinks,
	wikiPageAliases,
	wikiUnresolvedMentions,
	wikiSectionSources,
	wikiCompileJobs,
	wikiCompileCursors,
} from "@thinkwork/database-pg/schema";
import { db as defaultDb } from "../db.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WikiPageType = "entity" | "topic" | "decision";
export type WikiPageStatus = "active" | "archived";
export type WikiCompileJobStatus =
	| "pending"
	| "running"
	| "succeeded"
	| "failed"
	| "skipped";
export type WikiCompileTrigger =
	| "memory_retain"
	| "bootstrap_import"
	| "admin"
	| "lint";
export type WikiSectionSourceKind =
	| "memory_unit"
	| "artifact"
	| "journal_idea";
export type WikiUnresolvedStatus = "open" | "promoted" | "ignored";
export type WikiPageLinkKind = "reference" | "parent_of" | "child_of";
export type SectionPromotionStatus =
	| "none"
	| "candidate"
	| "promoted"
	| "suppressed";

/**
 * Aggregation metadata carried on a section that acts as a rollup. Leaf-style
 * sections (overview, notes, visits) leave this NULL.
 */
export interface SectionAggregation {
	linked_page_ids: string[];
	supporting_record_count: number;
	first_source_at: string | null;
	last_source_at: string | null;
	observed_tags: string[];
	promotion_status: SectionPromotionStatus;
	promotion_score: number;
	promoted_page_id: string | null;
}

export function emptySectionAggregation(): SectionAggregation {
	return {
		linked_page_ids: [],
		supporting_record_count: 0,
		first_source_at: null,
		last_source_at: null,
		observed_tags: [],
		promotion_status: "none",
		promotion_score: 0,
		promoted_page_id: null,
	};
}

export interface WikiCompileJobRow {
	id: string;
	tenant_id: string;
	owner_id: string;
	dedupe_key: string;
	status: WikiCompileJobStatus;
	trigger: WikiCompileTrigger;
	attempt: number;
	claimed_at: Date | null;
	started_at: Date | null;
	finished_at: Date | null;
	error: string | null;
	metrics: unknown;
	created_at: Date;
}

export interface WikiCompileCursorRow {
	tenant_id: string;
	owner_id: string;
	last_record_updated_at: Date | null;
	last_record_id: string | null;
	updated_at: Date;
}

export interface WikiPageRow {
	id: string;
	tenant_id: string;
	owner_id: string;
	type: WikiPageType;
	slug: string;
	title: string;
	summary: string | null;
	body_md: string | null;
	status: WikiPageStatus;
	/** Set when this page was promoted from a section on another page. */
	parent_page_id: string | null;
	/** Coarse, monotonic hubness signal. Recomputed on upsert. */
	hubness_score: number;
	/** Soft tag hints — never a structural forcing function. */
	tags: string[];
	last_compiled_at: Date | null;
	created_at: Date;
	updated_at: Date;
}

export interface WikiSectionInput {
	section_slug: string;
	heading: string;
	body_md: string;
	position: number;
	/** Source references for provenance; recorded per section on upsert. */
	sources?: Array<{ kind: WikiSectionSourceKind; ref: string }>;
}

export interface UpsertPageInput {
	tenant_id: string;
	owner_id: string;
	type: WikiPageType;
	slug: string;
	title: string;
	summary?: string | null;
	status?: WikiPageStatus;
	/** When set, also updates `last_compiled_at` and mirrors `body_md`
	 * computed from the supplied sections (if any). */
	markCompiled?: boolean;
	sections?: WikiSectionInput[];
	/** Aliases to upsert alongside the page. `source` defaults to 'compiler'. */
	aliases?: Array<{ alias: string; source?: string }>;
}

export interface UpsertUnresolvedInput {
	tenant_id: string;
	owner_id: string;
	alias: string;
	alias_normalized: string;
	suggested_type?: WikiPageType | null;
	context?: { quote: string; source_ref: string };
}

export interface Cursor {
	updatedAt: Date | null;
	recordId: string | null;
}

type DbClient = typeof defaultDb | PgTransaction<any, any, any>;

// ---------------------------------------------------------------------------
// Alias normalization — shared canonical form for lookup & dedupe
// ---------------------------------------------------------------------------

/**
 * Cheap guard against garbage IDs flowing in from LLM output. Postgres
 * raises `invalid input syntax for type uuid` on any non-conforming string,
 * which would otherwise crash a whole compile job when the planner
 * hallucinates / truncates a page id. Anywhere we trust model-provided IDs,
 * filter through this first and skip rows that fail.
 */
export function isValidUuid(raw: unknown): raw is string {
	if (typeof raw !== "string") return false;
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
		raw,
	);
}

/**
 * Normalize an alias for matching. Lowercases, strips punctuation (except
 * internal hyphens/apostrophes), collapses whitespace, trims.
 *
 * Intentionally Unicode-aware so that accented names resolve consistently.
 */
export function normalizeAlias(raw: string): string {
	return raw
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s'\-]/gu, " ")
		.replace(/\s+/g, " ")
		.trim();
}

// ---------------------------------------------------------------------------
// Dedupe key — 5-minute wall-clock bucket per (tenant, owner)
// ---------------------------------------------------------------------------

const DEDUPE_BUCKET_SECONDS = 300;

export function buildCompileDedupeKey(args: {
	tenantId: string;
	ownerId: string;
	nowEpochSeconds?: number;
}): string {
	const now = args.nowEpochSeconds ?? Math.floor(Date.now() / 1000);
	const bucket = Math.floor(now / DEDUPE_BUCKET_SECONDS);
	return `${args.tenantId}:${args.ownerId}:${bucket}`;
}

// ---------------------------------------------------------------------------
// Compile jobs
// ---------------------------------------------------------------------------

/**
 * Insert a compile job for (tenant, owner, 5-min bucket). If a job already
 * exists for the bucket, returns { inserted: false, job: existing }. The
 * caller uses `inserted` to decide whether to async-invoke the compile Lambda.
 */
export async function enqueueCompileJob(
	args: {
		tenantId: string;
		ownerId: string;
		trigger: WikiCompileTrigger;
	},
	db: DbClient = defaultDb,
): Promise<{ inserted: boolean; job: WikiCompileJobRow }> {
	const dedupeKey = buildCompileDedupeKey({
		tenantId: args.tenantId,
		ownerId: args.ownerId,
	});

	const [inserted] = await db
		.insert(wikiCompileJobs)
		.values({
			tenant_id: args.tenantId,
			owner_id: args.ownerId,
			dedupe_key: dedupeKey,
			trigger: args.trigger,
		})
		.onConflictDoNothing({ target: wikiCompileJobs.dedupe_key })
		.returning();

	if (inserted) {
		return { inserted: true, job: inserted as WikiCompileJobRow };
	}

	const existing = await db
		.select()
		.from(wikiCompileJobs)
		.where(eq(wikiCompileJobs.dedupe_key, dedupeKey))
		.limit(1);

	if (!existing[0]) {
		throw new Error(
			`enqueueCompileJob: dedupe conflict but no existing row found for key=${dedupeKey}`,
		);
	}
	return { inserted: false, job: existing[0] as WikiCompileJobRow };
}

/**
 * Claim the next pending compile job for processing. Uses FOR UPDATE SKIP
 * LOCKED so multiple compile workers can run concurrently without stepping
 * on each other. Returns null if nothing is claimable.
 */
export async function claimNextCompileJob(
	db: DbClient = defaultDb,
): Promise<WikiCompileJobRow | null> {
	const result = await db.execute(sql`
		UPDATE ${wikiCompileJobs}
		SET status = 'running',
		    claimed_at = now(),
		    started_at = now(),
		    attempt = attempt + 1
		WHERE id = (
			SELECT id
			FROM ${wikiCompileJobs}
			WHERE status = 'pending'
			ORDER BY created_at ASC
			FOR UPDATE SKIP LOCKED
			LIMIT 1
		)
		RETURNING *
	`);
	// pg returns { rows: [...] }; some drivers return arrays directly.
	const row = Array.isArray(result)
		? result[0]
		: ((result as { rows?: unknown[] })?.rows?.[0] ?? null);
	return (row as WikiCompileJobRow | null) ?? null;
}

/**
 * Load a specific compile job (used by admin/compile-now paths).
 */
export async function getCompileJob(
	jobId: string,
	db: DbClient = defaultDb,
): Promise<WikiCompileJobRow | null> {
	if (!isValidUuid(jobId)) return null;
	const rows = await db
		.select()
		.from(wikiCompileJobs)
		.where(eq(wikiCompileJobs.id, jobId))
		.limit(1);
	return (rows[0] as WikiCompileJobRow | undefined) ?? null;
}

/** Mark a job finished (succeeded | failed | skipped), recording metrics. */
export async function completeCompileJob(
	args: {
		jobId: string;
		status: Exclude<WikiCompileJobStatus, "pending" | "running">;
		metrics?: Record<string, unknown>;
		error?: string | null;
	},
	db: DbClient = defaultDb,
): Promise<void> {
	await db
		.update(wikiCompileJobs)
		.set({
			status: args.status,
			finished_at: sql`now()`,
			metrics: args.metrics ?? null,
			error: args.error ?? null,
		})
		.where(eq(wikiCompileJobs.id, args.jobId));
}

// ---------------------------------------------------------------------------
// Compile cursors
// ---------------------------------------------------------------------------

/**
 * Returns the cursor for (tenant, owner). If none exists, returns a fresh
 * cursor (all nulls).
 */
export async function getCursor(
	args: { tenantId: string; ownerId: string },
	db: DbClient = defaultDb,
): Promise<Cursor> {
	const rows = await db
		.select()
		.from(wikiCompileCursors)
		.where(
			and(
				eq(wikiCompileCursors.tenant_id, args.tenantId),
				eq(wikiCompileCursors.owner_id, args.ownerId),
			),
		)
		.limit(1);
	const row = rows[0] as WikiCompileCursorRow | undefined;
	return {
		updatedAt: row?.last_record_updated_at ?? null,
		recordId: row?.last_record_id ?? null,
	};
}

/** Advance (or initialize) the cursor for (tenant, owner). */
export async function setCursor(
	args: {
		tenantId: string;
		ownerId: string;
		updatedAt: Date;
		recordId: string;
	},
	db: DbClient = defaultDb,
): Promise<void> {
	await db
		.insert(wikiCompileCursors)
		.values({
			tenant_id: args.tenantId,
			owner_id: args.ownerId,
			last_record_updated_at: args.updatedAt,
			last_record_id: args.recordId,
		})
		.onConflictDoUpdate({
			target: [wikiCompileCursors.tenant_id, wikiCompileCursors.owner_id],
			set: {
				last_record_updated_at: args.updatedAt,
				last_record_id: args.recordId,
				updated_at: sql`now()`,
			},
		});
}

/** Clear the cursor for (tenant, owner) — admin replay path. */
export async function resetCursor(
	args: { tenantId: string; ownerId: string },
	db: DbClient = defaultDb,
): Promise<void> {
	await db
		.delete(wikiCompileCursors)
		.where(
			and(
				eq(wikiCompileCursors.tenant_id, args.tenantId),
				eq(wikiCompileCursors.owner_id, args.ownerId),
			),
		);
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

export async function findPageBySlug(
	args: {
		tenantId: string;
		ownerId: string;
		type: WikiPageType;
		slug: string;
	},
	db: DbClient = defaultDb,
): Promise<WikiPageRow | null> {
	const rows = await db
		.select()
		.from(wikiPages)
		.where(
			and(
				eq(wikiPages.tenant_id, args.tenantId),
				eq(wikiPages.owner_id, args.ownerId),
				eq(wikiPages.type, args.type),
				eq(wikiPages.slug, args.slug),
			),
		)
		.limit(1);
	return (rows[0] as WikiPageRow | undefined) ?? null;
}

export async function findPageById(
	pageId: string,
	db: DbClient = defaultDb,
): Promise<WikiPageRow | null> {
	// LLM-provided plans sometimes carry truncated or fabricated ids; return
	// null silently so applyPlan skips the update instead of failing the job.
	if (!isValidUuid(pageId)) return null;
	const rows = await db
		.select()
		.from(wikiPages)
		.where(eq(wikiPages.id, pageId))
		.limit(1);
	return (rows[0] as WikiPageRow | undefined) ?? null;
}

/**
 * List active pages in a (tenant, owner) scope with their aliases. Used by
 * the compiler to feed candidate pages into the planner so it can choose
 * update-vs-create against a finite set it has already seen.
 */
export async function listPagesForScope(
	args: { tenantId: string; ownerId: string; limit?: number },
	db: DbClient = defaultDb,
): Promise<
	Array<{
		id: string;
		type: WikiPageType;
		slug: string;
		title: string;
		summary: string | null;
		aliases: string[];
	}>
> {
	const limit = Math.max(1, Math.min(args.limit ?? 200, 500));
	const pageRows = await db
		.select({
			id: wikiPages.id,
			type: wikiPages.type,
			slug: wikiPages.slug,
			title: wikiPages.title,
			summary: wikiPages.summary,
		})
		.from(wikiPages)
		.where(
			and(
				eq(wikiPages.tenant_id, args.tenantId),
				eq(wikiPages.owner_id, args.ownerId),
				eq(wikiPages.status, "active"),
			),
		)
		.orderBy(desc(wikiPages.last_compiled_at))
		.limit(limit);

	if (pageRows.length === 0) return [];

	const ids = pageRows.map((r) => r.id);
	// pg's node driver doesn't auto-marshal raw JS arrays as Postgres arrays
	// on the right side of `= ANY (...)`, so the `sql\`ANY\`` form we used
	// earlier failed at runtime with `requires array on right side`. Drizzle's
	// `inArray()` emits a parameterized `IN ($1, $2, …)` which works
	// correctly regardless of driver version.
	const aliasRows = await db
		.select({ page_id: wikiPageAliases.page_id, alias: wikiPageAliases.alias })
		.from(wikiPageAliases)
		.where(inArray(wikiPageAliases.page_id, ids));

	const aliasesByPage = new Map<string, string[]>();
	for (const a of aliasRows) {
		const list = aliasesByPage.get(a.page_id) || [];
		list.push(a.alias);
		aliasesByPage.set(a.page_id, list);
	}

	return pageRows.map((p) => ({
		id: p.id,
		type: p.type as WikiPageType,
		slug: p.slug,
		title: p.title,
		summary: p.summary,
		aliases: aliasesByPage.get(p.id) ?? [],
	}));
}

/**
 * List open unresolved mentions in a scope — fed to the planner so it can
 * either reinforce a mention (increment count by proposing it again) or
 * promote one explicitly.
 */
export async function listOpenMentions(
	args: { tenantId: string; ownerId: string; limit?: number },
	db: DbClient = defaultDb,
): Promise<
	Array<{
		id: string;
		alias: string;
		alias_normalized: string;
		mention_count: number;
		suggested_type: WikiPageType | null;
	}>
> {
	const limit = Math.max(1, Math.min(args.limit ?? 200, 500));
	const rows = await db
		.select({
			id: wikiUnresolvedMentions.id,
			alias: wikiUnresolvedMentions.alias,
			alias_normalized: wikiUnresolvedMentions.alias_normalized,
			mention_count: wikiUnresolvedMentions.mention_count,
			suggested_type: wikiUnresolvedMentions.suggested_type,
		})
		.from(wikiUnresolvedMentions)
		.where(
			and(
				eq(wikiUnresolvedMentions.tenant_id, args.tenantId),
				eq(wikiUnresolvedMentions.owner_id, args.ownerId),
				eq(wikiUnresolvedMentions.status, "open"),
			),
		)
		.orderBy(desc(wikiUnresolvedMentions.mention_count))
		.limit(limit);
	return rows as any;
}

/** Read all sections for a page ordered by position. */
export async function listPageSections(
	pageId: string,
	db: DbClient = defaultDb,
): Promise<
	Array<{
		id: string;
		section_slug: string;
		heading: string;
		body_md: string;
		position: number;
		last_source_at: Date | null;
		aggregation: SectionAggregation | null;
	}>
> {
	const rows = await db
		.select({
			id: wikiPageSections.id,
			section_slug: wikiPageSections.section_slug,
			heading: wikiPageSections.heading,
			body_md: wikiPageSections.body_md,
			position: wikiPageSections.position,
			last_source_at: wikiPageSections.last_source_at,
			aggregation: wikiPageSections.aggregation,
		})
		.from(wikiPageSections)
		.where(eq(wikiPageSections.page_id, pageId))
		.orderBy(asc(wikiPageSections.position));
	return rows.map((r) => ({
		id: r.id,
		section_slug: r.section_slug,
		heading: r.heading,
		body_md: r.body_md,
		position: r.position,
		last_source_at: r.last_source_at,
		aggregation: (r.aggregation as SectionAggregation | null) ?? null,
	}));
}

/**
 * Upsert a page with its sections and aliases in a single transaction.
 * Recomputes `body_md` from sections (ordered by position) and updates
 * `last_compiled_at` when markCompiled is true. `search_tsv` is a generated
 * column — Postgres recomputes it from title/summary/body_md automatically.
 *
 * Sections not present in `sections` are left untouched — callers compute
 * the section diff before invoking this (see lib/wiki/compiler.ts).
 */
export async function upsertPage(
	input: UpsertPageInput,
	db: DbClient = defaultDb,
): Promise<WikiPageRow> {
	return db.transaction(async (tx) => {
		const existing = await findPageBySlug(
			{
				tenantId: input.tenant_id,
				ownerId: input.owner_id,
				type: input.type,
				slug: input.slug,
			},
			tx as DbClient,
		);

		const body_md = input.sections
			? renderBodyMarkdown(input.sections)
			: undefined;

		let page: WikiPageRow;
		if (existing) {
			// Status resolution: explicit input.status wins; otherwise if we're
			// compiling (markCompiled) treat this as a resurrection of the page
			// and flip it back to 'active'. Falling through to existing.status
			// without that step left archived pages archived forever after a
			// `resetWikiCursor(force: true)` cycle, which silently lost content.
			const nextStatus: WikiPageStatus =
				input.status ??
				(input.markCompiled
					? "active"
					: (existing.status as WikiPageStatus));
			const [updated] = await tx
				.update(wikiPages)
				.set({
					title: input.title,
					summary: input.summary ?? existing.summary,
					status: nextStatus,
					...(body_md !== undefined ? { body_md } : {}),
					...(input.markCompiled
						? { last_compiled_at: sql`now()` as any }
						: {}),
					updated_at: sql`now()` as any,
				})
				.where(eq(wikiPages.id, existing.id))
				.returning();
			page = updated as WikiPageRow;
		} else {
			const [inserted] = await tx
				.insert(wikiPages)
				.values({
					tenant_id: input.tenant_id,
					owner_id: input.owner_id,
					type: input.type,
					slug: input.slug,
					title: input.title,
					summary: input.summary ?? null,
					body_md: body_md ?? null,
					status: input.status ?? "active",
					last_compiled_at: input.markCompiled
						? (sql`now()` as any)
						: null,
				})
				.returning();
			page = inserted as WikiPageRow;
		}

		if (input.sections && input.sections.length > 0) {
			await upsertSections(page.id, input.sections, tx as DbClient);
		}

		if (input.aliases && input.aliases.length > 0) {
			for (const { alias, source } of input.aliases) {
				await tx
					.insert(wikiPageAliases)
					.values({
						page_id: page.id,
						alias,
						source: source ?? "compiler",
					})
					.onConflictDoNothing();
			}
		}

		return page;
	});
}

/**
 * Upsert sections for a page. Each incoming section matches an existing row
 * via (page_id, section_slug). New sections are inserted, existing ones are
 * updated, and provenance rows are appended. Sections not referenced here
 * are left in place.
 */
export async function upsertSections(
	pageId: string,
	sections: WikiSectionInput[],
	db: DbClient = defaultDb,
): Promise<void> {
	for (const section of sections) {
		const existing = await db
			.select({ id: wikiPageSections.id })
			.from(wikiPageSections)
			.where(
				and(
					eq(wikiPageSections.page_id, pageId),
					eq(wikiPageSections.section_slug, section.section_slug),
				),
			)
			.limit(1);

		let sectionId: string;
		if (existing[0]) {
			sectionId = existing[0].id;
			await db
				.update(wikiPageSections)
				.set({
					heading: section.heading,
					body_md: section.body_md,
					position: section.position,
					last_source_at: sql`now()` as any,
					updated_at: sql`now()` as any,
				})
				.where(eq(wikiPageSections.id, sectionId));
		} else {
			const [inserted] = await db
				.insert(wikiPageSections)
				.values({
					page_id: pageId,
					section_slug: section.section_slug,
					heading: section.heading,
					body_md: section.body_md,
					position: section.position,
					last_source_at: sql`now()` as any,
				})
				.returning({ id: wikiPageSections.id });
			sectionId = inserted!.id;
		}

		if (section.sources && section.sources.length > 0) {
			await recordSectionSources(
				sectionId,
				section.sources.map((s) => ({ kind: s.kind, ref: s.ref })),
				db,
			);
		}
	}

	// Refresh the page body_md to stay in sync with the section set.
	const allSections = await listPageSections(pageId, db);
	const rendered = renderBodyMarkdown(
		allSections.map((s) => ({
			section_slug: s.section_slug,
			heading: s.heading,
			body_md: s.body_md,
			position: s.position,
		})),
	);
	await db
		.update(wikiPages)
		.set({ body_md: rendered, updated_at: sql`now()` as any })
		.where(eq(wikiPages.id, pageId));
}

// ---------------------------------------------------------------------------
// Aliases
// ---------------------------------------------------------------------------

/**
 * Find pages in the caller's (tenant, owner) scope whose alias matches the
 * normalized input. v1 is strictly owner-scoped — no cross-agent alias lookup.
 */
export async function findAliasMatches(
	args: {
		tenantId: string;
		ownerId: string;
		aliasNormalized: string;
	},
	db: DbClient = defaultDb,
): Promise<Array<{ pageId: string; aliasId: string; aliasText: string }>> {
	const rows = await db
		.select({
			pageId: wikiPageAliases.page_id,
			aliasId: wikiPageAliases.id,
			aliasText: wikiPageAliases.alias,
		})
		.from(wikiPageAliases)
		.innerJoin(wikiPages, eq(wikiPageAliases.page_id, wikiPages.id))
		.where(
			and(
				eq(wikiPageAliases.alias, args.aliasNormalized),
				eq(wikiPages.tenant_id, args.tenantId),
				eq(wikiPages.owner_id, args.ownerId),
			),
		);
	return rows.map((r) => ({
		pageId: r.pageId,
		aliasId: r.aliasId,
		aliasText: r.aliasText,
	}));
}

// ---------------------------------------------------------------------------
// Unresolved mentions
// ---------------------------------------------------------------------------

const MAX_SAMPLE_CONTEXTS = 5;

/**
 * Accumulate a mention: creates an `open` row if none exists for the scope/
 * alias, otherwise increments the counter and refreshes `last_seen_at`.
 * The optional `context` is appended to `sample_contexts` (capped at 5).
 */
export async function upsertUnresolvedMention(
	input: UpsertUnresolvedInput,
	db: DbClient = defaultDb,
): Promise<{ id: string; mention_count: number; inserted: boolean }> {
	const existing = await db
		.select()
		.from(wikiUnresolvedMentions)
		.where(
			and(
				eq(wikiUnresolvedMentions.tenant_id, input.tenant_id),
				eq(wikiUnresolvedMentions.owner_id, input.owner_id),
				eq(wikiUnresolvedMentions.alias_normalized, input.alias_normalized),
				eq(wikiUnresolvedMentions.status, "open"),
			),
		)
		.limit(1);

	const contextEntry = input.context
		? {
				quote: input.context.quote,
				source_ref: input.context.source_ref,
				seen_at: new Date().toISOString(),
			}
		: null;

	if (existing[0]) {
		const row = existing[0] as any;
		const nextSamples = contextEntry
			? [contextEntry, ...((row.sample_contexts ?? []) as any[])].slice(
					0,
					MAX_SAMPLE_CONTEXTS,
				)
			: row.sample_contexts;
		await db
			.update(wikiUnresolvedMentions)
			.set({
				mention_count: sql`${wikiUnresolvedMentions.mention_count} + 1`,
				last_seen_at: sql`now()` as any,
				sample_contexts: nextSamples,
				suggested_type: input.suggested_type ?? row.suggested_type,
				updated_at: sql`now()` as any,
			})
			.where(eq(wikiUnresolvedMentions.id, row.id));
		return {
			id: row.id,
			mention_count: (row.mention_count as number) + 1,
			inserted: false,
		};
	}

	const [inserted] = await db
		.insert(wikiUnresolvedMentions)
		.values({
			tenant_id: input.tenant_id,
			owner_id: input.owner_id,
			alias: input.alias,
			alias_normalized: input.alias_normalized,
			suggested_type: input.suggested_type ?? null,
			sample_contexts: contextEntry ? [contextEntry] : [],
		})
		.returning({
			id: wikiUnresolvedMentions.id,
			mention_count: wikiUnresolvedMentions.mention_count,
		});
	return {
		id: inserted!.id,
		mention_count: inserted!.mention_count,
		inserted: true,
	};
}

/** Mark an unresolved mention as promoted and point it at the new page. */
export async function markUnresolvedPromoted(
	args: { mentionId: string; pageId: string },
	db: DbClient = defaultDb,
): Promise<void> {
	// Guard against hallucinated mention ids from the planner.
	if (!isValidUuid(args.mentionId) || !isValidUuid(args.pageId)) return;
	await db
		.update(wikiUnresolvedMentions)
		.set({
			status: "promoted",
			promoted_page_id: args.pageId,
			updated_at: sql`now()` as any,
		})
		.where(eq(wikiUnresolvedMentions.id, args.mentionId));
}

/**
 * Candidates ready for promotion per the v1 rule: open, mention_count >= n,
 * last_seen_at within the configured recency window. Defaults match the
 * build plan (count ≥ 3, last_seen within 30 days).
 */
export async function listPromotionCandidates(
	args: {
		tenantId: string;
		ownerId: string;
		minCount?: number;
		withinDays?: number;
	},
	db: DbClient = defaultDb,
): Promise<
	Array<{
		id: string;
		alias: string;
		alias_normalized: string;
		mention_count: number;
		suggested_type: WikiPageType | null;
		sample_contexts: unknown;
	}>
> {
	const minCount = args.minCount ?? 3;
	const withinDays = args.withinDays ?? 30;
	const rows = await db
		.select({
			id: wikiUnresolvedMentions.id,
			alias: wikiUnresolvedMentions.alias,
			alias_normalized: wikiUnresolvedMentions.alias_normalized,
			mention_count: wikiUnresolvedMentions.mention_count,
			suggested_type: wikiUnresolvedMentions.suggested_type,
			sample_contexts: wikiUnresolvedMentions.sample_contexts,
		})
		.from(wikiUnresolvedMentions)
		.where(
			and(
				eq(wikiUnresolvedMentions.tenant_id, args.tenantId),
				eq(wikiUnresolvedMentions.owner_id, args.ownerId),
				eq(wikiUnresolvedMentions.status, "open"),
				sql`${wikiUnresolvedMentions.mention_count} >= ${minCount}`,
				sql`${wikiUnresolvedMentions.last_seen_at} >= now() - (${withinDays} || ' days')::interval`,
			),
		)
		.orderBy(desc(wikiUnresolvedMentions.mention_count));
	return rows as any;
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

/**
 * Record provenance for a section — idempotent per (section, kind, ref).
 * Safe to call repeatedly; existing rows keep their `first_seen_at`.
 */
export async function recordSectionSources(
	sectionId: string,
	sources: Array<{ kind: WikiSectionSourceKind; ref: string }>,
	db: DbClient = defaultDb,
): Promise<void> {
	if (sources.length === 0) return;
	await db
		.insert(wikiSectionSources)
		.values(
			sources.map((s) => ({
				section_id: sectionId,
				source_kind: s.kind,
				source_ref: s.ref,
			})),
		)
		.onConflictDoNothing();
}

// ---------------------------------------------------------------------------
// Page-to-page links
// ---------------------------------------------------------------------------

export async function upsertPageLink(
	args: {
		fromPageId: string;
		toPageId: string;
		context?: string | null;
		/** Link discriminator. Defaults to 'reference' for the historical
		 * wikilink case. 'parent_of' / 'child_of' express durable hierarchy
		 * created by section promotion. */
		kind?: WikiPageLinkKind;
	},
	db: DbClient = defaultDb,
): Promise<void> {
	if (args.fromPageId === args.toPageId) return; // no self-links
	await db
		.insert(wikiPageLinks)
		.values({
			from_page_id: args.fromPageId,
			to_page_id: args.toPageId,
			kind: args.kind ?? "reference",
			context: args.context ?? null,
		})
		.onConflictDoNothing();
}

export async function listBacklinks(
	pageId: string,
	db: DbClient = defaultDb,
): Promise<Array<{ id: string; type: WikiPageType; slug: string; title: string }>> {
	const rows = await db
		.select({
			id: wikiPages.id,
			type: wikiPages.type,
			slug: wikiPages.slug,
			title: wikiPages.title,
		})
		.from(wikiPageLinks)
		.innerJoin(wikiPages, eq(wikiPageLinks.from_page_id, wikiPages.id))
		.where(eq(wikiPageLinks.to_page_id, pageId));
	return rows as any;
}

// ---------------------------------------------------------------------------
// Hierarchical aggregation — parent/child, section aggregation, hubness
// ---------------------------------------------------------------------------

/**
 * Set a page's parent pointer and mirror it into the page-link graph as
 * `parent_of` (parent → child) and `child_of` (child → parent). Idempotent:
 * calling again with the same arguments is a no-op beyond the UPDATE.
 *
 * Pass `null` as parentPageId to detach the page from its current parent;
 * this also removes the hierarchy link rows (but leaves `reference` links
 * between the same pages untouched, since link uniqueness now includes kind).
 */
export async function setParentPage(
	args: { pageId: string; parentPageId: string | null },
	db: DbClient = defaultDb,
): Promise<void> {
	if (args.pageId === args.parentPageId) {
		throw new Error("setParentPage: a page cannot be its own parent");
	}
	await db.transaction(async (tx) => {
		const [existing] = await tx
			.select({ parent_page_id: wikiPages.parent_page_id })
			.from(wikiPages)
			.where(eq(wikiPages.id, args.pageId))
			.limit(1);
		if (!existing) {
			throw new Error(`setParentPage: page ${args.pageId} not found`);
		}

		const previousParent = existing.parent_page_id as string | null;

		await tx
			.update(wikiPages)
			.set({
				parent_page_id: args.parentPageId,
				updated_at: sql`now()` as any,
			})
			.where(eq(wikiPages.id, args.pageId));

		// Remove stale hierarchy links when the parent changes or is cleared.
		if (previousParent && previousParent !== args.parentPageId) {
			await tx
				.delete(wikiPageLinks)
				.where(
					and(
						eq(wikiPageLinks.from_page_id, previousParent),
						eq(wikiPageLinks.to_page_id, args.pageId),
						eq(wikiPageLinks.kind, "parent_of"),
					),
				);
			await tx
				.delete(wikiPageLinks)
				.where(
					and(
						eq(wikiPageLinks.from_page_id, args.pageId),
						eq(wikiPageLinks.to_page_id, previousParent),
						eq(wikiPageLinks.kind, "child_of"),
					),
				);
		}

		if (args.parentPageId) {
			await tx
				.insert(wikiPageLinks)
				.values([
					{
						from_page_id: args.parentPageId,
						to_page_id: args.pageId,
						kind: "parent_of",
					},
					{
						from_page_id: args.pageId,
						to_page_id: args.parentPageId,
						kind: "child_of",
					},
				])
				.onConflictDoNothing();
		}
	});
}

/** Read all direct children of a page. */
export async function listChildPages(
	parentPageId: string,
	db: DbClient = defaultDb,
): Promise<WikiPageRow[]> {
	const rows = await db
		.select()
		.from(wikiPages)
		.where(eq(wikiPages.parent_page_id, parentPageId));
	return rows as WikiPageRow[];
}

/**
 * Pure merge of a patch into existing section aggregation metadata. Kept
 * separate so the pure logic is unit-testable without hitting the DB:
 *   - scalar keys: patch wins, undefined keys keep current
 *   - array keys (linked_page_ids, observed_tags): dedup after merge;
 *     patch REPLACES (the planner emits the authoritative list per call)
 *   - supporting_record_count: patch REPLACES; callers that want to
 *     accumulate should pass `current + n`
 */
export function mergeSectionAggregation(
	current: SectionAggregation | null,
	patch: Partial<SectionAggregation>,
): SectionAggregation {
	const base = current ?? emptySectionAggregation();
	return {
		...base,
		...patch,
		linked_page_ids: dedupe(
			(patch.linked_page_ids ?? base.linked_page_ids) || [],
		),
		observed_tags: dedupe((patch.observed_tags ?? base.observed_tags) || []),
	};
}

/**
 * Merge aggregation metadata into a section. Existing keys are overwritten
 * when provided in `patch`; keys absent from `patch` are preserved. Writing
 * NULL to the column is explicitly not supported here — callers that want
 * to clear aggregation should set `promotion_status: "suppressed"` and let
 * the row keep its history.
 */
export async function upsertSectionAggregation(
	args: { sectionId: string; patch: Partial<SectionAggregation> },
	db: DbClient = defaultDb,
): Promise<SectionAggregation> {
	return db.transaction(async (tx) => {
		const [row] = await tx
			.select({ aggregation: wikiPageSections.aggregation })
			.from(wikiPageSections)
			.where(eq(wikiPageSections.id, args.sectionId))
			.limit(1);
		if (!row) {
			throw new Error(
				`upsertSectionAggregation: section ${args.sectionId} not found`,
			);
		}
		const merged = mergeSectionAggregation(
			row.aggregation as SectionAggregation | null,
			args.patch,
		);
		await tx
			.update(wikiPageSections)
			.set({
				aggregation: merged as any,
				updated_at: sql`now()` as any,
			})
			.where(eq(wikiPageSections.id, args.sectionId));
		return merged;
	});
}

/**
 * Recompute hubness_score for a page and persist it. Formula is intentionally
 * narrow — we only need a monotonic ordering, not a precise number:
 *
 *     hubness = inbound_reference_links
 *             + 2 * promoted_child_count
 *             + floor(avg(section.supporting_record_count) / 10)
 *
 * Returns the freshly-written score.
 */
export async function recomputeHubness(
	pageId: string,
	db: DbClient = defaultDb,
): Promise<number> {
	const [inboundRefs] = await db
		.select({
			count: sql<number>`count(*)::int`,
		})
		.from(wikiPageLinks)
		.where(
			and(
				eq(wikiPageLinks.to_page_id, pageId),
				eq(wikiPageLinks.kind, "reference"),
			),
		);

	const [promotedChildren] = await db
		.select({
			count: sql<number>`count(*)::int`,
		})
		.from(wikiPages)
		.where(eq(wikiPages.parent_page_id, pageId));

	const [sectionAvg] = await db
		.select({
			avgRecords: sql<number>`coalesce(avg((aggregation->>'supporting_record_count')::int), 0)::float`,
		})
		.from(wikiPageSections)
		.where(eq(wikiPageSections.page_id, pageId));

	const score =
		(inboundRefs?.count ?? 0) +
		2 * (promotedChildren?.count ?? 0) +
		Math.floor((sectionAvg?.avgRecords ?? 0) / 10);

	await db
		.update(wikiPages)
		.set({ hubness_score: score, updated_at: sql`now()` as any })
		.where(eq(wikiPages.id, pageId));
	return score;
}

/**
 * Pages whose sections have been touched since `sinceUpdatedAt` — the input
 * set for the aggregation pass. Ordered by most-recently-updated first so
 * callers can clamp to a reasonable window without missing hot pages.
 */
export async function listRecentlyChangedPagesForAggregation(
	args: {
		tenantId: string;
		ownerId: string;
		sinceUpdatedAt: Date | null;
		limit?: number;
	},
	db: DbClient = defaultDb,
): Promise<WikiPageRow[]> {
	const limit = Math.max(1, Math.min(args.limit ?? 100, 500));
	const since = args.sinceUpdatedAt ?? new Date(0);
	const rows = await db
		.select()
		.from(wikiPages)
		.where(
			and(
				eq(wikiPages.tenant_id, args.tenantId),
				eq(wikiPages.owner_id, args.ownerId),
				eq(wikiPages.status, "active"),
				gte(wikiPages.updated_at, since),
			),
		)
		.orderBy(desc(wikiPages.updated_at))
		.limit(limit);
	return rows as WikiPageRow[];
}

/**
 * Summary of a (tenant, owner) scope's wiki state. Used by the wipe +
 * rebuild tooling to report before/after counts.
 */
export interface WikiScopeCounts {
	pages: number;
	sections: number;
	links: number;
	aliases: number;
	unresolved_mentions: number;
	compile_jobs: number;
	has_cursor: boolean;
	/** Pages whose parent_page_id is set — emergent hierarchy count. */
	pages_with_parent: number;
	/** Sections whose aggregation.promotion_status is 'promoted'. */
	sections_promoted: number;
	/** Sections whose aggregation.promotion_status is 'candidate'. */
	sections_promotion_candidate: number;
}

/** Count everything in the scope without reading row bodies. */
export async function countWikiScope(
	args: { tenantId: string; ownerId: string },
	db: DbClient = defaultDb,
): Promise<WikiScopeCounts> {
	const [pages] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(wikiPages)
		.where(
			and(
				eq(wikiPages.tenant_id, args.tenantId),
				eq(wikiPages.owner_id, args.ownerId),
			),
		);
	const [sections] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(wikiPageSections)
		.innerJoin(wikiPages, eq(wikiPageSections.page_id, wikiPages.id))
		.where(
			and(
				eq(wikiPages.tenant_id, args.tenantId),
				eq(wikiPages.owner_id, args.ownerId),
			),
		);
	const [links] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(wikiPageLinks)
		.innerJoin(wikiPages, eq(wikiPageLinks.from_page_id, wikiPages.id))
		.where(
			and(
				eq(wikiPages.tenant_id, args.tenantId),
				eq(wikiPages.owner_id, args.ownerId),
			),
		);
	const [aliases] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(wikiPageAliases)
		.innerJoin(wikiPages, eq(wikiPageAliases.page_id, wikiPages.id))
		.where(
			and(
				eq(wikiPages.tenant_id, args.tenantId),
				eq(wikiPages.owner_id, args.ownerId),
			),
		);
	const [mentions] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(wikiUnresolvedMentions)
		.where(
			and(
				eq(wikiUnresolvedMentions.tenant_id, args.tenantId),
				eq(wikiUnresolvedMentions.owner_id, args.ownerId),
			),
		);
	const [jobs] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(wikiCompileJobs)
		.where(
			and(
				eq(wikiCompileJobs.tenant_id, args.tenantId),
				eq(wikiCompileJobs.owner_id, args.ownerId),
			),
		);
	const [cursor] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(wikiCompileCursors)
		.where(
			and(
				eq(wikiCompileCursors.tenant_id, args.tenantId),
				eq(wikiCompileCursors.owner_id, args.ownerId),
			),
		);
	const [pagesWithParent] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(wikiPages)
		.where(
			and(
				eq(wikiPages.tenant_id, args.tenantId),
				eq(wikiPages.owner_id, args.ownerId),
				sql`${wikiPages.parent_page_id} is not null`,
			),
		);
	const [sectionsPromoted] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(wikiPageSections)
		.innerJoin(wikiPages, eq(wikiPageSections.page_id, wikiPages.id))
		.where(
			and(
				eq(wikiPages.tenant_id, args.tenantId),
				eq(wikiPages.owner_id, args.ownerId),
				sql`${wikiPageSections.aggregation}->>'promotion_status' = 'promoted'`,
			),
		);
	const [sectionsCandidate] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(wikiPageSections)
		.innerJoin(wikiPages, eq(wikiPageSections.page_id, wikiPages.id))
		.where(
			and(
				eq(wikiPages.tenant_id, args.tenantId),
				eq(wikiPages.owner_id, args.ownerId),
				sql`${wikiPageSections.aggregation}->>'promotion_status' = 'candidate'`,
			),
		);

	return {
		pages: pages?.n ?? 0,
		sections: sections?.n ?? 0,
		links: links?.n ?? 0,
		aliases: aliases?.n ?? 0,
		unresolved_mentions: mentions?.n ?? 0,
		compile_jobs: jobs?.n ?? 0,
		has_cursor: (cursor?.n ?? 0) > 0,
		pages_with_parent: pagesWithParent?.n ?? 0,
		sections_promoted: sectionsPromoted?.n ?? 0,
		sections_promotion_candidate: sectionsCandidate?.n ?? 0,
	};
}

/**
 * Delete every compiled wiki row for a single (tenant, owner) scope.
 *
 * DESTRUCTIVE. Intended for the wipe-and-rebuild path: purge compiled rows
 * so a subsequent `bootstrapJournalImport` rebuilds from canonical memory.
 * Canonical memory (Hindsight) is NOT touched — only this compiled store.
 *
 * Runs inside a transaction; if any DELETE fails, nothing is committed.
 * Cascades on `wiki_pages` handle sections / links / aliases / section-
 * sources automatically (see FK definitions in the schema). Unresolved
 * mentions and compile jobs/cursor are scoped directly.
 */
export async function wipeWikiScope(
	args: { tenantId: string; ownerId: string },
	db: DbClient = defaultDb,
): Promise<{
	before: WikiScopeCounts;
	after: WikiScopeCounts;
}> {
	if (!args.tenantId || !args.ownerId) {
		throw new Error(
			"wipeWikiScope: tenantId and ownerId are both required — refusing to wipe unscoped",
		);
	}
	const before = await countWikiScope(args, db);
	await db.transaction(async (tx) => {
		// Cascades delete sections / links / aliases / section_sources.
		await tx
			.delete(wikiPages)
			.where(
				and(
					eq(wikiPages.tenant_id, args.tenantId),
					eq(wikiPages.owner_id, args.ownerId),
				),
			);
		await tx
			.delete(wikiUnresolvedMentions)
			.where(
				and(
					eq(wikiUnresolvedMentions.tenant_id, args.tenantId),
					eq(wikiUnresolvedMentions.owner_id, args.ownerId),
				),
			);
		await tx
			.delete(wikiCompileJobs)
			.where(
				and(
					eq(wikiCompileJobs.tenant_id, args.tenantId),
					eq(wikiCompileJobs.owner_id, args.ownerId),
				),
			);
		await tx
			.delete(wikiCompileCursors)
			.where(
				and(
					eq(wikiCompileCursors.tenant_id, args.tenantId),
					eq(wikiCompileCursors.owner_id, args.ownerId),
				),
			);
	});
	const after = await countWikiScope(args, db);
	return { before, after };
}

function dedupe<T>(items: T[]): T[] {
	const seen = new Set<T>();
	const out: T[] = [];
	for (const x of items) {
		if (seen.has(x)) continue;
		seen.add(x);
		out.push(x);
	}
	return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Render page body markdown by concatenating sections ordered by `position`,
 * with each section prefixed by its heading. Kept deterministic so that
 * `body_md` comparisons during compile can detect drift.
 */
export function renderBodyMarkdown(
	sections: Array<Pick<WikiSectionInput, "heading" | "body_md" | "position">>,
): string {
	const sorted = [...sections].sort((a, b) => a.position - b.position);
	return sorted
		.map((s) => `## ${s.heading}\n\n${s.body_md}`.trim())
		.join("\n\n");
}
