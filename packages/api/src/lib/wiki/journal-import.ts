/**
 * Bulk import of an external "journal" dataset into Hindsight as normalized
 * memory records, scoped to one (tenant, agent) pair.
 *
 * v1 use case: seed the Compounding Memory pipeline for agent GiGi with
 * Amy's historical restaurant notes. One source row (`journal.idea`)
 * becomes one memory record, with the joined place + journal context
 * carried in `metadata` so the compile pipeline has everything it needs
 * to build compounded pages (see .prds/compounding-memory-v1-build-plan.md
 * PR 5).
 *
 * Key behavior:
 *   - Streams rows in batches of 200 via keyset pagination (idea.id > :last)
 *   - Renders a deterministic prose `content.text` + short `content.summary`
 *   - Calls `adapter.retain()` (NOT `retainTurn`) — these are already
 *     distilled units, not conversational turns
 *   - Suppresses the per-record compile enqueue by construction: the
 *     import path talks to the adapter directly; the memory-retain handler
 *     is never invoked, so its enqueue hook never fires
 *   - On completion, enqueues ONE terminal compile job so the full cursor
 *     drains in a single pass
 */

import { sql } from "drizzle-orm";
import type { MemoryAdapter } from "../memory/adapter.js";
import { getMemoryServices } from "../memory/index.js";
import { db } from "../db.js";
import { enqueueCompileJob } from "./repository.js";

export interface JournalImportArgs {
	accountId: string;
	tenantId: string;
	agentId: string;
	/** Optional cap for smoke-tests (e.g. 50). Unset = ingest everything. */
	limit?: number;
	/** Injected for tests; defaults to the process memory adapter. */
	adapter?: MemoryAdapter;
}

export interface JournalImportResult {
	accountId: string;
	tenantId: string;
	agentId: string;
	recordsIngested: number;
	recordsSkipped: number;
	errors: number;
	compileJobId: string | null;
	compileJobDeduped: boolean;
	latencyMs: number;
}

// `pg` returns timestamp columns as Date by default but as string in some
// pool configurations (no type parser bound for OID 1114/1184). Accept both
// shapes; the prose + metadata path routes every timestamp through
// toIsoSafe() so neither case throws.
interface JournalIdeaRow {
	id: string;
	body: string | null;
	tags: string[] | null;
	created: Date | string | null;
	date_created: Date | string | null;
	is_visit: boolean | null;
	is_favorite: boolean | null;
	geo_lat: number | null;
	geo_lon: number | null;
	images: string[] | null;
	external_id: number | null;
	idea_metadata: Record<string, unknown> | null;
	place_id: string | null;
	place_name: string | null;
	place_address: string | null;
	place_types: string[] | null;
	place_lat: number | null;
	place_lon: number | null;
	place_google_id: string | null;
	place_metadata: Record<string, unknown> | null;
	journal_id: string | null;
	journal_title: string | null;
	journal_description: string | null;
	journal_start_date: Date | string | null;
	journal_end_date: Date | string | null;
	journal_tags: string[] | null;
}

const BATCH_SIZE = 200;
const SUMMARY_MAX = 240;

