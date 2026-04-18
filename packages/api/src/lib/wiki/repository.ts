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

import { and, asc, desc, eq, sql } from "drizzle-orm";
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
	const rows = await db
		.select()
		.from(wikiPages)
		.where(eq(wikiPages.id, pageId))
		.limit(1);
	return (rows[0] as WikiPageRow | undefined) ?? null;
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
		})
		.from(wikiPageSections)
		.where(eq(wikiPageSections.page_id, pageId))
		.orderBy(asc(wikiPageSections.position));
	return rows as any;
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
			const [updated] = await tx
				.update(wikiPages)
				.set({
					title: input.title,
					summary: input.summary ?? existing.summary,
					status: input.status ?? existing.status,
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
	args: { fromPageId: string; toPageId: string; context?: string | null },
	db: DbClient = defaultDb,
): Promise<void> {
	if (args.fromPageId === args.toPageId) return; // no self-links
	await db
		.insert(wikiPageLinks)
		.values({
			from_page_id: args.fromPageId,
			to_page_id: args.toPageId,
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
