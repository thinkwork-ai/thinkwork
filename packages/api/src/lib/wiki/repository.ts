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
	wikiPlaces,
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
	/** Optional pointer into wiki_places. See wiki-places-v2 plan. */
	place_id: string | null;
	/** Coarse, monotonic hubness signal. Recomputed on upsert. */
	hubness_score: number;
	/** Soft tag hints — never a structural forcing function. */
	tags: string[];
	last_compiled_at: Date | null;
	created_at: Date;
	updated_at: Date;
}

export type WikiPlaceKind =
	| "country"
	| "region"
	| "state"
	| "city"
	| "neighborhood"
	| "poi"
	| "custom";

export type WikiPlaceSource =
	| "google_api"
	| "journal_metadata"
	| "manual"
	| "derived_hierarchy";

export interface WikiPlaceRow {
	id: string;
	tenant_id: string;
	owner_id: string;
	name: string;
	google_place_id: string | null;
	geo_lat: string | null; // numeric returned as text by pg driver
	geo_lon: string | null;
	address: string | null;
	parent_place_id: string | null;
	place_kind: WikiPlaceKind | null;
	source: WikiPlaceSource;
	source_payload: unknown | null;
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
	/** Optional pointer into wiki_places. First-seen-wins: on UPDATE the
	 * existing page's place_id is preserved via COALESCE; the new value only
	 * takes hold when the page had NULL before. See wiki-places-v2 plan. */
	place_id?: string | null;
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

export type DbClient = typeof defaultDb | PgTransaction<any, any, any>;

// ---------------------------------------------------------------------------
// Alias normalization — shared canonical form for lookup & dedupe
// ---------------------------------------------------------------------------

/**
 * Strip `[[wikilink]]` bracket syntax from section body markdown. Models
 * sometimes add it even when the prompt forbids it; brackets render as
 * literal noise on the mobile wiki view because cross-page links come
 * from `wiki_page_links`, not body prose.
 *
 * Handles both `[[Name]]` and Obsidian-style `[[Name|Display]]` (keeps
 * the display text).
 */
export function stripWikilinks(md: string | null | undefined): string {
	if (!md) return "";
	return md.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, plain, display) =>
		(display ?? plain).trim(),
	);
}

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

export const DEDUPE_BUCKET_SECONDS = 300;

export function buildCompileDedupeKey(args: {
	tenantId: string;
	ownerId: string;
	nowEpochSeconds?: number;
}): string {
	const now = args.nowEpochSeconds ?? Math.floor(Date.now() / 1000);
	const bucket = Math.floor(now / DEDUPE_BUCKET_SECONDS);
	return `${args.tenantId}:${args.ownerId}:${bucket}`;
}

/**
 * Extract the bucket number from a compiler-built dedupe key
 * (`{tenant}:{owner}:{bucket}`). Returns `null` when the key doesn't
 * match — e.g., manually-seeded keys like
 * `"marco-rebuild-1776700207"`. Continuation chaining uses this so a
 * chained job knows its *actual* dedupe bucket, not the bucket of its
 * `created_at` (which can trail the dedupe bucket by up to one full
 * `DEDUPE_BUCKET_SECONDS` when the enqueue was scheduled for a future
 * slot and the row was INSERTed earlier).
 */