export async function runJournalImport(
	args: JournalImportArgs,
): Promise<JournalImportResult> {
	const started = Date.now();
	const adapter = args.adapter ?? getMemoryServices().adapter;
	const hardLimit = args.limit && args.limit > 0 ? args.limit : Number.POSITIVE_INFINITY;

	let lastId = "";
	let recordsIngested = 0;
	let recordsSkipped = 0;
	let errors = 0;

	// Include errors in the processed-count so a scope-wide failure still
	// respects the limit. Otherwise 338 broken rows would spin through the
	// whole account even when the caller asked for 10.
	const processed = () => recordsIngested + recordsSkipped + errors;
	while (processed() < hardLimit) {
		const remaining = hardLimit - processed();
		const pageSize = Math.min(BATCH_SIZE, remaining);
		const rows = await fetchPage(args.accountId, lastId, pageSize);
		if (rows.length === 0) break;

		for (const row of rows) {
			lastId = row.id;
			try {
				const payload = buildRetainPayload(row, {
					tenantId: args.tenantId,
					agentId: args.agentId,
				});
				if (!payload) {
					recordsSkipped += 1;
					continue;
				}
				await adapter.retain(payload);
				recordsIngested += 1;
			} catch (err) {
				errors += 1;
				console.warn(
					`[journal-import] idea=${row.id} retain failed: ${(err as Error)?.message}`,
				);
			}
		}

		if (rows.length < pageSize) break;
	}

	// Single terminal compile for the whole ingest. bootstrap_import trigger
	// signals to any observer that this job was a bulk operation, not a
	// post-turn enqueue.
	let compileJobId: string | null = null;
	let compileJobDeduped = false;
	if (recordsIngested > 0) {
		try {
			const { inserted, job } = await enqueueCompileJob({
				tenantId: args.tenantId,
				ownerId: args.agentId,
				trigger: "bootstrap_import",
			});
			compileJobId = job.id;
			compileJobDeduped = !inserted;
		} catch (err) {
			console.warn(
				`[journal-import] terminal compile enqueue failed: ${(err as Error)?.message}`,
			);
		}
	}

	return {
		accountId: args.accountId,
		tenantId: args.tenantId,
		agentId: args.agentId,
		recordsIngested,
		recordsSkipped,
		errors,
		compileJobId,
		compileJobDeduped,
		latencyMs: Date.now() - started,
	};
}

// ---------------------------------------------------------------------------
// Query — keyset pagination on (account_id, id). `journal.idea.id` is a cuid-
// style text key; ordering is stable.
// ---------------------------------------------------------------------------

async function fetchPage(
	accountId: string,
	lastId: string,
	limit: number,
): Promise<JournalIdeaRow[]> {
	const result = await db.execute(sql`
		SELECT
			i.id, i.body, i.tags, i.created, i.date_created,
			i.is_visit, i.is_favorite, i.geo_lat, i.geo_lon, i.images,
			i.external_id, i.metadata AS idea_metadata,
			i.place_id,
			p.name AS place_name, p.address AS place_address,
			p.types AS place_types, p.geo_lat AS place_lat, p.geo_lon AS place_lon,
			p.google_place_id AS place_google_id, p.metadata AS place_metadata,
			i.journal_id,
			j.title AS journal_title, j.description AS journal_description,
			j.start_date AS journal_start_date, j.end_date AS journal_end_date,
			j.tags AS journal_tags
		FROM journal.idea i
		LEFT JOIN journal.place p ON p.id = i.place_id
		LEFT JOIN journal.journal j ON j.id = i.journal_id
		WHERE i.account_id = ${accountId}
		  AND i.id > ${lastId}
		ORDER BY i.id ASC
		LIMIT ${limit}
	`);
	return ((result as unknown as { rows?: JournalIdeaRow[] }).rows ??
		[]) as JournalIdeaRow[];
}

// ---------------------------------------------------------------------------
// Prose rendering — deterministic, grounded. Matches the template in the
// build plan; tests pin the exact output for representative rows.
// ---------------------------------------------------------------------------

export interface BuildPayloadOwner {
	tenantId: string;
	agentId: string;
}

export function buildRetainPayload(
	row: JournalIdeaRow,
	owner: BuildPayloadOwner,
) {
	const text = renderRecordText(row);
	// Skip records with neither body text nor a place anchor — nothing the
	// compiler could meaningfully compound on.
	const hasBody = !!(row.body && row.body.trim().length > 0);
	const hasPlace = !!(row.place_name && row.place_name.trim().length > 0);
	if (!hasBody && !hasPlace) return null;

	const summary = buildSummary(row);
	const metadata = buildMetadata(row);

	return {
		tenantId: owner.tenantId,
		ownerType: "agent" as const,
		ownerId: owner.agentId,
		sourceType: "import" as const,
		content: text,
		metadata,
	};
}

function renderRecordText(row: JournalIdeaRow): string {
	const parts: string[] = [];
	parts.push((row.body && row.body.trim()) || "Visited.");

	if (row.journal_title) {
		let line = `From journal "${row.journal_title.trim()}"`;
		if (row.journal_start_date) {
			const start = formatDate(row.journal_start_date);
			const end = row.journal_end_date
				? `–${formatDate(row.journal_end_date)}`
				: "";
			line += ` (${start}${end})`;
		}
		parts.push(`\n${line}.`);
	}

	if (row.place_name) {
		let line = `Place: ${row.place_name.trim()}`;
		if (row.place_address) line += ` — ${row.place_address.trim()}`;
		if (row.place_types && row.place_types.length > 0) {
			line += ` [${row.place_types.join(", ")}]`;
		}
		parts.push(`\n${line}.`);
	}

	if (row.tags && row.tags.length > 0) {
		parts.push(`\nTags: ${row.tags.join(", ")}.`);
	}

	return parts.join("\n").trim();
}

function buildSummary(row: JournalIdeaRow): string {
	const body = row.body?.trim();
	if (body && body.length > 0) {
		return body.length <= SUMMARY_MAX ? body : `${body.slice(0, SUMMARY_MAX - 1)}…`;
	}
	const bits: string[] = [];
	if (row.place_name) bits.push(`Visited ${row.place_name}`);
	if (row.tags && row.tags.length > 0) bits.push(`[${row.tags.join(", ")}]`);
	if (row.place_types && row.place_types.length > 0) {
		bits.push(`(${row.place_types.slice(0, 3).join(", ")})`);
	}
	const joined = bits.join(" ").trim();
	return joined.length === 0
		? "Imported journal entry"
		: joined.length <= SUMMARY_MAX
			? joined
			: `${joined.slice(0, SUMMARY_MAX - 1)}…`;
}

function buildMetadata(row: JournalIdeaRow): Record<string, unknown> {
	const metadata: Record<string, unknown> = {
		idea: {
			external_id: row.external_id,
			tags: row.tags ?? [],
			is_visit: !!row.is_visit,
			is_favorite: !!row.is_favorite,
			images: row.images ?? [],
			created: toIsoSafe(row.created) ?? toIsoSafe(row.date_created),
			geo_lat: row.geo_lat,
			geo_lon: row.geo_lon,
		},
		import: {
			source: "journal.idea",
			journal_idea_id: row.id,
		},
	};
	if (row.place_id || row.place_name) {
		metadata.place = {
			id: row.place_id,
			google_place_id: row.place_google_id,
			name: row.place_name,
			address: row.place_address,
			types: row.place_types ?? [],
			geo_lat: row.place_lat,
			geo_lon: row.place_lon,
			extra: compactPlaceMetadata(row.place_metadata),
		};
	}
	if (row.journal_id) {
		metadata.journal = {
			id: row.journal_id,
			title: row.journal_title,
			description: row.journal_description,
			start_date: formatDate(row.journal_start_date),
			end_date: formatDate(row.journal_end_date),
			tags: row.journal_tags ?? [],
		};
	}
	return metadata;
}

/**
 * Google Places `metadata` carries huge photo reference arrays we don't want
 * the planner to pay tokens for. Strip them; keep name/phone/rating/website/
 * hours-style fields.
 */
function compactPlaceMetadata(
	metadata: Record<string, unknown> | null,
): Record<string, unknown> | null {
	if (!metadata) return null;
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(metadata)) {
		if (k === "photos") continue;
		if (v == null) continue;
		if (typeof v === "string" && v.length > 600) continue;
		if (Array.isArray(v) && v.length > 30) continue;
		out[k] = v;
	}
	return Object.keys(out).length === 0 ? null : out;
}

function formatDate(date: Date | string | null | undefined): string | null {
	const iso = toIsoSafe(date);
	return iso ? iso.slice(0, 10) : null;
}

/**
 * pg returns timestamp columns as Date in some configs but as string in
 * others (esp. when the column has no `pg` parser installed on the pool).
 * Normalize to ISO string or null — never throw.
 */
function toIsoSafe(
	value: Date | string | number | null | undefined,
): string | null {
	if (value == null) return null;
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? null : value.toISOString();
	}
	try {
		const d = new Date(value as any);
		return Number.isNaN(d.getTime()) ? null : d.toISOString();
	} catch {
		return null;
	}
}