export function parseCompileDedupeBucket(dedupeKey: string): number | null {
	const parts = dedupeKey.split(":");
	if (parts.length !== 3) return null;
	const n = Number(parts[2]);
	return Number.isFinite(n) && Number.isInteger(n) ? n : null;
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
		/** Override the epoch-seconds used to derive the dedupe bucket. Used
		 * by continuation chaining to enqueue a job against the *next*
		 * bucket so the chain doesn't self-dedupe. Leave unset for the
		 * normal post-turn path. */
		nowEpochSeconds?: number;
	},
	db: DbClient = defaultDb,
): Promise<{ inserted: boolean; job: WikiCompileJobRow }> {
	const dedupeKey = buildCompileDedupeKey({
		tenantId: args.tenantId,
		ownerId: args.ownerId,
		nowEpochSeconds: args.nowEpochSeconds,
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
 * List recent compile jobs for a scope. If `ownerId` is provided, filters to
 * that agent; otherwise returns the tenant's jobs across all owners. Ordered
 * by `created_at DESC`, capped at `limit`.
 */
export async function listCompileJobsForScope(
	args: { tenantId: string; ownerId?: string | null; limit?: number | null },
	db: DbClient = defaultDb,
): Promise<WikiCompileJobRow[]> {
	const cap = Math.min(Math.max(args.limit ?? 10, 1), 100);
	const conditions = args.ownerId
		? and(
				eq(wikiCompileJobs.tenant_id, args.tenantId),
				eq(wikiCompileJobs.owner_id, args.ownerId),
			)
		: eq(wikiCompileJobs.tenant_id, args.tenantId);
	const rows = await db
		.select()
		.from(wikiCompileJobs)
		.where(conditions)
		.orderBy(desc(wikiCompileJobs.created_at))
		.limit(cap);
	return rows as WikiCompileJobRow[];
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

/**
 * Exact-title lookup within a (tenant, owner) scope. Returns every active
 * page whose title matches the input exactly — case- and whitespace-
 * sensitive. The deterministic linker uses this to resolve parent-expander
 * candidates into concrete page ids without guessing at a type (the parent
 * could be either `topic` or `entity`, so the caller filters on type after).
 * Returns all hits so callers can log title collisions rather than silently
 * picking one.
 */
/**
 * Bump `aggregation->last_source_at` on any section of the given leaf's
 * parent page whose `linked_page_ids` contains this leaf. Called after a
 * leaf page is upserted so the next aggregation pass sees its parent
 * sections as freshly touched — without this, a batch that updated only
 * leaves (no newPages, no promotions) leaves parent sections looking
 * stale and they can fall off the aggregation-target shortlist.
 *
 * Returns the number of section rows bumped. Zero is the common case for
 * brand-new leaves that no parent section claims yet — the aggregation
 * pass will register them on its own tick.
 */
export async function bumpSectionLastSeen(
	args: { pageId: string },
	db: DbClient = defaultDb,
): Promise<number> {
	const leafRows = await db
		.select({ parent_page_id: wikiPages.parent_page_id })
		.from(wikiPages)
		.where(eq(wikiPages.id, args.pageId))
		.limit(1);
	const parentId = leafRows[0]?.parent_page_id as string | null | undefined;
	if (!parentId) return 0;

	const nowIso = new Date().toISOString();
	const result = await db.execute(sql`
		UPDATE ${wikiPageSections}
		SET aggregation = jsonb_set(
			aggregation::jsonb,
			'{last_source_at}',
			to_jsonb(${nowIso}::text)::jsonb
		)
		WHERE ${wikiPageSections.page_id} = ${parentId}
			AND aggregation IS NOT NULL
			AND aggregation ? 'linked_page_ids'
			AND (aggregation -> 'linked_page_ids') @> to_jsonb(ARRAY[${args.pageId}]::text[])
		RETURNING ${wikiPageSections.id}
	`);
	const rows =
		(result as unknown as { rows?: Array<{ id: string }> }).rows ?? [];
	return rows.length;
}

/**
 * R5 canary for the link-densification plan — count of (owner_id, title)
 * pairs with more than one active page. Rising means densification may be
 * creating duplicate hubs. Called once per compile job so the time series
 * shows up in CloudWatch next to `links_written_*`.
 */
export async function countDuplicateTitleCandidates(
	args: { tenantId: string; ownerId: string },
	db: DbClient = defaultDb,
): Promise<number> {
	const result = await db.execute(sql`
		SELECT COUNT(*)::int AS n
		FROM (
			SELECT ${wikiPages.owner_id}, ${wikiPages.title}
			FROM ${wikiPages}
			WHERE ${wikiPages.tenant_id} = ${args.tenantId}
				AND ${wikiPages.owner_id} = ${args.ownerId}
				AND ${wikiPages.status} = 'active'
			GROUP BY ${wikiPages.owner_id}, ${wikiPages.title}
			HAVING COUNT(*) > 1
		) dup
	`);
	const rows = (result as unknown as { rows?: Array<{ n: number }> }).rows ?? [];
	return rows[0]?.n ?? 0;
}

/**
 * Trigram-fallback title lookup. Returns active pages whose title's
 * `similarity()` against the input is ≥ threshold (default 0.85 — same
 * as the alias bar in `findAliasMatchesFuzzy`). Results are ordered by
 * similarity desc, capped by `limit` (default 1). Powers the
 * deterministic parent linker's recall-extension path: candidate
 * `"Portland"` resolves to active page `"Portland, Oregon"`.
 *
 * Uses the `idx_wiki_pages_title_trgm` GIN index (migration 0015).
 * Internal try/catch returns empty on `pg_trgm` errors so callers
 * degrade gracefully if the extension is missing.
 */
export async function findPagesByFuzzyTitle(
	args: {
		tenantId: string;
		ownerId: string;
		title: string;
		threshold?: number;
		limit?: number;
	},
	db: DbClient = defaultDb,
): Promise<
	Array<{
		id: string;
		type: WikiPageType;
		slug: string;
		title: string;
		similarity: number;
	}>
> {
	const threshold = args.threshold ?? FUZZY_ALIAS_THRESHOLD;
	const limit = Math.max(1, Math.min(args.limit ?? 1, 20));
	try {
		const result = await db.execute(sql`
			SELECT
				${wikiPages.id}     AS "id",
				${wikiPages.type}   AS "type",
				${wikiPages.slug}   AS "slug",
				${wikiPages.title}  AS "title",
				similarity(${wikiPages.title}, ${args.title}) AS "similarity"
			FROM ${wikiPages}
			WHERE ${wikiPages.tenant_id} = ${args.tenantId}
				AND ${wikiPages.owner_id} = ${args.ownerId}
				AND ${wikiPages.status} = 'active'
				AND similarity(${wikiPages.title}, ${args.title}) >= ${threshold}
			ORDER BY similarity(${wikiPages.title}, ${args.title}) DESC
			LIMIT ${limit}
		`);
		const rows =
			(
				result as unknown as {
					rows?: Array<{
						id: string;
						type: WikiPageType;
						slug: string;
						title: string;
						similarity: number | string;
					}>;
				}
			).rows ?? [];
		return rows.map((r) => ({
			id: r.id,
			type: r.type,
			slug: r.slug,
			title: r.title,
			similarity:
				typeof r.similarity === "string"
					? Number(r.similarity)
					: r.similarity,
		}));
	} catch (err) {
		console.warn(
			`[findPagesByFuzzyTitle] similarity query failed, returning empty:`,
			(err as Error)?.message ?? err,
		);
		return [];
	}
}

export async function findPagesByExactTitle(
	args: { tenantId: string; ownerId: string; title: string },
	db: DbClient = defaultDb,
): Promise<
	Array<{ id: string; type: WikiPageType; slug: string; title: string }>
> {
	const rows = await db
		.select({
			id: wikiPages.id,
			type: wikiPages.type,
			slug: wikiPages.slug,
			title: wikiPages.title,
		})
		.from(wikiPages)
		.where(
			and(
				eq(wikiPages.tenant_id, args.tenantId),
				eq(wikiPages.owner_id, args.ownerId),
				eq(wikiPages.title, args.title),
				eq(wikiPages.status, "active"),
			),
		);
	return rows as Array<{
		id: string;
		type: WikiPageType;
		slug: string;
		title: string;
	}>;
}

/**
 * For each (memory_unit, page) pair in scope, return the page's type + slug
 * so the co-mention linker can filter to entity↔entity pairs and order
 * deterministically. Joins `wiki_section_sources → wiki_page_sections →
 * wiki_pages`, filtered to active pages in the requested (tenant, owner)
 * scope. The same query is used by the live compile and the Unit 4
 * backfill — that shared surface is the whole reason co-mention emission
 * reads this table rather than the planner's pageLinks wire.
 */
export async function findMemoryUnitPageSources(
	args: {
		tenantId: string;
		ownerId: string;
		memoryUnitIds: string[];
	},
	db: DbClient = defaultDb,
): Promise<
	Array<{
		memory_unit_id: string;
		page_id: string;
		page_type: WikiPageType;
		slug: string;
		title: string;
	}>
> {
	if (args.memoryUnitIds.length === 0) return [];
	const rows = await db
		.selectDistinct({
			memory_unit_id: wikiSectionSources.source_ref,
			page_id: wikiPages.id,
			page_type: wikiPages.type,
			slug: wikiPages.slug,
			title: wikiPages.title,
		})
		.from(wikiSectionSources)
		.innerJoin(
			wikiPageSections,
			eq(wikiSectionSources.section_id, wikiPageSections.id),
		)
		.innerJoin(wikiPages, eq(wikiPageSections.page_id, wikiPages.id))
		.where(
			and(
				eq(wikiSectionSources.source_kind, "memory_unit"),
				inArray(wikiSectionSources.source_ref, args.memoryUnitIds),
				eq(wikiPages.tenant_id, args.tenantId),
				eq(wikiPages.owner_id, args.ownerId),
				eq(wikiPages.status, "active"),
			),
		);
	return rows as Array<{
		memory_unit_id: string;
		page_id: string;
		page_type: WikiPageType;
		slug: string;
		title: string;
	}>;
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
		body_md: string | null;
		last_compiled_at: Date | null;
		backlink_count: number;
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
			body_md: wikiPages.body_md,
			last_compiled_at: wikiPages.last_compiled_at,
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
	const linkRows = await db
		.select({
			from_page_id: wikiPageLinks.from_page_id,
			to_page_id: wikiPageLinks.to_page_id,
		})
		.from(wikiPageLinks)
		.where(inArray(wikiPageLinks.to_page_id, ids));

	const aliasesByPage = new Map<string, string[]>();
	for (const a of aliasRows) {
		const list = aliasesByPage.get(a.page_id) || [];
		list.push(a.alias);
		aliasesByPage.set(a.page_id, list);
	}
	const backlinksByPage = new Map<string, number>();
	for (const link of linkRows) {
		backlinksByPage.set(
			link.to_page_id,
			(backlinksByPage.get(link.to_page_id) ?? 0) + 1,
		);
	}

	return pageRows.map((p) => ({
		id: p.id,
		type: p.type as WikiPageType,
		slug: p.slug,
		title: p.title,
		summary: p.summary,
		body_md: p.body_md,
		last_compiled_at: p.last_compiled_at,
		backlink_count: backlinksByPage.get(p.id) ?? 0,
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
					// First-seen-wins: existing wins when non-null, otherwise the
					// incoming place_id takes hold. A supplied-null `place_id`
					// (vs undefined) never clears an existing value — callers
					// that genuinely want to unset must do it explicitly.
					...(input.place_id !== undefined
						? {
								place_id: sql`COALESCE(${wikiPages.place_id}, ${input.place_id})` as any,
							}
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
					place_id: input.place_id ?? null,
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
		// Belt-and-suspenders: strip `[[wikilink]]` brackets before persist.
		// Prompts already forbid them, but models slip and they render as
		// literal noise on mobile (links come from wiki_page_links, not
		// prose). Do this at the repo boundary so every write path is
		// covered, not just the section-writer path.
		const cleanBody = stripWikilinks(section.body_md);
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
					body_md: cleanBody,
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
					body_md: cleanBody,
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

/** Trigram similarity threshold for fuzzy alias / title matching. Matches
 * the `hindsight_recall_filter.py` bar — keep aligned so duplicate-detection
 * behavior stays consistent across the repo. */
export const FUZZY_ALIAS_THRESHOLD = 0.85;

/** Trigram threshold for parent-title fuzzy lookup in the deterministic
 * linker. Lower than `FUZZY_ALIAS_THRESHOLD` because city candidates like
 * "Austin" vs existing page "Austin, Texas" score around 0.54 — below 0.85
 * but precision-acceptable once the geo-suffix gate in
 * `deterministic-linker.ts` filters out non-geographic hits like
 * "Austin Reggae Fest". Empirically tuned via
 * `packages/api/scripts/wiki-parent-link-audit.ts` against Marco's
 * 2026-04-20 corpus. Alias dedupe retains 0.85 — different precision bar. */
export const PARENT_TITLE_FUZZY_THRESHOLD = 0.5;

/**
 * Trigram-fallback variant of `findAliasMatches`. Returns every alias in
 * scope whose Postgres `similarity()` against `aliasNormalized` is
 * ≥ `FUZZY_ALIAS_THRESHOLD` (0.85). Filters to active pages only so
 * archived doppelgangers don't silently resurrect. Returns rows with the
 * matched page's `type` + `status` so callers can apply the type-mismatch
 * gate without a second lookup.
 *
 * Relies on the `idx_wiki_page_aliases_alias_trgm` GIN index from migration
 * 0015 for query performance; the function itself falls back to sequential
 * scan + returns empty if `pg_trgm` isn't installed (see Unit 3 fallback).
 */
export async function findAliasMatchesFuzzy(
	args: {
		tenantId: string;
		ownerId: string;
		aliasNormalized: string;
		threshold?: number;
	},
	db: DbClient = defaultDb,
): Promise<
	Array<{
		pageId: string;
		aliasId: string;
		aliasText: string;
		similarity: number;
		pageType: WikiPageType;
		pageStatus: string;
	}>
> {
	const threshold = args.threshold ?? FUZZY_ALIAS_THRESHOLD;
	try {
		const result = await db.execute(sql`
			SELECT
				${wikiPageAliases.page_id}    AS "pageId",
				${wikiPageAliases.id}         AS "aliasId",
				${wikiPageAliases.alias}      AS "aliasText",
				similarity(${wikiPageAliases.alias}, ${args.aliasNormalized}) AS "similarity",
				${wikiPages.type}             AS "pageType",
				${wikiPages.status}           AS "pageStatus"
			FROM ${wikiPageAliases}
			INNER JOIN ${wikiPages}
				ON ${wikiPageAliases.page_id} = ${wikiPages.id}
			WHERE ${wikiPages.tenant_id} = ${args.tenantId}
				AND ${wikiPages.owner_id} = ${args.ownerId}
				AND ${wikiPages.status} = 'active'
				AND similarity(${wikiPageAliases.alias}, ${args.aliasNormalized}) >= ${threshold}
			ORDER BY similarity(${wikiPageAliases.alias}, ${args.aliasNormalized}) DESC
			LIMIT 20
		`);
		const rows =
			(
				result as unknown as {
					rows?: Array<{
						pageId: string;
						aliasId: string;
						aliasText: string;
						similarity: number | string;
						pageType: WikiPageType;
						pageStatus: string;
					}>;
				}
			).rows ?? [];
		return rows.map((r) => ({
			pageId: r.pageId,
			aliasId: r.aliasId,
			aliasText: r.aliasText,
			similarity:
				typeof r.similarity === "string"
					? Number(r.similarity)
					: r.similarity,
			pageType: r.pageType,
			pageStatus: r.pageStatus,
		}));
	} catch (err) {
		// pg_trgm extension missing / permission issue / syntax reject. Caller
		// treats this as "no fuzzy matches" so the exact-match code path can
		// carry on unchanged.
		console.warn(
			`[findAliasMatchesFuzzy] similarity query failed, falling back to exact-only:`,
			(err as Error)?.message ?? err,
		);
		return [];
	}
}

/**
 * Look up an existing active page that this proposed page would collide with,
 * using the same two-pass alias machinery as the compiler's merge step
 * (`maybeMergeIntoExistingPage`): exact alias match first, then trigram-fuzzy
 * at {@link FUZZY_ALIAS_THRESHOLD}.
 *
 * Exact hits prefer same-type candidates (so a "Paris" topic page doesn't get
 * collapsed into an unrelated "Paris" entity). Fuzzy is strict same-type
 * because the over-collapse risk there is significant.
 *
 * Returns the matching page row, or null if nothing qualifies. Pure
 * lookup — no upsert side effects, unlike the compiler's merge helper
 * which re-seeds sections on hit.
 *
 * Extracted for reuse by the places-service auto-backing-page creator
 * (see packages/api/src/lib/wiki/places-service.ts).
 */
// `findExistingPageByTitleOrAlias` lives in ./page-lookup.ts — it imports
// the alias helpers above via `./repository.js` so vi.mock interception works
// for callers. Keeping it here would trap the internal calls in the same
// module scope and break test mocks.

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

	// Race-tolerant insert: the SELECT-then-INSERT window above is not
	// atomic. On a cursor-reset recompile (or any flow that re-emits the
	// same alias quickly), a sibling process can land the open row between
	// our SELECT and our INSERT, yielding a unique-index violation on
	// `(tenant_id, owner_id, alias_normalized, status)`. Switching to
	// ON CONFLICT DO NOTHING lets the caller progress; when the conflict
	// fires, we re-read the winning row and drive the same update path the
	// happy case would — so mention_count and sample_contexts still
	// accumulate (just one generation behind in the race case).
	const insertedRows = await db
		.insert(wikiUnresolvedMentions)
		.values({
			tenant_id: input.tenant_id,
			owner_id: input.owner_id,
			alias: input.alias,
			alias_normalized: input.alias_normalized,
			suggested_type: input.suggested_type ?? null,
			sample_contexts: contextEntry ? [contextEntry] : [],
		})
		.onConflictDoNothing()
		.returning({
			id: wikiUnresolvedMentions.id,
			mention_count: wikiUnresolvedMentions.mention_count,
		});

	if (insertedRows.length > 0) {
		return {
			id: insertedRows[0]!.id,
			mention_count: insertedRows[0]!.mention_count,
			inserted: true,
		};
	}

	// Conflict path: someone else inserted the open row. Re-read it and
	// apply the same update the first branch would have applied if the
	// SELECT had found it.
	const winnerRows = await db
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
	if (!winnerRows[0]) {
		// Conflict reported but re-read returned nothing — possible only if
		// the winning row was promoted/archived in the micro-gap between our
		// INSERT and our follow-up SELECT. Treat as a no-op; the next
		// planner invocation will re-attempt cleanly.
		console.warn(
			`[upsertUnresolvedMention] conflict without winner for ` +
				`(tenant=${input.tenant_id}, owner=${input.owner_id}, ` +
				`alias=${input.alias_normalized})`,
		);
		return { id: "", mention_count: 0, inserted: false };
	}
	const winner = winnerRows[0] as any;
	const winnerSamples = contextEntry
		? [contextEntry, ...((winner.sample_contexts ?? []) as any[])].slice(
				0,
				MAX_SAMPLE_CONTEXTS,
			)
		: winner.sample_contexts;
	await db
		.update(wikiUnresolvedMentions)
		.set({
			mention_count: sql`${wikiUnresolvedMentions.mention_count} + 1`,
			last_seen_at: sql`now()` as any,
			sample_contexts: winnerSamples,
			suggested_type: input.suggested_type ?? winner.suggested_type,
			updated_at: sql`now()` as any,
		})
		.where(eq(wikiUnresolvedMentions.id, winner.id));
	return {
		id: winner.id,
		mention_count: (winner.mention_count as number) + 1,
		inserted: false,
	};
}

/** Mark an unresolved mention as promoted and point it at the new page. */
export async function markUnresolvedPromoted(
	args: { mentionId: string; pageId: string },
	db: DbClient = defaultDb,
): Promise<void> {
	// Guard against hallucinated mention ids from the planner.
	if (!isValidUuid(args.mentionId) || !isValidUuid(args.pageId)) return;
	const result = await db.execute(sql`
		WITH target AS (
			SELECT id, tenant_id, owner_id, alias_normalized
			FROM wiki_unresolved_mentions
			WHERE id = ${args.mentionId}
		),
		updated AS (
			UPDATE wiki_unresolved_mentions mention
			SET status = 'promoted',
				promoted_page_id = ${args.pageId},
				updated_at = now()
			FROM target
			WHERE mention.id = target.id
			  AND NOT EXISTS (
				SELECT 1
				FROM wiki_unresolved_mentions other
				WHERE other.tenant_id = target.tenant_id
				  AND other.owner_id = target.owner_id
				  AND other.alias_normalized = target.alias_normalized
				  AND other.status = 'promoted'
				  AND other.id <> target.id
			  )
			RETURNING mention.id
		)
		SELECT id FROM updated
	`);

	if (((result as any).rows?.length ?? 0) > 0) return;

	// Retry/idempotency path: the same alias is already represented by a
	// promoted mention in this scope. Remove the stale open mention so future
	// planner passes do not keep trying to promote it into the same unique key.
	await db.execute(sql`
		DELETE FROM wiki_unresolved_mentions mention
		WHERE mention.id = ${args.mentionId}
		  AND mention.status = 'open'
		  AND EXISTS (
			SELECT 1
			FROM wiki_unresolved_mentions other
			WHERE other.tenant_id = mention.tenant_id
			  AND other.owner_id = mention.owner_id
			  AND other.alias_normalized = mention.alias_normalized
			  AND other.status = 'promoted'
			  AND other.id <> mention.id
		  )
	`);
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
): Promise<boolean> {
	if (args.fromPageId === args.toPageId) return false; // no self-links
	const returned = await db
		.insert(wikiPageLinks)
		.values({
			from_page_id: args.fromPageId,
			to_page_id: args.toPageId,
			kind: args.kind ?? "reference",
			context: args.context ?? null,
		})
		.onConflictDoNothing()
		.returning({ id: wikiPageLinks.id });
	// Empty array = the ON CONFLICT DO NOTHING path fired (edge already
	// existed). Callers that track metrics should NOT double-count on
	// re-runs.
	return returned.length > 0;
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

// ---------------------------------------------------------------------------
// Read surfaces — powered by the `WikiPage` GraphQL field resolvers (Unit 8)
// ---------------------------------------------------------------------------

/** Server-side hard cap for `sourceMemoryIds(limit)` — protects the
 * sections-sources join from accidental unbounded scans on heavy pages. */
export const SOURCE_MEMORY_IDS_MAX_LIMIT = 50;

/**
 * Count distinct `memory_unit` source_refs across every section on `pageId`.
 * Drives the "Based on N memories" badge in the mobile page detail screen.
 * Returns 0 for pages with no section-sources rows (the compile pipeline
 * hasn't cited them yet, or they're pure-aggregation sections).
 */
export async function countSourceMemoriesForPage(
	pageId: string,
	db: DbClient = defaultDb,
): Promise<number> {
	if (!isValidUuid(pageId)) return 0;
	const result = await db.execute(sql`
		SELECT COUNT(DISTINCT ${wikiSectionSources.source_ref})::int AS n
		FROM ${wikiSectionSources}
		INNER JOIN ${wikiPageSections}
			ON ${wikiPageSections.id} = ${wikiSectionSources.section_id}
		WHERE ${wikiPageSections.page_id} = ${pageId}
			AND ${wikiSectionSources.source_kind} = 'memory_unit'
	`);
	const rows = (result as unknown as { rows?: Array<{ n: number }> }).rows ?? [];
	return rows[0]?.n ?? 0;
}

/**
 * Up to `limit` distinct `memory_unit` ids sourcing sections on `pageId`,
 * ordered by `created_at` DESC (most recently cited first). Caller's `limit`
 * is clamped to `[1, SOURCE_MEMORY_IDS_MAX_LIMIT]` — protects the API from
 * unbounded scans when a mobile client accidentally asks for 100k.
 */
export async function listSourceMemoryIdsForPage(
	pageId: string,
	limit: number,
	db: DbClient = defaultDb,
): Promise<string[]> {
	if (!isValidUuid(pageId)) return [];
	const bounded = Math.max(1, Math.min(limit, SOURCE_MEMORY_IDS_MAX_LIMIT));
	const result = await db.execute(sql`
		SELECT DISTINCT ON (${wikiSectionSources.source_ref})
			${wikiSectionSources.source_ref} AS "sourceRef",
			${wikiSectionSources.first_seen_at} AS "firstSeenAt"
		FROM ${wikiSectionSources}
		INNER JOIN ${wikiPageSections}
			ON ${wikiPageSections.id} = ${wikiSectionSources.section_id}
		WHERE ${wikiPageSections.page_id} = ${pageId}
			AND ${wikiSectionSources.source_kind} = 'memory_unit'
		ORDER BY ${wikiSectionSources.source_ref}, ${wikiSectionSources.first_seen_at} DESC
		LIMIT ${bounded}
	`);
	const rows =
		(result as unknown as {
			rows?: Array<{ sourceRef: string; firstSeenAt: string | Date }>;
		}).rows ?? [];
	return rows.map((r) => r.sourceRef);
}

/**
 * Active child pages of `parentPageId`. Shape matches `WikiPageRow` so the
 * GraphQL mapper can accept them with no conversion step. Ordered by
 * `(type, slug)` — same deterministic ordering the compile pipeline uses
 * for list surfaces.
 */
export async function listActiveChildPages(
	parentPageId: string,
	db: DbClient = defaultDb,
): Promise<WikiPageRow[]> {
	if (!isValidUuid(parentPageId)) return [];
	const rows = await db
		.select()
		.from(wikiPages)
		.where(
			and(
				eq(wikiPages.parent_page_id, parentPageId),
				eq(wikiPages.status, "active"),
			),
		)
		.orderBy(asc(wikiPages.type), asc(wikiPages.slug));
	return rows as WikiPageRow[];
}

/**
 * Reverse-lookup of a promotion: given a promoted page's id, find the
 * section on its parent page whose aggregation metadata claims it. Returns
 * null when the page is top-level OR the parent-section row has since been
 * archived. The compile applier writes both halves (parent_page_id on the
 * child, promoted_page_id into the parent-section's jsonb) so the mapping
 * is intentionally directional — we scan for the section on the parent.
 */
export async function findPromotedFromSection(
	pageId: string,
	db: DbClient = defaultDb,
): Promise<{
	parentPageId: string;
	sectionId: string;
	sectionSlug: string;
	sectionHeading: string;
} | null> {
	if (!isValidUuid(pageId)) return null;
	const [page] = await db
		.select({
			id: wikiPages.id,
			parent_page_id: wikiPages.parent_page_id,
		})
		.from(wikiPages)
		.where(eq(wikiPages.id, pageId))
		.limit(1);
	if (!page?.parent_page_id) return null;

	// pg_jsonb `@>` containment — matches the section whose aggregation
	// jsonb has `promoted_page_id = <pageId>`. Cheaper than `->>` scans
	// because jsonb_path_ops supports containment via GIN when present.
	const needle = JSON.stringify({ promoted_page_id: pageId });
	const result = await db.execute(sql`
		SELECT id, section_slug AS "sectionSlug", heading
		FROM ${wikiPageSections}
		WHERE page_id = ${page.parent_page_id}
			AND aggregation @> ${needle}::jsonb
		LIMIT 1
	`);
	const rows =
		(result as unknown as {
			rows?: Array<{ id: string; sectionSlug: string; heading: string }>;
		}).rows ?? [];
	const row = rows[0];
	if (!row) return null;
	return {
		parentPageId: page.parent_page_id,
		sectionId: row.id,
		sectionSlug: row.sectionSlug,
		sectionHeading: row.heading,
	};
}

/**
 * Active pages denormalized into the named section's `aggregation
 * .linked_page_ids` array. Runs two indexed lookups — one to resolve the
 * section by (pageId, sectionSlug), one to fetch the child pages by id
 * list. Returns [] when the section doesn't exist, has no aggregation
 * metadata, or every linked page has been archived.
 */
export async function listSectionChildPages(
	args: { pageId: string; sectionSlug: string },
	db: DbClient = defaultDb,
): Promise<WikiPageRow[]> {
	if (!isValidUuid(args.pageId)) return [];
	const [section] = await db
		.select({ aggregation: wikiPageSections.aggregation })
		.from(wikiPageSections)
		.where(
			and(
				eq(wikiPageSections.page_id, args.pageId),
				eq(wikiPageSections.section_slug, args.sectionSlug),
			),
		)
		.limit(1);
	const agg = section?.aggregation as SectionAggregation | null | undefined;
	const linkedIds = Array.isArray(agg?.linked_page_ids)
		? agg!.linked_page_ids.filter(isValidUuid)
		: [];
	if (linkedIds.length === 0) return [];

	const rows = await db
		.select()
		.from(wikiPages)
		.where(
			and(inArray(wikiPages.id, linkedIds), eq(wikiPages.status, "active")),
		)
		.orderBy(asc(wikiPages.type), asc(wikiPages.slug));
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
		// Delete unresolved mentions FIRST so the page delete that follows isn't
		// blocked by the FK from wiki_unresolved_mentions.promoted_page_id →
		// wiki_pages.id. The FK is not set to cascade (nulling promoted_page_id
		// would preserve mention history, but the wipe explicitly discards the
		// whole scope's mention set anyway, so just delete the mentions up
		// front).
		await tx
			.delete(wikiUnresolvedMentions)
			.where(
				and(
					eq(wikiUnresolvedMentions.tenant_id, args.tenantId),
					eq(wikiUnresolvedMentions.owner_id, args.ownerId),
				),
			);
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
// wiki_places — canonical location records
//
// Scoped per (tenant, owner) like every other wiki table. The partial unique
// index on (tenant_id, owner_id, google_place_id) WHERE google_place_id IS
// NOT NULL enforces first-seen-wins; callers must handle the resulting
// unique-violation by reading the existing row.
// ---------------------------------------------------------------------------

export interface UpsertWikiPlaceInput {
	tenant_id: string;
	owner_id: string;
	name: string;
	google_place_id?: string | null;
	geo_lat?: number | string | null;
	geo_lon?: number | string | null;
	address?: string | null;
	parent_place_id?: string | null;
	place_kind?: WikiPlaceKind | null;
	source: WikiPlaceSource;
	source_payload?: unknown | null;
}

/**
 * Look up a wiki_places row by its (tenant, owner, google_place_id). Returns
 * null when no row exists. Used by the places-service to short-circuit
 * Google API calls when a record's POI id has already been materialized.
 */
export async function findPlaceByGooglePlaceId(
	args: {
		tenantId: string;
		ownerId: string;
		googlePlaceId: string;
	},
	db: DbClient = defaultDb,
): Promise<WikiPlaceRow | null> {
	if (!args.googlePlaceId) return null;
	const rows = await db
		.select()
		.from(wikiPlaces)
		.where(
			and(
				eq(wikiPlaces.tenant_id, args.tenantId),
				eq(wikiPlaces.owner_id, args.ownerId),
				eq(wikiPlaces.google_place_id, args.googlePlaceId),
			),
		)
		.limit(1);
	return (rows[0] as WikiPlaceRow) ?? null;
}

/**
 * Look up a wiki_places row by id, scope-checked. Returns null on mismatch.
 */
export async function findPlaceById(
	args: { tenantId: string; ownerId: string; id: string },
	db: DbClient = defaultDb,
): Promise<WikiPlaceRow | null> {
	const rows = await db
		.select()
		.from(wikiPlaces)
		.where(
			and(
				eq(wikiPlaces.id, args.id),
				eq(wikiPlaces.tenant_id, args.tenantId),
				eq(wikiPlaces.owner_id, args.ownerId),
			),
		)
		.limit(1);
	return (rows[0] as WikiPlaceRow) ?? null;
}

/**
 * Find a wiki_page whose `place_id` matches. Used by the hierarchy linker
 * (Unit 7) to look up the parent page from the parent place. Returns null
 * when no backing page exists — that's a signal worth logging (the auto-
 * create-backing-page step in places-service should have ensured one).
 */
export async function findPageByPlaceId(
	args: { tenantId: string; ownerId: string; placeId: string },
	db: DbClient = defaultDb,
): Promise<WikiPageRow | null> {
	const rows = await db
		.select()
		.from(wikiPages)
		.where(
			and(
				eq(wikiPages.tenant_id, args.tenantId),
				eq(wikiPages.owner_id, args.ownerId),
				eq(wikiPages.place_id, args.placeId),
				eq(wikiPages.status, "active"),
			),
		)
		.limit(1);
	return (rows[0] as WikiPageRow) ?? null;
}

/**
 * Insert a wiki_places row, or return the existing row if the partial
 * unique index fires. On conflict the row is re-read from the
 * `(tenant_id, owner_id, google_place_id)` partial unique so callers get
 * the canonical id to link against.
 *
 * ON CONFLICT DO NOTHING is used instead of DO UPDATE because first-
 * seen-wins is the product decision — re-running compile should never
 * overwrite the original row's payload or coordinates. Rows without
 * `google_place_id` are always inserted (the partial unique doesn't cover
 * them).
 *
 * Returns `{ row, inserted }` so callers can distinguish "new row written"
 * from "existing row returned" — useful for metrics and logs.
 */
export async function upsertPlace(
	input: UpsertWikiPlaceInput,
	db: DbClient = defaultDb,
): Promise<{ row: WikiPlaceRow; inserted: boolean }> {
	const values = {
		tenant_id: input.tenant_id,
		owner_id: input.owner_id,
		name: input.name,
		google_place_id: input.google_place_id ?? null,
		// numeric columns accept string; stringify numbers to preserve precision.
		geo_lat:
			input.geo_lat === null || input.geo_lat === undefined
				? null
				: String(input.geo_lat),
		geo_lon:
			input.geo_lon === null || input.geo_lon === undefined
				? null
				: String(input.geo_lon),
		address: input.address ?? null,
		parent_place_id: input.parent_place_id ?? null,
		place_kind: input.place_kind ?? null,
		source: input.source,
		source_payload: (input.source_payload ?? null) as any,
	};

	const inserted = await db
		.insert(wikiPlaces)
		.values(values as any)
		.onConflictDoNothing()
		.returning();

	if (inserted[0]) {
		return { row: inserted[0] as WikiPlaceRow, inserted: true };
	}

	// Conflict — read the existing row via google_place_id (the partial
	// unique key). If google_place_id is null, the conflict can't have
	// fired on the partial unique and we should never land here; log and
	// bail gracefully.
	if (!input.google_place_id) {
		throw new Error(
			`upsertPlace: INSERT returned no row with null google_place_id — scope (${input.tenant_id}, ${input.owner_id}) name=${input.name}`,
		);
	}
	const existing = await findPlaceByGooglePlaceId(
		{
			tenantId: input.tenant_id,
			ownerId: input.owner_id,
			googlePlaceId: input.google_place_id,
		},
		db,
	);
	if (!existing) {
		throw new Error(
			`upsertPlace: conflict on google_place_id=${input.google_place_id} but no existing row in scope (${input.tenant_id}, ${input.owner_id})`,
		);
	}
	console.warn(
		`[wiki-places] upsert_conflict_reused: google_place_id=${input.google_place_id} scope=(${input.tenant_id.slice(0, 8)},${input.owner_id.slice(0, 8)})`,
	);
	return { row: existing, inserted: false };
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
